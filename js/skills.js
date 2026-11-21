// ============================================================
// skills.js —— 技能系统（智力 / 力量 / 灵活 / 感知）
// ============================================================
import { SKILL_TREE, W_TIER_ORDER, unlockByBooks } from './config.js';

export class SkillSystem {
  constructor() {
    this.lv = {};      // "int_craft" -> 等级
    this.mods = null;
    this.recompute();
  }

  id(catId, skillId) { return catId + '_' + skillId; }
  levelOf(catId, skillId) { return this.lv[this.id(catId, skillId)] ?? 0; }

  // 某大类总等级
  catLevel(catId) {
    const cat = SKILL_TREE.find(c => c.id === catId);
    return cat.skills.reduce((s, k) => s + this.levelOf(cat.id, k.id), 0);
  }

  canLearn(catId, skill) {
    return this.levelOf(catId, skill.id) < skill.max;
  }

  // 学习消耗 1 点技能点，由调用方扣点
  learn(catId, skillId) {
    const key = this.id(catId, skillId);
    this.lv[key] = (this.lv[key] ?? 0) + 1;
    this.recompute();
  }

  recompute() {
    const l = (c, s) => this.levelOf(c, s);
    this.mods = {
      craftDiscount: 0.07 * l('int', 'craft'),
      smeltBonus:    0.10 * l('int', 'smelt'),
      xpGain:        1 + 0.08 * l('int', 'xp'),
      unlockSteel:   l('int', 'unlock') > 0,

      meleeMul:      1 + 0.20 * l('str', 'power'),
      breakMul:      1 + 0.15 * l('str', 'mine'),
      hpBonus:       20 * l('str', 'health'),
      tough:         0.06 * l('str', 'tough'),

      moveMul:       1 + 0.08 * l('agi', 'speed'),
      attackMul:     1 + 0.10 * l('agi', 'attack'),
      jumpMul:       1 + 0.06 * l('agi', 'jump'),
      fallReduce:    0.25 * l('agi', 'jump'),
      dodge:         0.08 * l('agi', 'dodge'),

      crit:          0.06 * l('per', 'crit'),
      rangedMul:     1 + 0.15 * l('per', 'ranged'),
      warningRange:  6 + 4 * l('per', 'sense'),
      dropMul:       1 + 0.12 * l('per', 'scav'),

      packBonus:     4 * l('str', 'pack'),   // 背包格数加成（力量·行囊）
    };
  }
}

// ============================================================
// MasterySystem —— 武器熟练度（M3 技能书系统，docs/WEAPONS-DESIGN.md 5）
// 六类武器各自累计研读本数 → unlockByBooks 决定可造/可用品级上限
// ============================================================
export class MasterySystem {
  constructor() {
    this.counts = { knife: 0, hammer: 0, club: 0, spear: 0, bow: 0, crossbow: 0 };
  }

  // 研读 n 本：返回 before/after 解锁状态与是否推进（gi 变化即解锁新档位）
  add(cls, n = 1) {
    const before = unlockByBooks(this.counts[cls] ?? 0);
    this.counts[cls] = Math.min(99, (this.counts[cls] ?? 0) + n);
    const after = unlockByBooks(this.counts[cls]);
    return { before, after, upgraded: after.gi !== before.gi };
  }

  // 当前解锁档位 { tier, tierIdx, lvl, gi, maxed }
  unlocked(cls) { return unlockByBooks(this.counts[cls] ?? 0); }

  // 某类某材质某级是否已解锁（如 isUnlocked('knife','iron',3)）
  isUnlocked(cls, mat, lv) {
    const u = this.unlocked(cls);
    const mi = W_TIER_ORDER.indexOf(mat);
    if (mi < 0) return false;
    return mi < u.tierIdx || (mi === u.tierIdx && lv <= u.lvl);
  }

  serialize() { return { ...this.counts }; }
  load(d) { for (const k in this.counts) this.counts[k] = Math.max(0, d?.[k] ?? 0); }
}
