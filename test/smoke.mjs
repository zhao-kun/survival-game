// Node 冒烟测试：验证配置完整性 + 世界生成 + 背包/技能逻辑（无需浏览器）
import * as THREE from 'three';
import { BLOCKS, ITEMS, RECIPES, SKILL_TREE, ZOMBIE_CFG, BLOCK, WORLD, EFFECTS, GAMEPLAY, zombieBudget } from '../js/config.js';
import { STATION_RECIPES } from '../js/stations.js';
import { World } from '../js/world.js';
import { Inventory } from '../js/inventory.js';
import { SkillSystem } from '../js/skills.js';

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.error('✗', msg); } else console.log('✓', msg); };

// 1. 配置完整性
for (const b of Object.values(BLOCKS)) {
  if (b.drop && !ITEMS[b.drop] && b.drop !== null) check(false, `方块掉落物未定义: ${b.drop}`);
}
check(Object.keys(BLOCKS).length === 16, '16 种方块已定义');
for (const r of RECIPES) {
  if (!ITEMS[r.out]) check(false, `配方产物未定义: ${r.out}`);
  for (const id of Object.keys(r.cost)) if (!ITEMS[id]) check(false, `配方材料未定义: ${id}`);
}
check(ITEMS['wood_hammer'] && ITEMS['iron_knife'] && ITEMS['steel_club'], '木/铁/钢三级武器生成');
check(ITEMS['bow'].ammo === 'arrow' && ITEMS['crossbow'].ammo === 'bolt', '远程武器弹药定义');
check(SKILL_TREE.length === 4 && SKILL_TREE.every(c => c.skills.length >= 4), '4 大类技能树');
{ const allSk = SKILL_TREE.flatMap(c => c.skills.map(s => c.id + '_' + s.id));
  check(new Set(allSk).size === allSk.length, '技能 id 无重复'); }
// 装备/插件配置完整性
for (const it of Object.values(ITEMS)) {
  if (it.kind === 'equip') check(it.equip && (it.armor != null || it.pack != null), `装备 ${it.id ?? it.name} 配置完整`);
  if (it.kind === 'plugin') check(it.target && it.effect?.k, `插件 ${it.name} 配置完整`);
}
check(ITEMS['leather_helm'] && ITEMS['pack_explorer'] && ITEMS['mod_sharp'], '装备与插件已定义');
check(ZOMBIE_CFG.LEVELS.length === 3, '3 级僵尸');

// 2. 世界生成
const world = new World(new THREE.Scene());
const c = WORLD.SIZE / 2 | 0;
const sy = world.surfaceY(c, c);
check(sy > 1 && sy < WORLD.HEIGHT, `中心地表高度 = ${sy}`);
let grassCount = 0, treeCount = 0, waterCount = 0;
for (const id of world.blocks.values()) {
  if (id === BLOCK.GRASS) grassCount++;
  if (id === BLOCK.LOG) treeCount++;
  if (id === BLOCK.WATER) waterCount++;
}
check(grassCount > 500, `草地方块 ${grassCount}`);
check(treeCount > 50, `树木 ${treeCount}`);
check(waterCount > 0, `水体 ${waterCount}`);

// 3. 方块修改 + 射线
const y = world.surfaceY(10, 10);
world.setBlock(10, y - 1, 10, BLOCK.AIR);
check(world.getBlock(10, y - 1, 10) === BLOCK.AIR, 'setBlock 挖掘生效');
const origin = new THREE.Vector3(10.5, y + 3, 10.5);
const hit = world.raycast(origin, new THREE.Vector3(0, -1, 0), 10);
check(hit && hit.ny === 1, `DDA 射线命中 (y=${hit?.y})`);

// 4. 碰撞
const pos = new THREE.Vector3(20.5, world.surfaceY(20, 20) + 2, 20.5);
const vel = new THREE.Vector3(0, -5, 0);
const res = world.moveEntity(pos, vel, 1, 0.3, 1.8);
check(res.onGround && vel.y === 0, 'AABB 落地解算');
check(pos.y === world.surfaceY(20, 20), `站立高度正确 (${pos.y})`);

