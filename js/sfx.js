// ------------------------------------------------------------
// 程序化合成音效（零音频资产：全部用 Web Audio 振荡器 + 噪声实时生成）
// 约定：所有接线点用 g.sfx?.xxx() 可选调用——sfx 缺失/不支持时静默降级
// ------------------------------------------------------------
import { BLOCK } from './config.js';

// 同名音效最小重播间隔（秒）：挖掘/受击等连续触发的事件节流，防刷屏
const MIN_GAP = {
  dig: 0.22, break_: 0.05, place: 0.06, pickup: 0.08, drop: 0.12,
  hit: 0.14, hurt: 0.15, eat: 0.2, drink: 0.25, craft: 0, shoot: 0.08,
  splash: 0.3, ui: 0.06, crit: 0.14,
};

// 方块 → 材质（决定挖掘/破坏音色；combat.js 接线用）
export const MAT = {
  [BLOCK.STONE]: 'stone', [BLOCK.BEDROCK]: 'stone', [BLOCK.IRON_ORE]: 'stone',
  [BLOCK.COAL_ORE]: 'stone', [BLOCK.FURNACE]: 'stone',
  [BLOCK.LOG]: 'wood', [BLOCK.PLANK]: 'wood', [BLOCK.CAMPFIRE]: 'wood', [BLOCK.WORKBENCH]: 'wood',
  [BLOCK.GRASS]: 'dirt', [BLOCK.DIRT]: 'dirt', [BLOCK.SAND]: 'sand',
  [BLOCK.GLASS]: 'glass', [BLOCK.LEAVES]: 'leaf', [BLOCK.WATER]: 'water',
};

export class Sfx {
  constructor(game) {
    this.game = game;
    this.ctx = null;       // AudioContext 懒初始化（首次手势后恢复）
    this.master = null;    // 总线
    this.muted = false;
    this.last = {};        // 节流时间戳
    this._noiseBuf = null; // 白噪声缓存
  }

