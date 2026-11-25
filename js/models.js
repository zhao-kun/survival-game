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
export function buildHumanoid({ skin = 0xd9a066, shirt = 0x2e8b8b, pants = 0x35415e, scale = 1, facing = -1, armsForward = false, eyeColor } = {}) {
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
  // 躯干（g.torso 供职业外观定位/测试）
  g.torso = addBox(g, 0.52, 0.66, 0.28, shirt, 0, 1.08, 0);
  // 头（脖子 pivot y=1.42，供点头动画；g.headBox 皮肤盒引用）
  g.head = limb(0.36, 0.36, 0.36, skin, 0, 1.42, 0, 0.18);
  g.headBox = g.head.children[0];
  // 眼睛（挂在头 pivot 上，随头动；位于面向方向；eyeColor 供敌人职业/大级基调）
  const eyeZ = 0.19 * f;
  const eyeMat = eyeColor ?? (armsForward ? 0x111111 : 0x222222);
  addBox(g.head, 0.06, 0.06, 0.02, eyeMat, -0.08, 0.21, eyeZ);
  addBox(g.head, 0.06, 0.06, 0.02, eyeMat, 0.08, 0.21, eyeZ);
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

// ============================================================
// E2 敌人系统 v2：职业僵尸外观（docs/ENEMIES-DESIGN.md 4.3）
// 大级基调：皮肤/眼睛色（辐射发光用荧光皮肤色而非 emissive，避免与受击闪红冲突）
// ============================================================
export const TIER_SKIN = { 1: 0x4a9a4a, 2: 0x8a4a4a, 3: 0x7aff5a };
export const TIER_EYE = { 1: 0x111111, 2: 0xff3333, 3: 0xaaff66 };

// 职业外观：基础人形 + 职业配色/性别体型/标志物/手持道具
// 标志物挂 userData.tag（apron/skirt/hair/cross/tie/glasses/vest/hat/helmet/held），
// 汇总在 g.userData.jobTags —— 供辨识与测试断言；全部程序化无资产
export function buildZombieJob(job = 'common', tier = 1, scale = 1) {
  const skin = TIER_SKIN[tier] ?? TIER_SKIN[1];
  const eye = TIER_EYE[tier] ?? TIER_EYE[1];
  const female = job === 'housewife' || job === 'doctor';
  const bodyScale = scale * (female ? 0.95 : 1) * (job === 'lumberjack' ? 1.08 : job === 'soldier' ? 1.05 : 1);
  const STYLE = {
    common:     { shirt: 0x2a6f6f, pants: 0x3a3a6a },
    housewife:  { shirt: 0x8a3a4a, pants: 0x5a4a5a },
    doctor:     { shirt: 0xeeeeee, pants: 0xdddddd },   // 白大褂
    clerk:      { shirt: 0xf0f0f0, pants: 0x2a3a5a },   // 白衬衫+深蓝裤
    lumberjack: { shirt: 0xa83232, pants: 0x3a3a3a },   // 红格衬衫
    soldier:    { shirt: 0x4a5a3a, pants: 0x3e4a32 },   // 迷彩绿
  };
  const st = STYLE[job] ?? STYLE.common;
  const g = buildHumanoid({ skin, shirt: st.shirt, pants: st.pants, armsForward: true, facing: 1, scale: bodyScale, eyeColor: eye });
  const tags = [];
  const addTagged = (parent, tag, ...box) => { const m = addBox(parent, ...box); m.userData.tag = tag; tags.push(tag); return m; };
  // 女职业：长发 + 裙装（盖住大腿上段）
  if (female) {
    addTagged(g.head, 'hair', 0.40, 0.44, 0.10, 0x3a2a1a, 0, 0.16, -0.19);
    addTagged(g, 'skirt', 0.56, 0.32, 0.34, st.pants, 0, 0.72, 0);
  }
  if (job === 'housewife') {
    addTagged(g, 'apron', 0.42, 0.52, 0.03, 0xd88a9a, 0, 1.05, 0.155);          // 围裙
    addTagged(g.held, 'held', 0.05, 0.05, 0.42, 0x8a6236, 0, 0, -0.10);          // 锅铲柄
    addTagged(g.held, 'held', 0.20, 0.16, 0.03, 0x9a9a9a, 0, 0, -0.32);          // 铲板
  } else if (job === 'doctor') {
    addTagged(g, 'cross', 0.14, 0.14, 0.03, 0xcc3333, 0, 1.16, 0.155);           // 胸口红十字
    addTagged(g.held, 'held', 0.04, 0.04, 0.30, 0xbbccdd, 0, 0, -0.16);          // 注射器
  } else if (job === 'clerk') {
    addTagged(g, 'tie', 0.07, 0.30, 0.03, 0xaa2222, 0, 1.22, 0.155);             // 红领带
    addTagged(g.head, 'glasses', 0.30, 0.06, 0.02, 0x222222, 0, 0.21, 0.20);     // 黑框眼镜
    addTagged(g.held, 'held', 0.30, 0.22, 0.10, 0x6a4a2a, 0, 0, -0.05);          // 公文包
  } else if (job === 'lumberjack') {
    addTagged(g, 'vest', 0.50, 0.56, 0.03, 0xd97a2a, 0, 1.08, 0.15);             // 橙马甲
    addTagged(g.head, 'hat', 0.40, 0.12, 0.40, 0xd9c25a, 0, 0.40, 0);            // 护耳帽顶
    addTagged(g.head, 'hat', 0.06, 0.22, 0.36, 0xd9c25a, -0.20, 0.16, 0);        // 左护耳
    addTagged(g.head, 'hat', 0.06, 0.22, 0.36, 0xd9c25a, 0.20, 0.16, 0);         // 右护耳
    addTagged(g.held, 'held', 0.05, 0.05, 0.50, 0x8a6236, 0, 0, -0.10);          // 斧柄
    addTagged(g.held, 'held', 0.05, 0.16, 0.20, 0x9a9a9a, 0, 0.05, -0.34);       // 斧刃
  } else if (job === 'soldier') {
    addTagged(g, 'vest', 0.50, 0.52, 0.03, 0x2a2a2a, 0, 1.08, 0.155);            // 防弹背心前片
    addTagged(g, 'vest', 0.50, 0.52, 0.03, 0x2a2a2a, 0, 1.08, -0.155);           // 防弹背心后片
    addTagged(g.head, 'helmet', 0.40, 0.14, 0.40, 0x3a4a2a, 0, 0.38, 0);         // 头盔
    // 手持：辐射级步枪，其余级军刀
    if (tier >= 3) {
      addTagged(g.held, 'held', 0.06, 0.06, 0.50, 0x222222, 0, 0.02, -0.20);     // 枪管
      addTagged(g.held, 'held', 0.08, 0.12, 0.16, 0x3a3a3a, 0, -0.04, -0.05);    // 枪身
    } else {
      addTagged(g.held, 'held', 0.04, 0.11, 0.34, 0x8a8a8a, 0, 0.02, -0.30);     // 军刀
    }
  }
  g.userData.jobTags = tags;
  return g;
}