// 5. 背包
const inv = new Inventory();
check(inv.add('log', 5) === 0 && inv.countOf('log') === 5, '添加物品');
const left = inv.add('log', 100);
check(left === 0 && inv.countOf('log') === 105, `多槽位堆叠（剩余 ${left}，共 ${inv.countOf('log')}）`);
inv.selected = 0;
check(inv.selectedId() === 'log', '快捷栏选中');
check(inv.remove('log', 3) && inv.countOf('log') === 102, '移除物品');
check(!inv.remove('log', 999), '数量不足时移除失败');

// 6. 技能
const sk = new SkillSystem();
check(sk.mods.meleeMul === 1, '初始无加成');
sk.lv['str_power'] = 2;
sk.lv['per_crit'] = 1;
sk.recompute();
check(Math.abs(sk.mods.meleeMul - 1.4) < 1e-9, '力量加成计算');
check(Math.abs(sk.mods.crit - 0.06) < 1e-9, '感知加成计算');
check(sk.catLevel('str') === 2, '类别总等级');

// 7. 装备与插件
import { pluginFits, hostTargetName } from '../js/config.js';
import { Player } from '../js/player.js';
import { Crafting } from '../js/crafting.js';
import { EntityManager, Animal } from '../js/entities.js';
import { Combat } from '../js/combat.js';

// 最小化 game 壳（无需真实渲染）
const g = { scene: new THREE.Scene(), camera: new THREE.Object3D(), state: 'playing', stats: { kills: 0, blocksMined: 0 }, day: 1, timeOfDay: 0.3, isNight: false,
  gameOver: () => {}, skills: sk, inventory: inv, world, crafting: null, entities: null, ui: { toast: () => {}, dirtyVitals: false, dirtyXp: false, flashDamage: () => {} } };
g.crafting = new Crafting(g);
g.entities = new EntityManager(g);
const player = new Player(g, new THREE.Vector3(30.5, 11, 26.5));
g.player = player;
g.combat = new Combat(g);

check(player.equipment && Object.keys(player.equipment).length === 5, '5 个装备槽（头/身/腿/鞋/背包）');
check(inv.slots.length === 36, '初始背包 36 格');

// 穿上背包 → 容量增加
inv.add('pack_canvas', 1);
const idxPack = inv.slots.findIndex(s => s?.id === 'pack_canvas');
check(player.equipFromInv(idxPack), '穿上帆布背包');
check(inv.slots.length === 42, `背包容量 36→42（实际 ${inv.slots.length}）`);
check(player.equipment.backpack?.id === 'pack_canvas', '背包槽位已占用');

// 安装扩容插件 → 容量再 +4
inv.add('mod_pack', 2);
g.ui.pendingPlugin = 'mod_pack';
let r = player.installPlugin({ equip: 'backpack' });
check(r.ok, '安装扩容插件到背包');
check(inv.slots.length === 46, `扩容插件生效 42→46（实际 ${inv.slots.length}）`);
check(player.equipment.backpack.mods.length === 1, '背包插件记录');

// 卸下插件
r = player.removePlugin({ equip: 'backpack' }, 0);
check(r.ok && inv.slots.length === 42, '卸下插件容量回退');

// 护甲与减伤
inv.add('iron_chest', 1);
const idxChest = inv.slots.findIndex(s => s?.id === 'iron_chest');
player.equipFromInv(idxChest);
check(player.armor === 4, `铁甲护甲值 4（实际 ${player.armor}）`);
inv.add('mod_armor', 1);
g.ui.pendingPlugin = 'mod_armor';
r = player.installPlugin({ equip: 'chest' });
check(r.ok && player.armor === 6, '强化插件提升护甲 4→6');
player.hp = 50;
player.damage(10, 'zombie');
const expected = 50 - 10 * (1 - Math.min(0.75, 6 / (6 + 30)));   // M6：A/(A+30)
check(Math.abs(player.hp - expected) < 1e-6, `护甲减伤正确 (${player.hp.toFixed(2)})`);

// 插件兼容性
check(pluginFits(ITEMS['mod_sharp'], ITEMS['bow']), '锋利插件适配弓');
check(!pluginFits(ITEMS['mod_sharp'], ITEMS['iron_chest']), '锋利插件不适配护甲');
check(!pluginFits(ITEMS['mod_pack'], ITEMS['leather_vest']), '扩容插件不适配普通护甲');
check(hostTargetName(ITEMS['bow']) === '武器', '宿主类型名');

