// ============================================================
// config.js —— 全局配置：世界参数 / 方块 / 物品 / 配方 / 技能树
// ============================================================

// ---------- 世界参数 ----------
export const WORLD = {
  SIZE: 64,          // 世界边长（方块数）
  HEIGHT: 28,        // 世界高度
  CHUNK: 16,         // 渲染区块边长
  WATER_LEVEL: 8,    // 海平面
  SEED: 1379,        // 地形种子
  DAY_LENGTH: 3600,  // 一天时长（秒）——设计为真实 1 小时，0=清晨
};

// ---------- 物理与生存参数 ----------
export const GAMEPLAY = {
  GRAVITY: 24,
  JUMP_SPEED: 8.2,
  WALK_SPEED: 4.3,
  SPRINT_MUL: 1.45,
  MOUSE_SENS: 0.0023,
  REACH: 4.5,          // 交互距离
  MELEE_REACH: 2.9,    // 近战攻击距离
  // 生存消耗按「游戏内一天」锚定（旧值按 300s/天设计，一天改为 1 小时后同比例放慢 12 倍）
  HUNGER_RATE: 0.025,  // 每秒饥饿消耗（约一天 90 点）
  THIRST_RATE: 0.028,  // 每秒口渴消耗（约一天 100 点）
  HAND_DRINK_THIRST: 25,   // 空手直接喝水恢复的口渴
  HAND_DRINK_EFFECT: 60,   // 空手喝水导致拉肚子的时长（秒）
  REGEN_RATE: 1.4,     // 满足状态每秒回血
  STARVE_DPS: 0.6,     // 饥饿为0时每秒扣血
  DEHYD_DPS: 0.9,      // 口渴为0时每秒扣血
  FALL_SAFE: 12,       // 坠落安全速度，超过则受伤
};

// ---------- 方块 ----------
export const BLOCK = {
  AIR: 0, BEDROCK: 1, GRASS: 2, DIRT: 3, STONE: 4, SAND: 5,
  LOG: 6, LEAVES: 7, PLANK: 8, IRON_ORE: 9, COAL_ORE: 10,
  WATER: 11, CAMPFIRE: 12, FURNACE: 13, GLASS: 14, WORKBENCH: 15,
};

// hardness：徒手采集所需秒数（配合工具会加速）；needsTool：必须用对应工具
export const BLOCKS = {
  [BLOCK.AIR]:      { name: '空气',   solid: false, transparent: true },
  [BLOCK.BEDROCK]:  { name: '基岩',   color: 0x2b2b2b, texture: 'noise',  solid: true,  targetable: false, hardness: Infinity },
  [BLOCK.GRASS]:    { name: '草方块', color: 0x63a844, texture: 'grass',  solid: true,  hardness: 0.9, tool: 'shovel',   drop: 'dirt',      xp: 3 },
  [BLOCK.DIRT]:     { name: '泥土',   color: 0x8a5a33, texture: 'noise',  solid: true,  hardness: 0.8, tool: 'shovel',   drop: 'dirt',      xp: 3 },
  [BLOCK.STONE]:    { name: '石头',   color: 0x8d8d8d, texture: 'noise',  solid: true,  hardness: 4.0, tool: 'pickaxe',  needsTool: true, drop: 'stone', xp: 4 },
  [BLOCK.SAND]:     { name: '沙子',   color: 0xd8c97e, texture: 'noise',  solid: true,  hardness: 0.7, tool: 'shovel',   drop: 'sand',      xp: 3 },
  [BLOCK.LOG]:      { name: '原木',   color: 0x6e4a2a, texture: 'log',    solid: true,  hardness: 2.2, tool: 'axe',      drop: 'log',       xp: 4 },
  [BLOCK.LEAVES]:   { name: '树叶',   color: 0x3e7d2c, texture: 'leaves', solid: true,  transparent: true, hardness: 0.4, drop: null, xp: 2 }, // 树叶特殊掉落在代码中处理
  [BLOCK.PLANK]:    { name: '木板',   color: 0xa97c50, texture: 'planks', solid: true,  hardness: 1.6, tool: 'axe',      drop: 'plank',     xp: 3 },
  [BLOCK.IRON_ORE]: { name: '铁矿石', color: 0x9a8b7a, texture: 'ore_iron', solid: true, hardness: 5.0, tool: 'pickaxe', needsTool: true, drop: 'iron_ore', xp: 6 },
  [BLOCK.COAL_ORE]: { name: '煤矿石', color: 0x6f6f6f, texture: 'ore_coal', solid: true, hardness: 4.5, tool: 'pickaxe', needsTool: true, drop: 'coal',    xp: 5 },
  [BLOCK.WATER]:    { name: '水',     color: 0x3b6fc9, texture: 'water',  solid: false, transparent: true, targetable: false },
  [BLOCK.CAMPFIRE]: { name: '篝火',   color: 0xd06a2a, texture: 'campfire', solid: false, targetable: true, hardness: 0.6, drop: 'campfire', xp: 2, station: 'campfire' },
  [BLOCK.FURNACE]:  { name: '熔炉',   color: 0x6f6f6f, texture: 'furnace', solid: true,  hardness: 4.5, tool: 'pickaxe', needsTool: true, drop: 'furnace', xp: 4, station: 'furnace' },
  [BLOCK.GLASS]:    { name: '玻璃',   color: 0xbfe3ef, texture: 'glass',  solid: true,  transparent: true, hardness: 0.5, drop: 'glass', xp: 2 },
  // station: 右键打开对应容器界面（篝火/熔炉/工作台）
  [BLOCK.WORKBENCH]:{ name: '工作台', color: 0xa97c50, texture: 'workbench', solid: true, hardness: 2.5, tool: 'axe', drop: 'workbench', xp: 3, station: 'workbench' },
};

