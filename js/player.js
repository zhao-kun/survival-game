// ============================================================
// player.js —— 玩家：移动物理 / 相机(第一&第三人称) / 生存数值 / 经验
// ============================================================
import * as THREE from 'three';
import { WORLD, GAMEPLAY, ITEMS, EFFECTS, BLOCK, pluginFits, hostTargetName } from './config.js';
import { buildHumanoid, buildHeldItem } from './models.js';
import { clamp } from './utils.js';

const _v3 = new THREE.Vector3();   // 复用临时向量（findAimedMob）

export const BASE_INV_SIZE = 36;
export const EQUIP_SLOTS = [
  { key: 'head', label: '头' }, { key: 'chest', label: '身' },
  { key: 'legs', label: '腿' }, { key: 'boots', label: '鞋' },
  { key: 'backpack', label: '背包' },
];

const HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;

export class Player {
  constructor(game, spawnPos) {
    this.game = game;
    this.pos = spawnPos.clone();      // 脚底中心
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.prevVelY = 0;

    // 生存数值
    this.hp = 100;
    this.hunger = 100;
    this.thirst = 100;
    this.effects = [];              // 状态效果 [{ id, time, power }]
    this.fxToastCd = 0;             // 效果提示冷却（避免刷屏）
    this.xp = 0;
    this.level = 1;
    this.points = 0;                  // 可用技能点

    // 装备（实例：{id, count:1, mods:[插件id...]}）
    this.equipment = { head: null, chest: null, legs: null, boots: null, backpack: null };
    this.armor = 0;                   // 当前护甲值
    this.mods = null;                 // 合并后的属性加成（技能 + 装备插件）
    this.recomputeStats();

    this.cameraMode = 'fps';          // fps | tps
    this.swingT = 0;                  // 挥手动画计时

    // 第三人称模型
    this.model = buildHumanoid({ facing: -1 });
    this.model.visible = false;
    game.scene.add(this.model);

    // 手持物品（第一人称挂在相机上）
    this.heldGroup = new THREE.Group();
    this.heldGroup.position.set(0.42, -0.42, -0.75);
    this.heldItemId = undefined;      // 强制首次重建
    game.camera.add(this.heldGroup);

    // 生存计时
    this.regenAcc = 0;
  }

  get maxHp() { return 100 + (this.mods ?? this.game.skills.mods).hpBonus; }

  // 综合战力评分（0 起步）：驱动僵尸难度曲线——等级/护甲/装备/手持武器越好，刷怪越多越强
  powerScore() {
    let s = (this.level - 1) * 2 + this.armor * 1.2;
    let slots = 0;
    for (const inst of Object.values(this.equipment)) if (inst) slots++;
    s += slots * 1.5;
    const inv = this.game.inventory;
    const held = inv && inv.selected != null ? inv.slots[inv.selected] : null;
    const m = /^(wood|iron|steel)_/.exec(held?.id ?? '');
    if (m) s += { wood: 2, iron: 4, steel: 6 }[m[1]];
    return Math.round(s);
  }

  // ---------------- 属性重算：技能 + 装备插件 → this.mods ----------------
  recomputeStats() {
    const g = this.game;
    const m = { ...g.skills.mods };
    let armor = 0, pack = 0;
    for (const inst of Object.values(this.equipment)) {
      if (!inst) continue;
      const def = ITEMS[inst.id];
      if (!def) continue;
      armor += def.armor ?? 0;
      pack += def.pack ?? 0;
      for (const mid of inst.mods ?? []) {
        const e = ITEMS[mid]?.effect;
        if (!e) continue;
        if (e.k === 'armor') armor += e.v;
        else if (e.k === 'pack') pack += e.v;
        else if (e.k === 'move') m.moveMul += e.v;
        else if (e.k === 'drop') m.dropMul += e.v;
      }
    }
    this.armor = armor;
    this.mods = m;
    const ok = g.inventory.resize(BASE_INV_SIZE + (m.packBonus ?? 0) + pack);
    if (g.ui) g.ui.dirtyVitals = true;
    return ok;
  }