// 武器插件影响战斗（手持带插件的弓伤害提升）
inv.slots[0] = { id: 'bow', count: 1, mods: ['mod_scope'] };
inv.selected = 0;
const im = g.combat.instMods(inv.slots[0]);
check(im.rangedDmg === 0.20, '瞄准插件远程伤害 +20%');

// 脱下装备
check(player.unequip('chest'), '脱下铁甲');
check(player.armor === 0 && inv.countOf('iron_chest') >= 1, '护甲值清零且装备回背包');

// 容量收缩保护
const capInv = new Inventory(40);
capInv.slots[39] = { id: 'stone', count: 1 };
check(capInv.resize(36) === false, '收缩范围内有物品时无法缩容');
capInv.slots[39] = null;
check(capInv.resize(36) === true, '空位时正常缩容');
check(player.equipFromInv(inv.slots.findIndex(s => s?.id === 'stone')) === false, '非装备物品不能穿上');

// 8. 物品栏 / 背包分区
const inv2 = new Inventory(36, 9);
check(inv2.hotbarSize === 9 && inv2.backpackSize() === 27, '物品栏 9 格 + 背包区 27 格');
inv2.slots[10] = { id: 'apple', count: 3 };
check(inv2.moveToHotbar(10) && inv2.slots[0]?.id === 'apple' && !inv2.slots[10], '背包 → 物品栏（优先空位）');
check(inv2.moveToBackpack(0) && inv2.slots[9]?.id === 'apple', '物品栏 → 背包');
for (let i = 9; i < 36; i++) inv2.slots[i] = { id: 'stone', count: 1 };
check(!inv2.moveToBackpack(0), '背包无空位时移入失败');
inv2.slots[0] = null;
inv2.slots[9] = { id: 'apple', count: 3 };
inv2.consumeAt(9, 3);
check(!inv2.slots[9], 'consumeAt 耗尽后清空槽位');

// 9. 状态效果与饮水（拉肚子 debuff）
check(EFFECTS.diarrhea && EFFECTS.diarrhea.hpDrain > 0 && EFFECTS.diarrhea.hungerMul > 1 && EFFECTS.diarrhea.blockRegen, '拉肚子效果配置完整');
check(ITEMS.bottle_dirty.effect?.id === 'diarrhea' && !ITEMS.bottle_clean.effect, '生水带负面效果、开水安全');
check(STATION_RECIPES.some(r => r.out === 'cooked_meat' && r.station === 'campfire'), '烤肉配方在篝火容器配方表中');
player.thirst = 50;
player.eat('bottle_dirty');
check(player.thirst === 72 && player.effects.some(e => e.id === 'diarrhea'), '喝生水解渴并拉肚子');
player.eat('bottle_clean');
check(player.effects.length === 1, '喝开水不会追加负面效果');
player.addEffect('diarrhea', 30);
check(player.effects.length === 1 && player.effects[0].time >= 30 && player.effects[0].power > 1, '重复触发只叠加强度、时长取更长值');
player.hp = 50;
const fx = player.updateEffects(1);
check(fx.hungerMul === 2 && fx.blockRegen === true, '效果返回饥饿加倍与禁止回血');
check(player.hp < 50, '拉肚子持续掉血');
player.updateEffects(100);
check(player.effects.length === 0, '效果到期自动痊愈');
check(GAMEPLAY.HAND_DRINK_THIRST > 0 && GAMEPLAY.HAND_DRINK_EFFECT > 0, '空手喝水参数存在');

