// ============================================================
// stations.js —— 篝火/熔炉容器系统（制作队列版）
// 每个篝火/熔炉方块是一个独立容器，互不干扰、可同时制作。
//
// 核心概念：
//   制作队列  —— 最多 4 个任务位（正在制作的 1 个 + 排队等待 3 个）；
//                点击配方入队（立即从背包扣原料），队首完成后自动开始下一个；
//                队列中的任务随时可取消（原料全额退回背包）。
//   产出暂存  —— 容量 6 件，做好的物品先存在容器里；左键收进背包，
//                食物/饮料可右键直接使用（吃掉/喝掉，返还瓶杯进背包）。
//   燃料      —— 1 木板烧 60 秒（原木 120 秒、木棍 15 秒、煤炭 90 秒），
//                燃尽自动补烧下一块；没燃料则熄灭、任务冻结（不丢进度），
//                补充燃料后自动点火继续。
//   自由离场  —— 制作与燃烧不依赖玩家位置：玩家可以去砍树、打怪、探索，
//                容器照常工作（每步完成有全局 toast 提醒）。
//   关火      —— 手动关火立即停止（当前任务进度保留）；队列做完自动关火。
// ============================================================
import { ITEMS, BLOCK, BLOCKS } from './config.js';

// 每个单位燃料的燃烧时长（秒，真实时间）
// 燃料表：id → 燃烧秒数（1 木板 = 60 秒 = 1 小时游戏时间的 1/60）；木板的制作物（木棍/木工具/弓箭等）也能当柴烧
export const FUEL = {
  plank: 60, log: 120, stick: 15, coal: 90,
  wood_pickaxe: 15, wood_axe: 15, wood_shovel: 15, wood_hammer: 15, wood_club: 15, wood_knife: 15,
  bow: 20, crossbow: 10, arrow: 5, bolt: 5,
};

// 队列总位数（含正在制作的 1 个）与产出暂存容量（件）
export const QUEUE_MAX = 4;
export const OUTPUT_MAX = 6;

