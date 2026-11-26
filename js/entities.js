// ============================================================
// entities.js —— 僵尸 / 动物 / 掉落物 / 箭矢 / 实体管理器
// ============================================================
import * as THREE from 'three';
import { ZOMBIE_CFG, ANIMAL_CFG, ZOMBIE_LOOT, PLAN_DROP_CHANCE, ITEMS, GAMEPLAY, WORLD, zombieBudget, BOOKS, HEADSHOT_MUL, ENEMY_CFG, enemyStats, pickJob } from './config.js';
import { buildHumanoid, buildItemCube, buildZombieJob } from './models.js';
import { randRange, randInt, clamp } from './utils.js';

const Z_HALF = 0.3, Z_HEIGHT = 1.8;
const BOOK_KEYS = Object.keys(BOOKS);   // M3 技能书掉落用
// M3：按概率掉落随机一类技能书
function dropBook(g, pos, chance) {
  if (Math.random() >= chance) return;
  const cls = BOOK_KEYS[randInt(0, BOOK_KEYS.length - 1)];
  g.entities.spawnDrop(BOOKS[cls].item, 1, pos);
}

// ============================================================
// M2 状态效果引擎（docs/WEAPONS-DESIGN.md 4.1）
// bleed 流血 / slow 震慑 / cripple 致残 —— 同类取强不叠加
// ============================================================
function applyStatusImpl(e, type, dur, dps = 0) {
  if (type === 'bleed') {
    if (dps >= e.bleedDps) { e.bleedDps = dps; e.bleedT = Math.max(e.bleedT, dur); }   // 弱施加不动强流血
  } else if (type === 'slow') e.slowT = Math.max(e.slowT, dur);
  else if (type === 'cripple') e.crippleT = Math.max(e.crippleT, dur);
}
function moveMulImpl(e) { return e.slowT > 0 ? 0.5 : e.crippleT > 0 ? 0.6 : 1; }   // 取强：震慑优先

// 轻量粒子（状态视觉：血滴等）——无对象池，一次性小方块
export function spawnParticle(game, x, y, z, color = 0xd0021b, life = 0.45) {
  if (!game.entities?.particles) return;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.07),
    new THREE.MeshBasicMaterial({ color, transparent: true })
  );
  m.position.set(x + randRange(-0.25, 0.25), y, z + randRange(-0.25, 0.25));
  game.scene.add(m);
  game.entities.particles.push({ mesh: m, life, max: life, vy: 1.1 });
}
export function updateParticles(game, dt) {
  const arr = game.entities.particles;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.life -= dt;
    if (p.life <= 0) {
      game.scene.remove(p.mesh);
      p.mesh.material.dispose();
      p.mesh.geometry.dispose();
      arr.splice(i, 1);
      continue;
    }
    p.mesh.position.y += p.vy * dt;
    p.mesh.material.opacity = p.life / p.max;
  }
}

// 状态引擎 tick：返回是否流血中（供 update 掉血/视觉用）
function statusTick(e, g, dt, particleY) {
  if (e.bleedT > 0) {
    e.bleedT -= dt;
    e.hp -= e.bleedDps * dt;
    e.dotTick -= dt;
    if (e.dotTick <= 0) { e.dotTick = 0.35; spawnParticle(g, e.pos.x, e.pos.y + particleY, e.pos.z); }
  } else e.bleedDps = 0;
  if (e.slowT > 0) e.slowT -= dt;
  if (e.crippleT > 0) e.crippleT -= dt;
}
// 血条颜色：流血红 / 致残黄 / 震慑蓝 / 常态红
const HP_BLEED = 0xd0021b, HP_CRIPPLE = 0xffd54a, HP_SLOW = 0x7ec8ff, HP_NORMAL = 0xff3b30;
function hpBarColor(e) {
  return e.bleedT > 0 ? HP_BLEED : e.crippleT > 0 ? HP_CRIPPLE : e.slowT > 0 ? HP_SLOW : HP_NORMAL;
}