// 10. 猪的行为：逃跑减速 / 受击硬直 / 喘息窗口 / 边界与悬崖回避
{
  let solidRule = (x, y, z) => y <= 10;   // 默认平地（顶面 y=11）
  const pigGame = {
    scene: { add() {}, remove() {} },
    world: { isSolid: (x, y, z) => solidRule(x, y, z), moveEntity: () => ({ onGround: true }) },
    player: { pos: new THREE.Vector3(30, 11, 40) },
    entities: { spawnDrop() {} },
    ui: { toast() {} },
  };
  const pig = new Animal(pigGame, 30, 11, 40);
  // 受击硬直
  pig.takeDamage(5);
  check(pig.stunT > 0, '猪受击后短暂硬直');
  pig.update(0.1);
  check(Math.abs(pig.vel.x) < 0.01 && Math.abs(pig.vel.z) < 0.01, '硬直期间猪不移动');
  // 逃跑速度低于玩家步行速度（4.3），可追上
  pig.stunT = 0; pig.fleeT = 3; pig.fleeCd = 0;
  pigGame.player.pos.set(40, 11, 40);
  pig.update(0.05);
  const fs = Math.abs(pig.vel.x);
  check(fs > 2.5 && fs < 3.05, `逃跑速度 ${fs.toFixed(2)} < 3.1（玩家 4.3 可追上）`);
  // 喘息期不再逃跑
  pig.fleeT = 0; pig.fleeCd = 5;
  pigGame.player.pos.set(30.5, 11, 40.5);
  pig.update(0.05);
  check(pig.fleeT <= 0, '喘息期内靠近不会再次触发逃跑');
  // 地图边缘反射：贴西边缘时方向强制朝内
  pig.pos.set(3, 11, 40);
  pig.wanderDir.set(-1, 0, 0);
  pig.avoidHazards();
  check(pig.wanderDir.x > 0, '猪在地图边缘会掉头往回走');
  // 悬崖回避：前方无实地则反向
  pig.pos.set(30, 11, 40);
  pig.wanderDir.set(1, 0, 0);
  solidRule = (x, y, z) => y <= 10 && Math.abs(x - 30) <= 0.5;   // 前方悬空
  pig.avoidHazards();
  check(pig.wanderDir.x < 0, '猪前方是悬崖时会反向');
  solidRule = (x, y, z) => y <= 10;
  pig.wanderDir.set(1, 0, 0);
  pig.avoidHazards();
  check(pig.wanderDir.x > 0, '实地恢复后不再误判悬崖');
}

// 11. 僵尸难度曲线：新手保护期 + 随天数/战力爬坡
{
  check(zombieBudget(1) === null && zombieBudget(3) === null, '前 3 天为新手保护期，不刷僵尸');
  const b4 = zombieBudget(4, 0, true);
  check(b4.max === 2 && b4.interval === 7, '保护期后首晚仅 2 只、间隔 7s');
  check(zombieBudget(4, 0, false).max === 1, '保护期后首个白天最多 1 只');
  check(b4.lv2P === 0 && b4.lv3P === 0, '首晚全部为 Lv1');
  check(zombieBudget(5, 0, true).max === 2 && zombieBudget(6, 0, true).max === 3 && zombieBudget(7, 0, true).max === 4, '数量随天数稳步递增');
  const b7 = zombieBudget(7, 15, true);
  check(b7.max === 7 && b7.lv2P > 0 && b7.lv3P === 0, '有装备后第 4 晚 7 只并开始出现 Lv2');
  check(zombieBudget(10, 0, true).lv3P === 0 && zombieBudget(13, 0, true).lv3P > 0, 'Lv3 从第 13 天起渐进出现');
  const b20 = zombieBudget(20, 38, true);
  check(b20.max === 12 && b20.interval >= 4, '后期封顶 12 只、刷新间隔有下限');
  check(zombieBudget(20, 38, false).max === 3, '白天上限为夜间的 1/4 左右');
  check(zombieBudget(4, 30, true).max > zombieBudget(4, 0, true).max, '战力越高刷怪越多');
  // 玩家战力评分
  const p0 = player.powerScore();
  check(p0 <= 3, `开局战力接近 0（${p0}）`);
  inv.add('leather_helm', 1);
  const hi = inv.slots.findIndex(s => s?.id === 'leather_helm');
  player.equipFromInv(hi);
  const p1 = player.powerScore();
  check(p1 > p0, '穿上护甲后战力提升');
  player.unequip('head');
}