// 工作站配方：点击配方按钮即入队（自动扣原料）
// in 支持两种写法：字符串（单原料，数量 = n ?? 1）或对象（多样材料）；returns = 完成时返还的容器
// plan = 需要学会的图纸（打怪掉落）；needUnlock = 需要智力「锻造解锁」技能（钢系）
export const STATION_RECIPES = [
  { id: 'cook_meat',   station: 'campfire', in: 'raw_meat',     out: 'cooked_meat', time: 8 },
  { id: 'boil_bottle', station: 'campfire', in: 'bottle_dirty', out: 'bottle_clean', time: 6 },
  { id: 'boil_cup',    station: 'campfire', in: 'cup_dirty',    out: 'cup_clean',   time: 6 },
  { id: 'brew_glue',   station: 'campfire', in: { cup_clean: 1, bone: 2 }, out: 'glue', time: 12, returns: 'glass_cup' },   // 烧开的水+骨头熬胶
  { id: 'cook_soup',   station: 'campfire', in: { raw_meat: 1, berry: 2 }, out: 'hot_soup', time: 10 },   // 肉+浆果炖汤：治脑震荡
  { id: 'bone_soup',   station: 'campfire', in: { bone: 2, cup_clean: 1 }, out: 'bone_soup', time: 8, returns: 'glass_cup' },   // 骨头熬汤：受伤减免
  { id: 'smelt_iron',  station: 'furnace',  in: 'iron_ore',     out: 'iron_ingot',  time: 8 },
  { id: 'smelt_steel', station: 'furnace',  in: 'iron_ingot',   out: 'steel_ingot', time: 14, needUnlock: true },
  { id: 'smelt_glass', station: 'furnace',  in: 'sand',         out: 'glass',       n: 2, time: 6 },
  { id: 'make_cup',    station: 'furnace',  in: 'glass',        out: 'glass_cup',   time: 6 },
  { id: 'draw_wire',   station: 'furnace',  in: 'iron_ingot',   out: 'iron_wire',   n: 2, time: 6 },   // 铁锭拉铁线
  // —— 工作台：高级物品（多样材料 + 图纸解锁）——
  { id: 'wb_bow',        station: 'workbench', in: { stick: 2, thread: 2, glue: 1 }, out: 'bow',      time: 10, plan: 'bow' },
  { id: 'wb_crossbow',   station: 'workbench', in: { plank: 2, iron_wire: 2, glue: 1, thread: 1 }, out: 'crossbow', time: 14, plan: 'crossbow' },
  { id: 'wb_arrow',      station: 'workbench', in: { stick: 1, stone: 1, thread: 1 }, out: 'arrow', n: 3, time: 5, plan: 'arrow' },
  { id: 'wb_bolt',       station: 'workbench', in: { iron_wire: 1, stick: 1 }, out: 'bolt', n: 2, time: 5, plan: 'crossbow' },
  { id: 'wb_sword',      station: 'workbench', in: { iron_ingot: 2, stick: 1, glue: 1 }, out: 'iron_sword', time: 12, plan: 'sword' },
  { id: 'wb_bandage',    station: 'workbench', in: { cloth: 2, thread: 1 }, out: 'bandage', n: 2, time: 6, plan: 'bandage' },
  { id: 'wb_skewer',     station: 'workbench', in: { stick: 1, cooked_meat: 1 }, out: 'meat_skewer', n: 2, time: 8 },   // 烤肉串：强壮 buff
  { id: 'wb_feast',      station: 'workbench', in: { cooked_meat: 1, hot_soup: 1, berry: 2 }, out: 'feast', time: 14 },   // 什锦大餐：双 buff
  { id: 'wb_medkit',     station: 'workbench', in: { bandage: 1, splint: 1, glue: 1 }, out: 'medkit', time: 12 },   // 医疗包：治愈一切
  { id: 'wb_leather_armor', station: 'workbench', in: { leather: 4, thread: 3 }, out: 'leather_armor', time: 12, plan: 'armor' },
  { id: 'wb_iron_helm',  station: 'workbench', in: { iron_ingot: 4, leather: 1 }, out: 'iron_helm',  time: 14, plan: 'iron_armor' },
  { id: 'wb_iron_chest', station: 'workbench', in: { iron_ingot: 6, leather: 2 }, out: 'iron_chest', time: 18, plan: 'iron_armor' },
  { id: 'wb_iron_pants', station: 'workbench', in: { iron_ingot: 5, leather: 2 }, out: 'iron_pants', time: 16, plan: 'iron_armor' },
  { id: 'wb_iron_boots', station: 'workbench', in: { iron_ingot: 3, leather: 1 }, out: 'iron_boots', time: 12, plan: 'iron_armor' },
  { id: 'wb_steel_helm',  station: 'workbench', in: { steel_ingot: 3, leather: 1 }, out: 'steel_helm',  time: 16, needUnlock: true },
  { id: 'wb_steel_chest', station: 'workbench', in: { steel_ingot: 5, leather: 2 }, out: 'steel_chest', time: 20, needUnlock: true },
  { id: 'wb_steel_pants', station: 'workbench', in: { steel_ingot: 4, leather: 2 }, out: 'steel_pants', time: 18, needUnlock: true },
  { id: 'wb_steel_boots', station: 'workbench', in: { steel_ingot: 2, leather: 1 }, out: 'steel_boots', time: 14, needUnlock: true },
];

export const STATION_BLOCK = { campfire: BLOCK.CAMPFIRE, furnace: BLOCK.FURNACE, workbench: BLOCK.WORKBENCH };

// 归一化配方原料：字符串 → { id: 数量 }；对象 → 原样拷贝
const insOf = r => (typeof r.in === 'string' ? { [r.in]: r.n ?? 1 } : { ...r.in });
// 旧版任务（单原料 in/cost）兼容读取
const taskIns = t => t.ins ?? { [t.in]: t.cost };

const fmt = s => (s >= 60 ? `${Math.floor(s / 60)}分${Math.round(s % 60)}秒` : `${Math.round(s)}秒`);

export class StationManager {
  constructor(game) {
    this.game = game;
    this.map = new Map();   // "x,y,z,type" -> 容器状态（工作台/熔炉/篝火各自独立的成品容器）
  }