// ------------------------------------------------------------
// 僵尸
// ------------------------------------------------------------
// ---------------- E3 职业技能实现（docs/ENEMIES-DESIGN.md 4.2） ----------------
// 每个 fn(z, g, ctx) 返回 true 表示技能触发并进入 cd；数值全部读 ENEMY_CFG.SKILLS 元数据，
// 新增职业/技能零侵入：JOB.skills 加键 + SKILLS 元数据 + 此处一个 fn 即可
const SKILL_IMPL = {
  // 📢 尖叫召集：受击惊动 12m 内同伴 + 自身攻速 +10%（可叠至 1.5）
  scream(z, g) {
    const s = ENEMY_CFG.SKILLS.scream;
    let woke = 0;
    for (const o of g.entities.zombies) {
      if (o === z || o.dead) continue;
      if (Math.hypot(o.pos.x - z.pos.x, o.pos.z - z.pos.z) < s.radius) { o.aggro = true; woke++; }
    }
    z.attackMul = Math.min(1.5, z.attackMul + 0.1);
    spawnParticle(g, z.pos.x, z.pos.y + 2.0, z.pos.z, 0xffd54a, 0.6);
    return true;
  },
  // 🍳 锅铲连击：20% 概率追击 60% 伤害
  spatula(z, g, { target } = {}) {
    const s = ENEMY_CFG.SKILLS.spatula;
    if (!target || target.dead || Math.random() >= s.chance) return false;
    target.damage(Math.round(z.attackDamage() * s.mul), 'zombie');
    spawnParticle(g, z.pos.x, z.pos.y + 1.5, z.pos.z, 0xffcc88, 0.4);
    return true;
  },
  // 💉 战地急救：脱战 calm 秒后自疗 8% maxHp
  heal(z, g) {
    const s = ENEMY_CFG.SKILLS.heal;
    if (z.lastHurtT < s.calm || z.hp >= z.maxHp) return false;
    z.hp = Math.min(z.maxHp, z.hp + Math.max(1, Math.round(z.maxHp * s.pct)));
    spawnParticle(g, z.pos.x, z.pos.y + 1.6, z.pos.z, 0x7dd87d, 0.5);
    return true;
  },
  // 🦠 感染采样：命中使玩家减速 30% 持续 slow 秒
  infect(z, g, { target } = {}) {
    if (!target || target.dead) return false;
    target.addEffect('infection', ENEMY_CFG.SKILLS.infect.slow);
    return true;
  },
  // 🤝 抱团士气：radius 内 ≥need 同伴 → 攻 +15%/速 +10%（tick 0.5s 刷新）
  morale(z, g) {
    const s = ENEMY_CFG.SKILLS.morale;
    let n = 0;
    for (const o of g.entities.zombies) {
      if (o === z || o.dead) continue;
      if (Math.hypot(o.pos.x - z.pos.x, o.pos.z - z.pos.z) < s.radius) n++;
    }
    z.moraleOn = n >= s.need;
    return true;
  },
  // 🔨 破甲锤击：命中削玩家护甲 shred 点，叠至 cap 封顶，dur 秒后返还
  armorbreak(z, g, { target } = {}) {
    const s = ENEMY_CFG.SKILLS.armorbreak;
    if (!target || target.dead) return false;
    if (z.shredAmt >= s.cap) return false;   // 削甲叠满封顶，不再叠加
    const amt = Math.min(s.shred, s.cap - z.shredAmt);
    z.shredAmt += amt;
    z.shredT = s.dur;
    target.armor = (target.armor ?? 0) - amt;
    spawnParticle(g, target.pos.x, target.pos.y + 1.2, target.pos.z, 0xaaaaaa, 0.4);
    return true;
  },
  // 🤸 战术翻滚：被玩家瞄准（视线夹角<20°）且 dist>5m 时 30% 侧滚，短暂远程免疫
  roll(z, g) {
    const s = ENEMY_CFG.SKILLS.roll;
    if (z.rollImmuneT > 0) return false;
    const p = g.player.pos;
    const dx = z.pos.x - p.x, dz = z.pos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 5) return false;
    const fwd = g.player.lookDir();
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    if ((fwd.x * dx + fwd.z * dz) / (fl * dist) < 0.94) return false;   // 未被瞄准
    if (Math.random() >= s.chance) return false;
    const perp = { x: -dz / dist, z: dx / dist };
    const side = Math.random() < 0.5 ? 1 : -1;
    g.world.moveEntity(z.pos, { x: perp.x * side * 9, y: 0, z: perp.z * side * 9 }, 0.18, Z_HALF, Z_HEIGHT);
    z.rollImmuneT = 0.6;
    spawnParticle(g, z.pos.x, z.pos.y + 0.4, z.pos.z, 0xdddddd, 0.4);
    return true;
  },
  // 🔫 军规点射（仅辐射级）：4-10m 锁定 → 0.8s 红色射线预警 → 0.8×伤害点射；
  // burst 发内连射（间隔 cd），burst 用尽 15s 后重装
  shoot(z, g, { dt } = {}) {
    const s = ENEMY_CFG.SKILLS.shoot;
    if (z.tier < (s.tierMin ?? 3)) return false;
    const p = g.player;
    z.shotResetT = (z.shotResetT ?? 0) + dt;
    if (z.shotResetT > 15) { z.shotResetT = 0; z.shotsLeft = s.burst; }
    if (p.dead) { z.aimT = 0; z.hideAimLine(); return false; }
    const dist = Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
    if (z.aimT > 0) {
      z.aimT -= dt;
      if (z.aimT <= 0) {
        z.hideAimLine();
        z.shotsLeft--;
        if (dist < s.range[1] + 0.5 && Math.abs(p.pos.y - z.pos.y) < 2.5) {
          p.damage(Math.round(z.attackDamage() * s.mul), 'zombie');
          spawnParticle(g, p.pos.x, p.pos.y + 1.2, p.pos.z, 0xff5555, 0.4);
        }
        return true;
      }
      z.updateAimLine(p.pos);
      return false;
    }
    if (z.shotsLeft > 0 && z.aggro && dist >= s.range[0] && dist <= s.range[1]) {
      z.aimT = s.windup;
      z.showAimLine();
    }
    return false;
  },
};

