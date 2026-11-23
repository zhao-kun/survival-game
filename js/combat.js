// ============================================================
// combat.js —— 战斗与交互：近战攻击 / 采集 / 射击 / 放置 / 使用
// ============================================================
import * as THREE from 'three';
import { BLOCK, BLOCKS, ITEMS, GAMEPLAY, PLAN_GROUPS, BOOKS, W_TIER, weaponInfo } from './config.js';
import { randRange, clamp } from './utils.js';
import { MAT } from './sfx.js';
import { spawnParticle } from './entities.js';

export class Combat {
  constructor(game) {
    this.game = game;
    this.attackCd = 0;
    this.mining = null;   // { key, progress }
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;
    const input = g.input;
    if (g.ui.isAnyPanelOpen()) { this.mining = null; return; }

    this.attackCd -= dt;
    const slot = g.inventory.selectedSlot();
    const itemId = slot?.id ?? null;
    const item = itemId ? ITEMS[itemId] : null;

    // ---- 左键：远程射击 / 近战 & 采集 ----
    if (item && item.kind === 'ranged') {
      this.mining = null;
      if (input.lmbPressed) this.tryShoot(item, slot, itemId);
    } else {
      if (input.lmbPressed) this.tryMelee(item, slot, itemId);
      if (input.lmb) this.updateMining(dt, item);
      else this.mining = null;
    }

    // ---- 右键：放置 / 使用 ----
    if (input.rmbPressed) this.useOrPlace(itemId, item);
  }

  // 手持物品实例上的插件效果汇总
  instMods(slot) {
    const out = { meleeDmg: 0, atkSpeed: 0, crit: 0, rangedDmg: 0,
      bleedMul: 0, stunAdd: 0, headAdd: 0, crippleAdd: 0, aoeAdd: 0, pierceAdd: 0 };   // M7：特技强化插件
    for (const mid of slot?.mods ?? []) {
      const e = ITEMS[mid]?.effect;
      if (!e) continue;
      if (e.k === 'meleeDmg') out.meleeDmg += e.v;
      else if (e.k === 'atkSpeed') out.atkSpeed += e.v;
      else if (e.k === 'crit') out.crit += e.v;
      else if (e.k === 'rangedDmg') out.rangedDmg += e.v;
      else if (e.k === 'bleedMul') out.bleedMul += e.v;
      else if (e.k === 'stunAdd') out.stunAdd += e.v;
      else if (e.k === 'headAdd') out.headAdd += e.v;
      else if (e.k === 'crippleAdd') out.crippleAdd += e.v;
      else if (e.k === 'aoeAdd') out.aoeAdd += e.v;
      else if (e.k === 'pierceAdd') out.pierceAdd += e.v;
    }
    return out;
  }

