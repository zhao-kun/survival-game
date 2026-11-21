// ============================================================
// main.js —— 游戏主入口：渲染 / 昼夜循环 / 状态机 / 系统装配
// ============================================================
import * as THREE from 'three';
import { WORLD, BLOCK } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Inventory } from './inventory.js';
import { SkillSystem, MasterySystem } from './skills.js';
import { Crafting } from './crafting.js';
import { EntityManager } from './entities.js';
import { Combat } from './combat.js';
import { Sfx } from './sfx.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { SaveManager } from './save.js';
import { StationManager } from './stations.js';

const SKY_DAY = new THREE.Color(0x87ceeb);
const SKY_NIGHT = new THREE.Color(0x0a0e1a);
const SKY_DUSK = new THREE.Color(0xe8956b);

class Game {
  constructor() {
    // ---- 渲染基础 ----
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color().copy(SKY_DAY);
    this.scene.fog = new THREE.Fog(0x87ceeb, 28, 90);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
    this.scene.add(this.camera);

    // ---- 光照 ----
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.0);
    this.scene.add(this.sun);

    // ---- 游戏状态 ----
    this.state = 'menu';
    this.elapsed = WORLD.DAY_LENGTH * 0.04;  // 从清晨开始
    this.timeOfDay = 0;
    this.day = 1;
    this.isNight = false;
    this.stats = { kills: 0, blocksMined: 0 };

    // ---- 世界与系统 ----
    this.world = new World(this.scene);
    this.skills = new SkillSystem();
    this.mastery = new MasterySystem();   // M3：武器熟练度（技能书）
    this.inventory = new Inventory();
    this.player = new Player(this, this.findSpawn());
    this.crafting = new Crafting(this);
    this.unlocked = new Set();   // 已学会的配方图纸（plan 组 id）
    this.stations = new StationManager(this);
    this.sfx = new Sfx(this);
    this.entities = new EntityManager(this);
    this.combat = new Combat(this);
    this.input = new Input(this.canvas);
    this.ui = new UI(this);
    this.ui.bindCraft();
    this.sfx.initUI();
    this.ui.updateHotbar();
    this.saves = new SaveManager(this);

