// ============================================================
// crafting.js —— 合成系统（含工作站检测、智力系加成、制作耗时队列）
// 所有制作都需要时间：简单材料秒级、工具数秒、冶炼/装备十余秒；
// 同一时刻只能进行一件制作；篝火类制作离开篝火 4m 自动暂停。
// ============================================================
import { RECIPES, ITEMS, BLOCK } from './config.js';

// 每种产物的制作时长（秒）。未列出的配方兜底 5 秒——不存在零耗时制作。
export const CRAFT_TIME = {
  // 基础材料
  plank: 2, stick: 1.5, campfire: 3, furnace: 6,
  // 木级
  wood_pickaxe: 4, wood_axe: 4, wood_shovel: 3,
  wood_hammer: 4, wood_club: 3, wood_knife: 3,
  bow: 6, crossbow: 10, arrow: 2, bolt: 4,
  // 篝火/熔炉容器制作时长同步定义在 stations.js 的 STATION_RECIPES
  bottle_empty: 5, glass_cup: 6,
  // 铁级
  iron_hammer: 10, iron_club: 9, iron_knife: 9,
  iron_pickaxe: 10, iron_axe: 10, iron_shovel: 8,
  // 钢级
  steel_hammer: 14, steel_club: 12, steel_knife: 12,
  steel_pickaxe: 14, steel_axe: 14, steel_shovel: 12,
  // 装备
  leather_helm: 6, leather_vest: 8, leather_pants: 7, leather_boots: 5, pack_canvas: 8,
  iron_helm: 10, iron_chest: 12, iron_pants: 11, iron_boots: 9, pack_explorer: 12,
  steel_helm: 14, steel_chest: 16, steel_pants: 15, steel_boots: 13,
  // 插件
  mod_sharp: 12, mod_quick: 12, mod_light: 12, mod_armor: 12, mod_pack: 12,
  mod_crit: 14, mod_scope: 14, mod_scav: 14,
};

const fmtTime = s => (s >= 60 ? `${Math.floor(s / 60)}分${Math.round(s % 60)}秒` : `${Math.round(s)}秒`);

export class Crafting {
  constructor(game) {
    this.game = game;
    this.recipes = RECIPES;
    for (const r of this.recipes) r.time = CRAFT_TIME[r.out] ?? 5;   // 附着制作时长
    this.job = null;   // 进行中的制作 { out, n, label, icon, remaining, total, smelt, xp, stationPos }
  }

  // 附近是否有指定工作站
  nearStation(station) {
    const map = { campfire: BLOCK.CAMPFIRE, furnace: BLOCK.FURNACE };
    return this.game.world.nearBlock(this.game.player.pos, map[station], 4);
  }

  // 合成后的实际消耗（智力「巧匠」减少材料）
  discountedCost(recipe) {
    const d = (this.game.player.mods ?? this.game.skills.mods).craftDiscount;
    const cost = {};
    for (const [id, n] of Object.entries(recipe.cost)) {
      cost[id] = Math.max(1, Math.round(n * (1 - d)));
    }
    return cost;
  }

  check(recipe) {
    const inv = this.game.inventory;
    if (recipe.needUnlock && !(this.game.player.mods ?? this.game.skills.mods).unlockSteel) {
      return { ok: false, reason: '需要技能【智力·蓝图】' };
    }
    if (recipe.station && !this.nearStation(recipe.station)) {
      return { ok: false, reason: `需要靠近${recipe.station === 'campfire' ? '篝火' : '熔炉'}` };
    }
    const cost = this.discountedCost(recipe);
    for (const [id, n] of Object.entries(cost)) {
      if (!inv.has(id, n)) return { ok: false, reason: '材料不足', cost };
    }
    return { ok: true, reason: '', cost };
  }

  // 启动合成：扣材料 → 进入制作队列，完成后自动产出
  craft(recipe) {
    const c = this.check(recipe);
    if (!c.ok) return false;
    if (this.job) { this.game.ui.toast('⏳ 正在制作中，等它完成再排队', '#ffd54a'); return false; }
    const inv = this.game.inventory;
    for (const [id, n] of Object.entries(c.cost)) inv.remove(id, n);
    this.job = {
      out: recipe.out, n: recipe.n,
      label: ITEMS[recipe.out].name, icon: ITEMS[recipe.out].icon,
      remaining: recipe.time, total: recipe.time,
      smelt: !!recipe.station, xp: 4, stationPos: null,
    };
    const tag = recipe.station === 'furnace' ? '🏭 冶炼' : recipe.station === 'campfire' ? '🔥 烹饪' : '🔨 制作';
    this.game.ui.toast(`${tag} ${ITEMS[recipe.out].name}…约 ${fmtTime(recipe.time)}`, '#b7ff5e');
    return true;
  }

  update(dt) {
    if (!this.job) return;
    const j = this.job;
    if (j.stationPos) {
      const p = this.game.player.pos;
      const d = Math.hypot(p.x - (j.stationPos.x + 0.5), p.z - (j.stationPos.z + 0.5));
      if (d > 4) return;   // 离开篝火 → 暂停（HUD 显示「已暂停」）
    }
    j.remaining -= dt;
    if (j.remaining > 0) return;
    // 完成：产出 + 智力「冶金」几率额外产出 +1
    let n = j.n;
    if (j.smelt) {
      const bonus = (this.game.player.mods ?? this.game.skills.mods).smeltBonus;
      if (Math.random() < bonus) n += 1;
    }
    this.game.inventory.add(j.out, n);
    // M6 材质门槛：产出铁质武器 → 解锁铁质护甲资格
    const od = ITEMS[j.out];
    if (od?.tier === 'iron' && (od.kind === 'melee' || od.kind === 'ranged')) {
      this.game.flags.ironWeapon = true;
    }
    this.game.sfx?.craft();   // 制作完成叮铃
    this.game.player.addXp(j.xp);
    this.game.ui.toast(`✅ ${j.label}做好了${n > 1 ? ` ×${n}` : ''}！`, '#b7ff5e');
    this.job = null;
  }

  // 供 HUD 查询；paused = 篝火类任务但玩家已离开
  progress() {
    if (!this.job) return null;
    const j = this.job;
    let paused = false;
    if (j.stationPos) {
      const p = this.game.player.pos;
      paused = Math.hypot(p.x - (j.stationPos.x + 0.5), p.z - (j.stationPos.z + 0.5)) > 4;
    }
    return { label: j.label, icon: j.icon, frac: 1 - Math.max(0, j.remaining) / j.total, remain: Math.max(0, j.remaining), paused };
  }

  // 供 UI 使用
  listStatus() {
    return this.recipes.map(r => ({ recipe: r, ...this.check(r) }));
  }
}