  // 容器键 = 坐标 + 容器类型：同格换方块（挖熔炉放工作台）视为全新容器，绝不共享产出/燃料/队列
  key(x, y, z, type) { return `${x},${y},${z},${type ?? ''}`; }

  // 从世界方块反查容器类型（篝火/熔炉/工作台方块都挂在 BLOCKS[id].station 上；无世界环境时返回 null）
  _typeAt(x, y, z) {
    const w = this.game?.world;
    return typeof w?.getBlock === 'function' ? (BLOCKS[w.getBlock(x, y, z)]?.station ?? null) : null;
  }

  // 按当前方块类型定位已存在的容器状态（put/take 等内部方法用，UI 无需传 type）
  stKey(x, y, z) { return this.key(x, y, z, this._typeAt(x, y, z)); }

  // 获取（或创建）容器状态
  get(x, y, z, type) {
    type = type ?? this._typeAt(x, y, z);
    const k = this.key(x, y, z, type);
    if (!this.map.has(k)) {
      this.map.set(k, {
        k, x, y, z, type,              // 'campfire' | 'furnace' | 'workbench'
        fuel: null,                    // {id, count} | null
        output: [],                    // 产出暂存 [{id, count}, ...]，总件数 ≤ OUTPUT_MAX
        lit: false, burning: 0,        // 是否点燃 / 剩余燃烧秒数
        holdFire: false,               // 手动关火标记：补充燃料也不会自动复燃，需再点点火
        job: null,                     // 正在制作：{ recipeId, in, cost, out, n, remaining, total, label, icon, xp }
        queue: [],                     // 排队等待：同 job 结构，remaining 用 time 字段
      });
    }
    return this.map.get(k);
  }

  // 该坐标是否存有任意类型的容器状态
  has(x, y, z) { const p = `${x},${y},${z},`; return [...this.map.keys()].some(k => k.startsWith(p)); }

  // 任务位占用数（正在制作 + 排队）
  jobsTotal(st) { return (st.job ? 1 : 0) + st.queue.length; }

  // 产出暂存件数
  outputTotal(st) { return st.output.reduce((a, b) => a + b.count, 0); }

  // 从玩家物品栏放入燃料（UI 点击调用）；返回错误信息或 ''
  put(x, y, z, itemId, count = 1) {
    const inv = this.game.inventory;
    if (!inv.has(itemId, count)) return '没有该物品';
    const st = this.map.get(this.stKey(x, y, z));
    if (!st) return '容器不存在';
    if (st.type === 'workbench') return '🛠️ 工作台无需燃料，直接点配方即可制作';
    if (!FUEL[itemId]) return '该物品不能作燃料（可放：木板/原木/木棍/木工具/弓箭/煤炭）';
    const slot = st.fuel;
    if (slot && slot.id !== itemId) return '燃料槽已放有其他物品，先取回';
    const max = ITEMS[itemId].stack;
    const add = Math.min(count, max - (slot?.count ?? 0));
    if (add <= 0) return '燃料槽已满';
    inv.remove(itemId, add);
    st.fuel = { id: itemId, count: (slot?.count ?? 0) + add };
    // 已有任务但没火（燃尽熄灭）→ 自动点火，放好燃料即可放心走开；手动关火的不复燃
    if (!st.lit && !st.holdFire && (st.job || st.queue.length)) this._burnOne(st);
    return '';
  }

  // 取回槽位物品到背包（which: 'fuel' | 'output'）
  take(x, y, z, which) {
    const st = this.map.get(this.stKey(x, y, z));
    if (!st) return;
    if (which === 'fuel' && st.fuel) {
      const slot = st.fuel;
      const left = this.game.inventory.add(slot.id, slot.count);
      slot.count -= slot.count - left;
      if (slot.count <= 0) st.fuel = null;
    } else if (which === 'output') {
      this.takeOutput(x, y, z);   // 全部收取
    }
  }

  // 收取产出暂存（idx 省略 = 全部）到背包
  takeOutput(x, y, z, idx) {
    const st = this.map.get(this.stKey(x, y, z));
    if (!st) return;
    if (idx === undefined) {
      for (let i = st.output.length - 1; i >= 0; i--) this.takeOutput(x, y, z, i);
      return;
    }
    const it = st.output[idx];
    if (!it) return;
    const left = this.game.inventory.add(it.id, it.count);
    it.count -= it.count - left;
    if (it.count <= 0) st.output.splice(idx, 1);
  }

