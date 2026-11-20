// ============================================================
// world.js —— 体素世界：地形生成 / 区块渲染 / 射线检测 / 碰撞
// ============================================================
import * as THREE from 'three';
import { BLOCK, BLOCKS, WORLD } from './config.js';
import { Noise, keyOf, clamp, hash2 } from './utils.js';
import { getBlockMaterial } from './textures.js';

const SHARED_GEO = new THREE.BoxGeometry(1, 1, 1);
const CAMPFIRE_GEO = new THREE.BoxGeometry(0.86, 0.55, 0.86);   // 篝火矮块，与熔炉拉开形状差异
const EPS = 1e-4;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.blocks = new Map();        // "x,y,z" -> blockId（逻辑数据）
    this.chunkData = new Map();     // "cx,cz" -> Map("x,y,z" -> id)（渲染数据）
    this.chunkMeshes = new Map();   // "cx,cz" -> InstancedMesh[]
    this.dirty = new Set();         // 待重建区块
    this.modified = new Set();      // 玩家修改过的方块 key（存档用：只存 diff）
    this.group = new THREE.Group();
    scene.add(this.group);
    this.generate();
  }

  // ---------------- 基础查询 ----------------
  inBounds(x, y, z) {
    return x >= 0 && x < WORLD.SIZE && y >= 0 && y < WORLD.HEIGHT && z >= 0 && z < WORLD.SIZE;
  }
  getBlock(x, y, z) {
    if (!this.inBounds(x, y, z)) return BLOCK.AIR;
    return this.blocks.get(keyOf(x, y, z)) ?? BLOCK.AIR;
  }
  isSolid(x, y, z) {
    const meta = BLOCKS[this.getBlock(x, y, z)];
    return !!(meta && meta.solid);
  }
  chunkKey(x, z) { return Math.floor(x / WORLD.CHUNK) + ',' + Math.floor(z / WORLD.CHUNK); }

  // ---------------- 修改方块 ----------------
  setBlock(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    const k = keyOf(x, y, z);
    const old = this.blocks.get(k) ?? BLOCK.AIR;
    if (old === id) return;
    this.blocks.set(k, id);
    this.modified.add(k);

    const ck = this.chunkKey(x, z);
    let data = this.chunkData.get(ck);
    if (!data) { data = new Map(); this.chunkData.set(ck, data); }
    if (id === BLOCK.AIR) data.delete(k); else data.set(k, id);

    // 标记脏区块（含相邻，保证边界面更新）
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      this.dirty.add(this.chunkKey(x + dx, z + dz));
    }
  }

  // ---------------- 地形生成 ----------------
  generate() {
    const noise = new Noise(WORLD.SEED);
    const noiseTree = new Noise(WORLD.SEED + 91);
    const S = WORLD.SIZE, H = WORLD.HEIGHT;

    for (let x = 0; x < S; x++) {
      for (let z = 0; z < S; z++) {
        const e = noise.fbm(x * 0.045, z * 0.045, 4);
        let h = Math.floor(4 + e * 11);                 // 地表高度 4~14
        h = clamp(h, 3, 13);
        const beach = h <= WORLD.WATER_LEVEL + 1;       // 水边沙滩

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = BLOCK.BEDROCK;
          else if (y <= h - 3) {
            // 石层 + 矿物
            const r = hash2(x * 31 + y * 7, z * 17 + y * 3, WORLD.SEED + 5);
            id = r < 0.013 ? BLOCK.IRON_ORE : r < 0.042 ? BLOCK.COAL_ORE : BLOCK.STONE;
          } else if (y < h) id = beach ? BLOCK.SAND : BLOCK.DIRT;
          else id = beach ? BLOCK.SAND : BLOCK.GRASS;
          this.blocks.set(keyOf(x, y, z), id);
        }
        // 水体
        if (h < WORLD.WATER_LEVEL) {
          for (let y = h + 1; y <= WORLD.WATER_LEVEL; y++) {
            this.blocks.set(keyOf(x, y, z), BLOCK.WATER);
          }
        }
      }
    }

    // 树木
    for (let x = 3; x < S - 3; x++) {
      for (let z = 3; z < S - 3; z++) {
        if (hash2(x, z, WORLD.SEED + 91) > 0.018) continue;
        const y = this.surfaceY(x, z) - 1;
        if (this.getBlock(x, y, z) !== BLOCK.GRASS) continue;
        const th = 4 + (hash2(x, z, WORLD.SEED + 7) * 2 | 0);
        for (let i = 1; i <= th; i++) this.blocks.set(keyOf(x, y + i, z), BLOCK.LOG);
        const top = y + th;
        for (let dy = -1; dy <= 1; dy++) {
          const r = dy === 1 ? 1 : 2;
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== 1) continue;
            const ly = top + dy, lx = x + dx, lz = z + dz;
            if (this.getBlock(lx, ly, lz) === BLOCK.AIR) this.blocks.set(keyOf(lx, ly, lz), BLOCK.LEAVES);
          }
        }
      }
    }

    // 构建 chunkData & 标记全部脏
    for (const [k, id] of this.blocks) {
      if (id === BLOCK.AIR) continue;
      const [x, y, z] = k.split(',').map(Number);
      const ck = this.chunkKey(x, z);
      let data = this.chunkData.get(ck);
      if (!data) { data = new Map(); this.chunkData.set(ck, data); }
      data.set(k, id);
    }
    for (const ck of this.chunkData.keys()) this.dirty.add(ck);
  }

  // ---------------- 区块网格重建 ----------------
  rebuildDirty() {
    if (this.dirty.size === 0) return;
    for (const ck of this.dirty) this.rebuildChunk(ck);
    this.dirty.clear();
  }

  rebuildChunk(ck) {
    const old = this.chunkMeshes.get(ck);
    if (old) { for (const m of old) { this.group.remove(m); m.dispose(); } }
    this.chunkMeshes.delete(ck);

    const data = this.chunkData.get(ck);
    if (!data || data.size === 0) return;

    const byId = new Map();
    for (const [k, id] of data) {
      const [x, y, z] = k.split(',').map(Number);
      // 仅渲染暴露面方块（六邻皆不透明则跳过）
      let exposed = false;
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const n = this.getBlock(x + dx, y + dy, z + dz);
        const nm = BLOCKS[n];
        if (n === BLOCK.AIR || (nm && nm.transparent)) { exposed = true; break; }
      }
      if (!exposed) continue;
      let arr = byId.get(id);
      if (!arr) { arr = []; byId.set(id, arr); }
      arr.push(x, y, z);
    }

    const dummy = new THREE.Object3D();
    const meshes = [];
    for (const [id, arr] of byId) {
      const count = arr.length / 3;
      const isCampfire = id === BLOCK.CAMPFIRE;
      const mesh = new THREE.InstancedMesh(isCampfire ? CAMPFIRE_GEO : SHARED_GEO, getBlockMaterial(id), count);
      for (let i = 0; i < count; i++) {
        const yC = isCampfire ? arr[i * 3 + 1] + 0.275 : arr[i * 3 + 1] + 0.5;   // 矮块贴地
        dummy.position.set(arr[i * 3] + 0.5, yC, arr[i * 3 + 2] + 0.5);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (BLOCKS[id]?.transparent) mesh.renderOrder = 1;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.chunkMeshes.set(ck, meshes);
  }

  // ---------------- 体素射线（DDA） ----------------
  raycast(origin, dir, maxDist = 5, includeWater = false) {
    const len = dir.length();
    if (len === 0) return null;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = d.x > 0 ? 1 : -1, stepY = d.y > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const tDeltaX = d.x !== 0 ? Math.abs(1 / d.x) : Infinity;
    const tDeltaY = d.y !== 0 ? Math.abs(1 / d.y) : Infinity;
    const tDeltaZ = d.z !== 0 ? Math.abs(1 / d.z) : Infinity;
    let tMaxX = d.x !== 0 ? (d.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDeltaX : Infinity;
    let tMaxY = d.y !== 0 ? (d.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDeltaY : Infinity;
    let tMaxZ = d.z !== 0 ? (d.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDeltaZ : Infinity;

    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 160; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== BLOCK.AIR) {
        const meta = BLOCKS[id];
        const hit = (meta.solid || meta.targetable) || (includeWater && id === BLOCK.WATER);
        if (hit) return { x, y, z, nx, ny, nz, dist: t, id };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
      else if (tMaxY < tMaxZ)             { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
      else                                { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      if (t > maxDist) return null;
    }
    return null;
  }

  // ---------------- AABB 碰撞移动 ----------------
  collidesBox(px, py, pz, half, height) {
    const x0 = Math.floor(px - half + EPS), x1 = Math.floor(px + half - EPS);
    const y0 = Math.floor(py + EPS),        y1 = Math.floor(py + height - EPS);
    const z0 = Math.floor(pz - half + EPS), z1 = Math.floor(pz + half - EPS);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (this.isSolid(x, y, z)) return true;
    return false;
  }

  // 逐轴移动并解算碰撞（自动子步进防穿透）。返回 { onGround, hitWall, landedSpeed }
  moveEntity(pos, vel, dt, half, height) {
    const maxMove = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxMove / 0.4));
    const sdt = dt / steps;
    const res = { onGround: false, hitWall: false, landedSpeed: 0 };
    for (let i = 0; i < steps; i++) {
      const r = this._moveStep(pos, vel, sdt, half, height);
      if (r.onGround) res.onGround = true;
      if (r.hitWall) res.hitWall = true;
      if (r.landedSpeed > res.landedSpeed) res.landedSpeed = r.landedSpeed;
    }
    return res;
  }

  _moveStep(pos, vel, dt, half, height) {
    const res = { onGround: false, hitWall: false, landedSpeed: 0 };
    // Y 轴
    pos.y += vel.y * dt;
    if (this.collidesBox(pos.x, pos.y, pos.z, half, height)) {
      if (vel.y < 0) {
        pos.y = Math.floor(pos.y + EPS) + 1;
        res.onGround = true;
        res.landedSpeed = -vel.y;
      } else {
        pos.y = Math.floor(pos.y + height - EPS) - height;
      }
      vel.y = 0;
    }
    // X 轴
    pos.x += vel.x * dt;
    if (this.collidesBox(pos.x, pos.y, pos.z, half, height)) {
      if (vel.x > 0) pos.x = Math.floor(pos.x + half - EPS) - half;
      else pos.x = Math.floor(pos.x - half + EPS) + 1 + half;
      vel.x = 0; res.hitWall = true;
    }
    // Z 轴
    pos.z += vel.z * dt;
    if (this.collidesBox(pos.x, pos.y, pos.z, half, height)) {
      if (vel.z > 0) pos.z = Math.floor(pos.z + half - EPS) - half;
      else pos.z = Math.floor(pos.z - half + EPS) + 1 + half;
      vel.z = 0; res.hitWall = true;
    }
    return res;
  }

  // ---------------- 工具方法 ----------------
  surfaceY(x, z) {   // 最高可站立位置（实心方块顶面 y）
    for (let y = WORLD.HEIGHT - 1; y >= 0; y--) {
      if (this.isSolid(x, y, z)) return y + 1;
    }
    return 1;
  }

  // 玩家附近是否有某功能方块（篝火/熔炉）
  nearBlock(pos, blockId, radius = 4) {
    const px = Math.floor(pos.x), py = Math.floor(pos.y + 0.9), pz = Math.floor(pos.z);
    for (let dx = -radius; dx <= radius; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -radius; dz <= radius; dz++)
          if (this.getBlock(px + dx, py + dy, pz + dz) === blockId) return true;
    return false;
  }
}