export class Zombie {
  // E1：job 参数化 —— 缺省 'common' 全乘数 1.0，旧签名 new Zombie(g, level, x, y, z) 零破坏
  constructor(game, level, x, y, z, job = 'common') {
    this.game = game;
    this.level = level;          // 大级 tier：1 一般 / 2 疯狂 / 3 辐射
    this.tier = level;           // E3：tier 别名（技能元数据 tierMin 判定用）
    this.job = job;
    const cfg = enemyStats(level, job);   // 15 变体最终数值 = TIER 基准 × JOB 乘数
    this.cfg = cfg;
    this.armorPct = cfg.armorPct;         // 职业减伤（特种兵防弹插板）
    this.elite = false;                   // E5 精英变体
    // E3：职业技能状态（数值全读 ENEMY_CFG.SKILLS）
    this.skillCd = {};        // 各技能 cd 计时
    this.lastHurtT = 9;       // 脱战计时（战地急救 calm，出生视为脱战）
    this.attackMul = 1;       // 尖叫召集攻速乘数
    this.moraleOn = false;    // 抱团士气（攻 +15%/速 +10%）
    this.rollImmuneT = 0;     // 战术翻滚远程免疫剩余
    this.windupT = 0;         // 蓄力劈砍预警剩余
    this.windupStunT = 0;     // 空劈硬直剩余
    this.aimT = 0;            // 军规点射瞄准剩余
    this.shotsLeft = 3;       // 点射剩余弹数
    this.shredAmt = 0;        // 破甲累计削甲量
    this.shredT = 0;          // 破甲恢复倒计时
    this.windupRing = null;   // 蓄力红圈预警 mesh
    this.aimLine = null;      // 点射红色射线 mesh
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.aggro = false;
    this.attackCd = 0;
    this.wanderDir = new THREE.Vector3();
    this.wanderTimer = 0;
    this.flashT = 0;
    this.dead = false;
    this.bleedT = 0; this.bleedDps = 0; this.slowT = 0; this.crippleT = 0; this.dotTick = 0;   // M2 状态
    this.headH = 1.45;   // M5 头部判定线

    // E2：职业外观（性别体型/配色/标志物/手持）+ 大级基调（疯狂红眼/辐射荧光）
    this.mesh = buildZombieJob(job, level, cfg.scale);
    this.baseScale = this.mesh.scale.x;   // 职业体型基准（攻击闪缩放用）
    game.scene.add(this.mesh);

    // 血条（面向相机的简易条）
    const barGeo = new THREE.PlaneGeometry(0.9, 0.09);
    this.hpBar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    this.hpBar.position.y = 2.15 * cfg.scale;
    this.hpBar.visible = false;
    this.mesh.add(this.hpBar);
  }

  materials() {
    const arr = [];
    this.mesh.traverse(o => { if (o.isMesh && o.material.emissive) arr.push(o.material); });
    return arr;
  }

  // M2 状态效果：同类取强不叠加
  applyStatus(type, dur, dps = 0) { applyStatusImpl(this, type, dur, dps); }
  moveMul() { return moveMulImpl(this); }

  // ---- E3 职业技能框架 ----
  hasSkill(key) { return this.cfg.skills.includes(key); }

  // 按 SKILLS 元数据的 hook 分发到 SKILL_IMPL；返回 true 的实现进入 cd（缺省 0.5s 供 tick 类刷新）
  fireSkills(hook, ctx = {}) {
    for (const key of this.cfg.skills) {
      const meta = ENEMY_CFG.SKILLS[key];
      if (!meta || meta.hook !== hook) continue;
      if ((this.skillCd[key] ?? 0) > 0) continue;
      const fn = SKILL_IMPL[key];
      if (fn && fn(this, this.game, ctx)) this.skillCd[key] = meta.cd ?? meta.interval ?? 0.5;
    }
  }

  // 攻击力：士气加成（🤝 抱团 +15%）
  attackDamage() { return Math.round(this.cfg.damage * (this.moraleOn ? ENEMY_CFG.SKILLS.morale.dmg : 1)); }
  // 攻击间隔：尖叫召集攻速乘数
  attackInterval() { return 1.2 / (this.attackMul ?? 1); }

  // 扑击动画（原攻击段内联逻辑提取，蓄力结算复用）
  pounce() {
    this.mesh.scale.setScalar(this.baseScale * 1.12);
    setTimeout(() => { if (!this.dead) this.mesh.scale.setScalar(this.baseScale); }, 120);
  }

  // ⚠️ 蓄力红圈预警（地面）
  showWindupRing() {
    const geo = new THREE.RingGeometry(0.7, 1.0, 24);
    this.windupRing = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    this.windupRing.rotation.x = -Math.PI / 2;
    this.windupRing.position.set(this.pos.x, this.pos.y + 0.06, this.pos.z);
    this.game.scene.add(this.windupRing);
  }
  hideWindupRing() {
    if (this.windupRing) {
      this.game.scene.remove(this.windupRing);
      this.windupRing.geometry.dispose(); this.windupRing.material.dispose();
      this.windupRing = null;
    }
  }

