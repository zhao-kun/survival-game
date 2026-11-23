// ============================================================
// models.js —— 简易人形模型 / 手持物品模型构建
// ============================================================
import * as THREE from 'three';
import { ITEMS, TIER } from './config.js';

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

function addBox(parent, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * 构建人形模型
 * facing: -1 => 模型面向 -Z（玩家，配合相机 yaw）
 *          1 => 模型面向 +Z（僵尸，配合 atan2 转向）
 * armsForward: 僵尸式前伸手臂
 */
export function buildHumanoid({ skin = 0xd9a066, shirt = 0x2e8b8b, pants = 0x35415e, scale = 1, facing = -1, armsForward = false } = {}) {
  const g = new THREE.Group();
  const f = facing;
  // 四肢 pivot：绕肩/髋旋转（走路摆臂摆腿/跳跃/挥手动画）——引用挂在返回 group 上（g.armL 等）
  const limb = (w, h, d, color, px, py, pz, oy = 0, oz = 0) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    addBox(pivot, w, h, d, color, 0, oy, oz);   // 盒子相对 pivot 偏移，旋转时绕关节转
    g.add(pivot);
    return pivot;
  };
  // 腿（髋部 pivot y=0.75）
  g.legL = limb(0.22, 0.75, 0.22, pants, -0.13, 0.75, 0, -0.375);
  g.legR = limb(0.22, 0.75, 0.22, pants, 0.13, 0.75, 0, -0.375);
  // 躯干
  addBox(g, 0.52, 0.66, 0.28, shirt, 0, 1.08, 0);
  // 头（脖子 pivot y=1.42，供点头动画）
  g.head = limb(0.36, 0.36, 0.36, skin, 0, 1.42, 0, 0.18);
  // 眼睛（挂在头 pivot 上，随头动；位于面向方向）
  const eyeZ = 0.19 * f;
  addBox(g.head, 0.06, 0.06, 0.02, armsForward ? 0x111111 : 0x222222, -0.08, 0.21, eyeZ);
  addBox(g.head, 0.06, 0.06, 0.02, armsForward ? 0x111111 : 0x222222, 0.08, 0.21, eyeZ);
  // 手臂（肩部 pivot y=1.39）
  if (armsForward) {
    // 僵尸式前伸手臂：盒子相对肩 pivot 前偏
    g.armL = limb(0.16, 0.16, 0.55, shirt, -0.34, 1.39, 0, -0.17, 0.30 * f);
    g.armR = limb(0.16, 0.16, 0.55, shirt, 0.34, 1.39, 0, -0.17, 0.30 * f);
  } else {
    g.armL = limb(0.16, 0.58, 0.16, shirt, -0.35, 1.39, 0, -0.29);
    g.armR = limb(0.16, 0.58, 0.16, shirt, 0.35, 1.39, 0, -0.29);
  }
  // 手持物品挂点：挂在右臂 pivot 内（跟随摆臂/挥手自然摆动）——player.setHeldItem 往里放 buildHeldItem
  g.held = new THREE.Group();
  g.held.position.set(0, -0.58, -0.06);   // 右臂末端（手部），微前
  g.held.rotation.x = 0.55;               // 工具斜持，视觉自然
  g.armR.add(g.held);
  g.scale.setScalar(scale);
  return g;
}

// 手持物品的小模型（第一人称与第三人称共用）
export function buildHeldItem(itemId) {
  const g = new THREE.Group();
  if (!itemId) {
    // 徒手：肤色小方块代表手
    addBox(g, 0.16, 0.16, 0.28, 0xd9a066, 0, 0, 0);
    return g;
  }
  const it = ITEMS[itemId] ?? {};   // 未知 id 容错（坏存档/测试），渲染为默认灰块而不抛错打死帧循环
  const color = it.color ?? 0xaaaaaa;

  const handle = () => addBox(g, 0.05, 0.05, 0.5, 0x8a6236, 0, 0, -0.1);

  if (it.kind === 'melee' || it.kind === 'tool') {
    handle();
    const tierColor = it.color;
    if (it.icon === '锤') addBox(g, 0.24, 0.16, 0.14, tierColor, 0, 0, -0.32);
    else if (it.icon === '斧') { addBox(g, 0.05, 0.16, 0.2, tierColor, 0, 0.05, -0.34); }
    else if (it.icon === '铲') addBox(g, 0.14, 0.03, 0.18, tierColor, 0, -0.02, -0.36);
    else if (it.icon === '镐') { const head = addBox(g, 0.4, 0.05, 0.06, tierColor, 0, 0.06, -0.3); head.rotation.z = Math.PI / 2; head.rotation.y = Math.PI / 4; }
    else if (it.icon === '棍') { g.clear(); addBox(g, 0.09, 0.09, 0.72, tierColor, 0, 0, -0.2); }
    else if (it.icon === '刀') { addBox(g, 0.04, 0.11, 0.34, tierColor, 0, 0.02, -0.38); }
    else if (it.icon === '枪') { addBox(g, 0.05, 0.05, 0.18, tierColor, 0, 0.02, -0.44); addBox(g, 0.02, 0.14, 0.05, tierColor, 0, 0.09, -0.36); }   // M8：矛头+侧刃
  } else if (it.kind === 'ranged') {
    addBox(g, 0.04, 0.5, 0.05, color, 0, 0, -0.15);
    addBox(g, 0.03, 0.03, 0.5, 0xdddddd, 0, 0, -0.15);
  } else if (it.block != null) {
    addBox(g, 0.26, 0.26, 0.26, color, 0, 0, -0.1);
  } else {
    addBox(g, 0.18, 0.18, 0.18, color, 0, 0, -0.1);
  }
  return g;
}

// 掉落物 / 弹药的小方块
export function buildItemCube(itemId, size = 0.28) {
  const it = ITEMS[itemId];
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    mat(it?.color ?? 0xcccccc)
  );
  return m;
}

export const TIER_CSS = Object.fromEntries(Object.entries(TIER).map(([k, v]) => [k, v.css]));