// ---------- 武器/工具品级 ----------
// mul: 伤害倍率   power: 采集速度倍率
export const TIER = {
  wood:  { name: '木', color: 0x9c6b3c, css: '#9c6b3c', mul: 1.0, power: 1.6 },
  iron:  { name: '铁', color: 0xc8cdd6, css: '#c8cdd6', mul: 1.6, power: 2.6 },
  steel: { name: '钢', color: 0x7e8fa0, css: '#7e8fa0', mul: 2.3, power: 4.0 },
};

// ---------- 物品 ----------
// kind: material材料 / tool工具 / melee近战 / ranged远程 / food食物 / drink饮品 / ammo弹药 / misc
// icon: 长度1 => 彩色字块；否则按 emoji 显示。color: 字块颜色与掉落物方块颜色
export const ITEMS = {
  // 材料
  log:        { name: '原木',   icon: '🪵', color: 0x6e4a2a, kind: 'material', stack: 32, block: BLOCK.LOG },
  plank:      { name: '木板',   icon: '🟫', color: 0xa97c50, kind: 'material', stack: 64, block: BLOCK.PLANK },
  stick:      { name: '木棍',   icon: '🥢', color: 0x8a6236, kind: 'material', stack: 64 },
  stone:      { name: '石头',   icon: '🪨', color: 0x8d8d8d, kind: 'material', stack: 64, block: BLOCK.STONE },
  dirt:       { name: '泥土',   icon: '🟤', color: 0x8a5a33, kind: 'material', stack: 64, block: BLOCK.DIRT },
  sand:       { name: '沙子',   icon: '🟨', color: 0xd8c97e, kind: 'material', stack: 64, block: BLOCK.SAND },
  coal:       { name: '煤炭',   icon: '⚫', color: 0x30302e, kind: 'material', stack: 64 },
  iron_ore:   { name: '铁矿石', icon: '🟠', color: 0xb08b64, kind: 'material', stack: 64 },
  iron_ingot: { name: '铁锭',   icon: '🔩', color: 0xc8cdd6, kind: 'material', stack: 64 },
  steel_ingot:{ name: '钢锭',   icon: '⚙️', color: 0x7e8fa0, kind: 'material', stack: 64 },
  glass:      { name: '玻璃',   icon: '🔷', color: 0xbfe3ef, kind: 'material', stack: 64, block: BLOCK.GLASS },
  leather:    { name: '皮革',   icon: '革', color: 0x9a5f38, kind: 'material', stack: 64 },

  // 功能方块
  campfire:   { name: '篝火',   icon: '🔥', color: 0xd06a2a, kind: 'material', stack: 8, block: BLOCK.CAMPFIRE },
  furnace:    { name: '熔炉',   icon: '🏭', color: 0x6f6f6f, kind: 'material', stack: 8, block: BLOCK.FURNACE },

  // 食物 / 饮品
  raw_meat:     { name: '生肉',   icon: '🥩', color: 0xc4545f, kind: 'food',  stack: 16, food: { hunger: 10, thirst: 0,  health: -2 } },
  cooked_meat:  { name: '烤肉',   icon: '🍗', color: 0xa5672f, kind: 'food',  stack: 16, food: { hunger: 35, thirst: 0,  health: 6 }, buffs: [{ id: 'well_fed', time: 90 }], desc: '食用获得饱食：缓慢回血 90 秒' },
  berry:        { name: '浆果',   icon: '🫐', color: 0x5a4fcf, kind: 'food',  stack: 32, food: { hunger: 5,  thirst: 3,  health: 0 } },
  hot_soup:     { name: '炖肉汤', icon: '🍲', color: 0xd88a4a, kind: 'food',  stack: 8,  food: { hunger: 30, thirst: 10, health: 8 }, buffs: [{ id: 'well_fed', time: 150, power: 1.3 }], cure: 'concussion', desc: '热汤驱寒：治脑震荡 + 长时间回血' },
  bone_soup:    { name: '骨头汤', icon: '🍜', color: 0xe8d8b0, kind: 'drink', stack: 8,  food: { hunger: 10, thirst: 25, health: 5 }, buffs: [{ id: 'tough', time: 120 }], returns: 'glass_cup', desc: '以骨补骨：受伤 -20%（喝完返杯）' },
  meat_skewer:  { name: '烤肉串', icon: '🍢', color: 0xb87a3f, kind: 'food',  stack: 8,  food: { hunger: 22, thirst: 0,  health: 4 }, buffs: [{ id: 'strong', time: 120 }], desc: '大口吃肉：近战伤害 +20%' },
  feast:        { name: '什锦大餐', icon: '🍱', color: 0xffc85a, kind: 'food',  stack: 4,  food: { hunger: 55, thirst: 10, health: 15 }, buffs: [{ id: 'well_fed', time: 240, power: 1.5 }, { id: 'energized', time: 120 }], desc: '顶级大餐：超长回血 + 移速 +15%' },
  bottle_empty: { name: '空水瓶', icon: '🍶', color: 0xbfe3ef, kind: 'misc',  stack: 8 },
  bottle_dirty: { name: '生水',   icon: '🥃', color: 0x7a6a4a, kind: 'drink', stack: 8,  food: { hunger: 0, thirst: 22, health: -2 }, effect: { id: 'diarrhea', time: 45 }, returns: 'bottle_empty' },
  bottle_clean: { name: '开水',   icon: '💧', color: 0x6fc3ff, kind: 'drink', stack: 8,  food: { hunger: 0, thirst: 45, health: 2 }, returns: 'bottle_empty' },
  glass_cup:    { name: '玻璃杯', icon: '🥛', color: 0xd8f2ff, kind: 'misc',  stack: 8, desc: '可盛水的杯子，对准水面右键接水' },
  cup_dirty:    { name: '杯装生水', icon: '🥛', color: 0x8a7a5a, kind: 'drink', stack: 8, food: { hunger: 0, thirst: 20, health: -2 }, effect: { id: 'diarrhea', time: 40 }, returns: 'glass_cup' },
  cup_clean:    { name: '杯装开水', icon: '🍵', color: 0x6fc3ff, kind: 'drink', stack: 8, food: { hunger: 0, thirst: 42, health: 2 }, returns: 'glass_cup' },

  // 弹药
  arrow: { name: '箭矢', icon: '箭', color: 0xb59a6d, kind: 'ammo', stack: 64 },
  bolt:  { name: '弩箭', icon: '弩', color: 0x8d9aa5, kind: 'ammo', stack: 64 },

  // ---------- 装备 ----------
  // kind:'equip'  equip: 部位(head/chest/legs/boots/backpack)  armor: 护甲值  pack: 背包扩容格数  sockets: 插槽数
  leather_helm: { name: '皮革帽',   icon: '🪖', color: 0x9a5f38, kind: 'equip', equip: 'head',     stack: 1, armor: 1, sockets: 1 },
  iron_helm:    { name: '铁盔',     icon: '🪖', color: 0xc8cdd6, css: '#c8cdd6', kind: 'equip', equip: 'head',     stack: 1, armor: 2, sockets: 1 },
  steel_helm:   { name: '钢盔',     icon: '🪖', color: 0x7e8fa0, css: '#7e8fa0', kind: 'equip', equip: 'head',     stack: 1, armor: 3, sockets: 2 },
  leather_vest: { name: '皮甲',     icon: '🦺', color: 0x9a5f38, kind: 'equip', equip: 'chest',    stack: 1, armor: 2, sockets: 1 },
  iron_chest:   { name: '铁甲',     icon: '🦺', color: 0xc8cdd6, css: '#c8cdd6', kind: 'equip', equip: 'chest',    stack: 1, armor: 4, sockets: 1 },
  steel_chest:  { name: '钢甲',     icon: '🦺', color: 0x7e8fa0, css: '#7e8fa0', kind: 'equip', equip: 'chest',    stack: 1, armor: 6, sockets: 2 },
  leather_pants:{ name: '皮裤',     icon: '👖', color: 0x9a5f38, kind: 'equip', equip: 'legs',     stack: 1, armor: 1, sockets: 1 },
  iron_pants:   { name: '铁护腿',   icon: '👖', color: 0xc8cdd6, css: '#c8cdd6', kind: 'equip', equip: 'legs',     stack: 1, armor: 3, sockets: 1 },
  steel_pants:  { name: '钢护腿',   icon: '👖', color: 0x7e8fa0, css: '#7e8fa0', kind: 'equip', equip: 'legs',     stack: 1, armor: 5, sockets: 2 },
  leather_boots:{ name: '皮靴',     icon: '🥾', color: 0x9a5f38, kind: 'equip', equip: 'boots',    stack: 1, armor: 1, sockets: 1 },
  iron_boots:   { name: '铁靴',     icon: '🥾', color: 0xc8cdd6, css: '#c8cdd6', kind: 'equip', equip: 'boots',    stack: 1, armor: 2, sockets: 1 },
  steel_boots:  { name: '钢靴',     icon: '🥾', color: 0x7e8fa0, css: '#7e8fa0', kind: 'equip', equip: 'boots',    stack: 1, armor: 3, sockets: 1 },
  pack_canvas:  { name: '帆布背包', icon: '🎒', color: 0x8a6236, kind: 'equip', equip: 'backpack', stack: 1, pack: 6,  sockets: 1 },
  pack_explorer:{ name: '探险背包', icon: '🎒', color: 0x4a6b3a, kind: 'equip', equip: 'backpack', stack: 1, pack: 12, sockets: 2 },

  // ---------- 插件 ----------
  // kind:'plugin'  target: weapon武器 / armor护甲 / backpack背包  effect: { k: 效果键, v: 数值 }
  mod_sharp:  { name: '锋利插件', icon: '🗡️', color: 0xc0c8d0, kind: 'plugin', target: 'weapon',   stack: 8, effect: { k: 'meleeDmg',  v: 3    }, desc: '近战伤害 +3' },
  mod_quick:  { name: '迅捷插件', icon: '⚡', color: 0xffd54a, kind: 'plugin', target: 'weapon',   stack: 8, effect: { k: 'atkSpeed',  v: 0.12 }, desc: '攻击速度 +12%' },
  mod_crit:   { name: '暴击插件', icon: '🎯', color: 0xff7b6b, kind: 'plugin', target: 'weapon',   stack: 8, effect: { k: 'crit',      v: 0.08 }, desc: '暴击几率 +8%' },
  mod_scope:  { name: '瞄准插件', icon: '🔭', color: 0x7ec8ff, kind: 'plugin', target: 'weapon',   stack: 8, effect: { k: 'rangedDmg', v: 0.20 }, desc: '远程伤害 +20%' },
  mod_armor:  { name: '强化插件', icon: '🛡️', color: 0x9dff6c, kind: 'plugin', target: 'armor',    stack: 8, effect: { k: 'armor',     v: 2    }, desc: '护甲值 +2' },
  mod_light:  { name: '轻羽插件', icon: '🪶', color: 0xbfe3ef, kind: 'plugin', target: 'armor',    stack: 8, effect: { k: 'move',      v: 0.06 }, desc: '移动速度 +6%' },
  mod_pack:   { name: '扩容插件', icon: '📦', color: 0x8a6236, kind: 'plugin', target: 'backpack', stack: 8, effect: { k: 'pack',      v: 4    }, desc: '背包格数 +4' },
  mod_scav:   { name: '掠夺插件', icon: '🍀', color: 0x5a4fcf, kind: 'plugin', target: 'backpack', stack: 8, effect: { k: 'drop',      v: 0.10 }, desc: '僵尸掉落几率 +10%' },

  // —— 工作台系统：基础材料 ——
  bone:      { name: '骨头',     icon: '🦴', color: 0xe8e2d0, kind: 'material', stack: 64 },
  cloth:     { name: '布料',     icon: '🧵', color: 0xc9bfae, kind: 'material', stack: 64 },
  fiber:     { name: '植物纤维', icon: '🌿', color: 0x7ab55e, kind: 'material', stack: 64 },
  thread:    { name: '线',       icon: '🧶', color: 0xd8d3c0, kind: 'material', stack: 64 },
  glue:      { name: '胶水',     icon: '🧴', color: 0xd8b04a, kind: 'material', stack: 16 },
  iron_wire: { name: '铁线',     icon: '🔗', color: 0xc8cdd6, kind: 'material', stack: 64 },
  workbench: { name: '工作台',   icon: '🛠️', color: 0xa97c50, kind: 'material', stack: 8, block: BLOCK.WORKBENCH },

  // —— 工作台系统：高级成品 ——
  iron_sword:   { name: '铁剑', icon: '⚔️', color: 0xc8cdd6, css: '#c8cdd6', kind: 'melee', stack: 1, tier: 'iron', damage: 17.6, rate: 0.7, knock: 1.2 },
  bandage:      { name: '绷带', icon: '🩹', color: 0xf0ebe0, kind: 'medical', stack: 8, food: { hunger: 0, thirst: 0, health: 22 }, cure: 'scrape', desc: '回复 22 生命，治疗擦伤' },
  splint:       { name: '夹板', icon: '🩼', color: 0xc9a86a, kind: 'medical', stack: 4, food: { hunger: 0, thirst: 0, health: 6 }, cure: 'broken_arm', desc: '固定断手，恢复攻击能力' },
  medkit:       { name: '医疗包', icon: '🧰', color: 0xe05a5a, kind: 'medical', stack: 2, food: { hunger: 10, thirst: 0, health: 40 }, cure: 'all', desc: '回复 40 生命，治愈一切创伤与病痛' },
  leather_armor:{ name: '皮甲', icon: '🧥', color: 0x9c6b3c, css: '#9c6b3c', kind: 'equip', equip: 'chest', stack: 1, armor: 2, sockets: 1 },

  // —— 工作台系统：配方图纸（打怪掉落，右键学习后解锁对应配方）——
  plan_bow:      { name: '图纸：弓',     icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'bow',       desc: '学会后可在工作台制作弓' },
  plan_crossbow: { name: '图纸：弩',     icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'crossbow',  desc: '学会后可在工作台制作弩与弩箭' },
  plan_arrow:    { name: '图纸：箭矢',   icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'arrow',     desc: '学会后可在工作台批量制作箭矢' },
  plan_sword:    { name: '图纸：铁剑',   icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'sword',     desc: '学会后可在工作台打造铁剑' },
  plan_bandage:  { name: '图纸：绷带',   icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'bandage',   desc: '学会后可在工作台制作绷带' },
  plan_armor:    { name: '图纸：皮甲',   icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'armor',     desc: '学会后可在工作台制作皮甲' },
  plan_iron_armor: { name: '图纸：铁甲', icon: '📜', color: 0xd8c97e, kind: 'plan', stack: 4, learn: 'iron_armor', desc: '学会后可在工作台打造全套铁盔/铁甲/铁护腿/铁靴' },
};