  // ---------------- 近战 ----------------
  tryMelee(item, slot = null, itemId = null) {
    const g = this.game;
    const p = g.player;
    const mods = p.mods ?? g.skills.mods;
    const im = this.instMods(slot);
    const info = weaponInfo(itemId ?? item?.id);   // M4：v2 武器解析（ITEMS 对象无 id 字段，需传字符串；旧武器 null 不受限）

    // M4 熟练度解锁限制
    if (info && !g.mastery.isUnlocked(info.cls, info.mat, info.lv)) {
      g.ui.toast(`${item?.name ?? '该武器'}品级尚未解锁——研读技能书提升熟练度（J 查看进度）`, '#ff9d5c');
      return;
    }

    const damage = (item?.damage ?? 1.5) + im.meleeDmg;
    const rate = (item?.rate ?? 0.6) / (mods.attackMul + im.atkSpeed);
    if (this.attackCd > 0) return;
    this.attackCd = rate;
    p.swing();

    const eye = p.eyePos;
    const look = p.lookDir();
    const reach = GAMEPLAY.MELEE_REACH;
    let hitAny = false;

    const targets = [...g.entities.zombies, ...g.entities.animals];
    let best = null, bestDist = Infinity;
    for (const e of targets) {
      if (e.dead) continue;
      const c = new THREE.Vector3(e.pos.x, e.pos.y + 0.9, e.pos.z);
      const to = c.clone().sub(eye);
      const dist = to.length();
      if (dist > reach) continue;
      to.normalize();
      if (to.dot(look) < 0.55) continue;   // 约 56° 锥角
      if (dist < bestDist) { best = e; bestDist = dist; }
    }

    if (best) {
      hitAny = true;
      let dmg = damage * mods.meleeMul * g.player.fxMul('meleeMul');   // 强壮增益 / 断手减半
      const crit = Math.random() < (mods.crit + im.crit);
      if (crit) dmg *= 2;
      const knock = look.clone().setY(0).normalize().multiplyScalar(item?.knock ?? 1);
      const fxToast = info ? this.applyMeleeFx(info, best, dmg, look, eye, im) : false;   // M4：特技先于主伤害（断头/爆头追加）；M7：传插件
      best.takeDamage(dmg, knock);
      g.sfx?.[crit ? 'crit' : 'hit']();   // 命中音效（暴击更亮）
      if (!fxToast && !best.dead) g.ui.toast(crit ? `🎯 暴击！-${Math.round(dmg)}` : `-${Math.round(dmg)}`, crit ? '#ffd54a' : '#ff9d5c');   // 特技提示优先
      p.addXp(2);
    }

    // 未命中实体时若指向方块则开始采集（updateMining 持续处理）
    if (!hitAny) this.updateMining(0.0001, item);
  }

  // ---------------- M4 近战特技（docs/WEAPONS-DESIGN.md 4.1） ----------------
  // 刀：流血 dps=2+0.4lv/4s + 断头 8%+2%lv；棍：击飞 vy3.5 + 爆头 15%+2%lv 总伤×3；
  // 锤：扇形 AOE 半径 3.5+0.1lv 副目标 60% + 震慢 25%+2%lv/2s（主目标也判）；枪：致残 30%+3%lv/4s + 直线穿透 70% 最多 3+floor(lv/2)
  applyMeleeFx(info, main, dmg, look, eye, im = null) {
    const g = this.game;
    const lv = info.lv;
    const imB = im?.bleedMul ?? 0, imS = im?.stunAdd ?? 0, imH = im?.headAdd ?? 0;
    const imC = im?.crippleAdd ?? 0, imA = im?.aoeAdd ?? 0, imP = im?.pierceAdd ?? 0;
    if (info.cls === 'knife') {
      main.applyStatus?.('bleed', 4, (2 + 0.4 * lv) * (1 + imB));   // M7 放血：流血 dps +25%
      if (Math.random() < 0.08 + 0.02 * lv + imH) {   // 断头：直接斩杀；M7 狩猎：概率 +6%
        main.takeDamage(9999, null);
        g.sfx?.decap();   // M8 验收：专属断头音效
        for (let i = 0; i < 5; i++) spawnParticle(g, main.pos.x, main.pos.y + 1.4, main.pos.z, 0xd0021b, 0.5);   // 颈部血粒迸溅
        g.ui.toast('🗡️ 断头一击！', '#ff5c5c');
        return true;
      }
    } else if (info.cls === 'club') {
      main.vel.y = Math.max(main.vel.y ?? 0, 3.5);   // 击飞
      if (Math.random() < 0.15 + 0.02 * lv + imH) {        // 爆头：总伤 ×3；M7 狩猎：概率 +6%
        main.takeDamage(dmg * 2, null);
        g.ui.toast('💥 爆头！伤害 ×3', '#ffd54a');
        return true;
      }
    } else if (info.cls === 'hammer') {
      if (Math.random() < 0.25 + 0.02 * lv + imS) main.applyStatus?.('slow', 2);   // 主目标震慢；M7 震慑：+10%
      const radius = 3.5 + 0.1 * lv + imA;   // M7 荡涤：扇形半径 +0.6m
      const cosHalf = Math.cos(Math.PI / 3);   // 60° 半角扇形
      let n = 0;
      for (const e of [...g.entities.zombies, ...g.entities.animals]) {
        if (e === main || e.dead) continue;
        const c = new THREE.Vector3(e.pos.x - eye.x, e.pos.y + 0.9 - eye.y, e.pos.z - eye.z);
        if (c.length() > radius || c.normalize().dot(look) < cosHalf) continue;
        e.takeDamage(dmg * 0.6, look.clone().setY(0).normalize().multiplyScalar(1));
        if (Math.random() < 0.25 + 0.02 * lv + imS) e.applyStatus?.('slow', 2);
        for (let i = 0; i < 3; i++) spawnParticle(g, e.pos.x, e.pos.y + 1.2, e.pos.z, 0xffd54a, 0.4);   // M8 验收：扇形波及金色尘粒
        n++;
      }
      if (n > 0) { g.ui.toast(`🔨 震地打击：波及 ${n} 个目标`, '#ffd54a'); return true; }
    } else if (info.cls === 'spear') {
      if (Math.random() < 0.30 + 0.03 * lv + imC) main.applyStatus?.('cripple', 4);   // M7 破甲：+12%
      const maxP = 3 + Math.floor(lv / 2) + Math.round(imP);   // M7 贯穿：人数 +1
      let n = 0;
      for (const e of [...g.entities.zombies, ...g.entities.animals]) {
        if (e === main || e.dead || n >= maxP) continue;
        const v = new THREE.Vector3(e.pos.x - main.pos.x, 0, e.pos.z - main.pos.z);   // 主目标后方直线
        const ahead = v.dot(look);
        if (ahead <= 0) continue;
        if (v.clone().sub(look.clone().multiplyScalar(ahead)).length() > 0.9) continue;
        e.takeDamage(dmg * 0.7, look.clone().setY(0).normalize().multiplyScalar(1));
        for (let i = 0; i < 2; i++) spawnParticle(g, e.pos.x, e.pos.y + 1.1, e.pos.z, 0x9dff6c, 0.35);   // M8 验收：贯穿点绿色标记粒
        n++;
      }
      if (n > 0) { g.ui.toast(`⚔️ 突穿：贯穿 ${n} 个目标`, '#ffd54a'); return true; }
    }
    return false;
  }

