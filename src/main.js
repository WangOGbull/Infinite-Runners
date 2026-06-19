import CONFIG from './config.js';
import AssetLoader from './assetLoader.js';
import { DragonManager } from './dragonManager.js';
import MovementSystem from './movementSystem.js';
import GrowthSystem from './growthSystem.js';
import CameraSystem from './cameraSystem.js';
import ArenaManager from './arenaManager.js';
import FoodSystem from './foodSystem.js';
import CollisionSystem from './collisionSystem.js';
import GameModeManager from './gameModeManager.js';
import UIManager from './uiManager.js';

// ==================== EVENT BUS ====================
class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const arr = this.listeners.get(event);
    const idx = arr.indexOf(callback);
    if (idx > -1) arr.splice(idx, 1);
  }
}

// ==================== AI CONTROLLER ====================
class AIController {
  constructor(arenaManager, foodSystem) {
    this.arena = arenaManager;
    this.food = foodSystem;
  }

  getInputAngle(dragon) {
    const head = dragon.head;
    let targetAngle = dragon.angle;

    // Find nearest food
    const foods = this.food.getFoods();
    let nearest = null;
    let nearestDist = Infinity;

    for (const food of foods) {
      const dx = food.x - head.x;
      const dy = food.y - head.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = food;
      }
    }

    if (nearest) {
      targetAngle = Math.atan2(nearest.y - head.y, nearest.x - head.x);
    }

    // Boundary avoidance
    const bounds = this.arena.getBounds();
    const margin = 150;
    let avoidAngle = null;

    if (head.x < bounds.minX + margin) avoidAngle = 0;
    else if (head.x > bounds.maxX - margin) avoidAngle = Math.PI;
    else if (head.y < bounds.minY + margin) avoidAngle = Math.PI / 2;
    else if (head.y > bounds.maxY - margin) avoidAngle = -Math.PI / 2;

    if (avoidAngle !== null) {
      // Blend toward center
      const centerAngle = Math.atan2(-head.y, -head.x);
      targetAngle = centerAngle;
    }

    // Add slight randomness
    targetAngle += (Math.random() - 0.5) * 0.3;

    return targetAngle;
  }
}

// ==================== MAIN GAME ====================
class Game {
  constructor() {
    this.eventBus = new EventBus();
    this.state = 'MENU'; // MENU, SELECT, MODE, MP_MENU, LOBBY, LOADING, PLAYING, PAUSED, GAME_OVER

    // Systems
    this.dragonManager = new DragonManager();
    this.movementSystem = new MovementSystem();
    this.growthSystem = new GrowthSystem(this.eventBus);
    this.cameraSystem = new CameraSystem(document.getElementById('gameCanvas'));
    this.arenaManager = new ArenaManager();
    this.foodSystem = new FoodSystem(this.eventBus);
    this.collisionSystem = new CollisionSystem(this.eventBus);
    this.gameModeManager = new GameModeManager();
    this.uiManager = new UIManager(this.eventBus);
    this.aiController = null;

    // Game state
    this.localDragon = null;
    this.gameStartTime = 0;
    this.gameTimer = 0;
    this.isPaused = false;
    this.lastTime = 0;
    this.animationFrame = null;

    // Firebase (initialized but not forced)
    this.firebaseApp = null;
    this.db = null;
    this.roomRef = null;
    this.isMultiplayer = false;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupFirebase();

    // Load assets
    this.uiManager.showScreen('loadingScreen');
    await AssetLoader.loadDragons();
    this.uiManager.buildDragonSelect(AssetLoader.getAllDragons());
    this.uiManager.showScreen('titleScreen');
  }

  setupFirebase() {
    try {
      const firebaseConfig = {
        apiKey: "AIzaSyCZExample",
        authDomain: "infinite-runners.firebaseapp.com",
        databaseURL: "https://infinite-runners-default-rtdb.firebaseio.com",
        projectId: "infinite-runners",
        storageBucket: "infinite-runners.appspot.com",
        messagingSenderId: "123456789",
        appId: "1:123456789:web:abcdef"
      };
      if (typeof firebase !== 'undefined') {
        this.firebaseApp = firebase.initializeApp(firebaseConfig);
        this.db = firebase.database();
      }
    } catch (e) {
      console.log('Firebase not available, running in local mode');
    }
  }

