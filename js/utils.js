// ============================================================
// utils.js —— 通用工具函数
// ============================================================

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function randRange(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function keyOf(x, y, z) { return x + ',' + y + ',' + z; }

// 整数格点哈希（0~1）
export function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// 平滑值噪声 + 分形叠加
export class Noise {
  constructor(seed) { this.seed = seed; }
  valueAt(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v00 = hash2(x0, y0, this.seed),     v10 = hash2(x0 + 1, y0, this.seed);
    const v01 = hash2(x0, y0 + 1, this.seed), v11 = hash2(x0 + 1, y0 + 1, this.seed);
    return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
  }
  fbm(x, y, oct = 4) {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += this.valueAt(x * f, y * f) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
}

// 可复现随机数
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