  // ---------------- 采集（按住左键） ----------------
  updateMining(dt, item) {
    const g = this.game;
    const p = g.player;
    const eye = p.eyePos;
    const look = p.lookDir();
    const hit = g.world.raycast(eye, look, GAMEPLAY.REACH);
    if (!hit) { this.mining = null; g.ui.updateMineProgress(null); return; }

    const meta = BLOCKS[hit.id];
    if (!meta || meta.hardness === undefined || meta.hardness === Infinity) {
      this.mining = null; g.ui.updateMineProgress(null); return;
    }

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (!this.mining || this.mining.key !== key) {
      this.mining = { key, progress: 0, pos: hit };
    }

    // 工具匹配
    const tool = item?.tool;
    const matches = tool && tool === meta.tool;
    let power = matches ? (item.power ?? 1) : (meta.needsTool ? 0 : 0.4);
    power *= (g.player.mods ?? g.skills.mods).breakMul;

    if (power <= 0) {
      this.mining.progress = 0;
      g.ui.updateMineProgress({ progress: 0, tip: `需要${meta.tool === 'pickaxe' ? '镐' : meta.tool === 'axe' ? '斧' : '铲'}才能采集` });
      return;
    }

    this.mining.progress += dt * power / meta.hardness;
    if (this.mining.progress >= 1) {
      this.breakBlock(hit, meta);
      this.mining = null;
      g.ui.updateMineProgress(null);
    } else {
      p.swing();
      g.sfx?.dig(MAT[hit.id] ?? 'stone');   // 采集声（内置节流）
      g.ui.updateMineProgress({ progress: this.mining.progress, tip: null });
    }
  }