  // 🔫 点射红色射线预警（枪口 → 玩家胸口）
  showAimLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.aimLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.85 }));
    this.aimLine.frustumCulled = false;
    this.game.scene.add(this.aimLine);
    this.updateAimLine(this.game.player.pos);
  }
  updateAimLine(targetPos) {
    if (!this.aimLine) return;
    this.aimLine.geometry.setFromPoints([
      new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z),
      new THREE.Vector3(targetPos.x, targetPos.y + 1.2, targetPos.z),
    ]);
  }
  hideAimLine() {
    if (this.aimLine) {
      this.game.scene.remove(this.aimLine);
      this.aimLine.geometry.dispose(); this.aimLine.material.dispose();
      this.aimLine = null;
    }
  }

  takeDamage(dmg, knockDir, opts = null) {
    if (this.dead) return;
    const g = this.game;
    // 🤸 战术翻滚：远程免疫中，本次伤害无效
    if (opts?.ranged && this.rollImmuneT > 0) {
      spawnParticle(g, this.pos.x, this.pos.y + 1.4, this.pos.z, 0xdddddd, 0.3);
      if (!opts.noAggro) this.aggro = true;
      return;
    }
    // 🛡 防弹插板：爆头伤害 ×0.6
    if (opts?.headshot && this.hasSkill('plate')) dmg *= ENEMY_CFG.SKILLS.plate.headMul;
    // 🏃 胆小侧闪：受击 25% 侧向闪避位移（cd 2s），免疫本次伤害
    if (this.hasSkill('dodge') && (this.skillCd.dodge ?? 0) <= 0 && Math.random() < ENEMY_CFG.SKILLS.dodge.chance) {
      this.skillCd.dodge = ENEMY_CFG.SKILLS.dodge.cd;
      const kd = knockDir ?? { x: 0, z: 1 };
      const perp = { x: -kd.z, z: kd.x };
      const side = Math.random() < 0.5 ? 1 : -1;
      g.world.moveEntity(this.pos, { x: perp.x * side * 9, y: 0, z: perp.z * side * 9 }, 0.18, Z_HALF, Z_HEIGHT);
      spawnParticle(g, this.pos.x, this.pos.y + 1.4, this.pos.z, 0xffffff, 0.35);
      if (!opts?.noAggro) this.aggro = true;
      return;
    }
    // E1：职业减伤入口（armorPct，最低承伤 1）
    this.hp -= Math.max(1, Math.round(dmg * (1 - this.armorPct)));
    this.lastHurtT = 0;   // 💉 脱战计时清零
    if (!opts?.noAggro) this.aggro = true;   // M5 隐蔽：弓 12m 外不惊动
    this.flashT = 0.15;
    this.game.sfx?.hit();   // 受击音效
    for (const m of this.materials()) m.emissive.setHex(0x881111);
    if (knockDir) {
      this.vel.x += knockDir.x * 3.5;
      this.vel.z += knockDir.z * 3.5;
      this.vel.y += 2;
    }
    this.hpBar.visible = true;
    if (this.hp <= 0) { this.hideWindupRing(); this.hideAimLine(); this.die(); return; }
    this.fireSkills('onDamaged');   // 📢 尖叫召集
  }

  die() {
    this.dead = true;
    this.hideWindupRing();   // E3：清理蓄力红圈/点射射线
    this.hideAimLine();
    const g = this.game;
    g.player.addXp(this.cfg.xp);
    g.stats.kills++;
    g.ui.toast(`击杀 Lv.${this.level} 僵尸 +${this.cfg.xp} XP`, '#ffd54a');
    dropBook(g, this.pos, 0.07);   // M3：僵尸 7% 掉技能书
    // 掉落判定
    const dropMul = (g.player.mods ?? g.skills.mods).dropMul;
    for (const entry of ZOMBIE_LOOT) {
      if (Math.random() < entry.chance * dropMul) {
        const drop = entry.make(this.level);
        if (drop) g.entities.spawnDrop(drop.id, drop.n, this.pos);
      }
    }
    // 配方图纸：从尚未学会的图纸中随机掉一张（全学会后不掉）
    if (Math.random() < PLAN_DROP_CHANCE * dropMul) {
      const pool = Object.entries(ITEMS).filter(([, d]) => d.kind === 'plan' && !(g.unlocked instanceof Set && g.unlocked.has(d.learn)));
      if (pool.length) {
        const [id] = pool[Math.floor(Math.random() * pool.length)];
        g.entities.spawnDrop(id, 1, this.pos);
        g.ui.toast('📜 僵尸掉落了一张配方图纸！', '#ffd54a');
      }
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // E2：辐射僵尸自体辐射雾（荧光绿粒子上升，0.5-0.9s 一缕）
    this.fogT = (this.fogT ?? 0) - dt;
    if (this.level >= 3 && this.fogT <= 0) {
      this.fogT = 0.5 + Math.random() * 0.4;
      spawnParticle(g, this.pos.x, this.pos.y + 1.2, this.pos.z, 0x66ff44, 0.8);
    }

    // E3：技能 cd 衰减 + tick/aimed 钩子 + 状态衰减
    for (const k in this.skillCd) this.skillCd[k] = Math.max(0, this.skillCd[k] - dt);
    this.lastHurtT += dt;
    this.rollImmuneT = Math.max(0, this.rollImmuneT - dt);
    this.windupStunT = Math.max(0, this.windupStunT - dt);
    this.fireSkills('tick', { dt });   // 💉战地急救/🤝抱团士气/🔫军规点射
    this.fireSkills('aimed');          // 🤸战术翻滚

    // 🔨 破甲恢复：削甲持续结束返还护甲
    if (this.shredT > 0) {
      this.shredT -= dt;
      if (this.shredT <= 0) { g.player.armor += this.shredAmt; this.shredAmt = 0; }
    }

    // ⚠️ 蓄力劈砍状态机：预警期红圈跟踪脚底，结束后 2m 内结算 ×1.6 伤，走出则空劈硬直
    if (this.windupT > 0) {
      this.windupT -= dt;
      if (this.windupRing) this.windupRing.position.set(this.pos.x, this.pos.y + 0.06, this.pos.z);
      if (this.windupT <= 0) {
        this.hideWindupRing();
        for (const m of this.materials()) m.emissive.setHex(0x000000);
        this.attackCd = this.attackInterval();
        const d2 = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
        if (d2 < 2.0 && Math.abs(p.y - this.pos.y) < 2 && !g.player.dead) {
          g.player.damage(Math.round(this.attackDamage() * ENEMY_CFG.SKILLS.windup.mul), 'zombie');
          this.pounce();
        } else {
          this.windupStunT = ENEMY_CFG.SKILLS.windup.punish;
        }
      }
    }

    // 受击闪光恢复
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) for (const m of this.materials()) m.emissive.setHex(0x000000);
    }

    this.attackCd -= dt;
    let moveX = 0, moveZ = 0;
    if (dist < this.cfg.detect || this.aggro) {
      this.aggro = true;
      if (dist > 0.01) {
        moveX = dx / dist; moveZ = dz / dist;
      }
      // 进入攻击距离后停下（避免冲过头来回穿越玩家）
      const stop = dist < 1.4;
      const mm = this.moveMul();   // M2：震慑 ×0.5 / 致残 ×0.6
      const spd = this.cfg.speed * (this.moraleOn ? ENEMY_CFG.SKILLS.morale.spd : 1);   // 🤝 抱团士气加速
      const stun = this.windupStunT > 0 ? 0 : 1;   // ⚠️ 空劈硬直不移动
      this.vel.x = (stop ? 0 : moveX * spd * mm) * stun;
      this.vel.z = (stop ? 0 : moveZ * spd * mm) * stun;
      // 攻击
      if (dist < 1.8 && Math.abs(p.y - this.pos.y) < 2 && this.attackCd <= 0 && this.windupT <= 0 && this.windupStunT <= 0) {
        if (this.hasSkill('windup')) {
          // ⚠️ 蓄力劈砍：泛黄 + 红圈预警，0.6s 后由 update 状态机结算
          this.windupT = ENEMY_CFG.SKILLS.windup.t;
          this.showWindupRing();
          for (const m of this.materials()) m.emissive.setHex(0xccaa00);
        } else {
          this.attackCd = this.attackInterval();
          g.player.damage(this.attackDamage(), 'zombie');
          // 僵尸攻击可能造成创伤：擦伤 30% / 脑震荡 15% / 断手 10%
          const tr = Math.random();
          if (tr < 0.30) g.player.addEffect('scrape', 30);
          else if (tr < 0.45) g.player.addEffect('concussion', 25);
          else if (tr < 0.55) g.player.addEffect('broken_arm', 40);
          // 扑击动画（E2：以职业体型基准缩放，还原不覆盖体型）
          this.pounce();
          // E3：命中钩子（🍳锅铲连击/🦠感染采样/🔨破甲锤击）
          this.fireSkills('onAttackHit', { target: g.player });
        }
      }
    } else {
      // 游荡
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = randRange(2, 5);
        const a = randRange(0, Math.PI * 2);
        this.wanderDir.set(Math.cos(a), 0, Math.sin(a));
        if (Math.random() < 0.4) this.wanderDir.set(0, 0, 0);
      }
      this.vel.x = this.wanderDir.x * 0.8;
      this.vel.z = this.wanderDir.z * 0.8;
    }

    // 物理
    this.vel.y -= GAMEPLAY.GRAVITY * dt;
    const res = g.world.moveEntity(this.pos, this.vel, dt, Z_HALF, Z_HEIGHT);
    this.onGround = res.onGround;
    if (res.hitWall && this.onGround && this.aggro) this.vel.y = 7; // 撞墙跳跃

    // M2 状态引擎：流血掉血+粒子 / 震慑 / 致残 计时衰减
    statusTick(this, g, dt, 1.2);

    // 白天缓慢灼烧
    if (!g.isNight) this.hp -= 2.5 * dt;
    if (this.hp <= 0 && !this.dead) this.die();

    // 超远 despawn
    if (dist > 75) this.dead = true;

    // 同步模型
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (moveX !== 0 || moveZ !== 0) {
      this.mesh.rotation.y = Math.atan2(moveX, moveZ);
    }
    // 走路摆腿（四肢 pivot 由 buildHumanoid 提供）
    if (this.mesh.legL) {
      if (moveX !== 0 || moveZ !== 0) {
        this.walkPhase = (this.walkPhase ?? 0) + dt * 9;
        const s = Math.sin(this.walkPhase);
        this.mesh.legL.rotation.x = s * 0.7;
        this.mesh.legR.rotation.x = -s * 0.7;
      } else {
        this.mesh.legL.rotation.x = 0;
        this.mesh.legR.rotation.x = 0;
      }
    }
    const frac = clamp(this.hp / this.maxHp, 0, 1);
    this.hpBar.scale.x = frac;
    this.hpBar.visible = frac < 1 && dist < 25;
    // 血条始终面向相机
    if (this.hpBar.visible) {
      this.hpBar.rotation.y = -(g.camera.rotation.y ?? 0) - this.mesh.rotation.y;
    }
    // M2：血条颜色随状态（流血红/致残黄/震慑蓝）
    const hc = hpBarColor(this);
    if (this.hpBar.material.color.getHex() !== hc) this.hpBar.material.color.setHex(hc);
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