  // 右键直接使用产出：食物/饮料直接吃掉喝掉（返还瓶杯进背包），其他收进背包
  useOutput(x, y, z, idx) {
    const st = this.map.get(this.stKey(x, y, z));
    const it = st?.output?.[idx];
    if (!it) return;
    const def = ITEMS[it.id];
    if (def?.food) {
      this.game.player.eat(it.id);
      it.count -= 1;
      const verb = def.kind === 'medical' ? '用了' : def.food.thirst ? '喝了' : '吃了';
      this.game.ui.toast(`${def.icon} 直接${verb}${def.name}`, '#b7ff5e');
    } else {
      this.game.inventory.add(it.id, it.count);
      this.game.ui.toast(`📦 ${def.name} ×${it.count} 收进背包`, '#c9b48a');
      it.count = 0;
    }
    if (it.count <= 0) st.output.splice(idx, 1);
  }

  // 点火：消耗 1 单位燃料槽物品；返回错误或 ''
  ignite(x, y, z) {
    const st = this.map.get(this.stKey(x, y, z));
    if (!st) return '容器不存在';
    if (st.type === 'workbench') return '🛠️ 工作台无需点火';
    if (st.lit) return '';
    st.holdFire = false;   // 手动点火解除关火锁定
    if (st.burning > 0) { st.lit = true; return ''; }   // 有关火保留的剩余燃烧时间：直接复燃，不烧新燃料
    if (!st.fuel) return '需要先放入燃料（木板/原木/木棍/煤炭）';
    this._burnOne(st);
    return '';
  }

  // 从燃料槽烧掉 1 个单位
  _burnOne(st) {
    st.fuel.count -= 1;
    st.burning += FUEL[st.fuel.id] ?? 60;
    if (st.fuel.count <= 0) st.fuel = null;
    st.lit = true;
  }

  // 关火：熄灭并锁定；燃烧剩余时间保留不浪费（再点火或入队新任务时直接复燃）
  extinguish(x, y, z) {
    const st = this.map.get(this.stKey(x, y, z));
    if (!st || st.type === 'workbench') return;
    st.lit = false;
    st.holdFire = true;
  }

  // 配方任务对象（入队即从背包扣原料，玩家可放心离场；ins 支持多样材料）
  _taskFromRecipe(recipe) {
    return {
      recipeId: recipe.id, ins: insOf(recipe),
      out: recipe.out, n: recipe.n ?? 1, time: recipe.time,
      label: ITEMS[recipe.out].name, icon: ITEMS[recipe.out].icon, xp: 2,
      returns: recipe.returns ?? null,
    };
  }

  // 配方解锁检查：返回错误信息或 ''（图纸 plan / 智力技能 needUnlock）
  _checkUnlock(recipe) {
    const mods = this.game.player.mods ?? this.game.skills.mods;
    if (recipe.needUnlock && !mods.unlockSteel) return '需要智力「锻造解锁」技能';
    if (recipe.plan && !(this.game.unlocked instanceof Set && this.game.unlocked.has(recipe.plan)))
      return '📜 还没学会这个配方——击杀怪物有几率掉落图纸，手持图纸右键学习';
    return '';
  }

  // 把配方加入队列；返回错误信息或 ''
  enqueue(x, y, z, recipeId) {
    const recipe = STATION_RECIPES.find(r => r.id === recipeId);
    if (!recipe) return '没有这个配方';
    const st = this.get(x, y, z, recipe.station);
    const unlockErr = this._checkUnlock(recipe);
    if (unlockErr) return unlockErr;
    if (this.jobsTotal(st) >= QUEUE_MAX) return `队列已满（${QUEUE_MAX} 个任务位），先取消一些`;
    const ins = insOf(recipe);
    const inv = this.game.inventory;
    for (const [id, n] of Object.entries(ins)) {
      if (!inv.has(id, n)) return `缺少原料：${ITEMS[id].name} ×${n}`;
    }
    const outN = recipe.n ?? 1;
    if (this.outputTotal(st) + outN > OUTPUT_MAX) return `产出暂存将满（上限 ${OUTPUT_MAX} 件），先取走一些`;
    for (const [id, n] of Object.entries(ins)) inv.remove(id, n);
    st.queue.push(this._taskFromRecipe(recipe));
    this.game.ui.toast(`📋 ${ITEMS[recipe.out].name} 排入队列（第 ${this.jobsTotal(st)}/${QUEUE_MAX} 位）`, '#9fd8ff');
    st.holdFire = false;   // 新任务入队解除关火锁定（剩余燃烧时间直接复燃）
    this._advance(st);   // 立即尝试开始（自动点火）
    return '';
  }