  breakBlock(hit, meta) {
    const g = this.game;
    const { x, y, z, id } = hit;
    // 挖掉篝火/熔炉/工作台：容器槽内物品退回背包，再销毁容器
    if (meta.station && g.stations.has(x, y, z)) {
      const lost = g.stations.withdraw(x, y, z);
      if (lost > 0) g.ui.toast(`⚠️ 背包已满，${lost} 件容器内物品丢失`, '#ff8a7a');
    }
    g.world.setBlock(x, y, z, BLOCK.AIR);
    g.sfx?.break_(MAT[id] ?? 'stone');   // 破坏碎裂声

    // 掉落
    if (id === BLOCK.LEAVES) {
      const r = Math.random();
      if (r < 0.3) { g.inventory.add('berry', 1); g.ui.loot([{ id: 'berry', count: 1 }]); }
      else if (r < 0.55) { g.inventory.add('stick', 1); g.ui.loot([{ id: 'stick', count: 1 }]); }
      else if (r < 0.7) { g.inventory.add('fiber', 1); g.ui.loot([{ id: 'fiber', count: 1 }]); }   // 植物纤维：搓线的原料
    } else if (meta.drop) {
      g.inventory.add(meta.drop, 1);
      g.ui.loot([{ id: meta.drop, count: 1 }]);   // 右下角收获提示（约 5 秒）
    }
    // 首次挖到矿石时提示用途（每局各一次，避免刷屏）
    if (id === BLOCK.IRON_ORE && !this._oreHintIron) {
      this._oreHintIron = true;
      g.ui.toast('⛏️ 挖到铁矿石！合成熔炉（石头×8）后放进去+木板当燃料，可烧成铁锭', '#ffd54a', 6);
    } else if (id === BLOCK.COAL_ORE && !this._oreHintCoal) {
      this._oreHintCoal = true;
      g.ui.toast('⛏️ 挖到煤！比木板耐烧（90 秒），熔炉/篝火都可用', '#c9b48a', 5);
    }
    if (meta.xp) g.player.addXp(meta.xp);
    g.stats.blocksMined++;
  }

  // ---------------- 远程射击 ----------------
  tryShoot(item, slot = null, itemId = null) {
    const g = this.game;
    const p = g.player;
    const mods = p.mods ?? g.skills.mods;
    const im = this.instMods(slot);
    const info = weaponInfo(itemId ?? item?.id);   // M5：v2 武器解析（ITEMS 对象无 id 字段）
    if (this.attackCd > 0) return;

    // M5 熟练度解锁限制（旧武器不限）
    if (info && !g.mastery.isUnlocked(info.cls, info.mat, info.lv)) {
      g.ui.toast(`${item?.name ?? '该武器'}品级尚未解锁——研读技能书提升熟练度（J 查看进度）`, '#ff9d5c');
      return;
    }

    const ammo = item.ammo;
    if (!g.inventory.has(ammo, 1)) {
      g.ui.toast(`缺少 ${ITEMS[ammo].name}！`, '#ff7b6b');
      return;
    }
    g.inventory.remove(ammo, 1);
    this.attackCd = item.rate / (mods.attackMul + im.atkSpeed);
    p.swing();

    const eye = p.eyePos;
    const dir = p.lookDir();
    const speed = item.ammo === 'bolt' ? 38 : 30;
    const vel = dir.clone().multiplyScalar(speed);
    const spawn = eye.clone().addScaledVector(dir, 0.5);
    const dmg = item.damage * mods.rangedMul * g.player.fxMul('rangedMul') * (1 + im.rangedDmg);
    g.sfx?.shoot();   // 弓弩弦响
    g.entities.spawnProjectile(item.ammo, spawn, vel, dmg, info ? { cls: info.cls, lv: info.lv, mat: info.mat, itemId: itemId ?? item?.id, bleedMul: im.bleedMul, headAdd: im.headAdd } : null);   // M5：武器信息；M7：插件
  }

