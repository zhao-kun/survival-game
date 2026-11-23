// ============================================================
// ui.js —— HUD / 背包 / 合成 / 技能树 / 提示 / 死亡界面
// ============================================================
import { ITEMS, EFFECTS, SKILL_TREE, pluginFits, hostTargetName, ZOMBIE_CFG, BOOKS, W_TIER, W_CLASSES, BLOCK } from './config.js';
import { EQUIP_SLOTS } from './player.js';
import { STATION_RECIPES, FUEL } from './stations.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.dirtyVitals = true;
    this.dirtyXp = true;
    this.craftTimer = 0;
    this.vignetteOpacity = 0;
    this.mobHudSig = null;
    this.craftLv = {};   // M8：制作面板分组等级选择 { 'w:knife:stone': 1..6 }

    this.el = {
      barHp: $('bar-hp'), textHp: $('text-hp'), barHunger: $('bar-hunger'), barThirst: $('bar-thirst'), fxRow: $('fx-row'),
      time: $('time-indicator'), mineProgress: $('mine-progress'), mineBar: $('mine-bar'), mineTip: $('mine-tip'),
      craftBar: $('craft-bar'), craftIcon: $('craft-icon'), craftLabel: $('craft-label'),
      craftFill: $('craft-fill'), craftRemain: $('craft-remain'),
      xpBar: $('xp-bar'), xpText: $('xp-text'), hotbar: $('hotbar'), toasts: $('toasts'),
      vignette: $('damage-vignette'), warning: $('zombie-warning'), hurtFloat: $('hurt-float-layer'), tip: $('tooltip'),
      panelInv: $('panel-inventory'), invGrid: $('inv-grid'), craftList: $('craft-list'),
      panelPack: $('panel-backpack'), packGrid: $('pack-grid'), bar2Grid: $('bar2-grid'),
      equipGrid: $('equip-grid'), equipStats: $('equip-stats'),
      panelSkills: $('panel-skills'), skillPoints: $('skill-points'), skillsColumns: $('skills-columns'),
      panelMastery: $('panel-mastery'), masteryRows: $('mastery-rows'),   // M3 熟练度面板
      panelHelp: $('panel-help'), helpContent: $('help-content'),
      lootFeed: $('loot-feed'),
      mobHud: $('mob-hud'), mobName: $('mob-hud-name'), mobFill: $('mob-hud-fill'), mobText: $('mob-hud-text'),
      panelStation: $('panel-station'), stTitle: $('station-title'), stState: $('station-state'),
      stQueue: $('st-queue'), stFuel: $('st-fuel'), stOutputGrid: $('st-output-grid'),
      stRecipes: $('st-recipes'), stFireBtn: $('st-fire-btn'), stInv: $('station-inv'), stBurn: $('st-burn-fill'), stFuelInfo: $('st-fuel-info'),
      start: $('start-screen'), death: $('death-screen'), deathReason: $('death-reason'), deathStats: $('death-stats'),
    };

    this.buildHelp();
    this.buildSkills();
    this.bindInventory();
    this.bindStation();
    this.pendingPlugin = null;   // 待安装的插件 id（点击插件后标记）
    this.stationPos = null;      // 当前打开的容器坐标 {x,y,z,type}
    // M9：物品功效悬停说明（tooltip）
    this.tip = null;             // 当前悬停的物品 id（帧重建后仍可重渲染）
    this.tipMouse = { x: 0, y: 0 };
    this.bindTooltip();
  }

  // ---------------- 篝火/熔炉容器面板 ----------------
  bindStation() {
    const el = this.el;
    // ★ 重要：容器面板每帧刷新会重建内部 DOM。click 事件在「mousedown 与 mouseup 跨帧」时
    //   会因目标节点已被替换而被浏览器吞掉（派发到共同祖先，找不到槽位）→ 用户看到“点了没反应”。
    //   因此面板内所有交互一律用 mousedown 处理：mousedown 发生在帧内替换之前，必定命中真实节点。
    // 队列任务 → 取消并退回原料
    el.stQueue.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('[data-qidx]');
      if (!cell || !this.stationPos) return;
      e.preventDefault();
      const { x, y, z } = this.stationPos;
      const err = this.game.stations.cancel(x, y, z, +cell.dataset.qidx);
      if (err) this.toast('⚠️ ' + err, '#ff8a7a');
      this.updateStationPanel();
    });
    // 燃料槽 → 取回燃料
    el.stFuel.addEventListener('mousedown', () => {
      if (!this.stationPos) return;
      const { x, y, z } = this.stationPos;
      this.game.stations.take(x, y, z, 'fuel');
      this.updateStationPanel();
    });
    // 产出格：左键收进背包，右键直接使用
    el.stOutputGrid.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('[data-oidx]');
      if (!cell || !this.stationPos) return;
      e.preventDefault();
      const { x, y, z } = this.stationPos;
      if (e.button === 2) this.game.stations.useOutput(x, y, z, +cell.dataset.oidx);
      else this.game.stations.takeOutput(x, y, z, +cell.dataset.oidx);
      this.updateStationPanel();
    });
    // 点火/关火
    el.stFireBtn.addEventListener('mousedown', () => {
      if (!this.stationPos) return;
      const { x, y, z } = this.stationPos;
      const st = this.game.stations.get(x, y, z, this.stationPos.type);
      if (st.lit) {
        this.game.stations.extinguish(x, y, z);
        this.toast('已关火，任务暂停（进度与剩余燃烧时间都保留，再点火或入队继续）', '#c9b48a');
      } else {
        const err = this.game.stations.ignite(x, y, z);
        if (err) this.toast('⚠️ ' + err, '#ff8a7a');
        else this.toast('🔥 点火了（燃尽会自动补烧下一块）', '#ffb35c');
      }
      this.updateStationPanel();
    });
    // 配方按钮 → 入队
    el.stRecipes.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('[data-recipe]');
      if (!btn || !this.stationPos) return;
      e.preventDefault();
      const { x, y, z } = this.stationPos;
      const err = this.game.stations.enqueue(x, y, z, btn.dataset.recipe);
      if (err) this.toast('⚠️ ' + err, '#ff8a7a');
      this.updateStationPanel();
    });
    // 物品栏 → 放入燃料（每次 1 块，可叠加）
    el.stInv.addEventListener('mousedown', (e) => {
      const slot = e.target.closest('[data-idx]');
      if (!slot || !this.stationPos) return;
      e.preventDefault();
      const s = this.game.inventory.slots[+slot.dataset.idx];
      if (!s) return;
      const { x, y, z } = this.stationPos;
      const err = this.game.stations.put(x, y, z, s.id, 1);
      if (err) this.toast('⚠️ ' + err, '#ff8a7a');
      else {
        this.toast(`🔥 ${ITEMS[s.id].name} ×1 放入燃料槽（可烧 ${FUEL[s.id]} 秒）`, '#ffb35c');
        this.el.stFuel.classList.remove('flash'); void this.el.stFuel.offsetWidth;   // 重启动画
        this.el.stFuel.classList.add('flash');
      }
      this.updateStationPanel();
    });
  }

  // 右键篝火/熔炉打开
  openStation(x, y, z, type) {
    const g = this.game;
    this.closeAllPanels();           // 先关其他面板（会清 stationPos）
    this.stationPos = { x, y, z, type };
    g.stations.get(x, y, z, type);   // 确保容器状态存在
    g.input.releaseLock();
    this.el.hotbar.style.display = 'none';   // 容器面板打开时隐藏快捷栏，避免误点切武器
    // 哨兵重置：空串''是合法签名（如空产出格），用它重置会让 updateStationPanel 误判「没变」而跳过重建，
    // 上一个容器的产出/队列/燃料 DOM 就残留在新面板里（用户实测：熔炉的玻璃串进工作台成品格）；哨兵值必不匹配 → 强制全量重建
    this._stQSig = this._stFuelSig = this._stOutSig = this._stRSig = this._stISig = '\u0000reset';
    // 工作台：隐藏燃料相关控件；篝火/熔炉：恢复显示
    const wb = type === 'workbench';
    document.getElementById('st-fuel').style.display = wb ? 'none' : '';
    document.getElementById('st-fire-btn').style.display = wb ? 'none' : '';
    const hint = document.getElementById('station-hint');
    if (hint) hint.innerHTML = wb
      ? '🛠️ <b>工作台</b>：无需燃料，点配方即入队（自动扣多样材料）；<b>带 🔒 的配方</b>需要先学习图纸——击杀怪物有几率掉落，选中图纸按右键学习；产出格：左键收进背包。'
      : '🔥 <b>放燃料</b>：点击下方物品栏中带 <b>🔥 标记</b>的物品（木板 60 秒 / 原木 120 秒 / 木棍 15 秒 / 木工具 15 秒 / 煤炭 90 秒）→ 点「点火」；<br>点配方即入队（自动扣原料），制作时可以去干其他事，做好了有提示；产出格：左键收进背包，食物/饮料右键直接吃掉/喝掉。';
    this.el.panelStation.classList.remove('hidden');
    this.updateStationPanel();
  }

  updateStationPanel() {
    const g = this.game, el = this.el;
    if (!this.stationPos || el.panelStation.classList.contains('hidden')) return;
    const { x, y, z, type } = this.stationPos;
    const st = g.stations.get(x, y, z, type);
    const isFire = type === 'campfire';
    const isWB = type === 'workbench';
    const QUEUE_MAX = 4;
    el.stTitle.textContent = isFire ? '🔥 篝火' : isWB ? '🛠️ 工作台' : '🏭 熔炉';
    // 状态与燃烧条（工作台无燃料概念）
    if (isWB) {
      el.stState.textContent = st.job ? '🛠️ 制作中……' : st.queue.length ? '⏳ 有任务排队中' : '🛠️ 就绪——点击配方开始制作（无需燃料）';
      el.stBurn.style.width = '0%';
      el.stFuelInfo.textContent = '🛠️ 工作台无需燃料——集齐材料点配方即可';
    } else {
    el.stState.textContent = st.lit
      ? `🔥 燃烧中 · 剩余 ${Math.ceil(st.burning)} 秒${st.fuel ? '（燃料充足自动续烧）' : '（燃料即将耗尽）'}`
      : st.fuel ? '⚫ 未点火——点击「点火」按钮开始制作'
      : (st.job || st.queue.length) ? '⚫ 燃料耗尽——点击下方带 🔥 标记的物品补充燃料'
      : '⚫ 没有燃料——点击下方物品栏里带 🔥 标记的物品放入燃料';
    el.stBurn.style.width = `${Math.min(100, (st.burning / 60) * 100)}%`;
    }
    // —— 制作队列：结构变化才重建；进行中任务的进度条原位更新 ——
    // （每帧重建会吞点击 + 闪 hover，故拆分：结构签名缓存 + 文本/宽度原位写入）
    const tasks = [];
    if (st.job) tasks.push({ ...st.job, active: true });
    for (const t of st.queue) tasks.push({ ...t, active: false });
    const qSig = `${st.lit ? 1 : 0}|${tasks.map(t => `${t.active ? 'A' : 'W'}:${t.icon}:${t.label}:${t.n ?? 1}`).join('|')}`;   // 含点火状态：暂停时槽体切黄框呼吸提醒
    if (qSig !== this._stQSig) {
      this._stQSig = qSig;
      el.stQueue.innerHTML = Array.from({ length: QUEUE_MAX }, (_, i) => {
        const t = tasks[i];
        if (!t) return `<div class="st-qslot empty">${i === 0 ? '＋ 放入原料后点配方入队' : '＋ 空位'}</div>`;
        const paused = t.active && !st.lit && !isWB;   // 燃料耗尽冻结中：黄框闪烁
        return `<div class="st-qslot ${t.active ? 'active' : ''}${paused ? ' paused' : ''}" data-qidx="${i}" title="${paused ? '⏸ 燃料耗尽暂停中——补充燃料自动继续；点击取消并退回原料' : '点击取消并退回原料'}">
          <span class="q-icon">${t.icon}</span>
          <span class="q-name">${t.label}${t.n > 1 ? `×${t.n}` : ''}</span>
          ${t.active
            ? `<div class="st-job-track"><div class="st-job-fill"></div></div><span class="q-eta"></span>`
            : `<span class="q-eta dim">等待中</span>`}
          <span class="q-cancel">✕</span>
        </div>`;
      }).join('');
    }
    // 进度条/剩余秒原位更新（不重建 DOM）
    if (st.job) {
      const fill = el.stQueue.querySelector('.st-qslot.active .st-job-fill');
      const eta = el.stQueue.querySelector('.st-qslot.active .q-eta');
      const paused = !st.lit && !isWB;   // 燃料耗尽冻结中（篝火/熔炉）
      if (fill) fill.style.width = ((1 - Math.max(0, st.job.remaining) / st.job.total) * 100).toFixed(1) + '%';
      if (eta) eta.textContent = paused
        ? `⏸ 暂停（燃料耗尽）· 还差 ${Math.ceil(st.job.remaining)} 秒`
        : `制作中 · 剩 ${Math.ceil(st.job.remaining)} 秒`;
    }
    // —— 燃料槽（签名缓存，避免每帧重建）——
    const fuelItem = st.fuel ? ITEMS[st.fuel.id] : null;
    const fuelSig = `${st.fuel?.id ?? ''}|${st.fuel?.count ?? 0}|${st.lit ? 1 : 0}`;
    if (fuelSig !== this._stFuelSig) {
      this._stFuelSig = fuelSig;
      const inFire = !st.fuel && st.burning > 0;   // 燃料已在炉中燃烧（本块烧掉后燃料槽为空）
      el.stFuel.innerHTML = `${fuelItem ? this.iconHTML(fuelItem) : ''}${st.fuel && st.fuel.count > 1 ? `<span class="count">${st.fuel.count}</span>` : ''}<span class="slot-label">燃料</span>${!st.fuel ? (inFire ? '<span class="slot-empty-hint">🔥 燃烧中</span>' : '<span class="slot-empty-hint">＋ 放入燃料</span>') : ''}`;
      el.stFuel.title = st.fuel
        ? `点击取回燃料 · ${st.fuel.count} 块共可烧 ${FUEL[st.fuel.id] * st.fuel.count} 秒`
        : inFire ? `燃料正在炉中燃烧（剩余 ${Math.ceil(st.burning)} 秒）——放入新燃料可自动续烧`
        : '空的燃料槽——点下方物品栏中带 🔥 标记的物品，每次放入 1 块（可叠加）';
    }
    // 常驻燃烧信息（不需要悬停就能看到；textContent 每帧写入开销可忽略；工作台在上面已写入）
    if (!isWB) el.stFuelInfo.textContent = st.burning > 0
      ? `🔥 燃烧中 · 剩余 ${Math.ceil(st.burning)} 秒${st.fuel ? `（${ITEMS[st.fuel.id].name} ×${st.fuel.count} 可自动续烧）` : '（燃料已在炉中燃烧，烧完自动熄灭）'}${(st.job || st.queue.length) ? '' : ' · 队列已空，可点「关火」提前结束'}`
      : st.fuel ? `🔥 燃料：${ITEMS[st.fuel.id].name} ×${st.fuel.count} · 共可烧 ${FUEL[st.fuel.id] * st.fuel.count} 秒（每块 ${FUEL[st.fuel.id]} 秒）`
      : '🔥 燃料：无 —— 点击下方物品栏中带 🔥 标记的物品放入（每次 1 块，可叠加）';
    // —— 产出暂存（签名缓存）——
    const outSig = st.output.map(o => `${o.id}:${o.count}`).join(',');
    if (outSig !== this._stOutSig) {
      this._stOutSig = outSig;
      el.stOutputGrid.innerHTML = Array.from({ length: 6 }, (_, i) => {
        const o = st.output[i];
        if (!o) return `<div class="st-ocell empty"></div>`;
        const item = ITEMS[o.id];
        return `<div class="st-ocell" data-oidx="${i}" title="${item.name}：左键收进背包${item.food ? ' · 右键直接使用' : ''}">${this.iconHTML(item)}${o.count > 1 ? `<span class="count">${o.count}</span>` : ''}</div>`;
      }).join('');
    }
    // —— 配方按钮（签名缓存：仅 ready/locked 状态或列表变化时重建）——
    const recipes = g.stations.recipesFor(x, y, z);
    const rSig = recipes.map(r => `${r.recipe.id}:${r.ready ? 1 : 0}:${r.locked ? 1 : 0}`).join(',');
    if (rSig !== this._stRSig) {
      this._stRSig = rSig;
      el.stRecipes.innerHTML = recipes.length
        ? recipes.map(({ recipe, ready, cost, ins, locked, lockHint }) => {
            const mats = Object.entries(ins).map(([id, n]) => `${ITEMS[id].icon}<i>${n}</i>`).join('');
            const t = recipe.time < 60 ? recipe.time + '秒' : Math.floor(recipe.time / 60) + '分' + (recipe.time % 60 ? (recipe.time % 60) + '秒' : '');
            if (locked) return `<button class="st-recipe dim" disabled title="${lockHint}">🔒 ${ITEMS[recipe.out].name}（${t}）</button>`;
            return `<button class="st-recipe ${ready ? 'ready' : 'dim'}" data-recipe="${recipe.id}" ${ready ? '' : 'disabled'} title="材料：${Object.entries(ins).map(([id, n]) => `${ITEMS[id].name}×${n}`).join('、')}${recipe.returns ? `（做完返还${ITEMS[recipe.returns].name}）` : ''}">
              ${ITEMS[recipe.out].icon} ${ITEMS[recipe.out].name}${cost > 1 ? `×${cost}` : ''} <span class="mats">${mats}</span>（${t}）
            </button>`;
          }).join('')
        : '<span class="dim">无可制作配方</span>';
    }
    if (!isWB) el.stFireBtn.textContent = st.lit ? '关火' : '点火';
    // —— 玩家物品栏（签名缓存：物品增减/插件变化时才重建，保证点击目标稳定、hover 不闪）——
    const inv = g.inventory;
    const iSig = inv.slots.map(s => s ? `${s.id}:${s.count}:${s.mods?.length ?? 0}` : '-').join(',');
    if (iSig !== this._stISig) {
      this._stISig = iSig;
      el.stInv.innerHTML = inv.slots.map((s, i) =>
        this.slotHTML(i, false, s && FUEL[s.id] ? `点击放入燃料槽（燃烧 ${FUEL[s.id]} 秒）` : null)
      ).join('');
    }
  }

  // ---------------- 图标渲染 ----------------
  cssColor(item) {
    if (item.css) return item.css;
    return '#' + (item.color ?? 0xcccccc).toString(16).padStart(6, '0');
  }

  isChip(item) {
    const ic = item.icon;
    return ic && [...ic].length === 1 && ic.codePointAt(0) >= 0x4E00; // CJK 字符 → 彩色字块
  }

  iconHTML(item) {
    if (!item) return '';
    if (this.isChip(item)) {
      const bg = this.cssColor(item);
      const rgb = parseInt(bg.slice(1), 16);
      const lum = ((rgb >> 16) * 0.299 + ((rgb >> 8) & 255) * 0.587 + (rgb & 255) * 0.114);
      const color = lum > 120 ? '#222' : '#f5f5f5';
      return `<div class="chip" style="background:${bg};color:${color}">${item.icon}</div>`;
    }
    return `<span>${item.icon ?? '❓'}</span>`;
  }

  // ---------------- 提示 ----------------
  toast(msg, color, dur = 2600) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    if (color) d.style.color = color;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), dur);
    while (this.el.toasts.children.length > 6) this.el.toasts.firstChild.remove();
  }

  // 收获结算提示：右下角，约 5 秒（4.2 秒后淡出）——挖方块掉落/拾取掉落物时告知玩家本次收获
  loot(items) {
    if (!items || !items.length) return;
    const feed = this.el.lootFeed;
    const d = document.createElement('div');
    d.className = 'loot-entry';
    d.innerHTML = items.map(({ id, count }) => {
      const item = ITEMS[id];
      if (!item) return '';
      return `<span class="loot-item">${this.iconHTML(item)}<b>+${count}</b>${item.name}</span>`;
    }).join('');
    feed.appendChild(d);
    setTimeout(() => d.classList.add('fade'), 4200);
    setTimeout(() => d.remove(), 5000);
    while (feed.children.length > 5) feed.firstChild.remove();   // 最多同屏 5 条
  }

  flashDamage() {
    this.vignetteOpacity = 0.9;
  }

  // ---------------- M9：物品功效悬停说明 ----------------
  // 事件委托：鼠标悬停背包/装备/制作列表/插件槽时记录物品 id；每帧 updateTip 重渲染（面板帧重建不闪）
  bindTooltip() {
    const SEL = '[data-iid], .slot[data-idx], .equip-slot[data-slot], [data-r], .socket[data-s]';
    document.addEventListener('mouseover', (e) => {
      const hit = e.target.closest(SEL);
      this.tip = hit ? this.tipItemAt(hit) : null;
      if (hit) { this.tipMouse = { x: e.clientX, y: e.clientY }; }
    });
    document.addEventListener('mousemove', (e) => {
      if (this.tip) { this.tipMouse = { x: e.clientX, y: e.clientY }; }
    });
  }

  // 从悬停元素解析物品 id（背包格/装备位/制作列表成品/插件槽）
  tipItemAt(el) {
    const inv = this.game.inventory;
    if (el.dataset.r !== undefined) {   // 制作列表合成按钮：显示成品说明（携带配方以便熟练度锁提示）
      const recipe = this.game.crafting.recipes[+el.dataset.r];
      return recipe ? { id: recipe.out, recipe } : null;
    }
    if (el.classList.contains('socket')) {   // 插件槽：显示已安装插件
      const key = el.closest('.equip-slot')?.dataset.slot;
      const inst = key ? this.game.player.equipment[key] : null;
      const pid = inst?.mods?.[+el.dataset.s] ?? null;
      return pid ? { id: pid } : null;
    }
    if (el.classList.contains('equip-slot')) {   // 装备位
      return { id: this.game.player.equipment[el.dataset.slot]?.id ?? null };
    }
    if (el.classList.contains('recipe')) {   // 制作列表：显示成品说明
      return this.game.crafting.recipes[+el.dataset.r]?.out ?? null;
    }
    if (el.classList.contains('slot')) {   // 快捷栏/背包/行囊/容器输入格（均为 inventory.slots[idx]）
      const pid = inv.slots[+el.dataset.idx]?.id ?? null;
      return pid ? { id: pid } : null;
    }
    const iid = el.dataset.iid;
    return iid ? { id: iid } : null;
  }

  // 物品详情卡：名称/类别/数值行/功效描述
  tipHTML(id, recipe = null) {
    const it = ITEMS[id];
    if (!it) return '';
    const KIND_CN = { melee: '近战武器', ranged: '远程武器', armor: '护甲', equip: '装备', plugin: '插件', medical: '医疗品', book: '技能书', plan: '图纸', material: '材料' };
    const BLOCK_CN = { [BLOCK.CAMPFIRE]: '可放置 · 篝火', [BLOCK.FURNACE]: '可放置 · 熔炉', [BLOCK.WORKBENCH]: '可放置 · 工作台' };
    const kind = it.block ? (BLOCK_CN[it.block] ?? '可放置方块') : (KIND_CN[it.kind] ?? (it.food ? '消耗品' : '物品'));
    let stats = '';
    if (it.damage) stats += `<div class="t-row">⚔️ 伤害 <b>${it.damage}</b>${it.rate ? ` · 攻击间隔 ${it.rate}s` : ''}</div>`;
    if (it.ammo) stats += `<div class="t-row">🏹 弹药：${it.ammo === 'arrow' ? '箭矢' : '弩箭'}</div>`;
    if (it.armor) stats += `<div class="t-row">🛡 护甲值 <b>${it.armor}</b>（受伤 -${Math.round(it.armor / (it.armor + 30) * 100)}%）</div>`;
    if (it.pack) stats += `<div class="t-row">🎒 背包格数 <b>+${it.pack}</b></div>`;
    if (it.sockets) stats += `<div class="t-row">⚙️ 插件槽 ×${it.sockets}</div>`;
    if (it.food) {
      const f = it.food, seg = [];
      if (f.hunger) seg.push(`🥩饱食 +${f.hunger}`); if (f.thirst) seg.push(`💧水分 +${f.thirst}`); if (f.health) seg.push(`❤️生命 +${f.health}`);
      if (seg.length) stats += `<div class="t-row">${seg.join(' · ')}</div>`;
    }
    const u = recipe?.unlock ?? null;
    if (u) stats += `<div class="t-row dim">🔒 需 ${W_TIER[u.mat].name}${u.lv} 级${(W_CLASSES.find(c => c.key === u.cls)?.cn) ?? u.cls}熟练度（研读书谱解锁）</div>`;
    return `<div class="t-name" style="color:${it.css ?? '#fff'}">${it.name}</div>`
      + `<div class="t-kind">${kind}</div>${stats}`
      + (it.desc ? `<div class="t-desc">${it.desc}</div>` : '');
  }

  // 每帧刷新 tooltip 内容与位置（跟随鼠标，防出屏）
  updateTip() {
    const t = this.el.tip;
    if (!t) return;
    if (!this.tip) { t.classList.add('hidden'); return; }
    const html = this.tipHTML(this.tip.id, this.tip.recipe);
    if (!html) { t.classList.add('hidden'); return; }
    t.innerHTML = html;
    t.classList.remove('hidden');
    const x = Math.min(this.tipMouse.x + 14, window.innerWidth - 280);
    const y = Math.min(this.tipMouse.y + 16, window.innerHeight - t.offsetHeight - 12);
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${Math.max(8, y)}px`;
  }

  // M8 验收：受伤浮动文字 —— 无护甲红色「-N」，有护甲变灰「-N 🛡P%」（P=减伤百分比）
  showHurtFloat(dmg, reducePct = 0) {
    const layer = this.el.hurtFloat ?? document.getElementById('hurt-float-layer');
    if (!layer) return;
    const d = document.createElement('div');
    d.className = 'hurt-float' + (reducePct > 0 ? ' armored' : '');
    d.textContent = reducePct > 0 ? `-${Math.round(dmg)} 🛡${reducePct}%` : `-${Math.round(dmg)}`;
    d.style.left = `${44 + Math.random() * 12}%`;
    d.style.top = `${40 + Math.random() * 10}%`;
    layer.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  updateMineProgress(data) {
    if (!data) { this.el.mineProgress.classList.add('hidden'); return; }
    this.el.mineProgress.classList.remove('hidden');
    this.el.mineBar.style.setProperty('--p', Math.floor(data.progress * 100) + '%');
    this.el.mineTip.textContent = data.tip ?? '';
  }

  // ---------------- 每帧刷新 ----------------
  // 准星目标怪物血量 HUD（每帧调用，签名缓存避免重复写 DOM）
  updateMobHud(t) {
    const sig = t ? `${t.name}|${t.hp}|${t.maxHp}` : null;
    if (sig === this.mobHudSig) return;
    this.mobHudSig = sig;
    if (!t) { this.el.mobHud.classList.add('hidden'); return; }
    this.el.mobHud.classList.remove('hidden');
    this.el.mobName.textContent = t.name;
    this.el.mobFill.style.width = `${(t.maxHp > 0 ? t.hp / t.maxHp : 0) * 100}%`;
    this.el.mobText.textContent = `${t.hp} / ${t.maxHp}`;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.updateTip();   // M9：物品功效悬停说明

    // 容器面板开着 → 实时刷新（燃烧/进度/暂停状态）
    if (!this.el.panelStation.classList.contains('hidden')) this.updateStationPanel();

    // 制作进度条
    const job = g.crafting?.progress();
    if (!job) { this.el.craftBar.classList.add('hidden'); }
    else {
      this.el.craftBar.classList.remove('hidden');
      this.el.craftIcon.textContent = job.paused ? '⏸' : job.icon;
      this.el.craftLabel.textContent = job.paused ? `${job.label}（远离篝火，已暂停）` : `正在制作 ${job.label}`;
      this.el.craftFill.style.width = `${Math.min(100, job.frac * 100).toFixed(1)}%`;
      this.el.craftRemain.textContent = job.paused ? '暂停' : `${Math.ceil(job.remain)}s`;
      this.el.craftRemain.classList.toggle('paused', job.paused);
    }

    if (this.dirtyVitals) {
      this.dirtyVitals = false;
      const hpFrac = Math.max(0, p.hp / p.maxHp);
      this.el.barHp.style.width = (hpFrac * 100) + '%';
      this.el.barHp.classList.toggle('low', hpFrac < 0.25);
      this.el.textHp.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
      this.el.barHunger.style.width = p.hunger + '%';
      this.el.barHunger.classList.toggle('low', p.hunger < 25);
      this.el.barThirst.style.width = p.thirst + '%';
      this.el.barThirst.classList.toggle('low', p.thirst < 25);
    }

    this.updateEffects();

    if (this.dirtyXp) {
      this.dirtyXp = false;
      this.el.xpBar.style.width = Math.min(100, p.xp / p.xpNeed() * 100) + '%';
      this.el.xpText.textContent = `Lv.${p.level}${p.points > 0 ? ` · 技能点 ${p.points}` : ''}`;
      this.el.xpText.classList.toggle('has-points', p.points > 0);
    }

    // 时间
    const hour = (6 + g.timeOfDay * 24) % 24;
    const hh = String(Math.floor(hour)).padStart(2, '0');
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    const protect = g.day <= ZOMBIE_CFG.PROTECT_DAYS
      ? ` · 🛡️ 新手保护 ${g.day}/${ZOMBIE_CFG.PROTECT_DAYS}` : '';
    this.el.time.textContent = `${g.isNight ? '🌙' : '☀️'} 第 ${g.day} 天 · ${hh}:${mm}${protect}`;

    // 危险预警（感知）
    const zd = g.entities.nearestZombieDist();
    const range = (g.player.mods ?? g.skills.mods).warningRange;
    this.el.warning.style.opacity = Math.max(0, 1 - zd / range) * 0.9;

    // 受伤红屏淡出
    if (this.vignetteOpacity > 0.01) {
      this.vignetteOpacity *= Math.pow(0.03, dt);
      this.el.vignette.style.opacity = this.vignetteOpacity;
    } else if (this.el.vignette.style.opacity !== '0') {
      this.el.vignette.style.opacity = '0';
    }

    // 面板定期刷新
    if (!this.el.panelInv.classList.contains('hidden')) {
      this.craftTimer -= dt;
      if (this.craftTimer <= 0) {
        this.craftTimer = 0.5;
        this.updateCraftPanel();
      }
    }
    if (!this.el.panelPack.classList.contains('hidden')) this.updateEquipStats();
  }

  // 状态效果徽章（拉肚子等）：每秒刷新一次剩余时间
  updateEffects() {
    const fx = this.game.player.effects || [];
    const sig = fx.map(e => `${e.id}_${Math.ceil(e.time)}`).join(',');
    if (sig === this._fxSig) return;
    this._fxSig = sig;
    this.el.fxRow.innerHTML = fx.map(e => {
      const def = EFFECTS[e.id];
      if (!def) return '';
      const st = def.hpDrain ? '掉血中' : def.hpHeal ? '回血中' : def.negative ? '削弱中' : '增益中';
      return `<span class="fx-chip" style="border-color:${def.color};color:${def.color}">${def.icon} ${def.name} · ${st} <b>${Math.ceil(e.time)}s</b></span>`;
    }).join('');
    this.el.fxRow.classList.toggle('has-fx', fx.length > 0);
  }

  // ---------------- 快捷栏 ----------------
  modBadge(s) {
    return s?.mods?.length ? '<span class="moddot">✦</span>' : '';
  }

  updateHotbar() {
    const inv = this.game.inventory;
    const html = [];
    for (let i = 0; i < inv.hotbarSize; i++) {
      const s = inv.slots[i];
      const item = s ? ITEMS[s.id] : null;
      html.push(`<div class="slot ${i === inv.selected ? 'selected' : ''}" data-idx="${i}">
        <span class="key">${i + 1}</span>
        ${item ? this.iconHTML(item) : ''}
        ${s && s.count > 1 ? `<span class="count">${s.count}</span>` : ''}
        ${this.modBadge(s)}
      </div>`);
    }
    this.el.hotbar.innerHTML = html.join('');
  }

  selectHotbar(i) {
    const inv = this.game.inventory;
    inv.selected = ((i % inv.hotbarSize) + inv.hotbarSize) % inv.hotbarSize;
    this.updateHotbar();
  }

  // ---------------- 物品栏 / 背包 / 装备面板 ----------------
  // fuelTip：传入时该槽位会被标记为可作燃料（🔥 角标 + 点击放入燃料槽的提示）
  slotHTML(i, selected, fuelTip) {
    const inv = this.game.inventory;
    const s = inv.slots[i];
    const item = s ? ITEMS[s.id] : null;
    const pending = item?.kind === 'plugin' && s.id === this.pendingPlugin;
    const planTip = item?.kind === 'plan' ? '　📜 选中后对空处按右键学习' : '';
    const title = item ? item.name + (item.desc ? '：' + item.desc : '') + planTip : '';
    return `<div class="slot ${selected ? 'selected' : ''} ${pending ? 'pending' : ''} ${fuelTip ? 'fuel-slot' : ''}" data-idx="${i}" title="${fuelTip ? title + '　🔥 ' + fuelTip : title}">
      ${item ? this.iconHTML(item) : ''}
      ${s && s.count > 1 ? `<span class="count">${s.count}</span>` : ''}
      ${fuelTip ? '<span class="fuel-mark">🔥</span>' : ''}
      ${this.modBadge(s)}
    </div>`;
  }

  // 根据当前打开的面板刷新对应内容
  refreshPanels() {
    this.updateHotbar();
    if (!this.el.panelInv.classList.contains('hidden')) {
      this.updateInventoryPanel();
      this.updateCraftPanel();
    }
    if (!this.el.panelPack.classList.contains('hidden')) {
      this.updateBackpackPanel();
      this.updateEquipPanel();
    }
  }

  bindInventory() {
    const inv = this.game.inventory;
    inv.onChange = () => this.refreshPanels();
    this.el.hotbar.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if (slot) this.selectHotbar(+slot.dataset.idx);
    });

    // ===== E 面板：物品栏（9 格，点击选中）=====
    this.el.invGrid.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const idx = +slot.dataset.idx;
      const g = this.game;
      const def = ITEMS[inv.slots[idx]?.id];
      // 双击装备 → 穿上
      if (e.detail >= 2 && def?.kind === 'equip') {
        g.player.equipFromInv(idx);
        this.refreshPanels();
        return;
      }
      // 点插件 → 标记待安装
      if (def?.kind === 'plugin') {
        this.pendingPlugin = this.pendingPlugin === inv.slots[idx].id ? null : inv.slots[idx].id;
        this.toast(this.pendingPlugin ? `已选择 ${def.name}，按 B 打开背包点插槽安装` : '取消安装', '#ffd54a');
        this.refreshPanels();
        return;
      }
      this.selectHotbar(idx);
    });
    // 右键带插件的物品 → 卸下最后一个插件
    this.el.invGrid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const idx = +slot.dataset.idx;
      const s = inv.slots[idx];
      if (!s?.mods?.length) return;
      const r = this.game.player.removePlugin({ inv: idx }, s.mods.length - 1);
      this.toast(r.ok ? '插件已卸下' : r.reason, r.ok ? '#9dff6c' : '#ff7b6b');
      this.refreshPanels();
    });

    // ===== B 面板：背包格（单击使用 / 右键移入物品栏）=====
    this.el.packGrid.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const idx = +slot.dataset.idx;
      const g = this.game;
      const s = inv.slots[idx];
      const def = s ? ITEMS[s.id] : null;
      // 待装插件 + 带插槽物品 → 安装
      if (this.pendingPlugin && def?.sockets) {
        const r = g.player.installPlugin({ inv: idx });
        this.toast(r.ok ? '插件安装成功' : r.reason, r.ok ? '#9dff6c' : '#ff7b6b');
        if (r.ok) this.pendingPlugin = null;
        this.refreshPanels();
        return;
      }
      // 点插件 → 标记待安装
      if (def?.kind === 'plugin') {
        this.pendingPlugin = this.pendingPlugin === s.id ? null : s.id;
        this.toast(this.pendingPlugin ? `已选择 ${def.name}，点击装备插槽或带插槽武器安装` : '取消安装', '#ffd54a');
        this.refreshPanels();
        return;
      }
      // 双击装备 → 穿上
      if (e.detail >= 2 && def?.kind === 'equip') {
        g.player.equipFromInv(idx);
        this.refreshPanels();
        return;
      }
      // 单击 = 直接使用（食用/饮用/穿戴）
      g.combat.useAtIndex(idx);
      this.refreshPanels();
    });
    this.el.packGrid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const idx = +slot.dataset.idx;
      const s = inv.slots[idx];
      if (s?.mods?.length) {
        const r = this.game.player.removePlugin({ inv: idx }, s.mods.length - 1);
        this.toast(r.ok ? '插件已卸下' : r.reason, r.ok ? '#9dff6c' : '#ff7b6b');
      } else if (inv.moveToHotbar(idx)) {
        this.toast('已移入物品栏', '#9dff6c');
      } else {
        this.toast('物品栏已满', '#ff7b6b');
      }
      this.refreshPanels();
    });

    // ===== B 面板：物品栏条（点击选中 / 右键移回背包）=====
    this.el.bar2Grid.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const idx = +slot.dataset.idx;
      const g = this.game;
      const s = inv.slots[idx];
      // 待装插件 + 带插槽武器 → 安装
      if (this.pendingPlugin && s && ITEMS[s.id]?.sockets) {
        const r = g.player.installPlugin({ inv: idx });
        this.toast(r.ok ? '插件安装成功' : r.reason, r.ok ? '#9dff6c' : '#ff7b6b');
        if (r.ok) this.pendingPlugin = null;
        this.refreshPanels();
        return;
      }
      if (e.detail >= 2 && s && ITEMS[s.id]?.kind === 'equip') {
        g.player.equipFromInv(idx);
        this.refreshPanels();
        return;
      }
      this.selectHotbar(idx);
    });
    this.el.bar2Grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const idx = +slot.dataset.idx;
      const s = inv.slots[idx];
      if (s?.mods?.length) {
        const r = this.game.player.removePlugin({ inv: idx }, s.mods.length - 1);
        this.toast(r.ok ? '插件已卸下' : r.reason, r.ok ? '#9dff6c' : '#ff7b6b');
      } else if (inv.moveToBackpack(idx)) {
        this.toast('已移入背包', '#9dff6c');
      } else {
        this.toast('背包已满', '#ff7b6b');
      }
      this.refreshPanels();
    });

    // ===== 装备槽（B 面板）：点击脱下；插槽安装/卸下插件 =====
    this.el.equipGrid.addEventListener('click', (e) => {
      const g = this.game;
      const socket = e.target.closest('.socket');
      const slotEl = e.target.closest('.equip-slot');
      if (!slotEl) return;
      const key = slotEl.dataset.slot;
      if (socket) {
        const inst = g.player.equipment[key];
        const socketIdx = +socket.dataset.s;
        const occupied = inst && socketIdx < (inst.mods?.length ?? 0);
        const loc = { equip: key };
        const r = occupied
          ? g.player.removePlugin(loc, socketIdx)
          : g.player.installPlugin(loc);
        this.toast(r.ok ? (occupied ? '插件已卸下' : '插件安装成功') : r.reason,
          r.ok ? '#9dff6c' : '#ff7b6b');
        if (r.ok && !occupied) this.pendingPlugin = null;
        this.refreshPanels();
        return;
      }
      // 点击装备本体 → 脱下
      g.player.unequip(key);
      this.refreshPanels();
    });
  }

  // 只刷新底部统计行（轻量）
  updateEquipStats() {
    const g = this.game;
    const p = g.player;
    const reduce = Math.round(Math.min(0.75, p.armor / (p.armor + 30)) * 100);   // M6：A/(A+30)
    const used = g.inventory.slots.slice(g.inventory.hotbarSize).filter(Boolean).length;
    this.el.equipStats.innerHTML =
      `🛡 护甲 <b>${p.armor}</b>（僵尸伤害 -${reduce}%）<br>` +
      `📦 背包 <b>${used}/${g.inventory.backpackSize()}</b> 格` +
      (this.pendingPlugin
        ? `<br><span class="pend">待安装：${ITEMS[this.pendingPlugin].name}<br>点击插槽安装</span>`
        : `<br><span class="dim2">单击背包物品使用<br>右键移入物品栏<br>双击装备穿上</span>`);
  }

  // E 面板：物品栏 9 格
  updateInventoryPanel() {
    const inv = this.game.inventory;
    const html = [];
    for (let i = 0; i < inv.hotbarSize; i++) html.push(this.slotHTML(i, i === inv.selected));
    this.el.invGrid.innerHTML = html.join('');
  }

  // B 面板：背包格 + 物品栏条
  updateBackpackPanel() {
    const inv = this.game.inventory;
    const html = [];
    for (let i = inv.hotbarSize; i < inv.slots.length; i++) html.push(this.slotHTML(i, false));
    this.el.packGrid.innerHTML = html.join('');
    const bar = [];
    for (let i = 0; i < inv.hotbarSize; i++) bar.push(this.slotHTML(i, i === inv.selected));
    this.el.bar2Grid.innerHTML = bar.join('');
  }

  updateEquipPanel() {
    const g = this.game;
    const p = g.player;
    const html = [];
    for (const { key, label } of EQUIP_SLOTS) {
      const inst = p.equipment[key];
      const def = inst ? ITEMS[inst.id] : null;
      const sockets = def?.sockets ?? 0;
      const mods = inst?.mods ?? [];
      let stat = '';
      if (def?.armor) stat += `🛡${def.armor} `;
      if (def?.pack) stat += `📦+${def.pack}`;
      const socketsHtml = sockets ?
        `<div class="sockets">${Array.from({ length: sockets }, (_, i) =>
          `<div class="socket ${i < mods.length ? 'filled' : ''}" data-s="${i}" title="${i < mods.length ? ITEMS[mods[i]].name + '（点击卸下）' : '空插槽（点击安装插件）'}">${i < mods.length ? this.iconHTML(ITEMS[mods[i]]) : ''}</div>`
        ).join('')}</div>` : '';
      html.push(`<div class="equip-slot ${inst ? '' : 'empty'}" data-slot="${key}">
        <div class="e-label">${label}</div>
        <div class="e-icon">${def ? this.iconHTML(def) : '<span class="dim">—</span>'}</div>
        <div class="e-name">${def ? def.name : '空'}</div>
        ${stat ? `<div class="e-stat">${stat}</div>` : ''}
        ${socketsHtml}
      </div>`);
    }
    this.el.equipGrid.innerHTML = html.join('');
    this.updateEquipStats();
  }

  // M8：制作列表分组渲染 —— v2 武器/护甲一类别一格（箭头切等级），普通配方原样罗列
  updateCraftPanel() {
    const g = this.game;
    const gmap = new Map();   // key -> { kind, cls/slot, mat, lv:{1..6: status} }
    const plain = [];
    for (const st of g.crafting.listStatus()) {
      const out = st.recipe.out ?? '';
      const w = out.match(/^(stone|iron|steel)_(knife|hammer|club|spear|bow|crossbow)_l([1-6])$/);
      const a = out.match(/^(stone|iron|steel)_armor_(helm|chest|legs|boots)_l([1-6])$/);
      if (w) {
        const key = `w:${w[2]}:${w[1]}`;
        if (!gmap.has(key)) gmap.set(key, { kind: 'w', cls: w[2], mat: w[1], lv: {} });
        gmap.get(key).lv[+w[3]] = st;
      } else if (a) {   // 护甲正则：a[1]=材质 a[2]=部位 a[3]=等级（'armor' 是字面量非捕获组）
        const key = `a:${a[2]}:${a[1]}`;
        if (!gmap.has(key)) gmap.set(key, { kind: 'a', slot: a[2], mat: a[1], lv: {} });
        gmap.get(key).lv[+a[3]] = st;
      } else plain.push(st);
    }
    const needHtml = (cost, recipe) => Object.entries(cost ?? recipe.cost).map(([id, n]) => {
      const have = g.inventory.countOf(id);
      return `<span class="${have >= n ? '' : 'lack'}">${ITEMS[id].name} ${have}/${n}</span>`;
    }).join('、');
    const stationTag = r => r.station
      ? `<span class="station">[${r.station === 'campfire' ? '篝火' : r.station === 'furnace' ? '熔炉' : '工作台'}]</span>` : '';
    const rows = [];
    // 普通配方：原样罗列（可合成=绿边 / 不可=黄边）
    for (const { recipe, ok, reason, cost } of plain) {
      const item = ITEMS[recipe.out];
      const lock = (recipe.needUnlock || recipe.unlock) && !ok ? `<span class="lack">🔒</span>` : '';
      rows.push(`<div class="recipe ${ok ? 'can' : 'lackmat'}">
        <div class="r-icon">${this.iconHTML(item)}</div>
        <div class="r-main">
          <div class="r-name">${item.name} ×${recipe.n} ${lock}</div>
          <div class="r-need">${stationTag(recipe)}${needHtml(cost, recipe)}${ok ? '' : ` — <span class="lack">${reason}</span>`}</div>
        </div>
        <button data-r="${g.crafting.recipes.indexOf(recipe)}" ${ok ? '' : 'disabled'}>合成</button>
      </div>`);
    }
    // v2 武器/护甲：一类别一格；等级 ‹ L# › 切换；锁定状态用颜色/水印/圆点区分
    for (const grp of gmap.values()) {
      const key = grp.kind === 'w' ? `w:${grp.cls}:${grp.mat}` : `a:${grp.slot}:${grp.mat}`;
      const lv = Math.min(6, Math.max(1, this.craftLv[key] ?? 1));
      const st = grp.lv[lv];
      const item = ITEMS[st.recipe.out];
      const { ok, reason } = st;
      // 视觉分级：ok=绿；熟练度/材质门槛锁=灰暗红锁水印（直接读配方数据判定，不依赖 check reason 顺序）；仅缺材料/工作站=黄
      const mlock = !ok && (() => {
        if (st.recipe.unlock) return !g.mastery.isUnlocked(st.recipe.unlock.cls, st.recipe.unlock.mat, st.recipe.unlock.lv);
        const m = (st.recipe.out ?? '').match(/^(stone|iron|steel)_armor_/);
        if (m) {
          if (m[1] === 'iron') return !g.flags?.ironWeapon;
          if (m[1] === 'steel') return g.inventory.countOf('steel_ingot') < 1;
        }
        return false;
      })();
      const cls = ok ? 'can' : mlock ? 'mlock' : 'lackmat';
      const unlocked = Object.entries(grp.lv).filter(([, s]) => s.ok).map(([l]) => +l);
      const dots = [1, 2, 3, 4, 5, 6].map(l =>
        `<i class="lv-dot${unlocked.includes(l) ? ' on' : ''}${l === lv ? ' cur' : ''}"></i>`).join('');
      rows.push(`<div class="recipe grp ${cls}">
        <div class="r-icon">${this.iconHTML(item)}</div>
        <div class="r-main">
          <div class="r-name">${item.name} <span class="lv-ctl"><button class="lv-btn" data-d="-1" data-key="${key}">‹</button><b>L${lv}</b><button class="lv-btn" data-d="1" data-key="${key}">›</button></span>${dots}${!ok && mlock ? '<span class="r-lock">🔒</span>' : ''}</div>
          <div class="r-need">${stationTag(st.recipe)}${needHtml(st.cost, st.recipe)}${ok ? '' : ` — <span class="lack">${reason}</span>`}</div>
        </div>
        <button data-r="${g.crafting.recipes.indexOf(st.recipe)}" ${ok ? '' : 'disabled'}>合成</button>
      </div>`);
    }
    this.el.craftList.innerHTML = rows.join('');
  }

  bindCraft() {
    this.el.craftList.addEventListener('click', (e) => {
      const lvBtn = e.target.closest('.lv-btn');   // M8：等级箭头优先处理，不触发合成
      if (lvBtn) {
        const key = lvBtn.dataset.key;
        const cur = this.craftLv[key] ?? 1;
        this.craftLv[key] = Math.min(6, Math.max(1, cur + +lvBtn.dataset.d));
        this.updateCraftPanel();
        return;
      }
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const r = this.game.crafting.recipes[+btn.dataset.r];
      this.game.crafting.craft(r);
      this.updateCraftPanel();
      this.updateInventoryPanel();
    });
  }

  // ---------------- 技能面板 ----------------
  buildSkills() {
    const cols = SKILL_TREE.map(cat => `
      <div class="skill-cat" style="border-top:3px solid ${cat.color}">
        <h3>${cat.icon} ${cat.name} <small style="color:#888">总 ${this.game.skills.catLevel(cat.id)} 级</small></h3>
        ${cat.skills.map(sk => {
          const lv = this.game.skills.levelOf(cat.id, sk.id);
          const pips = Array.from({ length: sk.max }, (_, i) =>
            `<span class="pip ${i < lv ? 'on' : ''}"></span>`).join('');
          const maxed = lv >= sk.max;
          return `<div class="skill-node ${maxed ? 'maxed' : ''}">
            <div class="s-info">
              <div class="s-name">${sk.name} <small style="color:#888">Lv.${lv}/${sk.max}</small></div>
              <div class="s-desc">${sk.desc}</div>
              <div class="pips">${pips}</div>
            </div>
            <button data-cat="${cat.id}" data-sk="${sk.id}" ${maxed ? 'disabled' : ''}>+</button>
          </div>`;
        }).join('')}
      </div>`).join('');
    this.el.skillsColumns.innerHTML = cols;
    this.el.skillPoints.textContent = this.game.player.points;

    this.el.skillsColumns.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const g = this.game;
      if (g.player.points <= 0) return;
      g.player.points--;
      g.skills.learn(btn.dataset.cat, btn.dataset.sk);
      g.player.recomputeStats();   // 行囊等影响背包容量/属性
      this.toast(`技能提升：${SKILL_TREE.find(c => c.id === btn.dataset.cat).skills.find(s => s.id === btn.dataset.sk)?.name ?? btn.dataset.sk}`, '#7ec8ff');
      this.dirtyVitals = true;
      this.buildSkills();
    });
  }

  refreshSkillPoints() {
    this.el.skillPoints.textContent = this.game.player.points;
  }

  // ---------------- 帮助 ----------------
  buildHelp() {
    this.el.helpContent.innerHTML = `
      <h4>基础操作</h4>
      <b>WASD</b> 移动 · <b>空格</b> 跳跃 · <b>Shift</b> 疾跑 · <b>V</b> 切换第一/第三人称<br>
      <b>左键</b> 攻击/采集（对准方块按住） · <b>右键</b> 放置方块 / 进食 / 装水<br>
      <b>1-9 / 滚轮</b> 选择物品栏 · <b>E</b> 物品栏&合成 · <b>B</b> 背包&装备 · <b>K</b> 技能树 · <b>H</b> 帮助<br>
      💾 <b>进度按用户 ID 保存</b>：开始界面输入或点选历史 ID；每 30 秒自动保存（含天数/位置/物品/装备/技能/方块改动）；死亡后该 ID 存档清除<br>
      ⏱ <b>所有制作都需要时间</b>：背包合成材料秒级、工具数秒、装备十余秒；<br>
      🔥 <b>篝火/熔炉是容器</b>：对准它们<b>右键打开</b>，点击配方即<b>入队</b>（自动扣原料，队列最多 4 个）；<br>
      队列做完一个自动开始下一个，<b>排队中的任务可随时取消</b>（原料退回）；做好的物品存在<b>产出暂存</b>（最多 6 件）：<br>
      <b>左键</b>收进背包，食物/饮料可<b>右键直接使用</b>；<br>
      燃料：<b>1 木板烧 60 秒</b>（原木 120 秒/木棍 15 秒/煤炭 90 秒/<b>木工具 15 秒</b>），木板的制作物都能当柴烧；燃尽自动续烧；燃料耗尽则暂停（不丢进度），补充燃料自动继续；<br>
      <b>制作期间你可以去干其他事</b>——篝火与熔炉各自独立同时工作，做好了有提示；队列空了火焰不熄（剩余燃烧时间保留，可点关火提前结束）。
      <h4>物品栏与背包</h4>
      <b>物品栏</b>（9 格，屏幕底部）：选中后在游戏中<b>右键直接使用</b>——进食、喝水、穿装备、放方块。<br>
      <b>背包</b>（27 格起步，可扩容）按 <b>B</b> 打开：背包里的东西必须打开背包<b>单击使用</b>；<br>
      <b>右键</b>背包物品移入物品栏，<b>右键</b>物品栏物品移回背包。拾取的新物品优先进入物品栏空位。
      <h4>生存流程</h4>
      🛡️ <b>新手保护期</b>：前 <b>3 天</b>不会出现僵尸，放心采集、建造、合成装备；<br>
      保护期结束后僵尸随天数和你<b>等级/装备</b>（右上角战力）逐步变多变强，前期少量低级怪，不会突然碾压。<br>
      ① 徒手砍树 → 合成木板、木棍、木镐木斧<br>
      ② 挖铁：铁矿石 = 地下石头层里<b>橙色斑点</b>的方块（手持镐挖，木镐约 3 秒）→ 石头×8 合成熔炉；熔炉里放铁矿石+木板燃料 → 点火熔炼铁锭（8 秒）→ 铁锭+木棍打造铁级武器工具<br>
      🛠️ <b>工作台</b>（木板×4+石头×2+木棍×2）：高级物品都在这做——弓=木棍+线+胶水、铁剑=铁锭+木棍+胶水等；<b>线</b>=树叶纤维×2 手工搓，<b>胶水</b>=杯装开水+骨头×2 在篝火熬（12 秒）；<br>
      📜 <b>配方图纸</b>：打僵尸有几率掉落（约 7%），选中图纸<b>按右键学习</b>后解锁对应配方——弓/弩/箭矢/铁剑/绷带/皮甲/铁甲都需要图纸；带 🔒 的配方先去打怪<br>
      🎁 <b>收获提示</b>：挖到东西/捡到掉落物时，屏幕<b>右下角</b>会显示本次收获（约 5 秒）<br>
      💊 <b>状态与医疗</b>：屏幕<b>左下角</b>显示所有状态——吃烤肉/炖肉汤/烤肉串/骨头汤/什锦大餐获得正面增益（回血/移速/攻击/减伤），越高级的餐食增益越强；被僵尸打可能擦伤/脑震荡/断手，分别用绷带/炖肉汤/夹板治疗，医疗包治愈一切<br>
      ③ 收集沙子 → 熔炉烧成玻璃 → 再烧成<b>玻璃杯</b>；空瓶/玻璃杯对着水右键接生水<br>
      🥛 <b>玻璃杯</b>：接水后对篝火右键打开，杯装生水<b>点配方入队</b>+木板放燃料 → 开水；喝完返还空杯（产出槽右键可直接喝）<br>
      💧 <b>喝水</b>：<b>空手</b>对准水右键可直接喝生水解急，但会<b>拉肚子</b>（持续掉血+饥饿加倍）；<br>
      空瓶/杯装的生水要<b>烧开</b>才安全（生水喝会拉肚子）；🍵杯装开水<b>手持右键即饮</b>（口渴+42），喝完返还空杯🥛，可反复接水。<br>
      ④ 猎猪：猪逃跑变慢且有喘息期，追上连砍两三下即可；篝火 = 原木×3 + 石头×2<br>
      🍖 <b>烤肉</b>：对篝火右键打开容器 → 木板放燃料槽 → 点「烤肉」入队（约 8 秒，最多排 4 个）；生肉生吃会掉血<br>
      💧 <b>烧水</b>：同样流程，杯装生水/瓶装生水 → 开水（约 6 秒）；一天为真实 1 小时，日夜缓慢流转<br>
      <h4>战斗与成长</h4>
      采集、合成、攻击、击杀都会获得经验，升级获得技能点 [K]。<br>
      智力/力量/灵活/感知各有限时专属技能，钢级配方需要【智力·蓝图】解锁。<br>
      弓箭需要箭矢，弩需要弩箭；僵尸掉落武器、弹药和食物。<br>
      口渴掉光会持续扣血——记得烧水！夜晚僵尸更多更强（前期有保护期，见生存流程）。
      <h4>装备与插件</h4>
      猎猪获得<b>皮革</b> → 合成头/身/腿/鞋护甲与<b>背包</b>（背包直接扩容格数）。<br>
      <b>双击</b>背包中的装备即可穿上；点击已装备的部位可脱下。<br>
      装备和武器都有<b>插件插槽</b>：先点击背包中的插件（标记待安装），再点装备插槽或武器格完成安装；<br>
      点击已装的插件卸下，<b>右键</b>背包中的带插件物品也可卸下最后一个插件。<br>
      武器插件：锋利/迅捷/暴击/瞄准；护甲插件：强化/轻羽；背包插件：扩容/掠夺。<br>
      插件在<b>熔炉</b>合成，僵尸有几率掉落；力量技能【行囊】也能扩大背包。
    `;
  }

  // ---------------- 面板开关 ----------------
  isAnyPanelOpen() {
    return [this.el.panelInv, this.el.panelPack, this.el.panelSkills, this.el.panelHelp, this.el.panelStation, this.el.panelMastery]
      .some(el => !el.classList.contains('hidden'));
  }

  // 面板互斥开关：同一时间只开一个面板（打开时关掉其他，避免叠加盖住导致点错）
  togglePanel(el) {
    const willOpen = el.classList.contains('hidden');
    if (willOpen) {
      [this.el.panelInv, this.el.panelPack, this.el.panelSkills, this.el.panelHelp, this.el.panelStation, this.el.panelMastery].forEach(p => {
        if (p !== el) p.classList.add('hidden');
      });
      this.stationPos = null;
      this.pendingPlugin = null;
      this.el.hotbar.style.display = '';
      this.game.input.releaseLock();
      el.classList.remove('hidden');
      if (el === this.el.panelInv) { this.updateInventoryPanel(); this.updateCraftPanel(); }
      if (el === this.el.panelPack) { this.updateBackpackPanel(); this.updateEquipPanel(); }
      if (el === this.el.panelSkills) { this.buildSkills(); }
      if (el === this.el.panelMastery) { this._mSig = null; this.updateMasteryPanel(); }   // M3
    } else {
      el.classList.add('hidden');
      this.pendingPlugin = null;
      if (!this.isAnyPanelOpen()) this.el.hotbar.style.display = '';
    }
  }

  closeAllPanels() {
    [this.el.panelInv, this.el.panelPack, this.el.panelSkills, this.el.panelHelp, this.el.panelStation, this.el.panelMastery].forEach(el => el.classList.add('hidden'));
    this.stationPos = null;
    this.el.hotbar.style.display = '';   // 关面板恢复快捷栏
  }

  // ---------------- M3：武器熟练度面板 ----------------
  updateMasteryPanel() {
    const g = this.game;
    if (!g.mastery) return;
    const rows = Object.entries(BOOKS).map(([cls, b]) => {
      const c = g.mastery.counts[cls] ?? 0;
      const u = g.mastery.unlocked(cls);
      const t = W_TIER[u.tier];
      return `<div class="mastery-row">`
        + `<span class="mr-book" style="color:${t.css}">${b.cn}</span>`
        + `<span class="mr-cnt">${c} / 51 本</span>`
        + `<span class="mr-unlock">已解锁：<b style="color:${t.css}">${t.name}${u.lvl} 级</b>${u.maxed ? '（满级）' : ''}</span>`
        + `</div>`;
    }).join('');
    if (rows === this._mSig) return;   // 签名缓存
    this._mSig = rows;
    this.el.masteryRows.innerHTML = rows;
  }

  // ---------------- 死亡 ----------------
  showDeath(reason) {
    const g = this.game;
    this.el.deathReason.textContent = `死因：${reason}`;
    this.el.deathStats.innerHTML =
      `最终等级 <b>Lv.${g.player.level}</b> · 击杀僵尸 <b>${g.stats.kills}</b> 只<br>` +
      `采集方块 <b>${g.stats.blocksMined}</b> 个 · 存活 <b>${g.day}</b> 天`;
    this.el.death.classList.remove('hidden');
    g.input.releaseLock();
  }
}
