import CONFIG, { DRAGON_IMAGES } from './config.js';
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
import PhotonMatchmaking from './photonMatchmaking.js';

const LOBBY_CONTEXT_KEY = 'mpLobbyContext';
// Separate from LOBBY_CONTEXT_KEY (which is ephemeral - consumed the moment
// a deposit confirms) - this one persists as long as you're plausibly still
// in a room, specifically so a bare title screen (Android dropping Phantom's
// redirect data entirely, which is a real OS-level behavior JS can't
// prevent) still gives you a way back into your room instead of a dead end.
const LAST_ROOM_KEY = 'lastRoomInfo';

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

// ==================== BOOT LOADER ====================
// Drives #bootScreen: the full-screen loader that appears the instant
// the page opens and stays until EVERY image the menus and arena need
// has actually arrived. Real per-file progress, a stall watchdog that
// shows a polite weak-network message, and a retry path so a player is
// never let into the game with broken images.
class BootLoader {
  constructor() {
    this.el = document.getElementById('bootScreen');
    this.fill = document.getElementById('bootBarFill');
    this.pct = document.getElementById('bootPct');
    this.status = document.getElementById('bootStatus');
    this.netBox = document.getElementById('bootNetBox');
    this.retryBtn = document.getElementById('bootRetryBtn');
    this.lastTick = Date.now();
    this.done = false;
    // Stall watchdog: 10s without a single file finishing = weak network.
    this.watchdog = setInterval(() => {
      if (this.done) return;
      if (Date.now() - this.lastTick > 10000) this.showNetWarning();
    }, 1000);
  }

  setProgress(done, total) {
    this.lastTick = Date.now();
    const pct = Math.min(100, Math.round((done / Math.max(1, total)) * 100));
    if (this.fill) this.fill.style.width = pct + '%';
    if (this.pct) this.pct.textContent = pct + '%';
    if (this.status) this.status.textContent = `Summoning dragons... ${done}/${total}`;
    this.hideNetWarning();
  }

  showNetWarning() {
    if (this.netBox) this.netBox.classList.add('show');
  }

  hideNetWarning() {
    if (this.netBox) this.netBox.classList.remove('show');
  }

  // Everything arrived - fade the loader away and let the player in.
  finish() {
    this.done = true;
    clearInterval(this.watchdog);
    if (this.fill) this.fill.style.width = '100%';
    if (this.pct) this.pct.textContent = '100%';
    if (this.status) this.status.textContent = 'The arena awaits.';
    this.hideNetWarning();
    if (this.el) {
      setTimeout(() => this.el.classList.add('boot-done'), 350);
      setTimeout(() => { if (this.el.parentNode) this.el.parentNode.removeChild(this.el); }, 1100);
    }
  }

  // A required asset failed every retry - keep the player here, explain
  // politely, and hand them a working retry button (cached files skip
  // instantly, so a retry only refetches what actually failed).
  fail(retryFn) {
    if (this.status) this.status.textContent = 'A few files could not make it through.';
    this.showNetWarning();
    if (this.retryBtn) {
      this.retryBtn.style.display = 'inline-block';
      this.retryBtn.onclick = async () => {
        this.retryBtn.style.display = 'none';
        this.hideNetWarning();
        this.lastTick = Date.now();
        if (this.status) this.status.textContent = 'Trying again...';
        try {
          await retryFn();
        } catch (e) {
          this.fail(retryFn);
        }
      };
    }
  }
}