  // ---------------- 右键：放置 / 使用 ----------------
  useOrPlace(itemId, item) {
    const g = this.game;
    const p = g.player;
    if (!item) { this.drinkFromWater(); return; }   // 空手对准水 → 直接喝生水

    // 对准篝火/熔炉/工作台右键 → 打开容器界面（放原料/燃料、点火、点配方）
    {
      const eye = p.eyePos, look = p.lookDir();
      const hit = g.world.raycast(eye, look, GAMEPLAY.REACH, true);
      const stType = hit && BLOCKS[hit.id]?.station;
      if (hit && stType) {
        g.ui.openStation(hit.x, hit.y, hit.z, stType);
        return;
      }
    }

    // 配方图纸：右键学习（无需目标），解锁对应配方组
    if (item.kind === 'plan') {
      const g2 = this.game;
      if (!(g2.unlocked instanceof Set)) g2.unlocked = new Set();
      if (g2.unlocked.has(item.learn)) {
        g.ui.toast(`📖 ${item.name}你已经学会了`, '#aaa');
        return;
      }
      g2.unlocked.add(item.learn);
      g.inventory.consumeSelected(1);
      const learned = PLAN_GROUPS[item.learn] ?? item.learn;
      g.ui.toast(`📖 学习成功！解锁配方：${learned}——去工作台制作吧`, '#ffd54a', 5);
      g.player.addXp(6);
      return;
    }

    // 空瓶/空杯装水
    if (itemId === 'bottle_empty' || itemId === 'glass_cup') {
      const eye = p.eyePos, look = p.lookDir();
      const hit = g.world.raycast(eye, look, GAMEPLAY.REACH, true);
      if (hit && hit.id === BLOCK.WATER) {
        g.inventory.consumeSelected(1);
        g.inventory.add(itemId === 'bottle_empty' ? 'bottle_dirty' : 'cup_dirty', 1);
        g.sfx?.splash();   // 装水水花声
        g.ui.toast(itemId === 'bottle_empty' ? '装了一瓶生水（篝火可以烧开）' : '接了一杯生水（篝火可以烧开）', '#6fc3ff');
      } else {
        g.ui.toast(itemId === 'glass_cup' ? '这是空玻璃杯：对准水面右键接水（接的是生水，篝火烧开再喝）' : '对着水使用才能装水', '#6fc3ff');
      }
      return;
    }

    // 放置方块
    if (item.block != null) {
      const eye = p.eyePos, look = p.lookDir();
      const hit = g.world.raycast(eye, look, GAMEPLAY.REACH);
      if (!hit) return;
      const tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
      const cur = g.world.getBlock(tx, ty, tz);
      if (cur !== BLOCK.AIR && cur !== BLOCK.WATER) return;
      // 不能放在自己身上
      if (this.overlapsPlayer(tx, ty, tz)) return;
      g.world.setBlock(tx, ty, tz, item.block);
      g.sfx?.place();   // 放置笃声
      g.inventory.consumeSelected(1);
      g.player.addXp(1);
      return;
    }

    // 进食 / 喝水 / 医疗品（注意：传 itemId 字符串，ITEMS 定义对象本身没有 id 字段）
    if ((item.kind === 'food' || item.kind === 'drink' || item.kind === 'medical') && item.food) {
      p.eat(itemId);
      g.inventory.consumeSelected(1);
      return;
    }

    // 快捷穿戴装备
    if (item.kind === 'equip') {
      g.player.equipFromInv(g.inventory.selected);
      return;
    }

    // 插件 → 标记待安装（去背包面板点插槽完成）
    if (item.kind === 'plugin') {
      g.ui.pendingPlugin = g.ui.pendingPlugin === itemId ? null : itemId;
      g.ui.toast(g.ui.pendingPlugin ? `已选择 ${item.name}，按 B 打开背包点插槽安装` : '取消安装', '#ffd54a');
      return;
    }

    // M3 技能书 → 研读：消耗 1 本，熟练度 +1
    if (this.studyBook(itemId, item)) g.inventory.consumeSelected(1);
  }

