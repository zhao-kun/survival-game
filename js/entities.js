// ============================================================
// entities.js —— 僵尸 / 动物 / 掉落物 / 箭矢 / 实体管理器
// ============================================================
import * as THREE from 'three';
import { ZOMBIE_CFG, ANIMAL_CFG, ZOMBIE_LOOT, PLAN_DROP_CHANCE, ITEMS, GAMEPLAY, WORLD, zombieBudget } from './config.js';
import { buildHumanoid, buildItemCube } from './models.js';
import { randRange, randInt, clamp } from './utils.js';

const Z_HALF = 0.3, Z_HEIGHT = 1.8;

// ------------------------------------------------------------
// 僵尸
// ------------------------------------------------------------
export class Zombie {
  constructor(game, level, x, y, z) {
    this.game = game;
    this.level = level;
    const cfg = ZOMBIE_CFG.LEVELS[level - 1];
    this.cfg = cfg;
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

    this.mesh = buildHumanoid({
      skin: 0x4a9a4a, shirt: 0x2a6f6f, pants: 0x3a3a6a,
      armsForward: true, facing: 1, scale: cfg.scale,
    });
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

  takeDamage(dmg, knockDir) {
    if (this.dead) return;
    this.hp -= dmg;
    this.aggro = true;
    this.flashT = 0.15;
    this.game.sfx?.hit();   // 受击音效
    for (const m of this.materials()) m.emissive.setHex(0x881111);
    if (knockDir) {
      this.vel.x += knockDir.x * 3.5;
      this.vel.z += knockDir.z * 3.5;
      this.vel.y += 2;
    }
    this.hpBar.visible = true;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    const g = this.game;
    g.player.addXp(this.cfg.xp);
    g.stats.kills++;
    g.ui.toast(`击杀 Lv.${this.level} 僵尸 +${this.cfg.xp} XP`, '#ffd54a');
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
      this.vel.x = stop ? 0 : moveX * this.cfg.speed;
      this.vel.z = stop ? 0 : moveZ * this.cfg.speed;
      // 攻击
      if (dist < 1.8 && Math.abs(p.y - this.pos.y) < 2 && this.attackCd <= 0) {
        this.attackCd = 1.2;
        g.player.damage(this.cfg.damage, 'zombie');
        // 僵尸攻击可能造成创伤：擦伤 30% / 脑震荡 15% / 断手 10%
        const tr = Math.random();
        if (tr < 0.30) g.player.addEffect('scrape', 30);
        else if (tr < 0.45) g.player.addEffect('concussion', 25);
        else if (tr < 0.55) g.player.addEffect('broken_arm', 40);
        // 扑击动画
        this.mesh.scale.setScalar(this.cfg.scale * 1.12);
        setTimeout(() => { if (!this.dead) this.mesh.scale.setScalar(this.cfg.scale); }, 120);
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

  takeDamage(dmg, knockDir) {
    if (this.dead) return;
    this.hp -= dmg;
    this.fleeT = 4;
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
    this.vel.x = this.wanderDir.x * speed;
    this.vel.z = this.wanderDir.z * speed;
    this.vel.y -= GAMEPLAY.GRAVITY * dt;
    const res = g.world.moveEntity(this.pos, this.vel, dt, 0.35, 0.9);
    this.onGround = res.onGround;
    // 撞墙跳：需 ≥1.4m 峰值才能稳定跃上 1 格台阶（6.5 只有 0.88m 会卡死在台阶前）
    if (res.hitWall && this.onGround && (this.wanderDir.x || this.wanderDir.z)) this.vel.y = GAMEPLAY.JUMP_SPEED;

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
  constructor(game, itemId, pos, vel, damage) {
    this.game = game;
    this.itemId = itemId;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.damage = damage;
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
        e.takeDamage(dmg, this.vel.clone().normalize());
        g.ui.toast(crit ? `🎯 暴击！-${Math.round(dmg)}` : `-${Math.round(dmg)}`, crit ? '#ffd54a' : '#ff9d5c');
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

  spawnZombie(level) {
    const pos = this.surfaceSpawnPos(ZOMBIE_CFG.MIN_DIST, ZOMBIE_CFG.MAX_DIST);
    if (!pos) return;
    this.zombies.push(new Zombie(this.game, level, pos.x, pos.y, pos.z));
  }

  spawnAnimal() {
    const pos = this.surfaceSpawnPos(12, 30);
    if (!pos) return;
    this.animals.push(new Animal(this.game, pos.x, pos.y, pos.z));
  }

  spawnDrop(id, n, pos) {
    this.drops.push(new DropItem(this.game, id, n, pos));
  }

  spawnProjectile(itemId, pos, vel, damage) {
    this.projectiles.push(new Projectile(this.game, itemId, pos, vel, damage));
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