// ------------------------------------------------------------
// 动物（猪）—— 狩猎目标
// ------------------------------------------------------------
export class Animal {
  constructor(game, x, y, z) {
    this.game = game;
    this.maxHp = ANIMAL_CFG.hp;
    this.hp = ANIMAL_CFG.hp;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.fleeT = 0;
    this.fleeCd = 0;      // 逃跑结束后喘息期（不再逃跑，给玩家出手窗口）
    this.stunT = 0;       // 受击硬直
    this.wanderTimer = 0;
    this.wanderDir = new THREE.Vector3();
    this.dead = false;
    this.bleedT = 0; this.bleedDps = 0; this.slowT = 0; this.crippleT = 0; this.dotTick = 0;   // M2 状态
    this.headH = 0.85;   // M5 头部判定线（野猪）

    const g = new THREE.Group();
    const mat = c => new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.9), mat(0xe8a0a8));
    body.position.y = 0.55; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.3), mat(0xe8a0a8));
    head.position.set(0, 0.65, -0.55); g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.1), mat(0xd98898));
    snout.position.set(0, 0.6, -0.72); g.add(snout);
    for (const [lx, lz] of [[-0.18, -0.3], [0.18, -0.3], [-0.18, 0.3], [0.18, 0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.35, 0.14), mat(0xd98898));
      leg.position.set(lx, 0.17, lz); g.add(leg);
    }
    this.mesh = g;
    game.scene.add(this.mesh);
  }

  takeDamage(dmg, knockDir, opts = null) {
    if (this.dead) return;
    this.hp -= dmg;
    if (!opts?.noAggro) this.fleeT = 4;   // M5 隐蔽：弓 12m 外不惊动（不触发逃窜）
    this.stunT = 0.45;    // 受击硬直：短暂踉跄，方便连续追击
    this.game.sfx?.hit();   // 受击音效
    if (knockDir) {
      this.vel.x += knockDir.x * 3;
      this.vel.z += knockDir.z * 3;
      this.vel.y += 1.5;
    }
    if (this.hp <= 0) this.die();
  }

  // 边界与悬崖回避：逃跑/游走方向若指向地图边缘或断崖则反弹回来
  avoidHazards() {
    const d = this.wanderDir;
    if (!d.x && !d.z) return;
    const M = 5, W = WORLD.SIZE;   // 注意：世界水平尺寸是 SIZE（无 WIDTH 字段）
    let nx = d.x, nz = d.z;
    // 1) 边界反射（最高优先级）
    if (this.pos.x < M && nx < 0) nx = -nx;
    if (this.pos.x > W - M && nx > 0) nx = -nx;
    if (this.pos.z < M && nz < 0) nz = -nz;
    if (this.pos.z > W - M && nz > 0) nz = -nz;
    // 2) 悬崖回避仅在非边界区生效，避免覆盖边界反射造成方向震荡
    const nearEdge = this.pos.x < M || this.pos.x > W - M || this.pos.z < M || this.pos.z > W - M;
    if (!nearEdge) {
      const fx = Math.floor(this.pos.x + nx * 1.2), fz = Math.floor(this.pos.z + nz * 1.2);
      if (!this.groundBelow(fx, fz)) { nx = -nx; nz = -nz; }
    }
    d.set(nx, 0, nz);
  }

  // 目标列在脚下±3 格内是否有实地
  groundBelow(x, z) {
    const w = this.game.world;
    const base = Math.floor(this.pos.y);
    for (let yy = base; yy >= base - 3; yy--) {
      if (w.isSolid(x, yy, z)) return true;
    }
    return false;
  }

  // M2 状态效果：同类取强不叠加
  applyStatus(type, dur, dps = 0) { applyStatusImpl(this, type, dur, dps); }
  moveMul() { return moveMulImpl(this); }

  die() {
    this.dead = true;
    const g = this.game;
    const n = randInt(1, 2);
    g.entities.spawnDrop(ANIMAL_CFG.drop, n, this.pos);
    if (ANIMAL_CFG.drop2 && Math.random() < (ANIMAL_CFG.drop2Chance ?? 0.6)) {
      g.entities.spawnDrop(ANIMAL_CFG.drop2, randInt(1, 2), this.pos);
    }
    if (Math.random() < 0.3) g.entities.spawnDrop('bone', randInt(1, 2), this.pos);   // 骨头：熬胶水原料
    g.player.addXp(ANIMAL_CFG.xp);
    g.ui.toast(`狩猎获得 生肉 ×${n}`, '#ffd54a');
    dropBook(g, this.pos, 0.10);   // M3：猪 10% 掉技能书
  }

  update(dt) {
    const g = this.game;
    const p = g.player.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    let speed = 1.1;
    if (this.stunT > 0) {          // 受击硬直：原地踉跄
      this.stunT -= dt;
      speed = 0;
    } else if (this.fleeT > 0) {
      this.fleeT -= dt;
      speed = 2.9;                 // 逃跑比玩家步行（4.3）慢，稳能追上
      const d = dist > 0.01 ? 1 / dist : 0;
      this.wanderDir.set(-dx * d, 0, -dz * d);
    } else {
      if (this.fleeCd > 0) this.fleeCd -= dt;
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = randRange(2, 6);
        const a = randRange(0, Math.PI * 2);
        this.wanderDir.set(Math.cos(a), 0, Math.sin(a));
        if (Math.random() < 0.5) this.wanderDir.set(0, 0, 0);
      }
      if (dist < 3.5 && this.fleeCd <= 0) { // 喘息期不再逃跑，玩家有机会出手
        this.fleeT = 3;
        this.fleeCd = 6;
      }
    }
    this.avoidHazards();           // 不往地图边缘/悬崖跑
    speed *= this.moveMul();       // M2：震慑 ×0.5 / 致残 ×0.6
    this.vel.x = this.wanderDir.x * speed;
    this.vel.z = this.wanderDir.z * speed;
    this.vel.y -= GAMEPLAY.GRAVITY * dt;
    const res = g.world.moveEntity(this.pos, this.vel, dt, 0.35, 0.9);
    this.onGround = res.onGround;
    // 撞墙跳：需 ≥1.4m 峰值才能稳定跃上 1 格台阶（6.5 只有 0.88m 会卡死在台阶前）
    if (res.hitWall && this.onGround && (this.wanderDir.x || this.wanderDir.z)) this.vel.y = GAMEPLAY.JUMP_SPEED;

    // M2 状态引擎：流血掉血+粒子（动物无灼烧，需自行判死）
    statusTick(this, g, dt, 0.7);
    if (this.hp <= 0 && !this.dead) this.die();

    if (dist > 70 || this.pos.y < -8) this.dead = true;   // 兑底清理（正常不会发生）

    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.wanderDir.x || this.wanderDir.z) {
      this.mesh.rotation.y = Math.atan2(this.wanderDir.x, this.wanderDir.z) + Math.PI;
    }
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