// 插件是否能装到宿主装备/武器上
export function pluginFits(pDef, hostDef) {
  if (!pDef || pDef.kind !== 'plugin' || !hostDef) return false;
  if (pDef.target === 'weapon')   return ['melee', 'ranged', 'tool'].includes(hostDef.kind);
  if (pDef.target === 'armor')    return ['head', 'chest', 'legs', 'boots'].includes(hostDef.equip);
  if (pDef.target === 'backpack') return hostDef.equip === 'backpack';
  return false;
}

// 宿主需要的插件类型名（用于提示）
export function hostTargetName(hostDef) {
  if (!hostDef) return '?';
  if (['melee', 'ranged', 'tool'].includes(hostDef.kind)) return '武器';
  if (hostDef.equip === 'backpack') return '背包';
  if (hostDef.equip) return '护甲';
  return '?';
}

// —— 状态效果（Debuff / Buff）：喝生水等行为触发 ——
export const EFFECTS = {
  // ---- 负面（debuff）----
  diarrhea: {
    name: '拉肚子', icon: '💩', color: '#9ccc65', negative: true,
    hpDrain: 0.55,      // 每秒流失生命（× 强度）
    hungerMul: 2.0,     // 饥饿消耗加倍
    blockRegen: true,   // 无法自然回血
    desc: '持续掉血 · 饥饿消耗加倍 · 无法自然回血',
  },
  scrape: {
    name: '擦伤', icon: '🩸', color: '#e08a8a', negative: true,
    hpDrain: 0.25,
    desc: '轻微持续掉血（绷带可治）',
  },
  concussion: {
    name: '脑震荡', icon: '💫', color: '#c39bff', negative: true,
    moveMul: 0.8,       // 移速乘子（fxMul 读取）
    desc: '头昏眼花，移速 -20%（热汤可治）',
  },
  broken_arm: {
    name: '断手', icon: '🦴', color: '#d0d6de', negative: true,
    meleeMul: 0.5,      // 近战伤害乘子
    rangedMul: 0.5,     // 远程伤害乘子
    desc: '攻击伤害减半（夹板可治）',
  },
  // ---- 正面（buff，通过饮食获得）----
  well_fed: {
    name: '饱食', icon: '🍖', color: '#8fe36a',
    hpHeal: 0.6,        // 每秒恢复生命（× 强度）
    desc: '吃得很饱，缓慢回血中',
  },
  energized: {
    name: '精力充沛', icon: '⚡', color: '#ffe066',
    moveMul: 1.15,
    desc: '移速 +15%',
  },
  strong: {
    name: '强壮', icon: '💪', color: '#ff9d5c',
    meleeMul: 1.2,
    desc: '近战伤害 +20%',
  },
  tough: {
    name: '坚韧', icon: '🛡️', color: '#7ab8ff',
    dmgTaken: 0.8,      // 受伤乘子
    desc: '皮糙肉厚，受伤 -20%',
  },
};

