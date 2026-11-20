// ============================================================
// input.js —— 键鼠输入（指针锁定 / 边沿检测）
// ============================================================
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.dx = 0; this.dy = 0;
    this.lmb = false; this.rmb = false;
    this.lmbPressed = false; this.rmbPressed = false;
    this.locked = false;
    this.handlers = new Map();   // code -> fn（仅按下沿触发）
    this.onWheel = null;
    this._skipFirstMove = false; // 锁定后忽略首次位移（避免视角跳变）

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      else if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      else if (e.button === 2) this.rmb = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        if (this._skipFirstMove) { this._skipFirstMove = false; return; }
        this.dx += e.movementX; this.dy += e.movementY;
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked && this.onWheel) this.onWheel(Math.sign(e.deltaY));
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const h = this.handlers.get(e.code);
      if (h) h(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this._skipFirstMove = this.locked;
      if (!this.locked) { this.lmb = this.rmb = false; this.keys.clear(); }
    });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* 忽略锁定失败（如浏览器冷却期） */ }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
  on(code, fn) { this.handlers.set(code, fn); }
  down(code) { return this.keys.has(code); }
  consumeMouse() {
    const d = { x: this.dx, y: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  }
  endFrame() { this.lmbPressed = false; this.rmbPressed = false; }
}