// ------------------------------------------------------------
// 掉落物
// ------------------------------------------------------------
export class DropItem {
  constructor(game, id, count, pos) {
    this.game = game;
    this.id = id; this.count = count;
    this.pos = pos.clone().add(new THREE.Vector3(randRange(-0.4, 0.4), 0.4, randRange(-0.4, 0.4)));
    this.vel = new THREE.Vector3(randRange(-1.5, 1.5), randRange(2, 4), randRange(-1.5, 1.5));
    this.age = 0;
    this.dead = false;
    this.mesh = buildItemCube(id, 0.26);
    game.scene.add(this.mesh);
    game.sfx?.drop();   // 掉落物生成噗通声（内置节流）
  }

  update(dt) {
    const g = this.game;
    this.age += dt;
    const p = g.player;
    const eye = new THREE.Vector3(p.pos.x, p.pos.y + 0.9, p.pos.z);
    const d = eye.distanceTo(this.pos);

    // 磁吸拾取
    if (d < 2.4 && this.age > 0.4) {
      const dir = eye.sub(this.pos).normalize();
      this.pos.addScaledVector(dir, 7 * dt);
      if (d < 1.0) {
        const left = g.inventory.add(this.id, this.count);
        const got = this.count - Math.max(0, left);
        if (got > 0) {
          g.sfx?.pickup();   // 拾取清脆双音
          g.ui.loot([{ id: this.id, count: got }]);   // 右下角收获提示（约 5 秒）
        }
        if (left <= 0) this.dead = true;
        else this.count = left;
      }
    } else {
      this.vel.y -= GAMEPLAY.GRAVITY * 0.6 * dt;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      g.world.moveEntity(this.pos, this.vel, dt, 0.15, 0.3);
    }

    if (this.age > 120) this.dead = true;

    this.mesh.position.set(this.pos.x, this.pos.y + 0.2 + Math.sin(this.age * 3) * 0.06, this.pos.z);
    this.mesh.rotation.y += dt * 1.5;
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

// ------------------------------------------------------------
// 箭矢 / 弩箭
// ------------------------------------------------------------
export class Projectile {
  // opts：M5 远程武器信息 { cls, lv, mat, itemId }（旧调用 null → 纯基础弹道）
  constructor(game, itemId, pos, vel, damage, opts = null) {
    this.game = game;
    this.itemId = itemId;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.damage = damage;
    this.wcls = opts?.cls ?? null;   // 弓/弩类别（特技判定）
    this.wlv = opts?.lv ?? 0;        // 武器级别（流血强度）
    this.bleedMul = opts?.bleedMul ?? 0;   // M7 放血：流血 dps +25%
    this.headAdd = opts?.headAdd ?? 0;     // M7 狩猎：爆头判定概率
    this.stuck = 0;
    this.dead = false;
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.55),
      new THREE.MeshLambertMaterial({ color: ITEMS[itemId]?.color ?? 0xb59a6d })
    );
    game.scene.add(this.mesh);
    this.updateMesh();
  }