// 12. 制作耗时队列：所有配方都有时长、扣料入队、计时产出、排队互斥、篝火离开暂停
{
  check(g.crafting.recipes.every(r => r.time > 0), '所有配方都有制作时长');
  const cookInv = new Inventory();
  const toasts = [];
  const cg = { player: { mods: null, addXp: () => {}, pos: new THREE.Vector3(35.5, 11, 26.5) },
    inventory: cookInv, world: { nearBlock: () => true },
    ui: { toast: (m) => toasts.push(m) }, skills: { mods: { craftDiscount: 0, smeltBonus: 0, unlockSteel: true } } };
  const csys = new Crafting(cg);
  // 合成木板（2s）：扣料 → 计时 → 产出
  cookInv.add('log', 1);
  const plankRecipe = csys.recipes.find(r => r.out === 'plank');
  check(csys.craft(plankRecipe) && !cookInv.has('log', 1) && csys.job?.out === 'plank', '合成启动即扣材料并入队');
  csys.update(1.9);
  check(!cookInv.has('plank', 4), '未到时间不产出');
  csys.update(0.2);
  check(cookInv.has('plank', 4) && csys.job === null, '时间到自动产出木板 ×4 并清空队列');
  // 排队互斥：第二件被拒绝且材料不扣
  cookInv.add('log', 1); cookInv.add('plank', 4);
  csys.craft(csys.recipes.find(r => r.out === 'stick'));
  const before = cookInv.countOf('plank');
  csys.craft(plankRecipe);
  check(csys.job?.out === 'stick' && cookInv.countOf('plank') === before, '同一时刻只能制作一件，被拒时不扣料');
  csys.update(2);
  check(cookInv.has('stick', 2) && csys.job === null, '队列计时完成自动产出并清空（远离暂停机制由容器系统承担，见第 14 节）');
}