  setupEventListeners() {
    // UI Events
    this.eventBus.on('ui:showDragonSelect', () => {
      this.uiManager.showScreen('dragonSelectScreen');
    });

    this.eventBus.on('ui:dragonSelected', ({ name }) => {
      this.selectedDragon = name;
    });

    this.eventBus.on('ui:modeSelected', ({ mode }) => {
      this.selectedMode = mode;
      if (mode === 'multiplayer') {
        this.uiManager.showScreen('mpMenuScreen');
      } else {
        this.startLocalGame(mode);
      }
    });

    // Multiplayer events
    this.eventBus.on('mp:createRoom', () => this.createRoom());
    this.eventBus.on('mp:joinRoom', ({ code }) => this.joinRoom(code));
    this.eventBus.on('mp:leaveRoom', () => this.leaveRoom());
    this.eventBus.on('mp:startGame', () => this.startMpGame());

    // Game events
    this.eventBus.on('game:pause', () => this.pauseGame());
    this.eventBus.on('game:resume', () => this.resumeGame());
    this.eventBus.on('game:quit', () => this.quitGame());
    this.eventBus.on('game:restart', () => this.restartGame());

    // Collision events
    this.eventBus.on('collision:eat', ({ dragon, food }) => {
      this.growthSystem.onEat(dragon, food);
    });

    this.eventBus.on('collision:tail', ({ attacker, victim }) => {
      this.growthSystem.onCollisionTailCut(victim, 0.2);
    });

    this.eventBus.on('dragon:death', ({ dragon, killer }) => {
      if (dragon === this.localDragon) {
        this.endGame();
      }
    });

    // Wallet
    this.eventBus.on('wallet:connect', ({ wallet }) => {
      console.log('Wallet connect:', wallet);
    });
  }

  // ==================== LOCAL GAME ====================
  startLocalGame(mode) {
    this.isMultiplayer = false;
    this.gameModeManager.setMode(mode);
    this.arenaManager.setMode(mode);

    const maxPlayers = this.gameModeManager.getMaxPlayers();
    const spawnPositions = this.arenaManager.getSpawnPositions(maxPlayers);

    this.dragonManager.clear();
    this.foodSystem.init(this.arenaManager.getBounds());
    this.aiController = new AIController(this.arenaManager, this.foodSystem);

    // Create local dragon
    const localSpawn = spawnPositions[0];
    this.localDragon = this.dragonManager.createDragon(
      this.selectedDragon || 'ignis',
      localSpawn.x,
      localSpawn.y
    );

    // Create AI opponents
    const aiNames = ['aegis', 'ignis', 'infinite', 'magnetron'];
    for (let i = 1; i < maxPlayers; i++) {
      const spawn = spawnPositions[i];
      const aiName = aiNames[i % aiNames.length];
      const teamId = this.gameModeManager.getTeamForPlayer(i);
      this.dragonManager.createDragon(aiName, spawn.x, spawn.y, teamId);
    }

    this.startGameLoop();
  }

