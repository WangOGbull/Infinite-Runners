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
import EffectsSystem from './effectsSystem.js';
import WalletManager from './walletManager.js';
import StakingManager from './stakingManager.js';
import AIController from './aiController.js';

const LOBBY_CONTEXT_KEY = 'mpLobbyContext';

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

// ==================== MAIN GAME ====================
class Game {
  constructor() {
    this.eventBus = new EventBus();
    this.state = 'MENU';

    this.dragonManager = new DragonManager();
    this.movementSystem = new MovementSystem();
    this.growthSystem = new GrowthSystem(this.eventBus);
    this.cameraSystem = new CameraSystem(document.getElementById('gameCanvas'));
    this.arenaManager = new ArenaManager();
    this.foodSystem = new FoodSystem(this.eventBus);
    this.collisionSystem = new CollisionSystem(this.eventBus);
    this.gameModeManager = new GameModeManager();
    this.uiManager = new UIManager(this.eventBus);
    this.effectsSystem = new EffectsSystem();
    this.walletManager = new WalletManager(this.eventBus);
    this.stakingManager = new StakingManager(this.eventBus, this.walletManager);
    this.aiController = null;

    this.localDragon = null;
    this.gameStartTime = 0;
    this.gameTimer = 0;
    this.isPaused = false;
    this.lastTime = 0;
    this.animationFrame = null;

    this.firebaseApp = null;
    this.db = null;
    this.roomRef = null;
    this.isMultiplayer = false;
    this.aiDifficulty = 'advanced';
    this.selectedMpMode = 'FFA';
    this.pendingArenaIndex = null;
    this.lobbyArenaIndex = 0;

    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };

    this.localPlayerId = null;
    this.playerIds = [];
    this.roomPlayers = {};
    this.remotePositions = {};
    this.positionsRef = null;
    this.lastBroadcast = 0;
    this.positionsListenerSet = false;

    this.assetsLoaded = false;

    // Match statistics
    this.matchStats = {};
    this.winner = null;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupFirebase();
    this.effectsSystem.init();

    this.uiManager.showScreen('titleScreen');

    this.stakingManager.getDisplayTiers()
      .then(tiers => this.uiManager.updateTierAmounts(tiers))
      .catch(err => console.warn('[Staking] Could not load tier amounts yet:', err.message));