// 14. 篝火/熔炉容器：制作队列（4 位）、产出暂存（6 件）、取消退料、离场继续制作、序列化
{
  const { StationManager, FUEL, STATION_RECIPES, QUEUE_MAX, OUTPUT_MAX } = await import('../js/stations.js');
  const inv = new Inventory();
  const toasts = [];
  const player = { mods: null, addXp: () => {}, pos: new THREE.Vector3(33.5, 11, 26.5), hunger: 50, thirst: 50, hp: 80, _ate: null,
    eat(id) { this._ate = id; } };
  const sg = { player, inventory: inv, ui: { toast: (m) => toasts.push(m) }, skills: { mods: { smeltBonus: 0, unlockSteel: true } },
    world: { getBlock: (x, y, z) => (x === 33 && z === 25 ? 13 : 12) } };   // 33,11,25 熔炉 / 其余篝火（供 stKey 反查类型）
  const sm = new StationManager(sg);
  const smeltGlass = STATION_RECIPES.find(r => r.id === 'smelt_glass');

  const st = sm.get(33, 11, 26, 'campfire');
  const fst = sm.get(33, 11, 25, 'furnace');

  // 燃料：put 扣背包；非燃料拒绝
  inv.add('plank', 5); inv.add('stone', 1); inv.add('raw_meat', 5);
  check(sm.put(33, 11, 26, 'plank', 3) === '' && st.fuel?.count === 3 && inv.countOf('plank') === 2, '木板放燃料槽扣背包');
  check(sm.put(33, 11, 26, 'stone', 1) !== '', '非燃料物品被拒绝');

  // 入队：扣原料 + 自动点火
  check(sm.enqueue(33, 11, 26, 'cook_meat') === '' && st.job?.out === 'cooked_meat' && inv.countOf('raw_meat') === 4, '点击配方入队：扣 1 生肉，立即开始制作');
  check(st.lit && Math.abs(st.burning - FUEL.plank) < 0.01 && st.fuel?.count === 2, '入队自动点火：烧掉 1 木板（60 秒）');

  // 队列容量 4（含正在制作的 1 个）
  const e2r = sm.enqueue(33, 11, 26, 'cook_meat'); const e3r = sm.enqueue(33, 11, 26, 'cook_meat'); const e4r = sm.enqueue(33, 11, 26, 'cook_meat'); const e5r = sm.enqueue(33, 11, 26, 'cook_meat');
  check(e2r === '' && e3r === '' && e4r === '' && e5r !== '' && sm.jobsTotal(st) === QUEUE_MAX, '队列最多 4 个任务位，第 5 个被拒绝');

  // 离场继续：玩家走远制作照常（与玩家位置解耦）
  player.pos.set(50.5, 11, 40.5);
  sm.update(8.1);
  check(st.queue.length === 2 && st.job?.out === 'cooked_meat' && st.output[0]?.id === 'cooked_meat' && st.output[0]?.count === 1, '玩家走远照常制作：烤肉完成进产出暂存，队列自动开始下一个');

  // 取消排队任务退原料；空位可重新入队
  const meatBefore = inv.countOf('raw_meat');
  check(sm.cancel(33, 11, 26, 2) === '' && st.queue.length === 1 && inv.countOf('raw_meat') === meatBefore + 1, '取消排队任务：原料退回背包');
  check(sm.enqueue(33, 11, 26, 'cook_meat') === '' && sm.jobsTotal(st) === 3, '取消后空位可重新入队');

  // 缺燃料暂停 → 补燃料自动点火继续
  st.fuel = null; st.burning = 0.2; st.lit = true;
  sm.update(0.3);
  check(!st.lit && st.job !== null, '燃尽无燃料：熄灭，任务冻结不丢进度');
  inv.add('plank', 1);
  sm.put(33, 11, 26, 'plank', 1);
  check(st.lit && st.burning > 59, '补充燃料自动点火，任务继续');

  // 手动关火：进度保留，再点火继续
  sm.extinguish(33, 11, 26);
  const rem = st.job.remaining;
  sm.update(3);
  check(!st.lit && Math.abs(st.job.remaining - rem) < 0.01, '手动关火：制作暂停且进度保留');
  inv.add('plank', 1);
  check(sm.put(33, 11, 26, 'plank', 1) === '' && !st.lit, '手动关火后放燃料不会自动复燃');
  check(sm.ignite(33, 11, 26) === '' && st.lit, '再点点火后任务继续');
  sm.update(32);
  check(sm.jobsTotal(st) === 0 && sm.outputTotal(st) === 4 && st.lit && st.burning > 0, '队列做完：4 份烤肉进暂存，燃烧时间保留不蒸发');

  // 右键直接使用产出：食物吃掉 / 非食物收背包
  player.hunger = 40;
  sm.useOutput(33, 11, 26, 0);
  check(player._ate === 'cooked_meat' && sm.outputTotal(st) === 3, '右键产出格直接吃烤肉');
  fst.output.push({ id: 'glass_cup', count: 1 });
  const cupBefore = inv.countOf('glass_cup');
  sm.useOutput(33, 11, 25, 0);
  check(inv.countOf('glass_cup') === cupBefore + 1 && fst.output.length === 0, '右键非食物产出直接收进背包');

  // 产出暂存上限 6：入队后被塞满 → 完成兜底进背包
  st.output = [{ id: 'cooked_meat', count: OUTPUT_MAX - 1 }];
  inv.add('raw_meat', 1); inv.add('plank', 1);
  sm.put(33, 11, 26, 'plank', 1);
  sm.ignite(33, 11, 26);   // 前段手动关火后重新点火
  check(sm.enqueue(33, 11, 26, 'cook_meat') === '', '暂存 5/6 时仍可入队');
  st.output[0].count = OUTPUT_MAX;
  const bagBefore = inv.countOf('cooked_meat');
  sm.update(9);
  check(inv.countOf('cooked_meat') === bagBefore + 1 && sm.outputTotal(st) === OUTPUT_MAX, '暂存被塞满时完成：产出直接进背包');

  // 熔炉玻璃链：cost 2 一次扣 2 份沙，产出 ×2
  inv.add('sand', 4); inv.add('plank', 1);
  check(sm.put(33, 11, 25, 'plank', 1) === '', '熔炉放燃料');
  check(sm.enqueue(33, 11, 25, 'smelt_glass') === '' && inv.countOf('sand') === 2 && fst.job?.out === 'glass', '玻璃配方一次消耗 2 份沙并开始制作');
  fst.job.remaining = 0.01;
  sm.update(0.1);
  check(fst.output[0]?.id === 'glass' && fst.output[0]?.count === 2 && fst.lit && fst.burning > 0, '玻璃 ×2 一次产出，燃烧时间保留不蒸发');

  // 木板的制作物也可作燃料（木镐/木斧/木棍/弓箭等）
  inv.add('wood_pickaxe', 1);
  check(sm.put(33, 11, 25, 'wood_pickaxe', 1) === '' && fst.fuel?.id === 'wood_pickaxe', '木镐等木制工具也可作燃料');

  // 挖掉容器：燃料+产出+队列任务原料全退背包
  inv.add('glass', 1);
  sm.enqueue(33, 11, 25, 'make_cup');
  const sumBefore = inv.countOf('plank') + inv.countOf('cooked_meat') + inv.countOf('glass');
  const lost = sm.withdraw(33, 11, 25);
  check(lost === 0 && !sm.map.has('33,11,25') && inv.countOf('plank') + inv.countOf('cooked_meat') + inv.countOf('glass') > sumBefore, '挖掉容器：燃料/产出/排队任务原料全退背包');

  // 序列化往返：产出暂存恢复、队列恢复、已挖掉的不复活
  const snap = JSON.parse(JSON.stringify(sm.serialize()));
  const sm2 = new StationManager(sg);
  sm2.applySave(snap);
  const st2 = sm2.get(33, 11, 26, 'campfire');
  check(st2 && sm2.outputTotal(st2) === OUTPUT_MAX && st2.queue.length === 0 && st2.job === null, '容器状态序列化往返（产出暂存恢复、已挖掉的不复活）');
}

