// ============================================================
// textures.js —— 程序化生成方块贴图（Canvas 像素风）
// 篝火与熔炉刻意拉开差异：篝火 = 矮块 + 石圈火堆 + 自发光；
// 熔炉 = 整块深灰石砖 + 大炉口（侧面）+ 石砖顶盖。
// ============================================================
import * as THREE from 'three';
import { BLOCKS } from './config.js';

const materialCache = new Map();

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
function shade(rgb, f) {
  return `rgb(${Math.min(255, rgb[0] * f) | 0},${Math.min(255, rgb[1] * f) | 0},${Math.min(255, rgb[2] * f) | 0})`;
}
const R = (a, b) => a + Math.random() * (b - a);

function mkCanvas(S = 32) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  return cv;
}
function texFromCanvas(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 灰石噪声底（篝火石圈 / 熔炉石砖共用基调）
function paintStone(ctx, S, base = 118, jitter = 26) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = (base + R(-jitter, jitter)) | 0;
    ctx.fillStyle = `rgb(${v},${v},${v + 3})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

// 三层锥形火焰（外橙 → 中黄 → 焰心白）
function paintFlame(ctx, cx, baseY, w, h) {
  const layer = (color, lw, lh) => {
    ctx.fillStyle = color;
    for (let i = 0; i < lh; i++) {
      const ww = Math.max(1, Math.round(lw * (1 - i / lh)));
      ctx.fillRect((cx - ww / 2) | 0, (baseY - i) | 0, ww, 1);
    }
  };
  layer('#ff7b1e', w, h);          // 外焰
  layer('#ffd54a', w * 0.58, h * 0.68);   // 内焰
  layer('#fff3b0', w * 0.3, h * 0.36);    // 焰心
}

// ---- 篝火：侧面（石圈底座 + 交叉木柴 + 火焰） ----
function drawCampfireSide() {
  const S = 32, cv = mkCanvas(S), ctx = cv.getContext('2d');
  paintStone(ctx, S);                                    // 整体石圈基调
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {   // 上半压暗（夜色里的坑口）
    if (y < 14) { ctx.fillStyle = 'rgba(20,16,12,0.55)'; ctx.fillRect(x, y, 1, 1); }
  }
  ctx.fillStyle = '#4a2f16';                             // 交叉木柴
  for (let t = 0; t <= 1; t += 0.04) {
    ctx.fillRect((2 + 26 * t) | 0, (21 - 4 * t) | 0, 3, 3);    // 左低右高
    ctx.fillRect((2 + 26 * t) | 0, (13 + 4 * t) | 0, 3, 3);    // 左高右低
  }
  paintFlame(ctx, 16, 20, 18, 17);                       // 中央大火
  return cv;
}

// ---- 篝火：顶面（石圈环 + 炭火坑） ----
function drawCampfireTop() {
  const S = 32, cv = mkCanvas(S), ctx = cv.getContext('2d');
  paintStone(ctx, S);                                    // 外圈石头
  ctx.fillStyle = '#241d16';                             // 中央炭坑
  ctx.fillRect(5, 5, 22, 22);
  ctx.fillStyle = '#3a2c1a';                             // 烧焦的木柴（放射状）
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1]]) {
    for (let r = 3; r <= 10; r++) ctx.fillRect(16 + dx * r - 1, 16 + dy * r - 1, 3, 3);
  }
  for (let i = 0; i < 26; i++) {                         // 炭火余烬
    ctx.fillStyle = Math.random() < 0.5 ? '#ff5a1e' : '#ff9d2e';
    ctx.fillRect((7 + R(0, 18)) | 0, (7 + R(0, 18)) | 0, 2, 2);
  }
  paintFlame(ctx, 16, 15, 8, 9);                         // 坑心小火苗
  return cv;
}

// ---- 熔炉：侧面（深灰石砖 + 大炉口 + 加热指示缝） ----
function drawFurnaceSide() {
  const S = 32, cv = mkCanvas(S), ctx = cv.getContext('2d');
  paintStone(ctx, S, 86, 20);                            // 深灰基调
  ctx.fillStyle = 'rgba(0,0,0,0.45)';                    // 石砖横缝 + 错位竖缝
  for (let y = 0; y < S; y += 10) ctx.fillRect(0, y, S, 1);
  for (let row = 0; row < 3; row++) {
    const off = row % 2 ? 8 : 20;
    for (let y = row * 10; y < row * 10 + 10; y++) ctx.fillRect(off, y, 1, 1);
  }
  ctx.fillStyle = '#ff8c1e';                             // 顶部加热指示条
  ctx.fillRect(6, 2, 20, 2);
  ctx.fillStyle = '#101010';                             // 大炉口（黑色拱形）
  ctx.fillRect(7, 12, 18, 18);
  ctx.fillRect(9, 10, 14, 2);
  ctx.fillStyle = '#ff7b1e';                             // 口内火光
  ctx.fillRect(9, 22, 14, 7);
  ctx.fillStyle = '#ffd54a';
  ctx.fillRect(12, 25, 8, 4);
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(14, 27, 4, 2);
  for (let i = 0; i < 10; i++) {                         // 火光向上舔舐
    ctx.fillStyle = Math.random() < 0.5 ? '#ff7b1e' : '#ff9d2e';
    ctx.fillRect((10 + R(0, 12)) | 0, (16 + R(0, 5)) | 0, 2, 2);
  }
  return cv;
}

// ---- 熔炉：顶/底面（纯石砖，无炉口） ----
function drawFurnaceTop() {
  const S = 32, cv = mkCanvas(S), ctx = cv.getContext('2d');
  paintStone(ctx, S, 86, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < S; y += 10) ctx.fillRect(0, y, S, 1);
  for (let row = 0; row < 3; row++) {
    const off = row % 2 ? 8 : 20;
    for (let y = row * 10; y < row * 10 + 10; y++) ctx.fillRect(off, y, 1, 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)';                     // 中心烟道口
  ctx.fillRect(12, 12, 8, 8);
  return cv;
}

function makeCanvasTexture(meta) {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rgb = hexToRgb(meta.color ?? 0x888888);

  const px = (x, y, f) => { ctx.fillStyle = shade(rgb, f); ctx.fillRect(x, y, 1, 1); };

  switch (meta.texture) {
    case 'grass': {
      ctx.fillStyle = shade(rgb, 1); ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.75 + Math.random() * 0.5);
      for (let x = 0; x < S; x++) if (Math.random() < 0.3) px(x, S - 1 - ((Math.random() * 3) | 0), 0.6);
      break;
    }
    case 'noise': {
      ctx.fillStyle = shade(rgb, 1); ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 320; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.72 + Math.random() * 0.55);
      break;
    }
    case 'log': {
      for (let x = 0; x < S; x++) {
        const f = 0.8 + 0.35 * Math.abs(Math.sin(x * 0.9 + 1));
        ctx.fillStyle = shade(rgb, f); ctx.fillRect(x, 0, 1, S);
      }
      for (let i = 0; i < 90; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.65 + Math.random() * 0.6);
      break;
    }
    case 'planks': {
      ctx.fillStyle = shade(rgb, 1); ctx.fillRect(0, 0, S, S);
      for (let y = 0; y < S; y++) {
        if (y % 8 === 0) { ctx.fillStyle = shade(rgb, 0.55); ctx.fillRect(0, y, S, 1); }
      }
      for (let i = 0; i < 200; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.8 + Math.random() * 0.4);
      break;
    }
    case 'leaves': {
      ctx.clearRect(0, 0, S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (Math.random() < 0.82) px(x, y, 0.7 + Math.random() * 0.6);
      }
      break;
    }
    case 'water': {
      ctx.fillStyle = shade(rgb, 1); ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 60; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 1.05 + Math.random() * 0.25);
      break;
    }
    case 'ore_iron': case 'ore_coal': {
      ctx.fillStyle = shade(rgb, 1); ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 220; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.75 + Math.random() * 0.5);
      const spot = meta.texture === 'ore_iron' ? '#d9a066' : '#181818';
      for (let i = 0; i < 7; i++) {
        const x = (Math.random() * (S - 5)) | 0, y = (Math.random() * (S - 5)) | 0;
        ctx.fillStyle = spot;
        ctx.fillRect(x, y, 3 + (Math.random() * 2 | 0), 3);
      }
      break;
    }
    case 'glass': {
      ctx.fillStyle = 'rgba(190,227,239,0.35)'; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(5, 5, 8, 2);
      break;
    }
    case 'workbench': {
      // 木板底台 + 深色台面边框 + 对角工具图案（锯/锤），一眼可辨
      ctx.fillStyle = shade(rgb, 0.9); ctx.fillRect(0, 0, S, S);
      for (let y = 0; y < S; y++) if (y % 8 === 0) { ctx.fillStyle = shade(rgb, 0.55); ctx.fillRect(0, y, S, 1); }
      ctx.fillStyle = shade(rgb, 0.45); ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, S - 3, S, 3);
      ctx.fillStyle = '#8d8d8d';   // 锤头
      ctx.fillRect(8, 8, 8, 5); ctx.fillStyle = '#9c6b3c'; ctx.fillRect(11, 13, 2, 8);
      ctx.fillStyle = '#c8cdd6';   // 锯刃
      ctx.save(); ctx.translate(20, 16); ctx.rotate(Math.PI / 4); ctx.fillRect(0, 0, 12, 2); ctx.restore();
      for (let i = 0; i < 80; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.8 + Math.random() * 0.4);
      break;
    }
    default: {
      ctx.fillStyle = shade(rgb, 1); ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 200; i++) px((Math.random() * S) | 0, (Math.random() * S) | 0, 0.8 + Math.random() * 0.4);
    }
  }

  return texFromCanvas(cv);
}

// 篝火材质组：BoxGeometry 面序 [+x,-x,+y,-y,+z,-z]，整体自发光（夜里一眼可辨）
function makeCampfireMaterials() {
  const side = texFromCanvas(drawCampfireSide());
  const top = texFromCanvas(drawCampfireTop());
  const bottom = texFromCanvas(drawFurnaceTop());        // 底面看不见，复用石砖
  const glow = { emissive: new THREE.Color(0xff8c1e), emissiveIntensity: 0.5 };
  const sideM = new THREE.MeshLambertMaterial({ map: side, ...glow });
  const topM = new THREE.MeshLambertMaterial({ map: top, ...glow });
  const botM = new THREE.MeshLambertMaterial({ map: bottom });
  return [sideM, sideM, topM, botM, sideM, sideM];
}

// 熔炉材质组：侧面带炉口，顶/底纯石砖，不发光（和篝火拉开）
function makeFurnaceMaterials() {
  const side = texFromCanvas(drawFurnaceSide());
  const top = texFromCanvas(drawFurnaceTop());
  const sideM = new THREE.MeshLambertMaterial({ map: side });
  const topM = new THREE.MeshLambertMaterial({ map: top });
  return [sideM, sideM, topM, topM, sideM, sideM];
}

// 获取某方块的共享材质（篝火/熔炉为 6 面材质数组）
export function getBlockMaterial(blockId) {
  if (materialCache.has(blockId)) return materialCache.get(blockId);
  const meta = BLOCKS[blockId];
  let mat;
  if (blockId === 12 /* CAMPFIRE */) mat = makeCampfireMaterials();
  else if (blockId === 13 /* FURNACE */) mat = makeFurnaceMaterials();
  else {
    const params = { map: makeCanvasTexture(meta) };
    if (blockId === 11 /* WATER */) { params.transparent = true; params.opacity = 0.72; }
    else if (blockId === 7 /* LEAVES */) { params.transparent = true; params.alphaTest = 0.4; }
    else if (blockId === 14 /* GLASS */) { params.transparent = true; params.opacity = 0.55; }
    mat = new THREE.MeshLambertMaterial(params);
  }
  materialCache.set(blockId, mat);
  return mat;
}