  // ---------------- 装备穿脱 ----------------
  // 从背包格穿上装备（双击背包中的装备）
  equipFromInv(idx) {
    const g = this.game;
    const s = g.inventory.slots[idx];
    const def = s && ITEMS[s.id];
    if (!def || def.kind !== 'equip') return false;
    const key = def.equip;
    const cur = this.equipment[key];
    const backup = s;
    this.equipment[key] = { id: s.id, count: 1, mods: s.mods ? [...s.mods] : [] };
    g.inventory.slots[idx] = cur ? { ...cur } : null;
    if (!this.recomputeStats()) {
      // 容量缩小失败（如换小背包时物品放不下）→ 回滚
      this.equipment[key] = cur;
      g.inventory.slots[idx] = backup;
      this.recomputeStats();
      g.ui.toast('背包物品太多，无法更换', '#ff7b6b');
      return false;
    }
    g.ui.toast(`装备 ${def.name}${cur ? '（替换 ' + ITEMS[cur.id].name + '）' : ''}`, '#9dff6c');
    return true;
  }
  // 兼容旧调用名
  unequipToCursor(key) { return this.unequip(key); }

  // 脱下装备回背包
  unequip(key) {
    const g = this.game;
    const cur = this.equipment[key];
    if (!cur) return false;
    this.equipment[key] = null;
    if (!this.recomputeStats()) {
      this.equipment[key] = cur;
      this.recomputeStats();
      g.ui.toast('背包物品太多，无法脱下', '#ff7b6b');
      return false;
    }
    if (!g.inventory.placeInstance({ ...cur })) {
      this.equipment[key] = cur;
      this.recomputeStats();
      g.ui.toast('背包已满', '#ff7b6b');
      return false;
    }
    g.ui.toast(`脱下 ${ITEMS[cur.id].name}`, '#aaa');
    return true;
  }

  // ---------------- 插件安装 / 卸下 ----------------
  // loc: { equip: 'head'... } 装备槽，或 { inv: idx } 背包格中的武器/装备
  installPlugin(loc) {
    const g = this.game;
    const inv = g.inventory;
    const host = loc.equip ? this.equipment[loc.equip] : inv.slots[loc.inv];
    if (!host) return { ok: false, reason: '没有装备' };
    const hostDef = ITEMS[host.id];
    if (!hostDef?.sockets) return { ok: false, reason: '该物品没有插槽' };
    const mods = host.mods ?? [];
    if (mods.length >= hostDef.sockets) return { ok: false, reason: '插槽已满' };

    // 插件来源：优先背包中已标记的待安装插件，否则找第一个兼容的
    let pluginId = g.ui.pendingPlugin;
    if (pluginId && !inv.has(pluginId, 1)) pluginId = null;
    if (!pluginId || !pluginFits(ITEMS[pluginId], hostDef)) {
      pluginId = null;
      for (const s of inv.slots) {
        if (s && ITEMS[s.id]?.kind === 'plugin' && pluginFits(ITEMS[s.id], hostDef)) { pluginId = s.id; break; }
      }
    }
    if (!pluginId) return { ok: false, reason: `没有兼容插件（${hostDef.name}需要 ${hostTargetName(hostDef)}插件）` };

    inv.remove(pluginId, 1);
    host.mods = [...mods, pluginId];
    this.recomputeStats();
    return { ok: true, reason: '' };
  }