    try {
      await AssetLoader.loadDragons();
      await this.arenaManager.preloadAll();
      this.uiManager.buildDragonSelect(AssetLoader.getAllDragons());
      this.assetsLoaded = true;
      console.log('[Assets] All dragon and arena assets loaded successfully');
    } catch (e) {
      console.error('Asset load failed:', e);
    }
  }

  setupFirebase() {
    try {
      const firebaseConfig = {
        apiKey: "AIzaSyAI0oDj8ZyjQzvdAWS-3CxbHCbJHU5R62s",
        authDomain: "infinite-runners-dragonsarena.firebaseapp.com",
        databaseURL: "https://infinite-runners-dragonsarena-default-rtdb.firebaseio.com",
        projectId: "infinite-runners-dragonsarena",
        storageBucket: "infinite-runners-dragonsarena.firebasestorage.app",
        messagingSenderId: "729310578893",
        appId: "1:729310578893:web:5a369465bb831f3cd8c184",
        measurementId: "G-K39Z0L2K2X"
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
    this.eventBus.on('ui:showDragonSelect', () => {
      this.uiManager.showScreen('dragonSelectScreen');
    });

    this.eventBus.on('ui:dragonSelected', ({ name }) => {
      this.selectedDragon = name;
    });

    this.eventBus.on('ui:arenaSelected', ({ mode, difficulty, arenaIndex }) => {
      this.pendingArenaIndex = arenaIndex;
      this.startLocalGame(mode, difficulty, arenaIndex);
    });

    this.eventBus.on('mp:createRoom', ({ mode }) => this.createRoom(mode));
    this.eventBus.on('mp:joinRoom', ({ code }) => this.joinRoom(code));
    this.eventBus.on('mp:leaveRoom', () => this.leaveRoom());
    this.eventBus.on('mp:startGame', () => this.startMpGame());

    this.eventBus.on('game:pause', () => this.pauseGame());
    this.eventBus.on('game:resume', () => this.resumeGame());
    this.eventBus.on('game:quit', () => this.quitGame());
    this.eventBus.on('game:restart', () => this.restartGame());

    this.eventBus.on('collision:eat', ({ dragon, food }) => {
      this.growthSystem.onEat(dragon, food);
      this.effectsSystem.spawnEatParticles(food.x, food.y, food.color);
      this.effectsSystem.playEatSound();
    });

    this.eventBus.on('collision:head-hit', ({ x, y }) => {
      this.effectsSystem.spawnImpactSparks(x, y, '#ffffff');
      this.effectsSystem.addShake(12, 250);
      this.effectsSystem.playHeadCollisionSound();
    });

    // NEW: Dragon shrink event (head-to-body collision, equal head collision)
    this.eventBus.on('dragon:shrink', ({ dragon, reason, other }) => {
      this.dragonManager.shrinkDragon(dragon);
      this.effectsSystem.spawnParticles(dragon.head.x, dragon.head.y, '#ffaa00', CONFIG.EFFECTS.SHRINK_PARTICLES || 15, CONFIG.EFFECTS.SHRINK_PARTICLE_SPEED || 4, CONFIG.EFFECTS.SHRINK_PARTICLE_LIFE || 500);
      this.effectsSystem.addShake(8, 200);
      this.effectsSystem.playTone(200, 'sawtooth', 0.3, 0.15);
    });

    // UPDATED: Dragon death with lives/respawn system
    this.eventBus.on('dragon:death', ({ dragon, killer }) => {
      dragon.deaths = (dragon.deaths || 0) + 1;
      dragon.lives = (dragon.lives || 0) - 1;

      const isLocal = dragon === this.localDragon;
      const deathColor = isLocal ? '#ff2222' : '#ff6600';
      this.effectsSystem.spawnDeathExplosion(dragon.head.x, dragon.head.y, deathColor);
      this.effectsSystem.addShake(isLocal ? 20 : 8, isLocal ? 500 : 300);
      this.effectsSystem.flashVignette(isLocal ? '#ff0000' : '#ff4400', isLocal ? 0.5 : 0.25, 400);
      this.effectsSystem.playDeathSound(isLocal);

      // Track killer stats
      if (killer && killer !== dragon) {
        killer.kills = (killer.kills || 0) + 1;
        const killerIsLocal = killer === this.localDragon;
        if (killerIsLocal) {
          this.effectsSystem.spawnKillSparkles(killer.head.x, killer.head.y, '#ffd700');
          this.effectsSystem.flashVignette('#ffd700', 0.35, 300);
          this.effectsSystem.playKillSound();
        }
      }

      // Drop food from dead dragon
      for (const seg of dragon.segments) {
        this.foodSystem.spawnFoodAt(seg.x, seg.y);
      }
      this.foodSystem.spawnFoodAt(dragon.head.x, dragon.head.y, true);

      // Check if dragon has lives remaining
      if (dragon.lives > 0) {
        // Respawn after delay
        dragon.alive = false;
        setTimeout(() => {
          if (this.state === 'PLAYING') {
            this.dragonManager.respawnDragon(dragon, this.arenaManager);
            this.effectsSystem.spawnParticles(dragon.head.x, dragon.head.y, '#00ff88', 10, 3, 400);
          }
        }, CONFIG.RESPAWN_DELAY_MS);
      } else {
        // Eliminated - no lives left
        dragon.alive = false;
        this.checkMatchEnd();
      }
    });

    this.eventBus.on('wallet:connectRequest', () => {
      this.walletManager.connect().catch(() => {});
    });

    this.eventBus.on('wallet:disconnectRequest', () => {
      this.walletManager.disconnect();
    });

    this.eventBus.on('wallet:refreshRequest', () => {
      this.walletManager.refreshBalance();
    });

    this.eventBus.on('wallet:signTestRequest', () => {
      this.walletManager.signTestMessage()
        .then(result => this.eventBus.emit('wallet:signTestResult', result))
        .catch(err => this.eventBus.emit('wallet:signTestError', {
          message: err?.message || 'Signing failed.'
        }));
    });

    this.eventBus.on('lobby:arenaSelected', ({ arenaIndex }) => {
      if (this.isHost && this.roomRef) {
        this.lobbyArenaIndex = arenaIndex;
        this.roomRef.child('arenaIndex').set(arenaIndex);
        this.uiManager.updateLobbyArena(arenaIndex, true);
      }
    });

    this.eventBus.on('lobby:tierSelected', ({ tier }) => {
      if (this.isHost && this.roomRef && !this.stakingState.hostDeposited) {
        this.lobbyTier = tier;
        this.roomRef.child('tier').set(tier);
        this._refreshStakingUI();
      }
    });

    this.eventBus.on('lobby:depositRequested', () => this.handleDeposit());

    this.eventBus.on('wallet:txConfirmed', ({ signature, pendingAction }) => {
      this._resumeStakingAction(pendingAction, signature);
    });
    this.eventBus.on('wallet:txError', ({ message, pendingAction }) => {
      this._restoreLobbyContextIfPresent();
      this.eventBus.emit('staking:error', { message: message || 'Staking transaction failed.' });
    });
  }

  checkMatchEnd() {
    const allDragons = this.dragonManager.getAllDragons();
    const withLives = allDragons.filter(d => d.lives > 0);

    // If only one dragon has lives left, they win
    if (withLives.length === 1 && allDragons.length > 1) {
      this.winner = withLives[0];
      this.endGame(true);
      return;
    }

    // If no one has lives left, it is a draw
    if (withLives.length === 0 && allDragons.length > 0) {
      this.winner = null;
      this.endGame(true);
      return;
    }

    // If local dragon is eliminated, check if match still ongoing
    if (this.localDragon && this.localDragon.lives <= 0 && !this.localDragon.alive) {
      const living = this.dragonManager.getLivingDragons();
      const othersAlive = living.filter(d => d !== this.localDragon);
      if (othersAlive.length === 0) {
        this.endGame(true);
      }
    }
  }

  _persistLobbyContext() {
    try {
      sessionStorage.setItem(LOBBY_CONTEXT_KEY, JSON.stringify({
        roomCode: this.roomCode,
        isHost: this.isHost,
        localPlayerId: this.localPlayerId,
        selectedDragon: this.selectedDragon,
        selectedMpMode: this.selectedMpMode,
        lobbyTier: this.lobbyTier,
      }));
    } catch (_) {}
  }

  _consumeLobbyContext() {
    try {
      const raw = sessionStorage.getItem(LOBBY_CONTEXT_KEY);
      sessionStorage.removeItem(LOBBY_CONTEXT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  _restoreLobbyContextIfPresent() {
    if (this.roomRef) return;
    const ctx = this._consumeLobbyContext();
    if (ctx && this.db) this._rejoinRoom(ctx);
  }

  _rejoinRoom(ctx) {
    this.roomCode = ctx.roomCode;
    this.isHost = ctx.isHost;
    this.localPlayerId = ctx.localPlayerId;
    this.selectedDragon = ctx.selectedDragon;
    this.selectedMpMode = ctx.selectedMpMode || this.selectedMpMode;
    this.lobbyTier = ctx.lobbyTier;
    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    this.uiManager.showScreen('lobbyScreen');
    this._attachRoomListener();
  }

  async _resumeStakingAction(pendingAction, signature) {
    if (!pendingAction) return;
    if (!this.roomRef) {
      const ctx = this._consumeLobbyContext();
      if (ctx && this.db) this._rejoinRoom(ctx);
    }
    if (pendingAction.type === 'createRoom') {
      await this._markDeposited('host', pendingAction.tier, signature);
    } else if (pendingAction.type === 'joinRoom') {
      await this._markDeposited('opponent', this.lobbyTier, signature);
    } else if (['mutualCancel', 'claimDepositTimeout', 'claimSettleTimeout'].includes(pendingAction.type)) {
      this.eventBus.emit('staking:confirmed', { label: 'Refund transaction confirmed on-chain.' });
    }
  }

  async handleDeposit() {
    if (!this.walletManager.connected) {
      this.eventBus.emit('staking:error', { message: 'Connect your wallet first.' });
      this.uiManager.showScreen('walletModal');
      return;
    }
    const roomIdNum = parseInt(this.roomCode, 10);
    if (!roomIdNum) {
      this.eventBus.emit('staking:error', { message: 'No active room to stake into.' });
      return;
    }
    this.eventBus.emit('staking:pending', { label: 'Waiting for wallet approval…' });
    try {
      if (this.isHost) {
        if (!this.lobbyTier) {
          this.eventBus.emit('staking:error', { message: 'Pick a stake tier first.' });
          return;
        }
        this._persistLobbyContext();
        const result = await this.stakingManager.createStakedRoom({ roomId: roomIdNum, tier: this.lobbyTier });
        if (result?.deepLinked) return;
        await this._markDeposited('host', this.lobbyTier, result.signature);
      } else {
        if (!this.lobbyTier) {
          this.eventBus.emit('staking:error', { message: 'Waiting for the host to lock in a tier.' });
          return;
        }
        this._persistLobbyContext();
        const result = await this.stakingManager.joinStakedRoom({ roomId: roomIdNum });
        if (result?.deepLinked) return;
        await this._markDeposited('opponent', this.lobbyTier, result.signature);
      }
    } catch (err) {
      console.error('[Staking] deposit failed:', err);
      this.eventBus.emit('staking:error', { message: err?.message || 'Deposit failed. Your funds were not moved.' });
    }
  }

  async _markDeposited(role, tier, signature) {
    if (!this.roomRef) return;
    const updates = {};
    // Stash the depositing wallet's own public key in Firebase so the backend
    // knows where to send a payout later - nothing wrote this before, and
    // settle_match cannot function without it.
    const myPubkey = this.walletManager.publicKey.toString();
    if (role === 'host') {
      updates.tier = tier;
      updates.hostPubkey = myPubkey;
      updates['staking/hostDeposited'] = true;
      updates['staking/hostTx'] = signature;
    } else {
      updates.opponentPubkey = myPubkey;
      updates['staking/opponentDeposited'] = true;
      updates['staking/opponentTx'] = signature;
    }
    await this.roomRef.update(updates);
    this._consumeLobbyContext();
    this.eventBus.emit('staking:confirmed', { label: `Deposit confirmed on-chain (tx ${String(signature).slice(0, 8)}…).` });
  }

  _refreshStakingUI() {
    const stakingApplies = this.selectedMpMode === '1v1';
    const tierSelector = document.getElementById('lobbyTierSelector');
    if (tierSelector) tierSelector.style.display = stakingApplies ? 'flex' : 'none';
    if (!stakingApplies) return;
    this.uiManager.updateStakingUI({
      isHost: this.isHost,
      tier: this.lobbyTier,
      locked: this.stakingState.hostDeposited || !!this.lobbyTier && this.isHost === false,
      hostDeposited: this.stakingState.hostDeposited,
      opponentDeposited: this.stakingState.opponentDeposited,
      canDeposit: this.walletManager.connected,
    });
  }

  startLocalGame(mode, difficulty, arenaIndex) {
    this.gameModeManager.setMode(mode);
    this.arenaManager.setMode(mode, arenaIndex);

    const maxPlayers = this.gameModeManager.getMaxPlayers();
    const spawnPositions = this.arenaManager.getSpawnPositions(maxPlayers);

    this.dragonManager.clear();
    this.foodSystem.init(this.arenaManager.getBounds(), this.arenaManager.getInnerBounds());

    this.aiController = new AIController(this.arenaManager, this.foodSystem, difficulty);

    // Reset match stats
    this.matchStats = {};
    this.winner = null;

    if (this.isMultiplayer && this.playerIds && this.playerIds.length > 0) {
      const myIndex = this.playerIds.indexOf(this.localPlayerId);
      const localSpawn = spawnPositions[myIndex] || spawnPositions[0];

      this.localDragon = this.dragonManager.createDragon(
        this.selectedDragon || 'ignis',
        localSpawn.x,
        localSpawn.y
      );
      this.localDragon.playerId = this.localPlayerId;
      this.initMatchStats(this.localDragon);

      for (let i = 0; i < this.playerIds.length; i++) {
        if (i === myIndex) continue;
        const pid = this.playerIds[i];
        const spawn = spawnPositions[i];
        const playerData = this.roomPlayers[pid] || {};
        const dragonName = playerData.dragon || 'ignis';
        const remoteDragon = this.dragonManager.createDragon(dragonName, spawn.x, spawn.y);
        remoteDragon.playerId = pid;
        remoteDragon.isRemote = true;
        this.initMatchStats(remoteDragon);
      }

      const aiNames = ['aegis', 'ignis', 'infinite', 'magnetron'];
      for (let i = this.playerIds.length; i < maxPlayers; i++) {
        const spawn = spawnPositions[i];
        const aiName = aiNames[i % aiNames.length];
        const teamId = this.gameModeManager.getTeamForPlayer(i);
        const aiDragon = this.dragonManager.createDragon(aiName, spawn.x, spawn.y, teamId);
        if (this.aiController) {
          aiDragon.speed *= this.aiController.getSpeedMult();
        }
        this.initMatchStats(aiDragon);
      }
    } else {
      const localSpawn = spawnPositions[0];
      this.localDragon = this.dragonManager.createDragon(
        this.selectedDragon || 'ignis',
        localSpawn.x,
        localSpawn.y
      );
      this.initMatchStats(this.localDragon);

      const aiNames = ['aegis', 'ignis', 'infinite', 'magnetron'];
      for (let i = 1; i < maxPlayers; i++) {
        const spawn = spawnPositions[i];
        const aiName = aiNames[i % aiNames.length];
        const teamId = this.gameModeManager.getTeamForPlayer(i);
        const aiDragon = this.dragonManager.createDragon(aiName, spawn.x, spawn.y, teamId);
        aiDragon.speed *= this.aiController.getSpeedMult();
        this.initMatchStats(aiDragon);
      }
    }

    this.startGameLoop();

    if (this.isMultiplayer) {
      this.startNetworkSync();
    }
  }

  initMatchStats(dragon) {
    this.matchStats[dragon.id] = {
      kills: 0,
      deaths: 0,
      timeSurvived: 0,
      infiniteCoin: 0,
      startTime: Date.now()
    };
  }

  createRoom(mpMode) {
    if (!this.db) {
      alert('Multiplayer not available. Running in local mode.');
      this.uiManager.showScreen('modeSelectScreen');
      return;
    }
    this.roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    this.isHost = true;
    this.selectedMpMode = mpMode || 'FFA';
    this.localPlayerId = 'local';
    this.playerIds = ['local'];
    this.lobbyArenaIndex = 0;
    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    const maxPlayers = CONFIG.MAX_PLAYERS[this.selectedMpMode] || 4;

    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    this.roomRef.set({
      host: 'local',
      mode: this.selectedMpMode,
      maxPlayers: maxPlayers,
      arenaIndex: 0,
      status: 'waiting',
      tier: null,
      staking: { hostDeposited: false, opponentDeposited: false },
      players: {
        local: { name: 'Player 1', dragon: this.selectedDragon || 'ignis', ready: true }
      }
    });

    this.roomPlayers = { local: { name: 'Player 1', dragon: this.selectedDragon || 'ignis', ready: true } };

    this.uiManager.updateLobby(
      [{ name: 'Player 1', dragon: this.selectedDragon, isLocal: true, deposited: false }],
      maxPlayers,
      this.roomCode,
      true
    );
    this.uiManager.updateLobbyArena(0, true);
    this.uiManager.showScreen('lobbyScreen');
    this._refreshStakingUI();
    this._attachRoomListener();
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
        const err = document.getElementById('mpJoinError');
        if (err) err.textContent = 'Room not found';
        this.roomRef = null;
        return;
      }
      const roomMax = data.maxPlayers || CONFIG.MAX_PLAYERS[data.mode] || 4;
      const playerCount = Object.keys(data.players || {}).length;
      if (playerCount >= roomMax) {
        const err = document.getElementById('mpJoinError');
        if (err) err.textContent = 'Room is full';
        this.roomRef = null;
        return;
      }
      const newPlayerRef = this.roomRef.child('players').push({
        name: 'Player ' + (playerCount + 1),
        dragon: this.selectedDragon || 'ignis',
        ready: true
      });
      this.localPlayerId = newPlayerRef.key;
      this.lobbyArenaIndex = data.arenaIndex !== undefined ? data.arenaIndex : 0;
      this.selectedMpMode = data.mode || this.selectedMpMode;
      this.lobbyTier = data.tier || null;
      this.uiManager.showScreen('lobbyScreen');
      this.uiManager.updateLobbyArena(this.lobbyArenaIndex, false);
      this._attachRoomListener();
    });
  }

  _attachRoomListener() {
    if (!this.roomRef) return;
    this.roomRef.on('value', snap => {
      const data = snap.val();
      if (!data) return;
      this.roomPlayers = data.players || {};
      this.playerIds = Object.keys(this.roomPlayers);
      this.lobbyTier = data.tier || null;
      this.stakingState = {
        hostDeposited: !!(data.staking && data.staking.hostDeposited),
        opponentDeposited: !!(data.staking && data.staking.opponentDeposited),
      };
      if (data.arenaIndex !== undefined && data.arenaIndex !== this.lobbyArenaIndex) {
        this.lobbyArenaIndex = data.arenaIndex;
        this.uiManager.updateLobbyArena(data.arenaIndex, this.isHost);
      }
      const players = Object.entries(this.roomPlayers).map(([id, p]) => ({
        ...p,
        isLocal: id === this.localPlayerId,
        deposited: id === 'local' ? this.stakingState.hostDeposited : this.stakingState.opponentDeposited,
      }));
      const roomMax = data.maxPlayers || CONFIG.MAX_PLAYERS[data.mode] || 4;
      this.uiManager.updateLobby(players, roomMax, this.roomCode, this.isHost);
      this._refreshStakingUI();
      if (data.status === 'playing' && this.state !== 'PLAYING' && !this.isHost) {
        const gameConfig = data.gameConfig || {};
        this.selectedMode = gameConfig.mode || data.mode || 'FFA';
        this.lobbyArenaIndex = gameConfig.arenaIndex !== undefined ? gameConfig.arenaIndex : (data.arenaIndex !== undefined ? data.arenaIndex : 0);
        this.isMultiplayer = true;
        this.startLocalGame(this.selectedMode, 'advanced', this.lobbyArenaIndex);
      }
    });
  }

  leaveRoom() {
    if (this.stakingState.hostDeposited && this.stakingState.opponentDeposited) {
      this.eventBus.emit('staking:error', {
        message: 'Both stakes are locked in escrow. Leaving now will NOT refund you automatically — ask your opponent to mutually cancel, or wait for the settle-timeout refund window.'
      });
    }
    this.stopNetworkSync();
    if (this.roomRef) {
      this.roomRef.off();
      if (this.isHost) {
        this.roomRef.remove();
      } else if (this.localPlayerId) {
        this.roomRef.child('players/' + this.localPlayerId).remove();
      }
      this.roomRef = null;
    }
    this.isHost = false;
    this.roomCode = '';
    this.localPlayerId = null;
    this.playerIds = [];
    this.roomPlayers = {};
    this.isMultiplayer = false;
    this.lobbyArenaIndex = 0;
    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this._consumeLobbyContext();
  }

  startMpGame() {
    const stakingApplies = this.selectedMpMode === '1v1';
    if (stakingApplies && !(this.stakingState.hostDeposited && this.stakingState.opponentDeposited)) {
      this.eventBus.emit('staking:error', { message: 'Both players must deposit their stake before the match can start.' });
      return;
    }
    if (this.roomRef && this.isHost) {
      this.roomRef.update({
        status: 'playing',
        gameConfig: {
          mode: this.selectedMpMode || 'FFA',
          arenaIndex: this.lobbyArenaIndex,
          playerIds: this.playerIds
        }
      });
    }
    this.isMultiplayer = true;
    this.startLocalGame(this.selectedMpMode || 'FFA', 'advanced', this.lobbyArenaIndex);
  }

  startNetworkSync() {
    if (!this.roomRef) return;
    this.positionsRef = this.roomRef.child('positions');
    this.positionsListenerSet = false;
    this.lastBroadcast = 0;
  }

  stopNetworkSync() {
    if (this.positionsRef) {
      this.positionsRef.off();
      this.positionsRef = null;
    }
    this.positionsListenerSet = false;
    this.remotePositions = {};
  }

  broadcastPosition() {
    if (!this.positionsRef || !this.localDragon || !this.localPlayerId) return;
    const now = Date.now();
    if (this.lastBroadcast && now - this.lastBroadcast < 50) return;
    this.lastBroadcast = now;
    this.positionsRef.child(this.localPlayerId).set({
      x: this.localDragon.head.x,
      y: this.localDragon.head.y,
      angle: this.localDragon.angle,
      score: this.localDragon.score || 0,
      // Segment count is required by the server-side match simulator to
      // correctly replicate collisionSystem.js's head-to-head death rule
      // (shorter dragon dies) - without this the server cannot independently
      // verify who won.
      segments: this.localDragon.segments.length,
      t: now
    });
  }

  applyRemotePositions() {
    if (!this.positionsRef) return;
    if (!this.positionsListenerSet) {
      this.positionsListenerSet = true;
      this.positionsRef.on('value', snap => {
        this.remotePositions = snap.val() || {};
      });
    }
    if (!this.remotePositions) return;
    for (const dragon of this.dragonManager.getAllDragons()) {
      if (!dragon.isRemote || !dragon.playerId) continue;
      const pos = this.remotePositions[dragon.playerId];
      if (!pos) continue;
      dragon.remoteTarget = { x: pos.x, y: pos.y };
      dragon.angle = pos.angle;
    }
  }

  startGameLoop() {
    this.state = 'PLAYING';
    this.isPaused = false;
    this.gameStartTime = Date.now();

    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        this.cameraSystem.canvas = canvas;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

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
    if (deltaTime > CONFIG.MAX_DELTA_TIME) deltaTime = CONFIG.MAX_DELTA_TIME;
    if (!this.isPaused) {
      this.update(deltaTime);
      this.render();
    }
    this.animationFrame = requestAnimationFrame(() => this.loop());
  }

  update(deltaTime) {
    this.gameTimer = Date.now() - this.gameStartTime;
    const minutes = Math.floor(this.gameTimer / 60000);
    const seconds = Math.floor((this.gameTimer % 60000) / 1000);
    const timeStr = minutes + ':' + seconds.toString().padStart(2, '0');

    this.foodSystem.update(deltaTime);
    this.movementSystem.update(this.dragonManager, this.cameraSystem, deltaTime);
    this.effectsSystem.update(deltaTime);

    const inputMap = new Map();
    const allDragons = this.dragonManager.getAllDragons();

    for (const dragon of this.dragonManager.getLivingDragons()) {
      let angle;
      if (dragon === this.localDragon) {
        angle = this.movementSystem.getInputAngle(
          dragon.id,
          dragon.head.x,
          dragon.head.y,
          this.cameraSystem
        );
      } else if (dragon.isRemote) {
        angle = dragon.angle;
      } else if (this.aiController) {
        angle = this.aiController.getInputAngle(dragon, allDragons);
      } else {
        angle = dragon.angle || 0;
      }
      inputMap.set(dragon.id, angle);
    }

    this.dragonManager.update(deltaTime, inputMap, this.arenaManager.getInnerBounds());

    if (this.isMultiplayer) {
      this.applyRemotePositions();
      this.broadcastPosition();
    }

    this.cameraSystem.update(this.localDragon, this.arenaManager);
    this.collisionSystem.checkAll(this.dragonManager, this.foodSystem, this.arenaManager);

    // Update time survived for all living dragons
    for (const dragon of this.dragonManager.getLivingDragons()) {
      if (this.matchStats[dragon.id]) {
        this.matchStats[dragon.id].timeSurvived = Date.now() - this.matchStats[dragon.id].startTime;
      }
    }

    // Check win condition (last standing with lives)
    const livingWithLives = allDragons.filter(d => d.alive && d.lives > 0);
    const totalWithLives = allDragons.filter(d => d.lives > 0);

    if (livingWithLives.length === 1 && totalWithLives.length === 1 && allDragons.length > 1) {
      this.winner = livingWithLives[0];
      this.endGame(true);
      return;
    }

    const score = this.localDragon ? this.localDragon.score : 0;
    this.uiManager.updateHUD(score, timeStr, this.localDragon);

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
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.cameraSystem.canvas = canvas;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shake = this.effectsSystem.getShake();
    this.cameraSystem.apply(ctx, shake.x, shake.y);
    this.arenaManager.render(ctx, this.cameraSystem);
    this.foodSystem.render(ctx, this.cameraSystem);
    this.effectsSystem.renderParticles(ctx, this.cameraSystem);
    this.dragonManager.render(ctx, this.cameraSystem);
    this.cameraSystem.reset(ctx);
    this.effectsSystem.renderVignette(ctx, canvas);
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

  endGame(hasWinner = false) {
    this.state = 'GAME_OVER';
    this.uiManager.showPauseOverlay(false);
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.stopNetworkSync();

    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Build stats for all dragons
    const allDragons = this.dragonManager.getAllDragons();
    const stats = allDragons.map(d => ({
      id: d.id,
      name: d.type,
      isLocal: d === this.localDragon,
      kills: d.kills || 0,
      deaths: d.deaths || 0,
      timeSurvived: this.matchStats[d.id] ? this.matchStats[d.id].timeSurvived : 0,
      infiniteCoin: 0,
      lives: d.lives || 0,
      collected: d.collected || 0
    }));

    const localStats = {
      time: document.getElementById('timerDisplay').textContent,
      collected: this.localDragon ? this.localDragon.collected : 0,
      kills: this.localDragon ? this.localDragon.kills : 0,
      deaths: this.localDragon ? this.localDragon.deaths : 0,
      lives: this.localDragon ? this.localDragon.lives : 0
    };

    this.uiManager.updateGameOver(localStats);
    this.uiManager.showMatchStats(stats, this.winner);
    this.uiManager.showScreen('gameOverScreen');
  }

  restartGame() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.uiManager.showPauseOverlay(false);
    this.dragonManager.clear();
    this.stopNetworkSync();

    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    this.startLocalGame(
      this.selectedMode || 'FFA',
      this.aiDifficulty || 'advanced',
      this.pendingArenaIndex !== null ? this.pendingArenaIndex : Math.floor(Math.random() * 4)
    );
  }

  quitGame() {
    this.state = 'MENU';
    this.uiManager.showPauseOverlay(false);
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.dragonManager.clear();
    this.isPaused = false;
    this.stopNetworkSync();

    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