  // 取消任务：idx 0 = 正在制作的，1..3 = 排队中的；原料全额退回背包
  cancel(x, y, z, idx) {
    const st = this.map.get(this.stKey(x, y, z));
    if (!st) return '容器不存在';
    let task = null;
    if (idx === 0) { task = st.job; st.job = null; }
    else task = st.queue.splice(idx - 1, 1)[0] ?? null;
    if (!task) return '没有这个任务';
    for (const [id, n] of Object.entries(taskIns(task))) this.game.inventory.add(id, n);
    this.game.ui.toast(`↩️ 已取消${task.label}，原料退回背包`, '#c9b48a');
    this._advance(st);   // 取消当前任务 → 自动开始下一个
    return '';
  }

  // 队列推进：无正在制作且有待做任务 → 出队开始（篝火/熔炉需火则自动点火；工作台直接开工）
  _advance(st) {
    if (st.job || !st.queue.length) return;
    if (st.type !== 'workbench') {
      if (st.burning > 0) { st.lit = true; st.holdFire = false; }   // 有关火保留的剩余燃烧时间：直接复燃
      else if (!st.lit) {
        if (!st.fuel || st.holdFire) return;   // 没燃料：任务继续排队等火；手动关火且无剩余燃烧：等玩家点火
        this._burnOne(st);                     // 有燃料自动点火
      }
    }
    const t = st.queue.shift();
    st.job = { ...t, remaining: t.time, total: t.time };
    const tag = st.type === 'workbench' ? '🛠️ 开始制作' : '🔥 开始制作';
    this.game.ui.toast(`${tag}${t.label}（约 ${fmt(t.time)}）——你可以去做其他事`, '#ffb35c');
  }

  // 主循环：制作与燃烧不依赖玩家位置（玩家可以去干其他事情）
  // 事件驱动：一次 update 内按「燃烧耗尽 / 任务完成」逐段推进，快进也能连续完成多个任务
  update(dt) {
    for (const st of this.map.values()) {
      let remain = dt, guard = 0;
      while (remain > 1e-6 && guard++ < 200) {
        const step = this._tick(st, remain);
        if (step <= 0) break;
        remain -= step;
      }
    }
  }

  // 推进单个容器一段时间，返回实际推进的秒数（到下一个事件为止）
  _tick(st, dt) {
    if (st.type === 'workbench') {
      // 工作台：无燃料，任务直接推进
      if (st.job) {
        const evT = Math.min(dt, st.job.remaining);
        st.job.remaining -= evT;
        if (st.job.remaining <= 1e-9) this._finishJob(st);
        this._advance(st);
        return evT;
      }
      this._advance(st);
      return dt;
    }
    if (st.lit && st.burning > 0) {
      const evT = Math.min(dt, st.burning, st.job ? st.job.remaining : Infinity);
      st.burning -= evT;
      if (st.job) st.job.remaining -= evT;
      if (st.burning <= 1e-9) {
        st.burning = 0;
        if (st.fuel) this._burnOne(st);   // 自动补烧下一块燃料
        else {
          st.lit = false;                 // 没燃料 → 熄灭，任务冻结（不丢进度）
          if (st.job || st.queue.length) this.game.ui.toast('⚠️ 燃料耗尽，制作暂停——补充燃料后会自动继续', '#ffd54a');
        }
      }
      if (st.job && st.job.remaining <= 1e-9) this._finishJob(st);
      this._advance(st);                  // 完成后立即开始下一个
      return evT;
    }
    this._advance(st);                    // 未点火：尝试点火推进队列（如补充燃料后）
    return dt;
  }