  // M3：研读技能书（快捷栏右键 / 背包面板点击共用）
  studyBook(itemId, item) {
    if (item?.kind !== 'book') return false;
    const g = this.game;
    const cls = Object.keys(BOOKS).find(k => BOOKS[k].item === itemId);
    if (!cls) return false;
    const r = g.mastery.add(cls, 1);
    const b = BOOKS[cls];
    const cnt = g.mastery.counts[cls];
    if (r.upgraded) {
      const u = r.after;
      g.ui.toast(`研读${b.cn}！${W_TIER[u.tier].name}${u.lvl} 级武器已解锁（${cnt}/51 本）`, '#7ee787');
    } else {
      g.ui.toast(`研读${b.cn}（${cnt}/51 本，${r.after.maxed ? '已满级' : '继续研读解锁更高品级'}）`, '#ffd54a');
    }
    g.sfx?.click?.();
    return true;
  }

  // 背包面板点击使用（不依赖快捷栏选中）
  useAtIndex(idx) {
    const g = this.game;
    const inv = g.inventory;
    const s = inv.slots[idx];
    if (!s) return;
    const item = ITEMS[s.id];
    if (!item) return;
    if ((item.kind === 'food' || item.kind === 'drink' || item.kind === 'medical') && item.food) {
      g.player.eat(s.id);
      inv.consumeAt(idx, 1);
      return;
    }
    if (item.kind === 'equip') { g.player.equipFromInv(idx); return; }
    if (item.kind === 'book') {   // M3：背包面板点击研读
      if (this.studyBook(s.id, item)) { inv.slots[idx].count--; if (inv.slots[idx].count <= 0) inv.slots[idx] = null; g.ui.updateInventoryPanel?.(); }
      return;
    }
    if (item.block != null) { g.ui.toast('方块需放入物品栏后才能放置（右键移入）', '#aaa'); return; }
    if (s.id === 'bottle_empty' || s.id === 'glass_cup') { g.ui.toast(`${ITEMS[s.id].name}需放入物品栏，对准水右键接水`, '#aaa'); return; }
    if (item.kind === 'weapon' || item.kind === 'tool') {
      g.ui.toast(`${item.name}需放入物品栏后使用（右键移入）`, '#ffd54a');
      return;
    }
    if (item.kind === 'plugin') { g.ui.toast('插件需安装到装备/武器的插槽上', '#aaa'); return; }
  }

  // 空手对准水面直接喝生水（应急手段，会拉肚子）
  drinkFromWater() {
    const g = this.game, p = g.player;
    const eye = p.eyePos, look = p.lookDir();
    const hit = g.world.raycast(eye, look, GAMEPLAY.REACH, true);
    if (!hit) return;
    if (BLOCKS[hit.id]?.station) {
      g.ui.toast('🔥 对篝火/熔炉/工作台右键打开容器：点配方入队（自动扣原料），放燃料点火即可离场', '#ffb35c');
      return;
    }
    if (hit.id !== BLOCK.WATER) return;
    if (p.thirst >= 99.5) { g.ui.toast('你并不口渴', '#aaa'); return; }
    p.thirst = clamp(p.thirst + GAMEPLAY.HAND_DRINK_THIRST, 0, 100);
    p.addEffect('diarrhea', GAMEPLAY.HAND_DRINK_EFFECT);
    g.ui.dirtyVitals = true;
    g.ui.toast('你捧起生水一饮而尽……肚子开始咕咕叫（烧开的瓶装水更安全）', '#c9b48a');
  }

  overlapsPlayer(tx, ty, tz) {
    const p = this.game.player.pos;
    const half = 0.3, h = 1.8;
    return (tx + 1 > p.x - half && tx < p.x + half)
        && (ty + 1 > p.y && ty < p.y + h)
        && (tz + 1 > p.z - half && tz < p.z + half);
  }
}