  updateMesh() {
    this.mesh.position.copy(this.pos);
    if (this.vel.lengthSq() > 0.01) {
      this.mesh.lookAt(this.pos.clone().add(this.vel));
    }
  }

  update(dt) {
    const g = this.game;
    if (this.stuck > 0) {
      this.stuck -= dt;
      if (this.stuck <= 0) {
        // 部分可拾取
        if (Math.random() < 0.5) g.entities.spawnDrop(this.itemId, 1, this.pos);
        this.dead = true;
      }
      return;
    }

    this.vel.y -= 14 * dt;
    const next = this.pos.clone().addScaledVector(this.vel, dt);

    // 撞方块
    const hit = g.world.raycast(this.pos, this.vel, this.vel.length() * dt + 0.1);
    if (hit) { this.stuck = 3; this.updateMesh(); return; }

    // 命中实体
    const targets = [...g.entities.zombies, ...g.entities.animals];
    for (const e of targets) {
      if (e.dead) continue;
      const c = new THREE.Vector3(e.pos.x, e.pos.y + 0.9, e.pos.z);
      if (c.distanceTo(next) < 0.75) {
        const mods = g.skills.mods;
        let dmg = this.damage * mods.rangedMul;
        const crit = Math.random() < mods.crit;
        if (crit) dmg *= 2;
        // M5 头部判定：命中点高于头部线 → ×1.5；M7 狩猎：插件概率补判头部
        const head = next.y > e.pos.y + (e.headH ?? 1.45) || Math.random() < this.headAdd;
        if (head) dmg *= HEADSHOT_MUL;
        // M5 弓/弩特技：弓流血 1.5+0.3lv/3s，弩重伤 3+0.5lv/5s；M7 放血：×(1+bleedMul)
        if (this.wcls === 'bow') e.applyStatus?.('bleed', 3, (1.5 + 0.3 * this.wlv) * (1 + this.bleedMul));
        else if (this.wcls === 'crossbow') e.applyStatus?.('bleed', 5, (3 + 0.5 * this.wlv) * (1 + this.bleedMul));
        // M5 隐蔽：弓且 12m 外 → 不因这次攻击进入 aggro（潜行狙击）
        const dist = e.pos.distanceTo(g.player.pos);
        const noAggro = this.wcls === 'bow' && dist > 12;
        // E3：ranged → 战术翻滚免疫可拦截；headshot → 防弹插板减爆头
        e.takeDamage(dmg, this.vel.clone().normalize(), { noAggro, ranged: true, headshot: head });
        g.ui.toast(head ? `🎯 爆头！-${Math.round(dmg)}`
          : noAggro ? `🏹 隐蔽狙击 -${Math.round(dmg)}`
          : crit ? `🎯 暴击！-${Math.round(dmg)}` : `-${Math.round(dmg)}`,
          crit || head ? '#ffd54a' : '#ff9d5c');
        this.dead = true;
        return;
      }
    }

    this.pos.copy(next);
    if (this.pos.y < -5 || this.pos.length() > 200) this.dead = true;
    this.updateMesh();
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

// ------------------------------------------------------------
// 实体管理器
// ------------------------------------------------------------
export class EntityManager {
  constructor(game) {
    this.game = game;
    this.zombies = [];
    this.animals = [];
    this.drops = [];
    this.projectiles = [];
    this.particles = [];   // M2 轻量粒子
    this.zombieTimer = 2;
    this.animalTimer = 1;
  }

  surfaceSpawnPos(minD, maxD) {
    const g = this.game;
    const p = g.player.pos;
    for (let tries = 0; tries < 12; tries++) {
      const a = randRange(0, Math.PI * 2);
      const d = randRange(minD, maxD);
      const x = clamp(Math.floor(p.x + Math.cos(a) * d), 2, WORLD.SIZE - 3);
      const z = clamp(Math.floor(p.z + Math.sin(a) * d), 2, WORLD.SIZE - 3);
      const y = g.world.surfaceY(x, z);
      if (g.world.getBlock(x, y - 1, z) === 11 /* WATER */) continue;
      if (y <= 1) continue;
      return { x: x + 0.5, y, z: z + 0.5 };
    }
    return null;
  }

  // E1：job 缺省按天数/昼夜自动抽职业（门槛+夜晚倾斜+归一化权重）
  spawnZombie(level, job = null) {
    const pos = this.surfaceSpawnPos(ZOMBIE_CFG.MIN_DIST, ZOMBIE_CFG.MAX_DIST);
    if (!pos) return;
    this.zombies.push(new Zombie(this.game, level, pos.x, pos.y, pos.z, job ?? pickJob(this.game.day, this.game.isNight)));
  }

  spawnAnimal() {
    const pos = this.surfaceSpawnPos(12, 30);
    if (!pos) return;
    this.animals.push(new Animal(this.game, pos.x, pos.y, pos.z));
  }

  spawnDrop(id, n, pos) {
    this.drops.push(new DropItem(this.game, id, n, pos));
  }

  spawnProjectile(itemId, pos, vel, damage, opts = null) {
    this.projectiles.push(new Projectile(this.game, itemId, pos, vel, damage, opts));
  }

  nearestZombieDist() {
    let best = Infinity;
    const p = this.game.player.pos;
    for (const z of this.zombies) {
      if (z.dead) continue;
      best = Math.min(best, Math.hypot(z.pos.x - p.x, z.pos.z - p.z));
    }
    return best;
  }

  update(dt) {
    const g = this.game;

    // 僵尸生成：前 3 天新手保护期不刷；之后随存活天数与玩家战力缓升
    this.zombieTimer -= dt;
    if (this.zombieTimer <= 0) {
      const budget = zombieBudget(g.day, g.player.powerScore(), g.isNight);
      this.zombieTimer = budget ? budget.interval : 2;   // 保护期低频探测，结束后立即生效
      if (budget && !this._protectWarned) {
        this._protectWarned = true;
        g.ui?.toast('⚠️ 新手保护期结束！僵尸开始出没，夜间更多——记得做武器护甲！');
      }
      if (budget && this.zombies.length < budget.max) {
        const r = Math.random();
        let level = 1;
        if (r < budget.lv3P) level = 3;
        else if (r < budget.lv3P + budget.lv2P) level = 2;
        this.spawnZombie(level);
      }
    }

    // 动物补充
    this.animalTimer -= dt;
    if (this.animalTimer <= 0) {
      this.animalTimer = ANIMAL_CFG.SPAWN_INTERVAL;
      if (this.animals.length < ANIMAL_CFG.MAX) this.spawnAnimal();
    }

    for (const z of this.zombies) if (!z.dead) z.update(dt);
    for (const a of this.animals) if (!a.dead) a.update(dt);
    for (const d of this.drops) if (!d.dead) d.update(dt);
    for (const pr of this.projectiles) if (!pr.dead) pr.update(dt);

    this._cleanup(this.zombies);
    this._cleanup(this.animals);
    this._cleanup(this.drops);
    this._cleanup(this.projectiles);
    updateParticles(this.game, dt);   // M2 粒子生命周期
  }

  _cleanup(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].dead) {
        list[i].dispose();
        list.splice(i, 1);
      }
    }
  }
}