    this.bindKeys();
    this.bindButtons();
    this.setupStartScreen();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.clock = new THREE.Clock();
  }

  // ---------------- 出生点 ----------------
  findSpawn() {
    const c = Math.floor(WORLD.SIZE / 2);
    for (let r = 0; r < 24; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = c + dx, z = c + dz;
          const y = this.world.surfaceY(x, z);
          if (this.world.getBlock(x, y - 1, z) === BLOCK.GRASS) {
            return new THREE.Vector3(x + 0.5, y, z + 0.5);
          }
        }
      }
    }
    return new THREE.Vector3(c + 0.5, this.world.surfaceY(c, c), c + 0.5);
  }

  // ---------------- 按键绑定 ----------------
  bindKeys() {
    const ui = this.ui;
    const toggleAndRelock = (panel) => {
      if (this.state !== 'playing') return;
      ui.togglePanel(panel);
      if (!ui.isAnyPanelOpen()) this.input.requestLock();
    };
    this.input.on('KeyE', () => toggleAndRelock(ui.el.panelInv));
    this.input.on('KeyB', () => toggleAndRelock(ui.el.panelPack));
    this.input.on('KeyK', () => toggleAndRelock(ui.el.panelSkills));
    this.input.on('KeyJ', () => toggleAndRelock(ui.el.panelMastery));   // M3：熟练度面板
    this.input.on('KeyH', () => toggleAndRelock(ui.el.panelHelp));
    this.input.on('KeyV', () => { if (this.state === 'playing') this.player.toggleCamera(); });
    this.input.on('KeyM', () => {
      const m = this.sfx.toggle();
      const btn = document.getElementById('btn-mute');
      if (btn) btn.textContent = m ? '🔇' : '🔊';
      this.ui.toast(m ? '🔇 音效已关闭' : '🔊 音效已开启', '#9dd0ff', 2);
    });
    this.input.on('Escape', () => ui.closeAllPanels());
    for (let i = 1; i <= 9; i++) {
      this.input.on('Digit' + i, () => this.ui.selectHotbar(i - 1));
    }
    this.input.onWheel = (dir) => {
      this.ui.selectHotbar(this.inventory.selected + dir);
    };
  }

  bindButtons() {
    document.getElementById('btn-start').addEventListener('click', () => this.startGame());
    document.getElementById('btn-restart').addEventListener('click', () => location.reload());
  }

  // ---------------- 开始界面：用户 ID 输入 + 历史存档选择 ----------------
  setupStartScreen() {
    const input = document.getElementById('user-id-input');
    const listEl = document.getElementById('saved-list');
    const btn = document.getElementById('btn-start');
    const refreshBtn = () => {
      const id = input.value.trim();
      const meta = id && this.saves.hasSave(id) ? this.saves.peek(id) : null;
      btn.textContent = meta ? `继续游戏 · ${id}（第 ${meta.day} 天）` : '开 始 游 戏';
    };
    input.addEventListener('input', refreshBtn);
    const saves = this.saves.list();
    if (saves.length) {
      for (const s of saves) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'saved-user';
        b.textContent = `👤 ${s.userId} · 第 ${s.day} 天`;
        b.addEventListener('click', () => { input.value = s.userId; refreshBtn(); });
        listEl.appendChild(b);
      }
    } else {
      listEl.innerHTML = '<span class="saved-empty">暂无历史存档，输入用户 ID 开始新游戏</span>';
    }
  }

  startGame() {
    const input = document.getElementById('user-id-input');
    const id = (input?.value ?? '').trim();
    if (!id) { this.ui.toast('请先输入用户 ID（用于保存进度）', '#ffd54a'); input?.focus(); return; }
    this.saves.setUserId(id);
    const hadSave = this.saves.hasSave(id);
    if (hadSave) this.saves.loadAndApply(id);
    this.state = 'playing';
    this.ui.el.start.classList.add('hidden');
    this.input.requestLock();
    if (hadSave) {
      setTimeout(() => this.ui.toast(`欢迎回来，${id}！进度已恢复（第 ${this.day} 天）`, '#b7ff5e'), 600);
    } else {
      setTimeout(() => this.ui.toast(`欢迎，${id}！徒手砍树获得原木，按 E 打开背包合成`, '#ffd54a'), 800);
      setTimeout(() => this.ui.toast('每 30 秒自动保存；注意口渴与饥饿，夜晚僵尸会成群出现！', '#ff9d5c'), 3400);
    }
  }

  gameOver(source) {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    // 生存硬核规则：死亡清除该用户存档
    if (this.saves.userId) { this.saves.remove(this.saves.userId); this.saves.userId = null; }
    const names = { zombie: '僵尸攻击' };
    this.ui.showDeath(`${names[source] ?? source} · 存档已清除`);
  }

  // ---------------- 昼夜循环 ----------------
  updateSky() {
    this.timeOfDay = (this.elapsed / WORLD.DAY_LENGTH) % 1;
    this.day = Math.floor(this.elapsed / WORLD.DAY_LENGTH) + 1;
    const sunAngle = this.timeOfDay * Math.PI * 2;
    const sunH = Math.sin(sunAngle);                     // 太阳高度
    this.isNight = sunH < -0.08;

    const dayF = Math.min(1, Math.max(0, (sunH + 0.15) / 0.3));
    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, dayF);
    const duskF = Math.max(0, 1 - Math.abs(sunH) / 0.22) * 0.45;
    sky.lerp(SKY_DUSK, duskF);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);

    const c = WORLD.SIZE / 2;
    this.sun.position.set(c + Math.cos(sunAngle) * 60, Math.sin(sunAngle) * 60, c + 20);
    this.sun.target.position.set(c, 8, c);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = 0.12 + Math.max(0, sunH) * 1.0;
    this.hemi.intensity = 0.22 + dayF * 0.62;
  }

  // ---------------- 主循环 ----------------
  loop = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.updateSky();

    if (this.state === 'playing') {
      this.player.heldGroup.visible = true;
      this.player.update(dt, this.input);
      this.entities.update(dt);
      this.combat.update(dt);
      this.crafting.update(dt);
      this.stations.update(dt);
      this.saves.update(dt);
      this.ui.update(dt);
    } else if (this.state === 'menu') {
      this.player.heldGroup.visible = false;
      // 菜单阶段环绕镜头
      const a = this.elapsed * 0.08;
      const c = WORLD.SIZE / 2;
      this.camera.position.set(c + Math.cos(a) * 42, 26, c + Math.sin(a) * 42);
      this.camera.lookAt(c, 8, c);
    }

    this.world.rebuildDirty();
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  };

  start() {
    this.renderer.setAnimationLoop(this.loop);
  }
}

const game = new Game();
window.game = game; // 调试用
game.start();