// ---------- 近战武器（木/铁/钢 三级自动生成）----------
const WEAPONS = [
  { key: 'hammer', cn: '锤', icon: '锤', dmg: 9,  rate: 1.25, knock: 2.4 },
  { key: 'club',   cn: '棍', icon: '棍', dmg: 6,  rate: 0.85, knock: 1.6 },
  { key: 'knife',  cn: '刀', icon: '刀', dmg: 5,  rate: 0.50, knock: 0.8 },
];
for (const w of WEAPONS) {
  for (const [tier, t] of Object.entries(TIER)) {
    ITEMS[`${tier}_${w.key}`] = {
      name: t.name + w.cn, icon: w.icon, color: t.color, css: t.css,
      kind: 'melee', stack: 1, tier,
      damage: Math.round(w.dmg * t.mul * 10) / 10,
      rate: w.rate, knock: w.knock,
    };
  }
}

// ---------- 工具（镐/斧/铲 × 三级）----------
const TOOLS = [
  { key: 'pickaxe', cn: '镐', icon: '镐', tool: 'pickaxe' },
  { key: 'axe',     cn: '斧', icon: '斧', tool: 'axe' },
  { key: 'shovel',  cn: '铲', icon: '铲', tool: 'shovel' },
];
for (const t0 of TOOLS) {
  for (const [tier, t] of Object.entries(TIER)) {
    ITEMS[`${tier}_${t0.key}`] = {
      name: t.name + t0.cn, icon: t0.icon, color: t.color, css: t.css,
      kind: 'tool', stack: 1, tier, tool: t0.tool,
      power: t.power, damage: 2, rate: 0.8,
    };
  }
}

