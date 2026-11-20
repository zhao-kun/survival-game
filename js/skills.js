// ============================================================
// skills.js —— 技能系统（智力 / 力量 / 灵活 / 感知）
// ============================================================
import { SKILL_TREE } from './config.js';

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