// 13. 存档序列化往返（纯函数，不依赖 localStorage）
{
  const { serializeGame, applySaveData } = await import('../js/save.js');
  const srcInv = new Inventory();
  srcInv.add('log', 5); srcInv.add('wood_pickaxe', 1); srcInv.resize(37);
  srcInv.slots[10] = { id: 'stone', count: 7 };
  let recomputeCalls = 0;
  const srcGame = {
    day: 3, elapsed: 2.5 * 3600, stats: { kills: 7, blocksMined: 12 },
    player: { pos: new THREE.Vector3(12.5, 11, 34.5), yaw: 1.2, pitch: -0.3, hp: 66.5, hunger: 44, thirst: 55, xp: 120, level: 4, points: 2,
      equipment: { head: { id: 'leather_helm', count: 1, mods: [] }, chest: null, legs: null, boots: null, backpack: null } },
    inventory: srcInv,
    skills: { lv: { int_craft: 2, str_hammer: 1 }, recompute: () => recomputeCalls++ },
    world: { modified: new Set(['10,11,20', '11,11,20']), blocks: new Map([['10,11,20', 12], ['11,11,20', 0]]) },
    ui: { dirtyVitals: false, dirtyXp: false, updateHotbar: () => {} },
    updateSky: () => {},
  };
  const snap = JSON.parse(JSON.stringify(serializeGame(srcGame, 'tester')));
  check(snap.v === 1 && snap.userId === 'tester' && snap.day === 3, '存档包含版本/用户/天数');
  // 目标壳：全新游戏状态
  const dstInv = new Inventory();
  const dstWorld = { modified: new Set(), blocks: new Map(), dirty: new Set(), chunkData: new Map([['a', 1]]),
    setBlock(x, y, z, id) { const k = x + ',' + y + ',' + z; this.blocks.set(k, id); this.modified.add(k); this.dirty.add('ck'); } };
  const dstGame = {
    day: 1, elapsed: 0, stats: { kills: 0, blocksMined: 0 },
    player: { pos: new THREE.Vector3(30.5, 11, 26.5), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
      hp: 100, hunger: 100, thirst: 100, maxHp: 100, xp: 0, level: 1, points: 0 },
    inventory: dstInv, skills: { lv: {}, recompute: () => recomputeCalls++ },
    world: dstWorld, ui: srcGame.ui,
    updateSky() { this.day = Math.floor(this.elapsed / 3600) + 1; },   // 模拟真实 updateSky 重算天数
  };
  applySaveData(dstGame, snap);
  check(dstGame.day === 3 && Math.abs(dstGame.elapsed - 2.5 * 3600) < 1 && dstGame.stats.kills === 7, '读档恢复天数/时间/统计');
  check(Math.abs(dstGame.player.pos.x - 12.5) < 0.01 && dstGame.player.hp === 66.5 && dstGame.player.level === 4 && dstGame.player.points === 2, '读档恢复玩家位置与状态');
  check(dstGame.player.equipment.head?.id === 'leather_helm', '读档恢复玩家装备');
  check(dstInv.countOf('log') === 5 && dstInv.countOf('stone') === 7 && dstInv.slots.length === 37, '读档恢复物品栏与容量');
  check(dstInv.selected >= 0, '读档恢复选中槽');
  check(dstGame.skills.lv.int_craft === 2 && recomputeCalls >= 1, '读档恢复技能等级并重算加成');
  check(dstWorld.blocks.get('10,11,20') === 12 && dstWorld.blocks.get('11,11,20') === 0 && dstWorld.modified.size === 2, '读档恢复方块修改（含挖掉的空气块）');
  check(dstWorld.dirty.size > 0, '读档后触发区块重建');
}

console.log(fails === 0 ? '\n全部测试通过 ✔' : `\n${fails} 项失败 ✘`);
process.exit(fails === 0 ? 0 : 1);