  // ==================== MULTIPLAYER ====================
  createRoom() {
    if (!this.db) {
      alert('Multiplayer not available. Running in local mode.');
      this.uiManager.showScreen('modeSelectScreen');
      return;
    }

    this.roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    this.isHost = true;

    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    this.roomRef.set({
      host: 'local',
      mode: 'FFA',
      status: 'waiting',
      players: {
        local: { name: 'Player 1', dragon: this.selectedDragon || 'ignis', ready: true }
      }
    });

    this.uiManager.updateLobby(
      [{ name: 'Player 1', dragon: this.selectedDragon, isLocal: true }],
      4,
      this.roomCode,
      true
    );
    this.uiManager.showScreen('lobbyScreen');

    // Listen for changes
    this.roomRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      const players = Object.entries(data.players || {}).map(([id, p]) => ({
        ...p,
        isLocal: id === 'local'
      }));
      this.uiManager.updateLobby(players, 4, this.roomCode, this.isHost);
    });
  }

  joinRoom(code) {
    if (!this.db) {
      alert('Multiplayer not available.');
      return;
    }

    this.roomCode = code;
    this.isHost = false;
    this.roomRef = this.db.ref('rooms/' + code);

    this.roomRef.once('value').then(snapshot => {
      const data = snapshot.val();
      if (!data) {
        document.getElementById('mpJoinError').textContent = 'Room not found';
        return;
      }

      const playerCount = Object.keys(data.players || {}).length;
      if (playerCount >= 4) {
        document.getElementById('mpJoinError').textContent = 'Room is full';
        return;
      }

      this.roomRef.child('players').push({
        name: 'Player ' + (playerCount + 1),
        dragon: this.selectedDragon || 'ignis',
        ready: true
      });

      this.uiManager.showScreen('lobbyScreen');
    });
  }

  leaveRoom() {
    if (this.roomRef) {
      this.roomRef.off();
      if (this.isHost) {
        this.roomRef.remove();
      }
      this.roomRef = null;
    }
    this.isHost = false;
    this.roomCode = '';
  }

  startMpGame() {
    if (this.roomRef) {
      this.roomRef.update({ status: 'playing' });
    }
    this.isMultiplayer = true;
    this.startLocalGame('FFA'); // Simplified for now
  }

  // ==================== GAME LOOP ====================
  startGameLoop() {
    this.state = 'PLAYING';
    this.isPaused = false;
    this.gameStartTime = Date.now();
    this.uiManager.showScreen('gameScreen');
    this.uiManager.showCountdown(3, () => {
      this.lastTime = performance.now();
      this.loop();
    });
  }

  loop() {
    if (this.state !== 'PLAYING') return;

    const now = performance.now();
    let deltaTime = now - this.lastTime;
    this.lastTime = now;

    // Cap delta time to prevent spiral
    if (deltaTime > CONFIG.MAX_DELTA_TIME) deltaTime = CONFIG.MAX_DELTA_TIME;

    if (!this.isPaused) {
      this.update(deltaTime);
      this.render();
    }

    this.animationFrame = requestAnimationFrame(() => this.loop());
  }

  update(deltaTime) {
    // Update timer
    this.gameTimer = Date.now() - this.gameStartTime;
    const minutes = Math.floor(this.gameTimer / 60000);
    const seconds = Math.floor((this.gameTimer % 60000) / 1000);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Update food
    this.foodSystem.update(deltaTime);

    // Build input map for AI
    const inputMap = new Map();
    for (const dragon of this.dragonManager.getLivingDragons()) {
      if (dragon === this.localDragon) {
        // Local player input handled by MovementSystem
      } else {
        // AI input
        inputMap.set(dragon.id, this.aiController.getInputAngle(dragon));
      }
    }

    // Update movement
    this.movementSystem.update(this.dragonManager, this.cameraSystem, deltaTime);

    // Apply AI inputs (override for AI dragons)
    for (const dragon of this.dragonManager.getLivingDragons()) {
      if (dragon !== this.localDragon && inputMap.has(dragon.id)) {
        dragon.update(deltaTime, inputMap.get(dragon.id));
      }
    }

    // Update camera
    this.cameraSystem.update(this.localDragon, this.arenaManager);

    // Check collisions
    this.collisionSystem.checkAll(this.dragonManager, this.foodSystem, this.arenaManager);

    // Check win condition
    const result = this.gameModeManager.checkWinCondition(this.dragonManager.getAllDragons());
    if (result && result.winner) {
      this.endGame();
      return;
    }

    // Update HUD
    const score = this.localDragon ? this.localDragon.score : 0;
    const collected = this.localDragon ? this.localDragon.collected : 0;
    this.uiManager.updateHUD(score, timeStr);

    // Update minimap
    const minimap = document.getElementById('minimapCanvas');
    if (minimap) {
      this.uiManager.renderMinimap(
        minimap,
        this.cameraSystem,
        this.arenaManager,
        this.dragonManager.getAllDragons(),
        this.foodSystem.getFoods()
      );
    }
  }

  render() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // Resize canvas
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.cameraSystem.canvas = canvas;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply camera transform
    this.cameraSystem.apply(ctx);

    // Render arena
    this.arenaManager.render(ctx, this.cameraSystem);

    // Render food
    this.foodSystem.render(ctx, this.cameraSystem);

    // Render dragons
    this.dragonManager.render(ctx, this.cameraSystem);

    // Reset transform for UI
    this.cameraSystem.reset(ctx);
  }

  pauseGame() {
    this.isPaused = true;
    this.uiManager.showPauseOverlay(true);
  }

  resumeGame() {
    this.isPaused = false;
    this.uiManager.showPauseOverlay(false);
    this.lastTime = performance.now();
  }

  endGame() {
    this.state = 'GAME_OVER';
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    const stats = {
      time: document.getElementById('timerDisplay').textContent,
      collected: this.localDragon ? this.localDragon.collected : 0,
      kills: this.localDragon ? this.localDragon.kills : 0
    };

    this.uiManager.updateGameOver(stats);
    this.uiManager.showScreen('gameOverScreen');
  }

  restartGame() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.startLocalGame(this.selectedMode || 'FFA');
  }

  quitGame() {
    this.state = 'MENU';
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.dragonManager.clear();
    this.isPaused = false;
  }
}

// ==================== BOOT ====================
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