// ---------- 远程武器 ----------
ITEMS.bow      = { name: '弓',   icon: '🏹', color: 0x8a6236, kind: 'ranged', stack: 1, ammo: 'arrow', damage: 15, rate: 1.1 };
ITEMS.crossbow = { name: '弩',   icon: '🏹', color: 0x5c5148, kind: 'ranged', stack: 1, ammo: 'bolt',  damage: 26, rate: 1.9 };

// ---------- 配方 ----------
// station: null 手工 / 'campfire' 附近需有篝火 / 'furnace' 附近需有熔炉
// needUnlock: 需要智力技能「蓝图」解锁
export const RECIPES = [
  // 基础材料
  { out: 'plank',    n: 4, cost: { log: 1 } },
  { out: 'stick',    n: 4, cost: { plank: 2 } },
  { out: 'campfire', n: 1, cost: { log: 3, stone: 2 } },
  { out: 'furnace',  n: 1, cost: { stone: 8 } },
  // 木级工具
  { out: 'wood_pickaxe', n: 1, cost: { plank: 3, stick: 2 } },
  { out: 'wood_axe',     n: 1, cost: { plank: 3, stick: 2 } },
  { out: 'wood_shovel',  n: 1, cost: { plank: 1, stick: 2 } },
  // 木级武器
  { out: 'wood_hammer', n: 1, cost: { plank: 3, stick: 2 } },
  { out: 'wood_club',   n: 1, cost: { plank: 2, stick: 1 } },
  { out: 'wood_knife',  n: 1, cost: { plank: 2, stone: 1 } },
  // 医疗
  { out: 'splint',      n: 1, cost: { stick: 2, cloth: 2 } },   // 夹板：固定断手
  // 远程武器（弓/弩/箭矢/弩箭已迁入工作台：多样材料+图纸解锁）
  // 注：篝火/熔炉/工作台配方在 stations.js 的 STATION_RECIPES（容器化制作：原料+燃料+点火）
  { out: 'bottle_empty',n: 1, cost: { glass: 3 } },
  // 铁级武器
  { out: 'iron_hammer', n: 1, cost: { iron_ingot: 3, stick: 2 } },
  { out: 'iron_club',   n: 1, cost: { iron_ingot: 2, stick: 1 } },
  { out: 'iron_knife',  n: 1, cost: { iron_ingot: 2, stick: 1 } },
  // 铁级工具
  { out: 'iron_pickaxe', n: 1, cost: { iron_ingot: 3, stick: 2 } },
  { out: 'iron_axe',     n: 1, cost: { iron_ingot: 3, stick: 2 } },
  { out: 'iron_shovel',  n: 1, cost: { iron_ingot: 1, stick: 2 } },
  // 工作台系统：基础手工（线/工作台本体）
  { out: 'thread',    n: 1, cost: { fiber: 2 } },
  { out: 'workbench', n: 1, cost: { plank: 4, stone: 2, stick: 2 } },
  // 钢级（需蓝图解锁）
  { out: 'steel_hammer', n: 1, cost: { steel_ingot: 3, stick: 2 }, needUnlock: true },
  { out: 'steel_club',   n: 1, cost: { steel_ingot: 2, stick: 1 }, needUnlock: true },
  { out: 'steel_knife',  n: 1, cost: { steel_ingot: 2, stick: 1 }, needUnlock: true },
  { out: 'steel_pickaxe',n: 1, cost: { steel_ingot: 3, stick: 2 }, needUnlock: true },
  { out: 'steel_axe',    n: 1, cost: { steel_ingot: 3, stick: 2 }, needUnlock: true },
  { out: 'steel_shovel', n: 1, cost: { steel_ingot: 1, stick: 2 }, needUnlock: true },
  // 装备 - 皮革系
  { out: 'leather_helm',  n: 1, cost: { leather: 3 } },
  { out: 'leather_vest',  n: 1, cost: { leather: 5 } },
  { out: 'leather_pants', n: 1, cost: { leather: 4 } },
  { out: 'leather_boots', n: 1, cost: { leather: 2 } },
  { out: 'pack_canvas',   n: 1, cost: { leather: 4, stick: 2 } },
  // 铁甲/钢甲已迁入工作台（多样材料+图纸解锁/锻造技能）
  { out: 'pack_explorer', n: 1, cost: { leather: 6, iron_ingot: 1 } },
  // 插件（熔炉精密加工）
  { out: 'mod_sharp', n: 1, cost: { iron_ingot: 1, coal: 1 },  station: 'furnace' },
  { out: 'mod_quick', n: 1, cost: { iron_ingot: 1, coal: 1 },  station: 'furnace' },
  { out: 'mod_light', n: 1, cost: { iron_ingot: 1, coal: 2 },  station: 'furnace' },
  { out: 'mod_armor', n: 1, cost: { iron_ingot: 2, coal: 1 },  station: 'furnace' },
  { out: 'mod_pack',  n: 1, cost: { iron_ingot: 2, coal: 1 },  station: 'furnace' },
  { out: 'mod_crit',  n: 1, cost: { steel_ingot: 1, coal: 1 }, station: 'furnace' },
  { out: 'mod_scope', n: 1, cost: { steel_ingot: 1, coal: 1 }, station: 'furnace' },
  { out: 'mod_scav',  n: 1, cost: { steel_ingot: 1, coal: 2 }, station: 'furnace' },
];