  removePlugin(loc, socketIdx) {
    const g = this.game;
    const inv = g.inventory;
    const host = loc.equip ? this.equipment[loc.equip] : inv.slots[loc.inv];
    if (!host || !(host.mods ?? []).length) return { ok: false, reason: '没有插件' };
    const mods = [...host.mods];
    if (socketIdx < 0 || socketIdx >= mods.length) return { ok: false, reason: '插槽为空' };
    const pid = mods[socketIdx];
    if (inv.add(pid, 1) > 0) return { ok: false, reason: '背包已满' };
    mods.splice(socketIdx, 1);
    host.mods = mods;
    this.recomputeStats();
    return { ok: true, reason: '' };
  }
  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }
  // 视线方向
  lookDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  xpNeed() { return 80 + (this.level - 1) * 50; }

  addXp(n) {
    const g = this.game;
    n = Math.max(1, Math.round(n * (this.mods ?? g.skills.mods).xpGain));
    this.xp += n;
    while (this.xp >= this.xpNeed()) {
      this.xp -= this.xpNeed();
      this.level++;
      this.points++;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25);
      g.ui.toast(`⬆ 升级！Lv.${this.level}，获得 1 技能点 [K 打开技能树]`, '#ffd54a');
    }
    g.ui.dirtyXp = true;
  }

  damage(amount, source = '未知') {
    if (this.game.state !== 'playing') return;
    const mods = this.mods ?? this.game.skills.mods;
    // 僵尸攻击可被闪避
    if (source === 'zombie' && Math.random() < mods.dodge) {
      this.game.ui.toast('⚡ 闪避！', '#9dff6c');
      return;
    }
    amount *= (1 - mods.tough);
    amount *= this.fxMul('dmgTaken');   // 坚韧等 buff：受伤减免
    // 护甲减伤（仅对僵尸攻击；上限 75%）
    if (source === 'zombie') {
      amount *= (1 - Math.min(0.75, this.armor * 0.055));
    }
    this.hp -= amount;
    this.game.sfx?.hurt();   // 玩家受伤下滑音
    this.game.ui.flashDamage();
    this.game.ui.dirtyVitals = true;
    if (this.hp <= 0) {
      this.hp = 0;
      this.game.gameOver(source);
    }
  }

  heal(n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
    this.game.ui.dirtyVitals = true;
  }

  eat(id) {
    const it = ITEMS[id];
    if (!it?.food) return;
    const f = it.food;
    this.game.sfx?.[it.kind === 'drink' ? 'drink' : 'eat']();   // 进食咀嘴 / 喝水咕嘟
    this.hunger = clamp(this.hunger + f.hunger, 0, 100);
    this.thirst = clamp(this.thirst + f.thirst, 0, 100);
    if (f.health) this.heal(f.health);
    if (it.effect) this.addEffect(it.effect.id, it.effect.time);   // 生水等带来的负面效果
    for (const b of it.buffs ?? []) this.addEffect(b.id, b.time, b.power ?? 1);   // 高级食物带来的正面 buff
    if (it.cure) this.cure(it.cure);   // 医疗品治疗创伤（擦伤/脑震荡/断手，'all'=全治）
    // 饮品/食物分开提示，并写明数值变化；返还的空容器（空瓶/空杯）单独提醒，避免误当成还有水
    const isDrink = it.kind === 'drink';
    const isMedical = it.kind === 'medical';
    const gain = [
      f.hunger ? `饱食+${f.hunger}` : '',
      f.thirst ? `口渴+${f.thirst}` : '',
      f.health ? (f.health > 0 ? `生命+${f.health}` : `生命${f.health}`) : '',
    ].filter(Boolean).join('，');
    const verb = isDrink ? '💧 饮用' : isMedical ? '💉 使用' : '🍖 食用';
    const color = isDrink ? '#6fc3ff' : isMedical ? '#ff9e9e' : '#b7ff5e';
    this.game.ui.toast(`${verb} ${it.name}${gain ? `（${gain}）` : ''}${it.returns ? '，空杯已放回背包' : ''}`, color);
    if (it.returns) this.game.inventory.add(it.returns, 1);        // 喝完返还容器（空瓶/玻璃杯）
    this.game.ui.dirtyVitals = true;
  }

  // 添加/刷新状态效果（叠加时刷新时长并小幅增强）
  addEffect(id, time, power = 1) {
    const def = EFFECTS[id];
    if (!def) return;
    const ex = this.effects.find(e => e.id === id);
    if (ex) { ex.time = Math.max(ex.time, time); ex.power = Math.min(2, ex.power + 0.35); }
    else this.effects.push({ id, time, power });
    const ui = this.game?.ui;
    if (ui) {
      ui.toast(`${def.icon} ${def.name}！${def.desc}`, def.color);
      ui.dirtyVitals = true;
    }
  }

  // 医疗品治愈：指定 id 或 'all'（清除所有负面效果）；返回是否真的治了什么
  cure(cureId) {
    const before = this.effects.length;
    if (cureId === 'all') {
      this.effects = this.effects.filter(e => !EFFECTS[e.id]?.negative);
    } else {
      this.effects = this.effects.filter(e => e.id !== cureId);
    }
    const healed = before - this.effects.length;
    if (healed > 0) {
      const ui = this.game?.ui;
      if (ui) {
        const name = cureId === 'all' ? '创伤' : EFFECTS[cureId]?.name ?? cureId;
        ui.toast(`✅ ${name}已治愈，感觉好多了`, '#7dff8e');
        ui.dirtyVitals = true;
      }
    }
    return healed > 0;
  }

  // 状态效果乘子（moveMul/meleeMul/rangedMul/dmgTaken）：所有相关效果按强度叠加相乘
  fxMul(key) {
    let m = 1;
    for (const e of this.effects) {
      const d = EFFECTS[e.id];
      if (d && d[key] != null) m *= 1 + (d[key] - 1) * (e.power ?? 1);
    }
    return m;
  }

  // 效果结算：返回 { hungerMul, blockRegen } 供主循环使用；自身负责掉血/回血与到期移除
  updateEffects(dt) {
    let hungerMul = 1, hpDrain = 0, hpHeal = 0, blockRegen = false;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i], def = EFFECTS[e.id];
      if (!def) { this.effects.splice(i, 1); continue; }
      e.time -= dt;
      if (e.time <= 0) {
        this.effects.splice(i, 1);
        const ui = this.game?.ui;
        if (ui && this.game.state === 'playing') ui.toast(`${def.icon} ${def.name} 已痊愈`, '#9be29b');
        continue;
      }
      if (def.hpDrain) hpDrain += def.hpDrain * e.power;
      if (def.hpHeal) hpHeal += def.hpHeal * e.power;   // 饱食等 buff：独立回血（不受拉肚子影响）
      if (def.hungerMul) hungerMul = Math.max(hungerMul, def.hungerMul);
      if (def.blockRegen) blockRegen = true;
    }
    if (hpDrain > 0 && this.hp > 0) this.hp = Math.max(0, this.hp - hpDrain * dt);
    if (hpHeal > 0 && this.hp > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + hpHeal * dt);
    return { hungerMul, blockRegen, hpDrain };
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'fps' ? 'tps' : 'fps';
    this.game.ui.toast(this.cameraMode === 'fps' ? '第一人称视角' : '第三人称视角');
  }

  setHeldItem(itemId) {
    if (itemId === this.heldItemId) return;
    this.heldItemId = itemId;
    this.heldGroup.clear();
    this.heldGroup.add(buildHeldItem(itemId));
    // 第三人称：同步挂到人形模型右手（跟随摆臂/挥手）；第一人称仍用相机上的 heldGroup
    if (this.model.held) {
      this.model.held.clear();
      this.model.held.add(buildHeldItem(itemId));
    }
  }

  swing() { if (this.swingT <= 0) this.swingT = 0.28; }

  // 准星方向锥内、20m 内的怪物（僵尸+动物），取离玩家最近者——顶部血量 HUD 用
  findAimedMob() {
    const g = this.game;
    const eye = this.eyePos;
    const look = this.lookDir();
    let best = null, bestDist = Infinity;
    const consider = (list, name, h, radius) => {
      for (const m of list) {
        if (m.dead) continue;
        const c = _v3.set(m.pos.x, m.pos.y + h, m.pos.z).sub(eye);
        const dist = c.length();
        if (dist < radius || dist > 20) continue;   // 贴脸不算（已在攻击范围）/ 超距不显示
        c.multiplyScalar(1 / dist);
        if (c.dot(look) < 0.9848) continue;         // ≈10° 准星锥
        if (dist < bestDist) { bestDist = dist; best = { mob: m, name, hp: Math.max(0, Math.ceil(m.hp)), maxHp: m.maxHp }; }
      }
    };
    consider(g.entities.zombies, '僵尸', 0.9, 0.6);
    consider(g.entities.animals, '野猪', 0.55, 0.5);
    return best;
  }

  // ---------------- 每帧更新 ----------------
  update(dt, input) {
    const g = this.game;
    const panelOpen = g.ui.isAnyPanelOpen();

    // ---- 视角 ----
    if (!panelOpen) {
      const md = input.consumeMouse();
      this.yaw -= md.x * GAMEPLAY.MOUSE_SENS;
      this.pitch = clamp(this.pitch - md.y * GAMEPLAY.MOUSE_SENS, -1.55, 1.55);
    } else {
      input.consumeMouse();
    }

    // ---- 移动 ----
    let mx = 0, mz = 0;
    if (!panelOpen) {
      if (input.down('KeyW')) mz -= 1;
      if (input.down('KeyS')) mz += 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
    }
    const sprinting = input.down('ShiftLeft') && mz < 0 && this.hunger > 5;
    const len = Math.hypot(mx, mz) || 1;
    const mods = this.mods ?? g.skills.mods;
    const speed = GAMEPLAY.WALK_SPEED * mods.moveMul * this.fxMul('moveMul')
      * (sprinting ? GAMEPLAY.SPRINT_MUL : 1)
      * (this.inWater ? 0.55 : 1);

    // 以 yaw 旋转移动向量（与相机一致：R_y(yaw)，W 始终朝视线方向）
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (mx * cos + mz * sin) / len * speed;
    const wz = (mz * cos - mx * sin) / len * speed;
    this.vel.x = wx; this.vel.z = wz;

    // ---- 水检测 ----
    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const feetWater = g.world.getBlock(bx, Math.floor(this.pos.y + 0.4), bz) === BLOCK.WATER;
    const headWater = g.world.getBlock(bx, Math.floor(this.pos.y + 1.5), bz) === BLOCK.WATER;
    this.inWater = feetWater || headWater;
    // 脚刚冲出水面的瞬间（边沿检测，不依赖帧间隔）
    this.justSurfaced = this.wasFeetWater && !feetWater;
    this.wasFeetWater = feetWater;

    // ---- 跳跃 / 重力 ----
    if (!panelOpen && input.down('Space')) {
      if (this.inWater && !this.onGround) {
        // 游泳上浮
        this.vel.y = Math.min(this.vel.y + 26 * dt, 4.2);
      } else if (this.onGround) {
        this.vel.y = GAMEPLAY.JUMP_SPEED * mods.jumpMul;   // 浅水/地面正常起跳
        g.sfx?.jump();                                     // 起跳音效
      }
      // 出水瞬间朝岸推进 → 跃出冲量，帮助爬上比水面高一格的岸
      if (this.justSurfaced && (Math.abs(this.vel.x) > 0.1 || Math.abs(this.vel.z) > 0.1)) {
        const nx = Math.floor(this.pos.x + Math.sign(this.vel.x) * 0.75);
        const nz = Math.floor(this.pos.z + Math.sign(this.vel.z) * 0.75);
        const shore = g.world.getBlock(nx, Math.floor(this.pos.y + 0.2), nz);
        if (shore !== BLOCK.AIR && shore !== BLOCK.WATER) {
          this.vel.y = Math.max(this.vel.y, 9.2);
        }
      }
    }
    this.vel.y -= (this.inWater ? 6 : GAMEPLAY.GRAVITY) * dt;
    if (this.inWater) this.vel.y = Math.max(this.vel.y, -3);
    this.vel.y = Math.max(this.vel.y, -45); // 限制终端速度

    this.prevVelY = this.vel.y;
    const res = g.world.moveEntity(this.pos, this.vel, dt, HALF, HEIGHT);
    const wasAirborne = !this.onGround;
    this.onGround = res.onGround;

    // ---- 坠落伤害 ----
    if (res.onGround && wasAirborne && res.landedSpeed > GAMEPLAY.FALL_SAFE && !this.inWater) {
      const dmg = (res.landedSpeed - GAMEPLAY.FALL_SAFE) * 2.2 * (1 - mods.fallReduce);
      this.damage(dmg, '坠落');
      g.ui.toast(`坠落伤害 -${Math.round(dmg)}`, '#ff7b6b');
    }

    // ---- 世界边界 ----
    this.pos.x = clamp(this.pos.x, 1.5, WORLD.SIZE - 1.5);
    this.pos.z = clamp(this.pos.z, 1.5, WORLD.SIZE - 1.5);
    if (this.pos.y < -8) { this.pos.y = g.world.surfaceY(bx, bz) + 1; this.vel.set(0, 0, 0); }

    // ---- 状态效果（拉肚子等）----
    const fx = this.updateEffects(dt);

    // ---- 生存数值 ----
    const rateMul = (sprinting ? 1.8 : 1) * fx.hungerMul;
    this.hunger = Math.max(0, this.hunger - GAMEPLAY.HUNGER_RATE * rateMul * dt);
    this.thirst = Math.max(0, this.thirst - GAMEPLAY.THIRST_RATE * rateMul * dt);
    if (this.hunger <= 0) this.hp -= GAMEPLAY.STARVE_DPS * dt;
    if (this.thirst <= 0) this.hp -= GAMEPLAY.DEHYD_DPS * dt;
    // 回血（拉肚子时无法自然回血）
    if (this.hunger > 60 && this.thirst > 60 && this.hp < this.maxHp && !fx.blockRegen) {
      this.regenAcc += GAMEPLAY.REGEN_RATE * dt;
      if (this.regenAcc >= 1) { this.heal(1); this.regenAcc = 0; }
    }
    if (this.hp <= 0 && this.game.state === 'playing') {
      this.hp = 0;
      const src = this.thirst <= 0 ? '脱水' : this.hunger <= 0 ? '饥饿' : fx.hpDrain > 0 ? '拉肚子' : '虚弱';
      this.game.gameOver(src);
    }
    g.ui.dirtyVitals = true;

    // ---- 相机与模型 ----
    this.updateCamera(g.camera);
    this.model.visible = this.cameraMode === 'tps';
    this.heldGroup.visible = this.cameraMode === 'fps';   // 第一人称手持模型只在 FPS 显示，避免 TPS 里穿屏
    this.model.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.model.rotation.y = this.yaw;

    // ---- 手持物品 ----
    this.setHeldItem(g.inventory.selectedId());
    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = Math.max(0, this.swingT / 0.28);
      this.heldGroup.rotation.x = -Math.sin(k * Math.PI) * 0.9;
      this.heldGroup.rotation.y = -Math.sin(k * Math.PI) * 0.35;
    } else {
      this.heldGroup.rotation.set(0, 0, 0);
    }
    // 走路轻微摆动
    if (this.onGround && (mx !== 0 || mz !== 0)) {
      this.heldGroup.position.y = -0.42 + Math.sin(performance.now() * 0.012) * 0.02;
    } else {
      this.heldGroup.position.y = -0.42;
    }

    // ---- 第三人称模型动画：走路摆臂摆腿 / 跳跃 / 挥手 ----
    const mdl = this.model;
    if (mdl.legL) {
      const moving = mx !== 0 || mz !== 0;
      const t = performance.now() * 0.001;
      const cadence = sprinting ? 13 : 9;   // 疾跑步频更快
      if (moving && this.onGround) {
        const s = Math.sin(t * cadence);
        // 脚步声：sin 过零（腿垂直→脚落地）边沿检测，每半周期一步
        const stepIdx = Math.floor(t * cadence / Math.PI);
        if (this.lastStepIdx !== stepIdx) { this.lastStepIdx = stepIdx; g.sfx?.step(); }
        mdl.legL.rotation.x = s * 0.85;
        mdl.legR.rotation.x = -s * 0.85;
        mdl.armL.rotation.x = -s * 0.7;
        mdl.armR.rotation.x = s * 0.7;
        mdl.position.y = this.pos.y + Math.abs(Math.sin(t * cadence)) * 0.06;   // 步伐起伏
      } else if (!this.onGround && !this.inWater) {
        // 空中：腿一前一后收起，手臂上扬保持平衡
        mdl.legL.rotation.x = 0.55;
        mdl.legR.rotation.x = -0.35;
        mdl.armL.rotation.x = -0.55;
        mdl.armR.rotation.x = -0.55;
        mdl.position.y = this.pos.y;
      } else {
        // 静止/游泳：回正（重置脚步计数，保证再次开步立即有声）
        this.lastStepIdx = -1;
        mdl.legL.rotation.x = 0; mdl.legR.rotation.x = 0;
        mdl.armL.rotation.x = 0; mdl.armR.rotation.x = 0;
        mdl.position.y = this.pos.y;
      }
      // 挥手：右臂跟随 swingT（第三人称也看得到挥动/挖掘）
      if (this.swingT > 0) {
        const k = Math.max(0, this.swingT / 0.28);
        mdl.armR.rotation.x = -Math.sin(k * Math.PI) * 1.8;
      }
    }

    // ---- 准星目标怪物血量 HUD ----
    g.ui.updateMobHud(this.findAimedMob());
  }

  applyCamera(camera) {
    if (this.cameraMode === 'fps') {
      camera.position.copy(this.eyePos);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = this.yaw;
      camera.rotation.x = this.pitch;
      camera.rotation.z = 0;
    }
  }

  updateCamera(camera) {
    if (this.cameraMode === 'fps') {
      this.applyCamera(camera);
      return;
    }
    // 第三人称：越肩视角（右肩）——相机在视线后上方偏右，人物位于屏幕左下，
    // 不再遮挡中央准星与攻击目标；视线轴与玩家视线平行，准星即瞄准方向。
    const eye = this.eyePos;
    const look = this.lookDir();
    const back = look.clone().multiplyScalar(-1);
    const dist = 4.2;
    // 主穿墙检测：眼 → 正后方
    const hit = this.game.world.raycast(eye, back, dist + 0.3);
    const d = hit ? Math.max(1.4, hit.dist - 0.3) : dist;
    // 越肩偏移：相机右向 = 水平前向的右垂直（yaw=0 时朝 +X）；略抬高越过肩头
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const ideal = eye.clone()
      .addScaledVector(back, d)
      .addScaledVector(right, 1.3)
      .add(new THREE.Vector3(0, 0.28, 0));
    // 侧向穿墙兜底：眼 → 理想相机点被方块挡住则拉近
    const toCam = ideal.clone().sub(eye);
    const len = toCam.length();
    if (len > 0.01) {
      const dir = toCam.multiplyScalar(1 / len);
      const hit2 = this.game.world.raycast(eye, dir, len);
      if (hit2) {
        ideal.copy(eye).addScaledVector(dir, Math.max(0.9, hit2.dist - 0.25));
      }
    }
    camera.position.copy(ideal);
    // 看向玩家视线前方远处 → 视锥轴与玩家视线平行，十字准星正对瞄准点
    camera.lookAt(eye.clone().addScaledVector(look, 12));
  }
}