  // 懒初始化 + 自动播放策略解锁；不可用/静音时返回 null（调用方直接跳过）
  _ensure() {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;   // 总音量
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx.state === 'running' ? this.ctx : null;
    } catch { return null; }
  }

  // 白噪声 buffer（1 秒，循环使用）
  _noise() {
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    return src;
  }

  // 振荡器滑音：type 波形，f0→f1 频率，dur 时长，vol 音量，delay 延迟
  _tone(type, f0, f1, dur, vol, delay = 0) {
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // 滤波噪声脉冲：dur 时长，vol 音量，filter 类型/频率，delay 延迟
  _burst(dur, vol, filter, freq, q = 1, delay = 0) {
    const t0 = this.ctx.currentTime + delay;
    const src = this._noise();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // 节流入口：同名音效在 MIN_GAP 内不重复播放
  play(name, fn) {
    const now = performance.now() / 1000;
    if (now - (this.last[name] ?? -9) < (MIN_GAP[name] ?? 0)) return;
    const ctx = this._ensure();
    if (!ctx) return;
    this.last[name] = now;
    try { fn(); } catch { /* 单次播放失败不致命 */ }
  }

  // ---------------- 具体音效 ----------------
  dig(mat = 'stone') {   // 采集：按材质区分音色
    this.play('dig', () => {
      if (mat === 'stone') { this._burst(0.06, 0.5, 'lowpass', 900); this._tone('square', 160, 90, 0.06, 0.22); }
      else if (mat === 'wood') { this._tone('triangle', 240, 130, 0.07, 0.45); this._burst(0.04, 0.3, 'bandpass', 900); }
      else if (mat === 'sand') { this._burst(0.1, 0.42, 'lowpass', 480); }
      else if (mat === 'dirt') { this._burst(0.09, 0.4, 'lowpass', 620); }
      else if (mat === 'glass') { this._tone('sine', 1250, 880, 0.05, 0.3); }
      else if (mat === 'leaf') { this._burst(0.09, 0.32, 'bandpass', 2400, 2); }
      else { this._burst(0.08, 0.4, 'lowpass', 700); }
    });
  }

  break_(mat = 'stone') {   // 方块破坏：更响更长的碎裂
    this.play('break_', () => {
      if (mat === 'glass') { this._burst(0.2, 0.55, 'highpass', 2600, 2); this._tone('sine', 1800, 600, 0.15, 0.25); }
      else if (mat === 'wood') { this._burst(0.16, 0.6, 'lowpass', 1100); this._tone('square', 140, 60, 0.14, 0.3); }
      else { this._burst(0.18, 0.65, 'lowpass', 1400); this._tone('square', 120, 55, 0.15, 0.3); }
    });
  }

  place() {   // 放置方块：短笃
    this.play('place', () => { this._tone('square', 210, 120, 0.06, 0.38); this._burst(0.03, 0.2, 'lowpass', 800); });
  }

  pickup() {   // 拾取：清脆双音上行
    this.play('pickup', () => { this._tone('sine', 880, 900, 0.05, 0.32); this._tone('sine', 1320, 1350, 0.08, 0.32, 0.05); });
  }

  drop() {   // 掉落物生成/落地：低频扑通
    this.play('drop', () => { this._tone('sine', 230, 80, 0.12, 0.45); this._burst(0.05, 0.2, 'lowpass', 500); });
  }

  hit() {   // 攻击命中：闷击
    this.play('hit', () => { this._tone('square', 150, 70, 0.08, 0.45); this._burst(0.05, 0.38, 'lowpass', 700); });
  }

  crit() {   // 暴击：更高更亮
    this.play('crit', () => { this._tone('square', 260, 120, 0.1, 0.5); this._tone('sine', 1560, 1560, 0.09, 0.3, 0.03); this._burst(0.07, 0.45, 'lowpass', 900); });
  }

  decap() {   // 断头斩杀：低沉重斩 + 高频破空哨音（专属反馈，区别于通用暴击）
    this.play('decap', () => {
      this._tone('sawtooth', 110, 40, 0.22, 0.5);
      this._burst(0.12, 0.55, 'lowpass', 500);
      this._tone('sine', 2100, 400, 0.16, 0.3, 0.04);
    });
  }

  hurt() {   // 玩家受伤：下滑锯齿
    this.play('hurt', () => { this._tone('sawtooth', 320, 130, 0.18, 0.4); this._burst(0.1, 0.25, 'lowpass', 400); });
  }

  eat() {   // 进食：三段咀嚼
    this.play('eat', () => { this._burst(0.06, 0.4, 'lowpass', 900); this._burst(0.06, 0.35, 'lowpass', 750, 1, 0.09); this._burst(0.06, 0.3, 'lowpass', 600, 1, 0.18); });
  }

  drink() {   // 喝水：咕嘟两声
    this.play('drink', () => { this._tone('sine', 280, 500, 0.09, 0.3); this._tone('sine', 240, 460, 0.09, 0.3, 0.13); this._burst(0.12, 0.15, 'bandpass', 900, 3); });
  }

  splash() {   // 装水/入水：水花
    this.play('splash', () => { this._burst(0.22, 0.45, 'bandpass', 850, 2); this._tone('sine', 420, 180, 0.16, 0.2); });
  }

  craft() {   // 制作/合成完成：叮铃
    this.play('craft', () => { this._tone('sine', 660, 665, 0.08, 0.38); this._tone('sine', 990, 995, 0.12, 0.38, 0.08); });
  }

  shoot() {   // 弓弩发射：弦响
    this.play('shoot', () => { this._burst(0.07, 0.5, 'highpass', 1100); this._tone('square', 240, 90, 0.08, 0.25); });
  }

  ui() {   // UI 点击：轻嗒
    this.play('ui', () => { this._burst(0.025, 0.22, 'highpass', 2600); });
  }

  step() {   // 脚步：低频闷响（随机微变音高，避免机械重复感）
    this.play('step', () => {
      this._burst(0.07, 0.16, 'lowpass', 380 + Math.random() * 140, 1);
      this._tone('sine', 95 + Math.random() * 12, 62, 0.08, 0.18);
    });
  }

  jump() {   // 起跳：短促上扬气声
    this.play('jump', () => {
      this._tone('sine', 190, 330, 0.14, 0.14);
      this._burst(0.06, 0.08, 'highpass', 900, 1, 0.02);
    });
  }

  // ---------------- 静音开关 ----------------
  toggle() {
    this.muted = !this.muted;
    if (this.muted && this.master) { try { this.master.disconnect(); } catch { } }
    return this.muted;
  }

  // UI 接线：静音按钮 + 全局按钮点击嗒声
  initUI() {
    const btn = document.getElementById('btn-mute');
    if (btn) {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const m = this.toggle();
        btn.textContent = m ? '🔇' : '🔊';
        btn.title = m ? '音效已关闭（M 切换）' : '音效已开启（M 切换）';
      });
    }
    // 全局按钮点击嗒声（委托：按钮/配方格），排除静音按钮自身
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest?.('button') && !e.target.closest?.('#btn-mute')) this.ui();
    }, true);
  }
}