// ---------- 技能树：4 大类，每类 4 个子技能 ----------
export const SKILL_TREE = [
  { id: 'int', name: '智力', icon: '🧠', color: '#7ec8ff', skills: [
    { id: 'craft',  name: '巧匠', max: 3, desc: '合成材料消耗 -7%/级' },
    { id: 'smelt',  name: '冶金', max: 3, desc: '熔炼/烹饪额外产出 +10%/级' },
    { id: 'xp',     name: '博学', max: 3, desc: '经验获取 +8%/级' },
    { id: 'unlock', name: '蓝图', max: 1, desc: '解锁钢锭与钢制武器、工具配方' },
  ]},
  { id: 'str', name: '力量', icon: '💪', color: '#ff9d5c', skills: [
    { id: 'power',  name: '巨力', max: 3, desc: '近战伤害 +20%/级' },
    { id: 'mine',   name: '勤工', max: 3, desc: '采集速度 +15%/级' },
    { id: 'health', name: '健体', max: 3, desc: '生命上限 +20/级' },
    { id: 'tough',  name: '坚韧', max: 3, desc: '受到伤害 -6%/级' },
    { id: 'pack',   name: '行囊', max: 3, desc: '背包格数 +4/级' },
  ]},
  { id: 'agi', name: '灵活', icon: '🏃', color: '#9dff6c', skills: [
    { id: 'speed',  name: '疾行', max: 3, desc: '移动速度 +8%/级' },
    { id: 'attack', name: '迅击', max: 3, desc: '攻击速度 +10%/级' },
    { id: 'jump',   name: '轻盈', max: 3, desc: '跳跃力 +6%/级，坠落伤害 -25%/级' },
    { id: 'dodge',  name: '闪避', max: 3, desc: '闪避僵尸攻击 +8%/级' },
  ]},
  { id: 'per', name: '感知', icon: '👁️', color: '#ff7ec8', skills: [
    { id: 'crit',   name: '鹰眼', max: 3, desc: '暴击几率 +6%/级（双倍伤害）' },
    { id: 'ranged', name: '神射', max: 3, desc: '远程伤害 +15%/级' },
    { id: 'sense',  name: '直觉', max: 3, desc: '危险感知范围 +4米/级' },
    { id: 'scav',   name: '拾荒', max: 3, desc: '僵尸掉落几率 +12%/级' },
  ]},
];

