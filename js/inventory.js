// ============================================================
// inventory.js —— 背包与快捷栏
// ============================================================
import { ITEMS } from './config.js';

export class Inventory {
  constructor(size = 36, hotbarSize = 9) {
    this.size = size;
    this.hotbarSize = hotbarSize;
    this.slots = new Array(size).fill(null); // {id, count} | null
    this.selected = 0;
    this.onChange = null;
  }

  maxStack(id) { return ITEMS[id]?.stack ?? 64; }

  // 调整背包容量；缩小时若目标范围外还有物品则失败返回 false
  resize(n) {
    n = Math.max(this.hotbarSize, n);
    if (n < this.slots.length) {
      for (let i = n; i < this.slots.length; i++) {
        if (this.slots[i]) return false;
      }
      this.slots.length = n;
    } else {
      while (this.slots.length < n) this.slots.push(null);
    }
    this.size = n;
    if (this.selected >= n) this.selected = 0;
    this._changed();
    return true;
  }

  freeCount() {
    let c = 0;
    for (const s of this.slots) if (!s) c++;
    return c;
  }

  // 背包区容量（不含物品栏）
  backpackSize() { return this.size - this.hotbarSize; }

  // 背包物品 → 物品栏：优先放入第一个空快捷栏位，否则与选中格交换
  moveToHotbar(idx) {
    if (idx < this.hotbarSize || !this.slots[idx]) return false;
    for (let i = 0; i < this.hotbarSize; i++) {
      if (!this.slots[i]) {
        this.slots[i] = this.slots[idx]; this.slots[idx] = null;
        this._changed(); return true;
      }
    }
    const b = this.selected;
    [this.slots[idx], this.slots[b]] = [this.slots[b], this.slots[idx]];
    this._changed();
    return true;
  }

  // 物品栏物品 → 背包：放入第一个空背包位
  moveToBackpack(idx) {
    if (idx >= this.hotbarSize || !this.slots[idx]) return false;
    for (let i = this.hotbarSize; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        this.slots[i] = this.slots[idx]; this.slots[idx] = null;
        this._changed(); return true;
      }
    }
    return false;
  }

  // 从指定槽位消耗 n 个（背包面板点击使用）
  consumeAt(idx, n = 1) {
    const s = this.slots[idx];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[idx] = null;
    this._changed();
  }

  // 放入一个完整物品实例（装备等），成功返回 true
  placeInstance(inst) {
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) { this.slots[i] = inst; this._changed(); return true; }
    }
    return false;
  }

  // 添加物品，返回未能放入的数量
  add(id, n = 1) {
    let left = n;
    const max = this.maxStack(id);
    // 先叠加
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max && !s.mods) {
        const put = Math.min(max - s.count, left);
        s.count += put; left -= put;
      }
    }
    // 再找空位（优先快捷栏）
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const put = Math.min(max, left);
        this.slots[i] = { id, count: put };
        left -= put;
      }
    }
    this._changed();
    return left;
  }

  // 移除 n 个，成功返回 true
  remove(id, n = 1) {
    if (this.countOf(id) < n) return false;
    let left = n;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, left);
        s.count -= take; left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this._changed();
    return true;
  }

  countOf(id) {
    let c = 0;
    for (const s of this.slots) if (s && s.id === id) c += s.count;
    return c;
  }

  has(id, n = 1) { return this.countOf(id) >= n; }

  selectedSlot() { return this.slots[this.selected]; }
  selectedId() { const s = this.selectedSlot(); return s ? s.id : null; }

  consumeSelected(n = 1) {
    const s = this.selectedSlot();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this._changed();
  }

  // 背包槽位与当前选中的快捷栏位交换
  swapWithHotbar(index) {
    const a = index, b = this.selected;
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this._changed();
  }

  _changed() { if (this.onChange) this.onChange(); }
}
