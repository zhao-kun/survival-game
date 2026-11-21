// ============================================================
// save.js —— 存档系统：按用户 ID 存/读/删（localStorage）
// 保存内容：天数/时间、玩家状态、技能等级、物品栏+装备、方块修改 diff。
// 地形生成是确定性的（固定种子），因此只需保存玩家修改过的方块。
// serializeGame / applySaveData 为纯函数，可在无 localStorage 环境测试。
// ============================================================

const PREFIX = 'survival-save:';
const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);

// ---------------- 序列化（游戏状态 → 存档对象） ----------------
export function serializeGame(game, userId) {
  const p = game.player, inv = game.inventory;
  return {
    v: 1,
    userId,
    day: game.day,
    elapsed: game.elapsed,
    stats: { ...game.stats },
    player: {
      x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      hp: +p.hp.toFixed(1), hunger: +p.hunger.toFixed(1), thirst: +p.thirst.toFixed(1),
      xp: p.xp, level: p.level, points: p.points,
      equipment: JSON.parse(JSON.stringify(p.equipment)),
      // 状态效果（debuff/buff）：存剩余时长，重进游戏后继续生效
      effects: (p.effects ?? []).filter(e => e.time > 0).map(e => ({ id: e.id, time: +e.time.toFixed(1), power: e.power ?? 1 })),
    },
    skills: { lv: { ...game.skills.lv } },
    mastery: game.mastery?.serialize() ?? null,   // M3：武器熟练度（技能书）
    flags: { ...(game.flags ?? {}) },   // M6 材质门槛
    inv: {
      slots: inv.slots.map(s => (s ? { id: s.id, count: s.count } : null)),
      size: inv.slots.length,
      hotbarSize: inv.hotbarSize,
      selected: inv.selected,
    },
    blocks: [...(game.world.modified ?? [])].map(k => [k, game.world.blocks.get(k) ?? 0]),
    stations: game.stations?.serialize() ?? [],
    unlocked: game.unlocked instanceof Set ? [...game.unlocked] : [],   // 已学会的图纸配方组
    savedAt: Date.now(),
  };
}

// ---------------- 反序列化（存档对象 → 游戏状态） ----------------
export function applySaveData(game, data) {
  const p = game.player, inv = game.inventory, w = game.world;

  // 世界时间
  game.elapsed = data.elapsed ?? 0;
  game.stats = { kills: 0, blocksMined: 0, ...(data.stats ?? {}) };
  game.updateSky();   // 重算 day / timeOfDay / isNight / 天空颜色

  // 已学会的配方图纸
  game.unlocked = new Set(data.unlocked ?? []);

  // 玩家状态
  const pl = data.player ?? {};
  if (pl.x != null) p.pos.set(pl.x, pl.y, pl.z);
  p.vel?.set(0, 0, 0);
  if (pl.yaw != null) p.yaw = pl.yaw;
  if (pl.pitch != null) p.pitch = pl.pitch;
  if (pl.hp != null) p.hp = Math.min(pl.hp, p.maxHp);
  if (pl.hunger != null) p.hunger = Math.min(pl.hunger, 100);
  if (pl.thirst != null) p.thirst = Math.min(pl.thirst, 100);
  if (pl.xp != null) p.xp = pl.xp;
  if (pl.level != null) p.level = pl.level;
  if (pl.points != null) p.points = pl.points;
  if (pl.equipment) p.equipment = JSON.parse(JSON.stringify(pl.equipment));
  // 恢复状态效果（拉肚子/口渴等 debuff 在退出前后保持一致）
  p.effects = Array.isArray(pl.effects) ? pl.effects.map(e => ({ id: e.id, time: e.time, power: e.power ?? 1 })) : [];

  // 技能等级
  game.skills.lv = { ...(data.skills?.lv ?? {}) };
  game.skills.recompute();
  game.mastery?.load(data.mastery);   // M3：熟练度恢复（旧档无此字段保持全 0）
  if (data.flags) Object.assign(game.flags ?? (game.flags = {}), data.flags);   // M6

  // 物品栏 / 装备 / 容量
  if (data.inv) {
    inv.resize(Math.max(inv.hotbarSize, data.inv.size ?? inv.slots.length));
    inv.slots = data.inv.slots.map(s => (s ? { id: s.id, count: s.count } : null));
    if (data.inv.hotbarSize != null) inv.hotbarSize = data.inv.hotbarSize;
    inv.selected = Math.min(data.inv.selected ?? 0, inv.slots.length - 1);
    inv._changed?.();
  }

  // 方块修改 diff（新 Game 刚生成默认地形，直接覆盖即可）
  w.modified?.clear();
  for (const [k, id] of data.blocks ?? []) {
    const [x, y, z] = k.split(',').map(Number);
    w.setBlock(x, y, z, id);
  }
  // 全部区块标脏重建
  for (const ck of w.chunkData.keys()) w.dirty.add(ck);

  // 篝火/熔炉容器状态
  game.stations?.applySave?.(data.stations ?? []);

  // 刷新 UI
  game.ui.dirtyVitals = true; game.ui.dirtyXp = true;
  game.ui.updateHotbar();
}

// ---------------- 管理器：菜单交互 + 自动保存 ----------------
export class SaveManager {
  constructor(game) {
    this.game = game;
    this.userId = null;
    this.timer = 0;          // 自动保存计时
    this.AUTOSAVE_EVERY = 30; // 秒
  }

  // 枚举所有存档：[{userId, day, savedAt}]，按时间倒序
  list() {
    const store = ls();
    if (!store) return [];
    const out = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k.startsWith(PREFIX)) continue;
      try {
        const d = JSON.parse(store.getItem(k));
        out.push({ userId: d.userId ?? k.slice(PREFIX.length), day: d.day ?? 1, savedAt: d.savedAt ?? 0 });
      } catch { /* 损坏档跳过 */ }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  hasSave(userId) { return !!ls()?.getItem(PREFIX + userId); }

  peek(userId) {
    try {
      const d = JSON.parse(ls().getItem(PREFIX + userId));
      return { day: d.day ?? 1, savedAt: d.savedAt ?? 0 };
    } catch { return null; }
  }

  setUserId(id) {
    this.userId = String(id ?? '').trim().slice(0, 20);
  }

  // 保存当前进度；成功返回 true
  save() {
    const store = ls();
    if (!store || !this.userId) return false;
    try {
      store.setItem(PREFIX + this.userId, JSON.stringify(serializeGame(this.game, this.userId)));
      return true;
    } catch (e) {
      this.game.ui.toast('⚠️ 存档失败：' + e.message, '#ff8a7a');
      return false;
    }
  }

  // 读档并应用到当前游戏（新 Game 刚构建完成后调用）
  loadAndApply(userId) {
    const store = ls();
    if (!store || !this.hasSave(userId)) return false;
    try {
      applySaveData(this.game, JSON.parse(store.getItem(PREFIX + userId)));
      return true;
    } catch (e) {
      this.game.ui.toast('⚠️ 存档损坏，已开始新游戏', '#ff8a7a');
      return false;
    }
  }

  // 删除存档（死亡时调用）
  remove(userId) {
    ls()?.removeItem(PREFIX + userId);
  }

  // 主循环调用：定时自动保存
  update(dt) {
    if (!this.userId) return;
    this.timer += dt;
    if (this.timer >= this.AUTOSAVE_EVERY) {
      this.timer = 0;
      if (this.save()) this.game.ui.toast('💾 已自动保存', '#9ecbff');
    }
  }
}