// ---------- 僵尸 ----------
export const ZOMBIE_CFG = {
  LEVELS: [
    { hp: 40,  damage: 8,  speed: 2.2, scale: 1.00, detect: 14, xp: 25 },
    { hp: 70,  damage: 12, speed: 2.6, scale: 1.08, detect: 16, xp: 45 },
    { hp: 110, damage: 18, speed: 3.0, scale: 1.18, detect: 18, xp: 70 },
  ],
  MIN_DIST: 18, MAX_DIST: 32,
  // —— 新手保护与难度曲线 ——
  PROTECT_DAYS: 3,       // 前 N 个游戏日不刷任何僵尸（安心采集/建造/合成装备）
  BASE_NIGHT: 2,         // 保护期结束后首晚的夜间上限
  RAMP_PER_DAY: 0.7,     // 每多活一天增加的上限
  NIGHT_CAP: 12,         // 夜间上限封顶
  DAY_FRACTION: 0.25,    // 白天上限 = 夜间上限 × 此比例（至少 1）
  INTERVAL_NIGHT: 7,     // 保护期后首晚刷新间隔（秒），随天数/战力渐快
  INTERVAL_NIGHT_MIN: 4,
  INTERVAL_DAY: 20,
};

// 某游戏日 / 某玩家战力下的僵尸生成预算；保护期内返回 null（不刷）
// 数量与高级僵尸出现率随天数爬坡，玩家战力（等级/护甲/武器）加成，全部封顶保证可玩性
export function zombieBudget(day, power = 0, isNight = true) {
  const C = ZOMBIE_CFG;
  if (day <= C.PROTECT_DAYS) return null;
  const n = day - C.PROTECT_DAYS;                       // 保护期结束后第几天
  const maxNight = Math.min(
    C.BASE_NIGHT + Math.floor((n - 1) * C.RAMP_PER_DAY) + Math.floor(power / 5),
    C.NIGHT_CAP
  );
  const max = isNight ? maxNight : Math.max(1, Math.round(maxNight * C.DAY_FRACTION));
  const interval = isNight
    ? Math.max(C.INTERVAL_NIGHT_MIN, C.INTERVAL_NIGHT - (n - 1) * 0.4 - power * 0.05)
    : C.INTERVAL_DAY;
  // 高级僵尸渐进解锁：天数为主、战力为辅，概率封顶（首晚全 Lv1）
  const lv2P = Math.min(0.35 * Math.max(0, (day - 6) / 4) + 0.15 * Math.max(0, (power - 8) / 20), 0.45);
  const lv3P = Math.min(0.30 * Math.max(0, (day - 10) / 6) + 0.15 * Math.max(0, (power - 16) / 25), 0.35);
  return { max, interval, lv2P, lv3P };
}