  // 完成：产出进暂存（满则直接进背包）→ 返还容器 → 自动开始下一个；队列空自动关火
  _finishJob(st) {
    let n = st.job.n;
    const bonus = (this.game.player.mods ?? this.game.skills.mods).smeltBonus;   // 制作完成另有 sfx.craft() 声
    if (Math.random() < bonus) n += 1;
    const j = st.job;
    st.job = null;
    this.game.sfx?.craft();   // 制作完成叮铃
    this.game.player.addXp(j.xp);
    if (j.returns) this.game.inventory.add(j.returns, 1);   // 熬胶等用掉的杯/瓶退回背包
    const room = OUTPUT_MAX - this.outputTotal(st);
    if (room >= n) {
      const ex = st.output.find(o => o.id === j.out);
      if (ex) ex.count += n;
      else st.output.push({ id: j.out, count: n });
      this.game.ui.toast(`✅ ${j.label}做好了${n > 1 ? ` ×${n}` : ''} → 产出暂存（${this.outputTotal(st)}/${OUTPUT_MAX}）`, '#b7ff5e');
    } else {
      this.game.inventory.add(j.out, n);
      this.game.ui.toast(`✅ ${j.label}做好了${n > 1 ? ` ×${n}` : ''}，暂存已满直接放入背包`, '#b7ff5e');
    }
    // 队列已空：不再自动清零燃烧——火焰继续烧到燃料耗尽，玩家可点「关火」提前终止（剩余时间保留不浪费）
  }

  // 挖掉容器方块：该坐标【所有类型】容器的燃料 + 产出 + 队列任务原料全部退回背包，返回丢失数量
  withdraw(x, y, z) {
    let lost = 0;
    const back = (id, c) => { lost += this.game.inventory.add(id, c); };
    const p = `${x},${y},${z},`;
    for (const k of [...this.map.keys()]) {
      if (!k.startsWith(p)) continue;
      const st = this.map.get(k);
      if (st.fuel) { back(st.fuel.id, st.fuel.count); st.fuel = null; }
      for (const o of st.output) back(o.id, o.count);
      st.output = [];
      if (st.job) { for (const [id, n] of Object.entries(taskIns(st.job))) back(id, n); st.job = null; }
      for (const t of st.queue) for (const [id, n] of Object.entries(taskIns(t))) back(id, n);
      st.queue = [];
      this.map.delete(k);
    }
    return lost;
  }

  // 查询某容器的配方（UI 用）：locked = 未解锁；ready = 原料够 + 队列有空位 + 暂存放得下
  recipesFor(x, y, z) {
    const st = this.map.get(this.stKey(x, y, z));
    if (!st) return [];
    const inv = this.game.inventory;
    return STATION_RECIPES.filter(r => r.station === st.type)
      .map(r => {
        const ins = insOf(r);
        const outN = r.n ?? 1;
        const unlockErr = this._checkUnlock(r);
        return {
          recipe: r, cost: outN, ins,
          locked: !!unlockErr, lockHint: unlockErr,
          ready: !unlockErr
            && Object.entries(ins).every(([id, n]) => inv.has(id, n))
            && this.jobsTotal(st) < QUEUE_MAX
            && this.outputTotal(st) + outN <= OUTPUT_MAX,
        };
      });
  }

  // ---------------- 存档 ----------------
  serialize() {
    return [...this.map.values()].map(st => ({
      k: st.k, type: st.type, fuel: st.fuel, output: st.output,
      lit: st.lit, burning: +st.burning.toFixed(1), holdFire: !!st.holdFire,
      job: st.job ? { ...st.job, remaining: +st.job.remaining.toFixed(1) } : null,
      queue: st.queue.map(t => ({ ...t })),
    }));
  }

  applySave(list) {
    this.map.clear();
    for (const s of list ?? []) {
      const [x, y, z] = s.k.split(',').map(Number);
      const type = s.type ?? '';                 // 旧存档键不含类型，按存档项 type 字段重建独立键
      const k = this.key(x, y, z, type);
      this.map.set(k, { ...s, k, x, y, z, type, output: s.output ?? [], queue: s.queue ?? [] });
    }
  }
}