// Every menu/arena image that is NOT a dragon sprite but still has to
// be sitting in cache before we let the player past the boot screen.
function bootExtraImages() {
  return [
    ...Object.values(DRAGON_IMAGES),           // select-screen portraits
    '/arenas/arena_stone.png',
    '/arenas/arena_grass.png',
    '/arenas/arena_purple.png',
    '/arenas/arena_fire.png',
    './shadow-drake-bg.png'                    // title screen backdrop
  ];
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
    // NOTE: WalletManager's constructor no longer processes a Phantom mobile
    // redirect on its own. It used to call _handleMobileRedirect() here,
    // synchronously, which meant 'wallet:txConfirmed' / 'wallet:txError'
    // could fire before Game.setupEventListeners() (called from init(),
    // further down) had registered any listeners - the event fired into
    // an empty EventBus and was lost. That's why staking on mobile bounced
    // back to the title screen with the wallet looking disconnected instead
    // of resuming the lobby. We now call walletManager.processMobileRedirect()
    // explicitly from init(), after listeners and Firebase are ready.
    this.walletManager = new WalletManager(this.eventBus);
    this.stakingManager = new StakingManager(this.eventBus, this.walletManager);
    this.matchmaking = new PhotonMatchmaking(this.eventBus);
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
    this.bootLoader = new BootLoader();
    this.setupEventListeners();
    await this.setupFirebase();
    this.effectsSystem.init();

    // Process any pending Phantom mobile redirect now that listeners
    // (setupEventListeners) and Firebase (setupFirebase) are both ready.
    // This can synchronously emit 'wallet:connected' / 'wallet:txConfirmed' /
    // 'wallet:txError', which in turn can call showScreen('lobbyScreen') via
    // _rejoinRoom() - so we only default to the title screen if that didn't
    // already happen.
    this.walletManager.processMobileRedirect();

    if (!this.roomRef) {
      // Only show the loading screen if we're ACTUALLY processing a
      // redirect right now (the URL literally has ?walletReturn=... on
      // it) - not just because a lobby context happens to exist in
      // localStorage. That key only gets cleared on a SUCCESSFUL deposit;
      // any abandoned attempt (tab closed mid-flow, browser killed,
      // anything) leaves it sitting there indefinitely. Using its mere
      // presence as the signal meant every future normal page load -
      // typing the URL fresh, no redirect involved at all - would show
      // the loading screen and then get stuck on it forever, since
      // nothing was ever going to transition it away. This is exactly
      // what caused the permanent "Entering the Arena..." freeze.
      let urlHasWalletReturn = false;
      try { urlHasWalletReturn = !!new URLSearchParams(window.location.search).get('walletReturn'); } catch (_) { /* ignore */ }
      this.uiManager.showScreen(urlHasWalletReturn ? 'loadingScreen' : 'titleScreen');

      // Safety net: even if a redirect IS genuinely in flight, don't ever
      // strand the user here forever if restoration fails silently for
      // some future, unforeseen reason. Fall back to the title screen.
      if (urlHasWalletReturn) {
        setTimeout(() => {
          if (!this.roomRef && this.uiManager.currentScreen === 'loadingScreen') {
            this.uiManager.showScreen('titleScreen');
          }
        }, 6000);
      } else {
        // No redirect data at all this load - if Android dropped it
        // entirely (a real behavior, not something JS can prevent), this
        // is the actual way back into the room instead of a dead end.
        const lastRoom = this._getLastRoom();
        if (lastRoom) this.uiManager.showResumeRoomBanner(lastRoom.roomCode);
      }
    }

    this.stakingManager.getDisplayTiers()
      .then(tiers => this.uiManager.updateTierAmounts(tiers))
      .catch(err => console.warn('[Staking] Could not load tier amounts yet:', err.message));

    // Boot gate: load EVERY image with real progress, and only let the
    // player past the boot screen once nothing is missing or broken.
    const loadEverything = async () => {
      await AssetLoader.preloadAll(
        (done, total) => this.bootLoader.setProgress(done, total),
        bootExtraImages()
      );
      await this.arenaManager.preloadAll();
      this.uiManager.buildDragonSelect(AssetLoader.getAllDragons());
      this.assetsLoaded = true;
      console.log('[Assets] All dragon and arena assets loaded successfully');
      this.bootLoader.finish();
    };
    try {
      await loadEverything();
    } catch (e) {
      console.error('Asset load failed:', e);
      this.bootLoader.fail(loadEverything);
    }
  }

  async setupFirebase() {
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
        // Anonymous auth DISABLED for now. Database rules are currently
        // wide open (.read: true, .write: true), so no write actually
        // requires an auth token right now - and this has repeatedly been
        // a real point of failure on networks that block Google's auth
        // domains (identitytoolkit.googleapis.com earlier, oauth2.googleapis.com
        // in WSL, now securetoken.googleapis.com). When the token refresh
        // fails, the Realtime Database SDK enters an endless reconnect
        // loop trying to attach a token it can't get - which can make the
        // ENTIRE database connection hang, breaking room creation/joining
        // even though nothing about them actually needed auth. Removing
        // this dependency removes that entire failure mode. Re-enable
        // once real database rules (requiring auth) are restored - see
        // firebase-database-rules.json for the version that needs it.
        this.authUid = null;
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
      this.dragonManager.addAttackCharge(dragon, food.value || 1);
      this.effectsSystem.spawnEatParticles(food.x, food.y, food.color);
      this.effectsSystem.playEatSound();
    });

    // Non-lethal tail bite (attacker not in attack mode)
    this.eventBus.on('collision:tail-cut', ({ victim }) => {
      this.growthSystem.onCollisionTailCut(victim, 0.2);
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
      // Kill glow uses the KILLER's neon dragon color (not generic fire)
      const neon = (killer && killer !== dragon && CONFIG.DRAGON_NEON)
        ? (CONFIG.DRAGON_NEON[killer.type] || null)
        : null;
      const deathColor = neon || (isLocal ? '#ff2222' : '#ff6600');
      this.effectsSystem.spawnDeathExplosion(dragon.head.x, dragon.head.y, deathColor);
      this.effectsSystem.addShake(isLocal ? 20 : 8, isLocal ? 500 : 300);
      this.effectsSystem.flashVignette(isLocal ? '#ff0000' : (neon || '#ff4400'), isLocal ? 0.5 : 0.25, 400);
      this.effectsSystem.playDeathSound(isLocal);

      // A death ends the victim's kill streak
      dragon.killStreak = 0;

      // Track killer stats
      if (killer && killer !== dragon) {
        killer.kills = (killer.kills || 0) + 1;
        // Kill reward: +2 body segments
        this.growthSystem.grow(killer, CONFIG.KILL_SEGMENTS_GAIN || 2);
        // Kill streak / combo announcements (full game: player, AI, MP)
        killer.killStreak = (killer.killStreak || 0) + 1;
        this._checkCombo(killer);
        const killerIsLocal = killer === this.localDragon;
        if (killerIsLocal) {
          this.effectsSystem.spawnKillSparkles(killer.head.x, killer.head.y, neon || '#ffd700');
          this.effectsSystem.flashVignette(neon || '#ffd700', 0.35, 300);
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
        // MULTIPLAYER CRITICAL: flush this final death state to Firebase
        // BEFORE checkMatchEnd() can end the game and stopNetworkSync().
        // The per-frame broadcast runs before the collision phase, so
        // without this forced send the loser's client ended its game and
        // stopped syncing while the last state the opponent ever received
        // still showed lives > 0 - the WINNER's client then never saw the
        // elimination, its win-check never fired, and it kept playing
        // forever with no VICTORY screen and no settlement trigger.
        if (this.isMultiplayer && dragon === this.localDragon && this.positionsRef) {
          this.lastBroadcast = 0; // bypass the 50ms throttle for this one send
          this.broadcastPosition();
        }
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

    this.eventBus.on('ui:resumeRoom', () => {
      const lastRoom = this._getLastRoom();
      if (lastRoom && this.db) {
        this.uiManager.hideResumeRoomBanner();
        this._rejoinRoom(lastRoom);
      }
    });

    // ===== SEARCH BATTLE (Photon matchmaking, tier-first) =====
    // Player picks a stake tier BEFORE searching; Photon only matches them
    // with someone who picked the same tier (native Photon room-property
    // filtering, not something checked after the fact). The moment two
    // players are matched, this hands off entirely to the existing,
    // already-working Firebase createRoom()/joinRoom() flow with that tier
    // already locked in - no separate "Proceed" confirmation step, since
    // picking a tier and starting the search already is the commitment.
    this.eventBus.on('ui:searchBattleTierSelected', async ({ tier }) => {
      this.uiManager.showScreen('matchmakingSearchScreen');
      try {
        // The old pre-search checkConnectionQuality() gate has been removed.
        // It spun up a THROWAWAY Photon client and force-disconnected it if
        // the Master handshake took longer than 5s - that mid-handshake kill
        // is exactly what produced the "WebSocket is closed before the
        // connection is established" / Master peer 1001+1004 errors, after
        // which the UI bounced straight back to the menu ("opens then
        // closes"). The real search client below has its own onError path,
        // so the gate added failure modes without adding safety.
        this.matchmaking.startSearch(tier);
      } catch (err) {
        this.eventBus.emit('matchmaking:error', { message: err?.message || 'Could not start matchmaking.' });
      }
    });

    this.eventBus.on('matchmaking:matched', ({ roomCode, isInitiator, tier }) => {
      if (isInitiator) {
        // Create the real Firebase room using the EXACT same path as
        // tapping "Create Room" manually, with the agreed tier already
        // locked in, then tell the matched opponent the code via Photon.
        this.createRoom(this.selectedMpMode || 'FFA', tier);
        if (this.roomCode) this.matchmaking.announceRoomReady(this.roomCode);
      } else {
        // roomCode arrives via Photon's onEvent - join it exactly as if
        // typed in manually. Tier is already set on the room itself.
        this.joinRoom(roomCode);
      }
    });

    this.eventBus.on('ui:cancelSearch', () => {
      this.matchmaking.cancelSearch();
    });
    this.eventBus.on('matchmaking:cancelled', () => {
      this.uiManager.showScreen('mpMenuScreen');
    });
    this.eventBus.on('matchmaking:error', ({ message }) => {
      this.matchmaking.cancelSearch();
      this.uiManager.showScreen('mpMenuScreen');
      const err = document.getElementById('mpJoinError');
      if (err) err.textContent = message || 'Matchmaking failed.';
    });

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
      localStorage.setItem(LOBBY_CONTEXT_KEY, JSON.stringify({
        roomCode: this.roomCode,
        isHost: this.isHost,
        localPlayerId: this.localPlayerId,
        selectedDragon: this.selectedDragon,
        selectedMpMode: this.selectedMpMode,
        lobbyTier: this.lobbyTier,
      }));
    } catch (_) {}
  }

  _persistLastRoom() {
    try {
      localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({
        roomCode: this.roomCode,
        isHost: this.isHost,
        localPlayerId: this.localPlayerId,
        selectedDragon: this.selectedDragon,
        selectedMpMode: this.selectedMpMode,
        lobbyTier: this.lobbyTier,
        savedAt: Date.now(),
      }));
    } catch (_) {}
  }

  _getLastRoom() {
    try {
      const raw = localStorage.getItem(LAST_ROOM_KEY);
      if (!raw) return null;
      const ctx = JSON.parse(raw);
      // Ignore anything older than 2 hours - a stale "resume?" prompt for a
      // long-dead room would just be confusing, not helpful.
      if (!ctx.savedAt || Date.now() - ctx.savedAt > 2 * 60 * 60 * 1000) return null;
      return ctx;
    } catch (_) {
      return null;
    }
  }

  _clearLastRoom() {
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch (_) {}
  }

  // Reconciles Firebase's staking flags against the actual on-chain Room
  // account. Called whenever we (re)enter a room - catches the case where a
  // deposit genuinely succeeded on-chain but our app never found out
  // (Android dropping Phantom's redirect data), which would otherwise leave
  // the room showing "not staked" forever even though the player paid.
  async _syncStakeFromChain() {
    if (!this.roomRef || !this.roomCode) return;
    const roomIdNum = parseInt(this.roomCode, 10);
    if (!roomIdNum) return;
    try {
      const onChain = await this.stakingManager.getRoomAccount(roomIdNum);
      if (!onChain.exists) return; // host hasn't actually deposited on-chain yet - nothing to reconcile

      const updates = {};
      if (!this.stakingState.hostDeposited && onChain.hostDeposited) {
        updates['staking/hostDeposited'] = true;
        if (onChain.hostPubkey) updates.hostPubkey = onChain.hostPubkey;
        if (onChain.tier) updates.tier = onChain.tier;
      }
      if (!this.stakingState.opponentDeposited && onChain.opponentDeposited) {
        updates['staking/opponentDeposited'] = true;
        if (onChain.opponentPubkey) updates.opponentPubkey = onChain.opponentPubkey;
      }
      if (Object.keys(updates).length > 0) {
        await this.roomRef.update(updates);
        this.eventBus.emit('staking:confirmed', { label: 'Synced your stake status from the blockchain.' });
      }
    } catch (err) {
      console.warn('[Staking] on-chain sync check failed (non-fatal):', err?.message || err);
    }
  }

  _consumeLobbyContext() {
    try {
      const raw = localStorage.getItem(LOBBY_CONTEXT_KEY);
      localStorage.removeItem(LOBBY_CONTEXT_KEY);
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
    this._ensurePresence();
    this._persistLastRoom();
    this._syncStakeFromChain();
  }

  // Self-heals by re-adding this player's own entry if it's ever missing
  // from the room (e.g. after resuming from a Phantom redirect).
  //
  // This USED to also arm Firebase onDisconnect().remove() here, on the
  // theory that a player who truly leaves (closes the tab, loses signal)
  // shouldn't linger forever as a ghost entry. That backfired badly: any
  // WebSocket disconnect fires onDisconnect, and backgrounding a mobile
  // browser tab - e.g. switching to Telegram to share the room code, which
  // is completely normal, expected behavior - can itself drop the
  // connection. That deleted the HOST's own entry while they'd never
  // actually left, showing "0/N players" when they came back. Kicking an
  // active player out of their own room for switching apps for a second is
  // a much worse failure than a rare stale entry from someone who
  // genuinely abandoned a room, so onDisconnect cleanup has been removed
  // entirely. leaveRoom() (Leave Room button) remains the way entries get
  // cleaned up.
  _ensurePresence() {
    if (!this.roomRef) return;
    if (this.isHost) {
      const hostRef = this.roomRef.child('players/local');
      hostRef.once('value').then(snap => {
        if (!snap.exists()) {
          hostRef.set({ name: 'Player 1', dragon: this.selectedDragon || 'ignis', ready: true });
        }
      }).catch(() => {});
    } else if (this.localPlayerId) {
      const meRef = this.roomRef.child('players/' + this.localPlayerId);
      meRef.once('value').then(snap => {
        if (!snap.exists()) {
          meRef.set({ name: 'Player', dragon: this.selectedDragon || 'ignis', ready: true });
        }
      }).catch(() => {});
    }
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
    this.eventBus.emit('staking:pending', { label: 'Forging your stake into the arena…' });
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
      // Records which authenticated visitor actually claimed the opponent
      // slot for staking, at the moment they stake - this is what the
      // rules use to stop a THIRD person (in an FFA room with more than 2
      // players) from being able to overwrite someone else's stake status.
      updates.opponentAuthUid = this.authUid || null;
      updates['staking/opponentDeposited'] = true;
      updates['staking/opponentTx'] = signature;
    }
    await this.roomRef.update(updates);
    this._consumeLobbyContext();
    this.eventBus.emit('staking:confirmed', { label: `Deposit confirmed on-chain (tx ${String(signature).slice(0, 8)}…).` });
  }

  _refreshStakingUI() {
    // Staking isn't limited to 1v1 - FFA and 2v2 rooms also show stake
    // tiers and a deposit button in the lobby. The old
    // `selectedMpMode === '1v1'` check meant updateStakingUI() was never
    // called for any other mode, so the deposit button on the joining
    // player's screen just kept whatever disabled state it had at page
    // load and never unlocked - that's why staking looked "locked" in an
    // FFA room. Gate on whether a tier has actually been picked instead,
    // since that applies the same way in every mode.
    const stakingApplies = !!this.lobbyTier;
    const tierSelector = document.getElementById('lobbyTierSelector');
    if (tierSelector) tierSelector.style.display = 'flex';
    if (!stakingApplies) {
      // No tier chosen yet, so this room isn't using staking (or hasn't
      // started to). Don't leave Start Game blocked on a deposit that was
      // never required - updateStakingUI() (which owns the actual
      // host-must-deposit-first gate) is only reached below, once a tier
      // is picked.
      const startBtn = document.getElementById('lobbyStartBtn');
      if (startBtn) startBtn.disabled = false;
      // Also clear any leftover status text from a PREVIOUS room (e.g.
      // "Both players staked - ready to battle!") - this element isn't
      // torn down between rooms, just toggled visible/hidden with the
      // screen, so without this it kept showing stale text from whatever
      // room was last played until a snapshot happened to overwrite it.
      const statusText = document.getElementById('depositStatusText');
      if (statusText) {
        statusText.textContent = '';
        statusText.className = 'depositStatusText';
      }
      return;
    }
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

      // NOTE: multiplayer rooms deliberately do NOT get backfilled with AI
      // bots for empty slots. maxPlayers (e.g. 8 for FFA) is a capacity
      // ceiling, not a target headcount - a 2-player staked match should
      // only ever contain those 2 real dragons. Padding with bots was also
      // why the match never ended after 3 deaths: checkMatchEnd() requires
      // exactly ONE dragon left with lives > 0 to declare a winner, and
      // with 6 AI bots also alive that condition could never be met.
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

  createRoom(mpMode, presetTier = null) {
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
    this.lobbyTier = presetTier;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    const maxPlayers = CONFIG.MAX_PLAYERS[this.selectedMpMode] || 4;

    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    this.roomRef.set({
      host: 'local',
      hostAuthUid: this.authUid || null,
      mode: this.selectedMpMode,
      maxPlayers: maxPlayers,
      arenaIndex: 0,
      status: 'waiting',
      tier: presetTier,
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
    this._ensurePresence();
    this._persistLastRoom();
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
      this._ensurePresence();
      this._persistLastRoom();
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
        isHost: id === 'local', // the host's Firebase key is always 'local', regardless of which browser is viewing
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
    this._clearLastRoom();
  }

  startMpGame() {
    // Same fix as _refreshStakingUI(): a stake tier can be set in any mode,
    // not just 1v1, so the "both players must deposit" requirement has to
    // be gated on whether a tier is actually set, not on the mode string -
    // otherwise FFA/2v2 rooms could start with an unstaked opponent.
    const stakingApplies = !!this.lobbyTier;
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
    this._watchSettlement();
  }

  // Watches rooms/{code}/settlement - the node the always-on backend
  // (watchMatches.js) writes after it determines the winner and pays out
  // on-chain. This is the authoritative result for staked matches: it ends
  // a match still running locally, corrects/confirm a locally-ended result,
  // and surfaces the payout transaction to both players.
  _watchSettlement() {
    if (!this.roomRef) return;
    if (this._settlementRef && this._settlementListener) {
      try { this._settlementRef.off('value', this._settlementListener); } catch (_) {}
    }
    this._settlementHandled = false;
    this._settlementRef = this.roomRef.child('settlement');
    this._settlementListener = this._settlementRef.on('value', snap => {
      const s = snap.val();
      if (!s || this._settlementHandled) return;
      if (s.status === 'draw_needs_dispute_resolution') {
        this._settlementHandled = true;
        this.uiManager.showStakeBreakdown({ draw: true });
        return;
      }
      if (s.status !== 'settled') return;
      this._settlementHandled = true;
      const iWon = (s.winner === 'host') === !!this.isHost;
      if (this.state === 'PLAYING') {
        // Match still running on this client - end it now with the
        // server-settled outcome instead of any local approximation.
        const all = this.dragonManager.getAllDragons();
        this.winner = iWon
          ? this.localDragon
          : (all.find(d => d !== this.localDragon) || null);
        this.endGame(true);
      } else if (this._lastStats) {
        // Game already ended locally - make sure the title matches the
        // authoritative settled result (winner object only needs .id for
        // showMatchStats to compare against the local stat entry).
        const localStat = this._lastStats.find(st => st.isLocal);
        this.winner = iWon && localStat ? { id: localStat.id } : { id: '__remote__' };
        this.uiManager.showMatchStats(this._lastStats, this.winner);
      }
      if (s.signature) {
        this.eventBus.emit('staking:confirmed', {
          label: `Match settled on-chain - payout sent (tx ${String(s.signature).slice(0, 8)}…).`
        });
      }
      // Fill the Dragon Age settlement breakdown (stakes, pot, 2.5% Treasury
      // fee, payout, tx link) on the game-over screen.
      this._showStakeBreakdown(iWon, s);
    });
  }

  stopNetworkSync() {
    if (this.positionsRef) {
      this.positionsRef.off();
      this.positionsRef = null;
    }
    this.positionsListenerSet = false;
    this.remotePositions = {};
  }

  // Combo announcements: 3 / 7 / 15 kills, then every +5 (20, 25...).
  _checkCombo(killer) {
    const streak = killer.killStreak || 0;
    const isMilestone = streak === 3 || streak === 7 || streak === 15 || (streak > 15 && streak % 5 === 0);
    if (!isMilestone) return;
    this.uiManager.showComboBanner(killer, streak);
    this.effectsSystem.playTone(520 + Math.min(streak, 30) * 20, 'square', 0.18, 0.14);
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
      // lives/alive: each client is only authoritative for its OWN
      // dragon's death/respawn state (see collisionSystem.js - it no
      // longer lets a client declare a remote dragon dead based on its own
      // local, lerped approximation of that dragon's position). Other
      // clients now sync the real lives/alive state from here instead of
      // computing it themselves, which is what was causing the opponent to
      // vanish on one client but not the other.
      lives: this.localDragon.lives,
      alive: this.localDragon.alive,
      attackActive: !!this.localDragon.attackActive,
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
      // Sync attack state (drives the open-mouth head + kill gate)
      dragon.attackActive = !!pos.attackActive;
      dragon.boostActive = dragon.attackActive;
      // Sync this dragon's actual size to the network's authoritative
      // segment count. broadcastPosition() already sends `segments`, but
      // nothing was ever reading it back - each client was instead letting
      // its OWN local food collisions grow remote dragons (collision:eat
      // fires for any dragon, including remote ones), and food isn't
      // networked at all. Two clients running independent, unsynced growth
      // simulations for the same remote dragon is exactly why the size
      // looked different on phone vs PC. This forces it back in line every
      // network tick (~50ms), so any local drift self-corrects almost
      // immediately instead of accumulating.
      if (typeof pos.segments === 'number' && pos.segments !== dragon.segments.length) {
        this._resizeRemoteDragon(dragon, pos.segments);
      }
      // Sync lives/alive from the network - collisionSystem.js no longer
      // lets any client declare a remote dragon dead on its own, so this
      // is the only place a remote dragon's death/respawn state actually
      // changes. The existing per-frame win-check in update() already
      // re-evaluates allDragons every tick, so a real death arriving here
      // is picked up automatically without needing anything extra.
      if (typeof pos.lives === 'number' && pos.lives !== dragon.lives) {
        dragon.lives = pos.lives;
      }
      if (typeof pos.alive === 'boolean' && pos.alive !== dragon.alive) {
        dragon.alive = pos.alive;
      }
    }
  }

  // Grows or shrinks a REMOTE dragon's segment array to match targetLength.
  // Deliberately bypasses growthSystem (that's for the local player's own
  // eating/growthProgress bookkeeping only) so remote dragons are purely
  // network-driven and can never desync from what's authoritative on the
  // client that actually owns them.
  _resizeRemoteDragon(dragon, targetLength) {
    const baseSpacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;
    const fatSpacing = baseSpacing * 2;
    while (dragon.segments.length < targetLength && dragon.segments.length < CONFIG.DRAGON_MAX_SEGMENTS) {
      const spacing = dragon.segments.length >= 25 ? fatSpacing : baseSpacing;
      const tailSeg = dragon.segments[dragon.segments.length - 1];
      const beforeTail = dragon.segments.length > 1
        ? dragon.segments[dragon.segments.length - 2]
        : dragon.head;
      const angle = Math.atan2(tailSeg.y - beforeTail.y, tailSeg.x - beforeTail.x);
      dragon.segments.push({
        x: tailSeg.x + Math.cos(angle) * spacing,
        y: tailSeg.y + Math.sin(angle) * spacing
      });
    }
    while (dragon.segments.length > targetLength && dragon.segments.length > CONFIG.DRAGON_START_SEGMENTS) {
      dragon.segments.pop();
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
        // AI attack (magazine model): hold while it has charge and a live
        // hunt target; the meter drains only during the hold, so the AI
        // naturally saves leftover charge when it breaks off.
        dragon.attackHeld = !!(dragon.aiHuntTarget && dragon.aiHuntTarget.alive &&
                               (dragon.attackCharge || 0) > 0);
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

    // Local player attack activation (ATTACK button / Space / click)
    // Hold-to-attack: dragonManager drains the magazine only while held.
    if (this.localDragon) {
      this.localDragon.attackHeld = this.localDragon.alive && this.movementSystem.isAttackHeld();
    }

    const score = this.localDragon ? this.localDragon.score : 0;
    this.uiManager.updateHUD(score, timeStr, this.localDragon);
    this.uiManager.updateAttackMeter(this.localDragon);

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
    this.uiManager.showPauseOverlay(true, this.isMultiplayer);
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
    // Kept so a later server-settlement update can correct/confirm the
    // result title without re-deriving stats (see _watchSettlement).
    this._lastStats = stats;

    if (this.isMultiplayer) {
      // Match is over - clear any saved lobby/room context so the title
      // screen stops offering "Resume Room" for a finished match.
      try { localStorage.removeItem(LOBBY_CONTEXT_KEY); } catch (_) {}
      try { localStorage.removeItem(LAST_ROOM_KEY); } catch (_) {}
      // For staked matches, show the settlement panel in its pending state
      // until the backend writes rooms/{code}/settlement.
      if (this.lobbyTier) this.uiManager.showStakeBreakdown({ pending: true });
    }
  }

  // Builds the Dragon Age settlement breakdown on the game-over screen once
  // the backend has settled the match on-chain. Amounts come from the live
  // on-chain tier config (stakingManager), the result/tx from the
  // rooms/{code}/settlement node written by watchMatches.js.
  async _showStakeBreakdown(iWon, settlement) {
    try {
      const tiers = await this.stakingManager.getDisplayTiers();
      const tierName = String(settlement?.tier || this.lobbyTier || '').toLowerCase();
      const tierKey = Object.keys(tiers).find(k => k.toLowerCase() === tierName);
      const parseAmt = (v) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
      const stake = tierKey ? parseAmt(tiers[tierKey]) : 0;
      const feePct = Number(tiers.feePercent) || 2.5;
      const pot = stake * 2;
      const fee = pot * (feePct / 100);
      const payout = pot - fee;
      const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
      this.uiManager.showStakeBreakdown({
        won: iWon,
        stakeText: stake ? `${fmt(stake)} INFINITE` : null,
        potText: stake ? `${fmt(pot)} INFINITE` : null,
        feeText: stake ? `-${fmt(fee)} INFINITE` : null,
        payoutText: stake ? `${fmt(payout)} INFINITE` : null,
        feePct,
        signature: settlement?.signature || null,
        cluster: settlement?.cluster || 'devnet',
      });
    } catch (err) {
      console.warn('[Staking] settlement breakdown display failed:', err?.message || err);
    }
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