// 掉落表（几率受感知「拾荒」加成）
export const ZOMBIE_LOOT = [
  { chance: 0.30, type: 'ammo',   make: (lvl) => (lvl >= 2 && Math.random() < 0.4)
      ? { id: 'bolt', n: 1 + Math.floor(Math.random() * 3) }
      : { id: 'arrow', n: 2 + Math.floor(Math.random() * 4) } },
  { chance: 0.15, type: 'food',   make: () => (Math.random() < 0.6)
      ? { id: 'raw_meat', n: 1 + Math.floor(Math.random() * 2) }
      : { id: 'berry', n: 1 + Math.floor(Math.random() * 3) } },
  { chance: 0.10, type: 'weapon', make: (lvl) => {
      if (lvl >= 2 && Math.random() < 0.25) return { id: 'bow', n: 1 };
      const tiers = ['wood', 'iron', 'steel'].filter(t => ['wood','iron','steel'].indexOf(t) <= lvl - 1);
      const tier = tiers[Math.floor(Math.random() * tiers.length)];
      const kind = ['hammer', 'club', 'knife'][Math.floor(Math.random() * 3)];
      return { id: `${tier}_${kind}`, n: 1 };
    } },
  { chance: 0.08, type: 'plugin', make: () => {
      const pool = ['mod_sharp', 'mod_quick', 'mod_crit', 'mod_scope', 'mod_armor', 'mod_light', 'mod_pack', 'mod_scav'];
      return { id: pool[Math.floor(Math.random() * pool.length)], n: 1 };
    } },
  { chance: 0.40, type: 'material', make: () => ({ id: 'bone', n: 1 + Math.floor(Math.random() * 2) }) },   // 骨头：熬胶水原料
  { chance: 0.25, type: 'material', make: () => ({ id: 'cloth', n: 1 + Math.floor(Math.random() * 2) }) },   // 布料：绷带/缝纫原料
];

// 僵尸蓝图掉落概率（每次击杀；从未学会的图纸中随机抽一张）
export const PLAN_DROP_CHANCE = 0.07;

// 图纸 learn 组 → 解锁的配方组名称（学习成功 toast 用）
export const PLAN_GROUPS = {
  bow: '弓', crossbow: '弩与弩箭', arrow: '箭矢', sword: '铁剑',
  bandage: '绷带', armor: '皮甲', iron_armor: '全套铁甲装备',
};

// ---------- 动物 ----------
export const ANIMAL_CFG = {
  MAX: 8, SPAWN_INTERVAL: 9,
  hp: 20, xp: 12, drop: 'raw_meat',
  drop2: 'leather', drop2Chance: 0.7,   // 猪额外掉落皮革（用于装备制作）
};
