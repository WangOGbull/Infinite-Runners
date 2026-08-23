// ==================== START OF main.js ====================
import CONFIG, { DRAGON_IMAGES, AI_WAVES, AI_DIFFICULTY_TIERS } from './config.js';
import AssetLoader from './assetLoader.js';
import { DragonManager } from './dragonManager.js?v=52';
import MovementSystem from './movementSystem.js';
import GrowthSystem from './growthSystem.js';
import CameraSystem from './cameraSystem.js';
import ArenaManager from './arenaManager.js';
import FoodSystem from './foodSystem.js?v=52';
import CollisionSystem from './collisionSystem.js';
import GameModeManager from './gameModeManager.js';
import UIManager from './uiManager.js?v=52';
import EffectsSystem from './effectsSystem.js';
import WalletManager from './walletManager.js?v=50';
import StakingManager, { TIER_AMOUNTS } from './stakingManager.js';
import AIController from './aiController.js?v=52';
import FirebaseMatchmaking from './firebaseMatchmaking.js';

const BACKEND_URL = 'https://infiniterunners-firebase-backend-production.up.railway.app';
const LOBBY_CONTEXT_KEY = 'mpLobbyContext';
const LAST_ROOM_KEY = 'lastRoomInfo';

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
    this.skipIntro = false;
    try {
      this.skipIntro = sessionStorage.getItem('infiniteRunnersBootComplete') === '1';
    } catch (_) {}
    if (this.skipIntro && this.el) {
      // Assets still validate in the background; only the repeated full-screen
      // summoning animation is skipped for this browser-tab session.
      this.el.style.display = 'none';
    }
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
  startWatchdog() {
    this.lastTick = Date.now();
  }
  showNetWarning() {
    if (this.netBox) this.netBox.classList.add('show');
  }
  hideNetWarning() {
    if (this.netBox) this.netBox.classList.remove('show');
  }
  finish() {
    this.done = true;
    clearInterval(this.watchdog);
    if (this.fill) this.fill.style.width = '100%';
    if (this.pct) this.pct.textContent = '100%';
    if (this.status) this.status.textContent = 'The arena awaits.';
    this.hideNetWarning();
    try { sessionStorage.setItem('infiniteRunnersBootComplete', '1'); } catch (_) {}
    if (this.el) {
      if (this.skipIntro) {
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
        return;
      }
      setTimeout(() => this.el.classList.add('boot-done'), 350);
      setTimeout(() => { if (this.el.parentNode) this.el.parentNode.removeChild(this.el); }, 1100);
    }
  }
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
        try { await retryFn(); } catch (e) { this.fail(retryFn); }
      };
    }
  }
}

function bootExtraImages() {
  return [
    ...Object.values(DRAGON_IMAGES),
    '/arenas/arena_stone.png',
    '/arenas/arena_grass.png',
    '/arenas/arena_purple.png',
    '/arenas/arena_fire.png',
    './shadow-drake-bg.png'
  ];
}

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
    this.walletManager.setBeforeRedirectCallback(() => this._saveAuthSnapshot());
    this.stakingManager = new StakingManager(this.eventBus, this.walletManager);
    this.matchmaking = null;
    this.aiController = null;
    this.localDragon = null;
    this.gameStartTime = 0;
    this.gameTimer = 0;
    this.isPaused = false;
    this.isSpectating = false;
    this.spectateTarget = null;
    this._lastKiller = null;
    this.lastTime = 0;
    this.animationFrame = null;
    this.firebaseApp = null;
    this.db = null;
    this.roomRef = null;
    this.matchId = null;
    this._endingGame = false;
    this.isMultiplayer = false;
    this.aiDifficulty = 'advanced';
    this.selectedMpMode = 'FFA';
    this.pendingArenaIndex = null;
    this.lobbyArenaIndex = 0;
    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this._pendingWalletLink = null;
    this.localPlayerId = null;
    this.playerIds = [];
    this.roomPlayers = {};
    this.remotePositions = {};
    this.positionsRef = null;
    this.lastBroadcast = 0;
    this.positionsListenerSet = false;
    this.combatEventsRef = null;
    this._combatEventListener = null;
    this._processedCombatEvents = new Set();
    // Host-side acknowledgement lock: one unresolved death per victim/life.
    // This prevents stale position snapshots from resurrecting a remote dragon
    // and awarding the same kill repeatedly before its life update arrives.
    this._pendingCombatDeaths = new Map();
    // Non-authority clients may show an immediate predicted death effect,
    // but only the host event can change lives or award kills.
    this._predictedCombatDeaths = new Map();
    this._combatListenStartedAt = 0;
    this.assetsLoaded = false;
    this.matchStats = {};
    this.winner = null;
    this.currentWaveIndex = -1;
    this.currentTier = null;
    this.sovereignStatus = false;
    this._remoteSovereign = {};
    this._waveTransitionPending = false;
    this._pendingPurge = [];
    this._frameCount = 0;
    // Reused every frame to avoid short-lived Map allocations and the
    // garbage-collection pauses they cause on lower-powered mobile devices.
    this._inputMap = new Map();
    this._domRefs = {};
    this._roomListener = null;
    this.init();
  }

  async init() {
    this.bootLoader = new BootLoader();
    this._loadAuthSnapshot();
    this.setupEventListeners();
    this._setupSprintButton();
    await this.setupFirebase();
    // ── Late-arrival auth recovery ──
    // If determineStartScreen() or _tryRestoreFirebaseAuth() already timed
    // out and dropped the player into guest mode, this persistent listener
    // catches the real Firebase account when it finally restores (which can
    // happen 5-15s after page load on slow mobile / tracking-prevented
    // browsers). It silently upgrades the session from guest → real account
    // so stat saves resume and the leaderboard "YOU" tag works again.
    if (this.auth) {
      this.auth.onAuthStateChanged((user) => {
        if (user && (!this.authUid || this.isGuest)) {
          console.log('[Auth] Late recovery: real account arrived after guest fallback. uid:', user.uid);
          this.authUid = user.uid;
          this.isGuest = false;
          this.db.ref('users/' + user.uid + '/username').once('value')
            .then((snap) => {
              if (snap.exists()) this.username = snap.val();
              this.uiManager.setAccount(this.authUid, this.db);
              this.uiManager.showLoginDrop(this.username, false);
              this._checkSovereignStatus();
            })
            .catch(() => {
              this.uiManager.setAccount(this.authUid, this.db);
              this.uiManager.showLoginDrop(this.username, false);
            });
        }
      });
    }
    this.effectsSystem.init();
    this.effectsSystem._preloadAudio();
    this.walletManager.processMobileRedirect();
    this._handoffResumeRoom = await this._redeemAuthHandoff();
    if (this.authUid && this.roomRef) {
      this.uiManager.setAccount(this.authUid, this.db);
      this.uiManager.showLoginDrop(this.username, this.isGuest);
    }
    this.walletManager._debugLog(
      `handoff: code=${this.walletManager._arrivedHandoffCode ? 'present' : 'none'} ` +
      `uid=${this.authUid ? 'restored' : 'MISSING'} room=${this._handoffResumeRoom || 'none'}`
    );
    if (!this.roomRef) {
      let urlHasWalletReturn = false;
      try {
        const params = new URLSearchParams(window.location.search);
        urlHasWalletReturn = !!(params.get('walletReturn') || this.walletManager._walletReturnType || this.walletManager._arrivedInWalletBrowser);
      } catch (_) {}
      if (this.walletManager._arrivedInWalletBrowser) {
        this._setLoadingMessage('Returning to Arena…');
        this.uiManager.showScreen('loadingScreen');
        await this.loadGameAssets();
        if (this.authUid && this._handoffResumeRoom) {
          this.enterMainMenu();
          await this._beginRoomResume(this._handoffResumeRoom);
        } else if (this.authUid) {
          this.enterMainMenu();
        } else {
          const screen = await this.determineStartScreen();
          if (screen === 'titleScreen') this.enterMainMenu();
          else this.uiManager.showScreen(screen);
        }
      } else if (urlHasWalletReturn) {
        const alreadyRestored = !!this.roomRef;
        if (!alreadyRestored) {
          this._setLoadingMessage('Returning to Arena…');
          this.uiManager.showScreen('loadingScreen');
        }
        setTimeout(() => {
          if (this._stakingResumeInFlight) return;
          if (!this.roomRef && this.uiManager.currentScreen === 'loadingScreen') {
            this.uiManager.showScreen('titleScreen');
          }
        }, 6000);
        this.loadGameAssets().then(async () => {
          if (this._stakingResumeInFlight) return;
          if (this.roomRef) {
            if (!this.authUid) await this._tryRestoreFirebaseAuth();
            this.uiManager.setAccount(this.isGuest ? null : this.authUid, this.db);
            this.uiManager.showLoginDrop(this.username, this.isGuest);
            if (this.uiManager.currentScreen === 'loadingScreen') {
              this.uiManager.showScreen('lobbyScreen');
            }
            return;
          }
          this.enterMainMenu();
          this._autoResumeLastRoom();
        });
      } else {
        await this.loadGameAssets();
        if (this.authUid && this._handoffResumeRoom) {
          this.enterMainMenu();
          await this._beginRoomResume(this._handoffResumeRoom);
        } else {
          const screen = await this.determineStartScreen();
          if (screen === 'titleScreen') {
            this.enterMainMenu();
            this._autoResumeLastRoom();
          } else {
            this.uiManager.showScreen(screen);
          }
        }
      }
    }
    if (this.roomRef) {
      await this.loadGameAssets();
    }
    this.stakingManager.getDisplayTiers()
      .then(tiers => this.uiManager.updateTierAmounts(tiers))
      .catch(err => console.warn('[Staking] Could not load tier amounts yet:', err.message));
  }

  async loadGameAssets() {
    if (this._assetsLoadStarted) return;
    this._assetsLoadStarted = true;
    this.bootLoader.startWatchdog();
    while (true) {
      try {
        await AssetLoader.preloadAll(
          (done, total) => this.bootLoader.setProgress(done, total),
          bootExtraImages()
        );
        await this.arenaManager.preloadAll();
        this.uiManager.buildDragonSelect(AssetLoader.getAllDragons());
        this.assetsLoaded = true;
        console.log('[Assets] All dragon and arena assets loaded successfully');
        this.bootLoader.finish();
        return;
      } catch (e) {
        console.error('Asset load failed:', e);
        await new Promise(resolve => this.bootLoader.fail(resolve));
      }
    }
  }

  enterMainMenu() {
    this.uiManager.setAccount(this.isGuest ? null : this.authUid, this.db);
    this.uiManager.showScreen('titleScreen');
    this.uiManager.showLoginDrop(this.username, this.isGuest);
    if (this._pendingWalletLink && this.authUid && this.db) {
      const { address, linkCode } = this._pendingWalletLink;
      this._pendingWalletLink = null;
      if (linkCode) {
        this.db.ref('walletLinkRequests/' + linkCode).once('value').then((snap) => {
          const req = snap.val();
          if (req && req.uid) {
            this.db.ref('users/' + req.uid + '/walletAddress').set(address).catch(() => {});
          }
          this.db.ref('walletLinkRequests/' + linkCode).remove().catch(() => {});
        }).catch(() => {});
      } else {
        this.db.ref('users/' + this.authUid + '/walletAddress').set(address).catch(() => {});
      }
    }
    this.loadGameAssets();
  }

  _setLoadingMessage(message) {
    const el = document.getElementById('loadingMessage');
    if (el) el.textContent = message || 'Entering the Arena...';
  }

  async _createAuthHandoffCode(roomCode) {
    try {
      if (!this.auth || !this.auth.currentUser || this.isGuest) return null;
      const idToken = await this.auth.currentUser.getIdToken();
      const resp = await fetch(`${BACKEND_URL}/handoff/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, roomCode: roomCode || null }),
      });
      if (!resp.ok) {
        console.warn('[AuthHandoff] create failed with status', resp.status);
        return null;
      }
      const data = await resp.json();
      if (!data || !data.ok || !data.code) return null;
      console.log('[AuthHandoff] code minted for room', roomCode || 'none');
      return data.code;
    } catch (err) {
      console.warn('[AuthHandoff] create error (continuing without handoff):', err?.message || err);
      return null;
    }
  }

  async _redeemAuthHandoff() {
    const code = this.walletManager && this.walletManager._arrivedHandoffCode;
    const arrivedRoom = (this.walletManager && this.walletManager._arrivedResumeRoom) || null;
    if (!code) return arrivedRoom;
    this.walletManager._arrivedHandoffCode = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        console.log('[AuthHandoff] retrying redemption in 1s...');
        await new Promise(r => setTimeout(r, 1000));
      }
      try {
        const resp = await fetch(`${BACKEND_URL}/handoff/redeem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data || !data.ok || !data.customToken) {
          console.warn('[AuthHandoff] redeem rejected:', data && data.reason);
          return arrivedRoom;
        }
        if (!this.auth) return data.roomCode || arrivedRoom;
        const result = await this.auth.signInWithCustomToken(data.customToken);
        this.authUid = result.user.uid;
        this.isGuest = false;
        try {
          const snap = await this.db.ref('users/' + this.authUid + '/username').once('value');
          if (snap.exists()) this.username = snap.val();
        } catch (_) {}
        console.log('[AuthHandoff] session restored for uid', this.authUid);
        return data.roomCode || arrivedRoom;
      } catch (err) {
        console.warn('[AuthHandoff] redeem error (attempt ' + (attempt + 1) + '):', err?.message || err);
        if (attempt === 0) continue;
        return arrivedRoom;
      }
    }
    return arrivedRoom;
  }

  async _tryRestoreFirebaseAuth() {
    if (!this.auth || this.authUid) return;
    if (this.auth.currentUser) {
      this.authUid = this.auth.currentUser.uid;
      this.isGuest = false;
      try {
        const snap = await this.db.ref('users/' + this.authUid + '/username').once('value');
        if (snap.exists()) this.username = snap.val();
      } catch (_) {}
      console.log('[Auth] restored from persisted session (sync):', this.authUid);
      return;
    }
    return new Promise((resolve) => {
      let resolved = false;
      // Was 2s — too aggressive. Firebase indexedDB restore can take longer
      // on mobile, and bailing early leaves the player in guest mode with
      // all stat saves silently skipped for the entire session.
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; if (unsubscribe) unsubscribe(); resolve(); }
      }, 8000);
      let unsubscribe;
      try {
        unsubscribe = this.auth.onAuthStateChanged((user) => {
          if (resolved) return;
          if (user) {
            resolved = true; clearTimeout(timeout); if (unsubscribe) unsubscribe();
            this.authUid = user.uid;
            this.isGuest = false;
            this.db.ref('users/' + this.authUid + '/username').once('value')
              .then((snap) => { if (snap.exists()) this.username = snap.val(); })
              .catch(() => {})
              .finally(resolve);
          } else {
            resolved = true; clearTimeout(timeout); if (unsubscribe) unsubscribe(); resolve();
          }
        });
      } catch (err) {
        resolved = true; clearTimeout(timeout); resolve();
      }
    });
  }

  _saveAuthSnapshot() {
    if (!this.authUid || this.isGuest) return;
    try {
      localStorage.setItem('ir_auth_snapshot', JSON.stringify({
        authUid: this.authUid,
        username: this.username || '',
        isGuest: !!this.isGuest,
        roomCode: this.roomCode || null,
        ts: Date.now()
      }));
    } catch (_) {}
  }

  _loadAuthSnapshot() {
    try {
      const raw = localStorage.getItem('ir_auth_snapshot');
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap.ts || Date.now() - snap.ts > 5 * 60 * 1000) {
        localStorage.removeItem('ir_auth_snapshot');
        return false;
      }
      this.authUid = snap.authUid || null;
      this.username = snap.username || '';
      this.isGuest = !!snap.isGuest;
      if (snap.roomCode) this.roomCode = snap.roomCode;
      console.log('[AuthSnapshot] restored from localStorage:', this.authUid, this.username);
      return true;
    } catch (_) { return false; }
  }

  _clearAuthSnapshot() {
    try { localStorage.removeItem('ir_auth_snapshot'); } catch (_) {}
  }

  async _beginRoomResume(roomCode) {
    if (!roomCode || !this.db) return;
    if (!this.authUid) await this._tryRestoreFirebaseAuth();
    const RESUME_LIMIT_MS = 5000;
    let finished = false;
    const banner = this.uiManager.showResumeBanner
      ? this.uiManager.showResumeBanner(roomCode, Math.round(RESUME_LIMIT_MS / 1000))
      : null;
    const succeed = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(ticker);
      if (this.uiManager.hideResumeBanner) this.uiManager.hideResumeBanner();
    };
    const giveUp = (message) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(ticker);
      if (this.uiManager.showResumeFailed) {
        this.uiManager.showResumeFailed(message || `Couldn't rejoin room ${roomCode}. Tap Play to continue.`);
      } else if (this.uiManager.hideResumeBanner) {
        this.uiManager.hideResumeBanner();
      }
      console.warn('[Resume]', message || 'rejoin failed');
    };
    let remaining = Math.round(RESUME_LIMIT_MS / 1000);
    const ticker = setInterval(() => {
      remaining -= 1;
      if (remaining >= 0 && this.uiManager.updateResumeBanner) {
        this.uiManager.updateResumeBanner(remaining);
      }
    }, 1000);
    const timer = setTimeout(() => {
      giveUp(`Couldn't rejoin room ${roomCode} in time. Tap Play to continue.`);
    }, RESUME_LIMIT_MS);
    try {
      if (!this.authUid) {
        giveUp('Session did not carry over - tap Play to continue.');
        return;
      }
      Promise.resolve(this.joinRoom(roomCode))
        .then(() => {
          if (this.roomRef) succeed();
          else giveUp(`Room ${roomCode} is no longer available.`);
        })
        .catch((err) => giveUp(err?.message || 'Rejoin failed.'));
    } catch (err) {
      giveUp(err?.message || 'Rejoin failed.');
    }
  }

  async _autoResumeLastRoom() {
    if (this.roomRef) return;
    const showFail = (m) => {
      if (this.uiManager.showResumeFailed) this.uiManager.showResumeFailed(m);
      console.warn('[Resume]', m);
    };
    if (!this.db) { showFail('Resume unavailable: no database connection.'); return; }
    const ctx = this._getLastRoom();
    if (!ctx || !ctx.roomCode) return;
    const RESUME_LIMIT_MS = 5000;
    let finished = false;
    let remaining = Math.round(RESUME_LIMIT_MS / 1000);
    if (this.uiManager.showResumeBanner) {
      this.uiManager.showResumeBanner(ctx.roomCode, remaining);
    }
    const ticker = setInterval(() => {
      remaining -= 1;
      if (this.uiManager.updateResumeBanner) this.uiManager.updateResumeBanner(remaining);
    }, 1000);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      clearInterval(ticker);
      if (this.uiManager.showResumeFailed) {
        this.uiManager.showResumeFailed(`Couldn't rejoin room ${ctx.roomCode} in time. Tap Play to continue.`);
      }
    }, RESUME_LIMIT_MS);
    const stop = () => { finished = true; clearTimeout(timer); clearInterval(ticker); };
    try {
      const snap = await this.db.ref('rooms/' + ctx.roomCode).once('value');
      if (finished) return;
      if (!snap.exists()) {
        stop();
        try { localStorage.removeItem(LAST_ROOM_KEY); } catch (_) {}
        if (this.uiManager.showResumeFailed) {
          this.uiManager.showResumeFailed(`Room ${ctx.roomCode} is no longer available.`);
        }
        return;
      }
      stop();
      this._rejoinRoom(ctx);
      if (this.uiManager.hideResumeBanner) this.uiManager.hideResumeBanner();
      setTimeout(() => this._assertLobbyScreen(), 400);
      setTimeout(() => this._assertLobbyScreen(), 1200);
      console.log('[Resume] rejoined room', ctx.roomCode);
    } catch (err) {
      stop();
      if (this.uiManager.showResumeFailed) {
        this.uiManager.showResumeFailed('Could not rejoin your room. Tap Play to continue.');
      }
      console.warn('[Resume] failed:', err?.message || err);
    }
  }

  _assertLobbyScreen() {
    if (!this.roomRef) return;
    const cur = this.uiManager.currentScreen;
    if (cur === 'loadingScreen' || cur === 'titleScreen') {
      this.uiManager.showScreen('lobbyScreen');
      if (this.uiManager.hideResumeBanner) this.uiManager.hideResumeBanner();
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
        this.auth = firebase.auth();
        this.googleProvider = new firebase.auth.GoogleAuthProvider();
        this.isGuest = false;
        this.authUid = null;
        this.matchmaking = new FirebaseMatchmaking(this.eventBus, this.db, {
          getIdentity: () => ({
            uid: this.authUid || ((this.walletManager && this.walletManager.publicKey)
              ? this.walletManager.publicKey.toString()
              : 'anon_' + Math.random().toString(36).slice(2)),
            name: this.username || 'Player',
            dragon: this.selectedDragon || null,
          }),
        });
      }
    } catch (e) {
      console.log('Firebase not available, running in local mode');
    }
  }

  async determineStartScreen() {
    if (this.authUid) return 'titleScreen';
    // Was 4s — too short for slow mobile networks / browser tracking-prevention
    // throttling. Firebase indexedDB persistence can take 6-10s to restore on
    // first load after a browser restart. Giving up early silently drops the
    // player into guest mode, which skips ALL stat saves for that session.
    const AUTH_TIMEOUT_MS = 12000;
    if (!this.auth) {
      this.isGuest = true;
      return 'titleScreen';
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (screen) => { if (!settled) { settled = true; resolve(screen); } };
      const timeoutId = setTimeout(() => {
        console.warn('[Auth] Timed out after', AUTH_TIMEOUT_MS, 'ms — falling back to guest mode (this session only). ' +
          'If your browser has tracking prevention enabled, try allowing third-party cookies for this site.');
        this.isGuest = true;
        finish('titleScreen');
      }, AUTH_TIMEOUT_MS);
      this.auth.onAuthStateChanged((user) => {
        clearTimeout(timeoutId);
        if (user) {
          this.authUid = user.uid;
          this.isGuest = false;
          this._checkSovereignStatus();
          if (this._pendingWalletLink) {
            const { address, linkCode } = this._pendingWalletLink;
            this._pendingWalletLink = null;
            if (linkCode) {
              this.db.ref('walletLinkRequests/' + linkCode).once('value').then((snap) => {
                const req = snap.val();
                if (req && req.uid) {
                  this.db.ref('users/' + req.uid + '/walletAddress').set(address).catch(() => {});
                }
                this.db.ref('walletLinkRequests/' + linkCode).remove().catch(() => {});
              }).catch(() => {});
            } else {
              this.db.ref('users/' + this.authUid + '/walletAddress').set(address).catch(() => {});
            }
          }
          this.db.ref('users/' + user.uid + '/username').once('value')
            .then((snap) => {
              if (snap.exists()) {
                this.username = snap.val();
              }
              // Check staking terms before proceeding to game
              this._checkStakingTerms(user, () => {
                if (snap.exists()) {
                  finish('titleScreen');
                } else {
                  finish('usernameScreen');
                }
              });
            })
            .catch(() => {
              this._checkStakingTerms(user, () => finish('titleScreen'));
            });
        } else {
          finish('loginScreen');
        }
      });
    });
  }


  // ================================================================
  // STAKING TERMS — one-time acceptance on first login
  // ================================================================
  async _checkStakingTerms(user, onProceed) {
    if (!user || !this.db) { onProceed(); return; }
    try {
      const snap = await this.db.ref('users/' + user.uid + '/termsAccepted').once('value');
      if (snap.exists() && snap.val() === true) {
        onProceed();
      } else {
        this._showStakingTermsModal(user, onProceed);
      }
    } catch (e) {
      console.warn('Terms check failed, proceeding:', e);
      onProceed();
    }
  }

  _showStakingTermsModal(user, onProceed) {
    const overlay = document.getElementById('stakingTermsOverlay');
    if (!overlay) { onProceed(); return; }

    const checkbox = document.getElementById('termsCheckbox');
    const acceptBtn = document.getElementById('termsAcceptBtn');
    const declineBtn = document.getElementById('termsDeclineBtn');

    // Reset state
    checkbox.checked = false;
    acceptBtn.disabled = true;

    // Checkbox enables accept button
    checkbox.onchange = () => {
      acceptBtn.disabled = !checkbox.checked;
    };

    // Accept handler — write to Firebase, hide modal, proceed
    acceptBtn.onclick = async () => {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Accepting...';
      try {
        await this.db.ref('users/' + user.uid).update({
          termsAccepted: true,
          termsAcceptedAt: firebase.database.ServerValue.TIMESTAMP
        });
      } catch (e) {
        console.warn('Failed to save terms acceptance:', e);
      }
      overlay.classList.remove('active');
      onProceed();
    };

    // Decline handler — sign out and go back to login
    declineBtn.onclick = () => {
      overlay.classList.remove('active');
      try { if (this.auth) this.auth.signOut(); } catch (_) {}
      this.uiManager.showScreen('loginScreen');
    };

    // Show the modal
    overlay.classList.add('active');
  }

  _friendlyAuthError(e) {
    const code = e && e.code;
    if (code === 'auth/network-request-failed') {
      return "Connection trouble reaching the login server. Tap Sign Up / Sign In again to retry, or tap Continue as Guest for now.";
    }
    if (code === 'auth/operation-not-allowed') {
      return "Google Sign-In is not enabled in Firebase Console. Please enable it in Authentication > Sign-in method > Google.";
    }
    if (code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
      return 'Incorrect email or password.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'An account already exists with that email - try Sign In instead.';
    }
    if (code === 'auth/weak-password') {
      return 'Password should be at least 6 characters.';
    }
    if (code === 'auth/invalid-email') {
      return 'That email address doesn\'t look right.';
    }
    return (e && e.message) || 'Something went wrong. Please try again.';
  }

  async signInWithGoogle() {
    if (!this.auth) return { error: 'Login unavailable right now.' };
    try {
      const result = await this.auth.signInWithPopup(this.googleProvider);
      this.authUid = result.user.uid;
      this.isGuest = false;
      const snap = await this.db.ref('users/' + this.authUid + '/username').once('value');
      if (snap.exists()) {
        this.username = snap.val();
        this.enterMainMenu();
      } else {
        this.uiManager.showScreen('usernameScreen');
      }
      return { success: true };
    } catch (e) {
      return { error: this._friendlyAuthError(e) };
    }
  }

  async signUpWithEmail(email, password, username) {
    if (!this.auth) return { error: 'Login unavailable right now.' };
    try {
      const result = await this.auth.createUserWithEmailAndPassword(email, password);
      this.authUid = result.user.uid;
      this.isGuest = false;
      await result.user.sendEmailVerification();
      const claim = await this.claimUsername(username);
      if (claim.error) {
        this.uiManager.showScreen('usernameScreen');
        this.uiManager.showUsernameError(claim.error);
      }
      return { success: true };
    } catch (e) {
      if (e && e.code === 'auth/network-request-failed') {
        this.uiManager.showAuthError('Connection slow... retrying in 2 seconds');
        await new Promise(r => setTimeout(r, 2000));
        try {
          const result = await this.auth.createUserWithEmailAndPassword(email, password);
          this.authUid = result.user.uid;
          this.isGuest = false;
          await result.user.sendEmailVerification();
          const claim = await this.claimUsername(username);
          if (claim.error) {
            this.uiManager.showScreen('usernameScreen');
            this.uiManager.showUsernameError(claim.error);
          }
          return { success: true };
        } catch (e2) {
          return { error: this._friendlyAuthError(e2) };
        }
      }
      return { error: this._friendlyAuthError(e) };
    }
  }

  async signInWithEmail(email, password) {
    if (!this.auth) return { error: 'Login unavailable right now.' };
    try {
      const result = await this.auth.signInWithEmailAndPassword(email, password);
      this.authUid = result.user.uid;
      this.isGuest = false;
      const snap = await this.db.ref('users/' + this.authUid + '/username').once('value');
      if (snap.exists()) {
        this.username = snap.val();
        this.enterMainMenu();
      } else {
        this.uiManager.showScreen('usernameScreen');
      }
      return { success: true };
    } catch (e) {
      if (e && e.code === 'auth/network-request-failed') {
        this.uiManager.showAuthError('Connection slow... retrying in 2 seconds');
        await new Promise(r => setTimeout(r, 2000));
        try {
          const result = await this.auth.signInWithEmailAndPassword(email, password);
          this.authUid = result.user.uid;
          this.isGuest = false;
          const snap = await this.db.ref('users/' + this.authUid + '/username').once('value');
          if (snap.exists()) {
            this.username = snap.val();
            this.enterMainMenu();
          } else {
            this.uiManager.showScreen('usernameScreen');
          }
          return { success: true };
        } catch (e2) {
          return { error: this._friendlyAuthError(e2) };
        }
      }
      return { error: this._friendlyAuthError(e) };
    }
  }

  continueAsGuest() {
    this.isGuest = true;
    this.enterMainMenu();
  }

  async signOut() {
    try { if (this.auth) await this.auth.signOut(); } catch (_) {}
    this._clearAuthSnapshot();
    this.authUid = null;
    this.username = null;
    this.isGuest = false;
    this.uiManager.setAccount(null, this.db);
    this.uiManager.showScreen('loginScreen');
  }

  async claimUsername(desiredName) {
    const name = (desiredName || '').trim();
    if (name.length < 3 || name.length > 20) return { error: 'Username must be 3-20 characters.' };
    if (!/^[a-zA-Z0-9_]+$/.test(name)) return { error: 'Letters, numbers, and underscores only.' };
    if (!this.authUid || !this.db) return { error: 'Not logged in.' };
    try {
      const allUsers = await this.db.ref('users').once('value');
      const taken = Object.values(allUsers.val() || {}).some(
        u => u && u.username && u.username.toLowerCase() === name.toLowerCase()
      );
      if (taken) return { error: 'That username is already taken.' };
      await this.db.ref('users/' + this.authUid).update({
        username: name,
        rank: 'Wingling',
        dragonKills: 0,
        multiplayerWins: 0,
        matchesPlayed: 0,
        timePlayedMs: 0,
        highestTierCleared: null,
        clearedTiers: {},
        createdAt: Date.now()
      });
      this.username = name;
      this.enterMainMenu();
      return { success: true };
    } catch (e) {
      return { error: e.message || 'Could not save username.' };
    }
  }

  async getProfileStats() {
    if (!this.authUid || !this.db) return null;
    try {
      const snap = await this.db.ref('users/' + this.authUid).once('value');
      return snap.val();
    } catch (e) {
      return null;
    }
  }

  async _checkSovereignStatus() {
    if (!this.authUid || !this.db) { this.sovereignStatus = false; return; }
    try {
      const snap = await this.db.ref('users/' + this.authUid + '/sovereignRank').once('value');
      this.sovereignStatus = !!snap.val();
      if (this.uiManager) this.uiManager.userSovereign = this.sovereignStatus;
    } catch (_) { this.sovereignStatus = false; }
  }

  async _grantSovereign() {
    if (!this.authUid) return;
    // ── Server-side verification via Firebase Cloud Function.
    // The function verifies auth + tier before writing sovereignRank.
    // This prevents browser-console tampering.
    try {
      if (this.firebaseApp && typeof firebase !== 'undefined' && firebase.functions) {
        const grantSovereign = firebase.functions().httpsCallable('grantSovereign');
        const result = await grantSovereign({
          tierId: 'hard',
          mode: this.selectedMode || 'wave1',
          multiplayer: !!this.isMultiplayer,
        });
        if (result.data && result.data.granted) {
          this.sovereignStatus = true;
          if (this.uiManager) this.uiManager.userSovereign = true;
          console.log('[Sovereign] Rank granted by server ✓');
        } else {
          console.warn('[Sovereign] Server declined:', result.data);
        }
      } else {
        // ── FALLBACK: Cloud Functions not available — direct Firebase write
        // for testing. Remove once grantSovereign function is deployed.
        console.warn('[Sovereign] Cloud Functions unavailable — using test fallback');
        if (this.db) {
          await this.db.ref('users/' + this.authUid + '/sovereignRank').set(true);
          this.sovereignStatus = true;
          if (this.uiManager) this.uiManager.userSovereign = true;
        }
      }
    } catch (e) {
      console.warn('[Sovereign] Cloud Function failed, falling back:', e.message);
      if (this.db && this.authUid) {
        await this.db.ref('users/' + this.authUid + '/sovereignRank').set(true).catch(() => {});
        this.sovereignStatus = true;
        if (this.uiManager) this.uiManager.userSovereign = true;
      }
    }
  }

  _formatSovereignName(name, isSovereign) {
    if (!name) return 'Unknown';
    if (!isSovereign) return name;
    return '<span class="sovereignBadge"><i class="fa-solid fa-crown"></i></span><span class="sovereignName">' + name + '</span>';
  }

  _isRemoteSovereign(playerId) {
    if (!playerId) return false;
    return !!(this._remoteSovereign && this._remoteSovereign[playerId]);
  }

  _isSovereignDragon(dragon) {
    if (!dragon) return false;
    if (dragon === this.localDragon) return this.sovereignStatus;
    if (dragon.isRemote && dragon.playerId) return this._isRemoteSovereign(dragon.playerId);
    return false;
  }

  setupEventListeners() {
    this.eventBus.on('auth:googleSignIn', async () => {
      const result = await this.signInWithGoogle();
      if (result.error) this.uiManager.showAuthError(result.error);
    });
    this.eventBus.on('auth:emailSubmit', async ({ mode, email, password, username }) => {
      const result = mode === 'signup'
        ? await this.signUpWithEmail(email, password, username)
        : await this.signInWithEmail(email, password);
      if (result.error) this.uiManager.showAuthError(result.error);
    });
    this.eventBus.on('auth:continueAsGuest', () => this.continueAsGuest());
    this.eventBus.on('auth:submitUsername', async ({ username }) => {
      const result = await this.claimUsername(username);
      if (result.error) this.uiManager.showUsernameError(result.error);
    });
    this.eventBus.on('auth:signOut', () => this.signOut());
    this.eventBus.on('profile:open', async () => {
      if (this.isGuest || !this.authUid) {
        this.uiManager.showScreen('loginScreen');
        return;
      }
      const stats = await this.getProfileStats();
      this.uiManager.showProfileStats(stats || {});
    });
    this.eventBus.on('wallet:connected', ({ address, linkCode }) => {
      if (!this.db || !address) return;
      if (!this.authUid) {
        this._pendingWalletLink = { address, linkCode };
        return;
      }
      if (linkCode) {
        this.db.ref('walletLinkRequests/' + linkCode).once('value').then((snap) => {
          const req = snap.val();
          if (req && req.uid) {
            this.db.ref('users/' + req.uid + '/walletAddress').set(address).catch(() => {});
          }
          this.db.ref('walletLinkRequests/' + linkCode).remove().catch(() => {});
        }).catch(() => {});
        this.uiManager.showScreen('walletSyncedScreen');
        return;
      }
      if (this.isGuest || !this.authUid) return;
      this.db.ref('users/' + this.authUid + '/walletAddress').set(address).catch(() => {});
    });
    this._watchWalletLinkSync = (uid) => {
      if (!this.db) return;
      const ref = this.db.ref('users/' + uid + '/walletAddress');
      const handler = (snap) => {
        const address = snap.val();
        if (address) {
          this.uiManager.showWalletSynced(address);
          ref.off('value', handler);
        }
      };
      ref.on('value', handler);
      setTimeout(() => ref.off('value', handler), 180000);
    };
    this.eventBus.on('ui:showDragonSelect', () => {
      this.uiManager.showScreen('dragonSelectScreen');
    });
    this.eventBus.on('ui:dragonSelected', ({ name }) => {
      this.selectedDragon = name;
    });
    this.eventBus.on('ui:arenaSelected', ({ mode, difficulty, tierId, arenaIndex }) => {
      this.pendingArenaIndex = arenaIndex;
      this.selectedMode = mode;
      this.aiDifficulty = difficulty;
      this.currentTier = tierId || null;
      this.startLocalGame(mode, difficulty, arenaIndex);
    });
    this.eventBus.on('ui:tierAdvance', ({ tierId }) => {
      if (this.isGuest) { this.uiManager.showScreen('loginScreen'); return; }
      const tier = AI_DIFFICULTY_TIERS.find(t => t.id === tierId);
      if (tier) this.startWaveRun(tier);
    });
    this.eventBus.on('ui:tierRestart', ({ tierId }) => {
      const tier = AI_DIFFICULTY_TIERS.find(t => t.id === tierId);
      if (tier) this.startWaveRun(tier);
    });
    this.eventBus.on('mp:createRoom', ({ mode }) => {
      if (this.isGuest) { this.uiManager.showScreen('loginScreen'); return; }
      this.createRoom(mode);
    });
    this.eventBus.on('mp:joinRoom', ({ code }) => {
      if (this.isGuest) { this.uiManager.showScreen('loginScreen'); return; }
      this.joinRoom(code);
    });
    this.eventBus.on('mp:leaveRoom', () => this.leaveRoom());
    this.eventBus.on('mp:startGame', () => this.startMpGame());
    this.eventBus.on('lobby:kickPlayer', ({ playerId }) => this.kickPlayer(playerId));
    this.eventBus.on('game:pause', () => this.pauseGame());
    this.eventBus.on('game:resume', () => this.resumeGame());
    this.eventBus.on('game:quit', () => this.quitGame());
    this.eventBus.on('game:restart', () => this.restartGame());
    this.eventBus.on('collision:eat', ({ dragon, food }) => {
      this.growthSystem.onEat(dragon, food);
      this.dragonManager.addAttackCharge(dragon, food.value || 1);
      this.dragonManager.addSprintCharge(dragon, food.value || 1);
      this.effectsSystem.spawnEatParticles(food.x, food.y, food.color);
      this.effectsSystem.playEatSound();
      const segments = dragon.segments ? dragon.segments.length : 0;
      const prevSegments = dragon._prevSegments || 0;
      if (segments > prevSegments && dragon === this.localDragon) {
        this._checkGrowthPopup(dragon);
      }
      dragon._prevSegments = segments;
    });
    this.eventBus.on('collision:tail-cut', ({ victim }) => {
      this.growthSystem.onCollisionTailCut(victim, 0.2);
    });
    this.eventBus.on('dragon:tailDamage', ({ victim, attacker }) => {
  this.growthSystem.onCollisionTailCut(
    victim,
    CONFIG.ATTACK_TAIL_DAMAGE_PERCENT
  );

  const neon =
    (attacker && CONFIG.DRAGON_NEON)
      ? (CONFIG.DRAGON_NEON[attacker.type] || '#ffffff')
      : '#ffffff';

  this.effectsSystem.spawnImpactSparks(
    victim.head.x,
    victim.head.y,
    neon
  );

  this.effectsSystem.addShake(
    victim === this.localDragon ? 7 : 3,
    220
  );

  this.effectsSystem.playHeadCollisionSound();
}); 
    
  this.eventBus.on('collision:recoil', ({
  dragon,
  other,
  directionX,
  directionY,
  force
}) => {
  if (!dragon) return;

  this.dragonManager.applyCollisionRecoil(
    dragon,
    directionX,
    directionY,
    force
  );

  const isLocal =
    dragon === this.localDragon;

  if (this.effectsSystem) {
    this.effectsSystem.addShake(
      isLocal ? 4 : 2,
      180
    );

    if (
      typeof this.effectsSystem.spawnImpactSparks ===
      'function'
    ) {
      this.effectsSystem.spawnImpactSparks(
        dragon.head.x,
        dragon.head.y,
        '#ffd24d'
      );
    }

    // Hit/damage sound — plays when the LOCAL player takes an actual
    // in-game hit (this event fires on every real dragon-vs-dragon bump).
    if (isLocal) this.effectsSystem.playHeadCollisionSound();
  }
});
    this.eventBus.on('collision:predicted-death', ({ dragon, killer }) => {
      if (!this.isMultiplayer || this.isHost || !dragon || !dragon.playerId) return;
      if (this._predictedCombatDeaths.has(dragon.playerId)) return;

      const neon = (killer && CONFIG.DRAGON_NEON)
        ? (CONFIG.DRAGON_NEON[killer.type] || '#ff6600')
        : '#ff6600';
      this.effectsSystem.spawnDeathExplosion(dragon.head.x, dragon.head.y, neon);
      this.effectsSystem.addShake(dragon === this.localDragon ? 10 : 4, 300);
      this.effectsSystem.flashVignette(dragon === this.localDragon ? '#ff0000' : neon, 0.3, 300);
      if (dragon === this.localDragon) this.effectsSystem.playDragonDeathSound();

      const timer = setTimeout(() => {
        this._predictedCombatDeaths.delete(dragon.playerId);
      }, 1200);
      this._predictedCombatDeaths.set(dragon.playerId, { timer });
    });

    this.eventBus.on('dragon:death', ({ dragon, killer, networkEventId = null }) => {
      const isRemote = !!dragon.isRemote;
      const isLocal = dragon === this.localDragon;
      const predicted = networkEventId && dragon.playerId
        ? this._predictedCombatDeaths.get(dragon.playerId)
        : null;
      if (predicted) {
        clearTimeout(predicted.timer);
        this._predictedCombatDeaths.delete(dragon.playerId);
      }

      // The host is the only multiplayer combat resolver. Publish its
      // decision once so every client applies the identical death.
      if (this.isMultiplayer && this.isHost && !networkEventId) {
        const publishedId = this._publishCombatDeath(dragon, killer);
        if (!publishedId) {
          console.warn('[Combat] Death was not published; missing player identity or room reference.');
          return;
        }
      }

      // ── Visual effects for ALL dragons (local + remote) ──
      const neon = (killer && killer !== dragon && CONFIG.DRAGON_NEON)
        ? (CONFIG.DRAGON_NEON[killer.type] || null)
        : null;
      const deathColor = neon || (isLocal ? '#ff2222' : '#ff6600');
      if (!predicted) {
        this.effectsSystem.spawnDeathExplosion(dragon.head.x, dragon.head.y, deathColor);
        this.effectsSystem.addShake(isLocal ? 10 : 4, isLocal ? 500 : 300);
        this.effectsSystem.flashVignette(isLocal ? '#ff0000' : (neon || '#ff4400'), isLocal ? 0.5 : 0.25, 400);
        if (isLocal) this.effectsSystem.playDragonDeathSound();
      }
      dragon.killStreak = 0;

      // ── Kill credit + sound + growth ──
      if (killer && killer !== dragon) {
        if (killer === this.localDragon) {
          killer.kills = (killer.kills || 0) + 1;
          this.effectsSystem.playKillSound();
        } else if (!isRemote) {
          this.effectsSystem.playKillSound(0.25);
        }

        if (killer === this.localDragon) {
          const victimSegments = dragon.segments ? dragon.segments.length : 0;
          let rewardSegments = 1;
          if (victimSegments >= 15) rewardSegments = 2;
          this.growthSystem.grow(killer, rewardSegments);

          const killerSegments = killer.segments ? killer.segments.length : 0;
          if (killerSegments >= 15) {
            const now = Date.now();
            if (!killer._comboTimer) { killer._comboTimer = 0; killer._comboCount = 0; }
            if (now - killer._comboTimer <= 4000) {
              killer._comboCount = (killer._comboCount || 0) + 1;
            } else {
              killer._comboCount = 1;
            }
            killer._comboTimer = now;
            if (killer._comboCount >= 3) {
              this.uiManager.showComboBanner(killer, killer._comboCount);
              this.effectsSystem.spawnKillSparkles(killer.head.x, killer.head.y, neon || '#ffd700');
              this.effectsSystem.flashVignette(neon || '#ffd700', 0.35, 300);
              this.effectsSystem.playKillSound();
            }
          }

          if (this.authUid && this.db && typeof firebase !== 'undefined') {
            this.db.ref('users/' + this.authUid + '/dragonKills')
              .set(firebase.database.ServerValue.increment(1))
              .catch(() => {});
          }
        }

        // Kill feed — show when local player is involved
        if (killer === this.localDragon || dragon === this.localDragon) {
          const killerName = this._getUsernameForDragon(killer) || killer.type || 'Unknown';
          const victimName = this._getUsernameForDragon(dragon) || dragon.type || 'Unknown';
          const killerColor = (CONFIG.DRAGON_NEON && CONFIG.DRAGON_NEON[killer.type]) || '#ffd700';
          const killerSov = this._isSovereignDragon(killer);
          const victimSov = this._isSovereignDragon(dragon);
          this._showKillFeed(killerName, victimName, killerColor, killerSov, victimSov);
        }
      }

      // ── Drop food from segments — for ALL dragons ──
      for (const seg of dragon.segments) {
        this.foodSystem.spawnFoodAt(seg.x, seg.y);
      }
      this.foodSystem.spawnFoodAt(dragon.head.x, dragon.head.y, true);

      // ── Authority split: local/AI vs remote ──
      if (isRemote) {
        // REMOTE: visual death only. Remote client owns lives/respawn/purge.
        // Lives are NOT decremented — applyRemotePositions will sync them
        // when the remote client broadcasts its updated state.
        dragon.alive = false;
        if (killer === this.localDragon) {
          this._lastKiller = null;
        }
        this.checkMatchEnd();
      } else {
        // LOCAL or AI: authoritative death
        dragon.deaths = (dragon.deaths || 0) + 1;
        dragon.lives = (dragon.lives || 0) - 1;

        if (dragon.lives > 0) {
          dragon.alive = false;
          setTimeout(() => {
            if (this.state === 'PLAYING') {
              this.dragonManager.respawnDragon(dragon, this.arenaManager);
              this.effectsSystem.spawnParticles(dragon.head.x, dragon.head.y, '#00ff88', 10, 3, 400);
              this.effectsSystem.playRespawnSound();
            }
          }, CONFIG.RESPAWN_DELAY_MS);
        } else {
          dragon.alive = false;
          this._pendingPurge.push({ dragon, time: Date.now() });
          if (isLocal) {
            this._lastKiller = (killer && killer !== dragon) ? killer : null;
          }
          if (this.isMultiplayer && dragon === this.localDragon && this.positionsRef) {
            this.lastBroadcast = 0;
            this.broadcastPosition();
          }
          this.checkMatchEnd();
        }
      }
    });this.eventBus.on('wallet:connectRequest', async () => {
      if (this.authUid && this.db && !this.isGuest) {
        const handoffCode = await this._createAuthHandoffCode();
        if (handoffCode) this.walletManager.pendingHandoffCode = handoffCode;
        const code = Math.random().toString(36).slice(2) + Date.now().toString(36);
        this.db.ref('walletLinkRequests/' + code).set({ uid: this.authUid, ts: Date.now() }).catch(() => {});
        this.walletManager.pendingLinkCode = code;
        this._watchWalletLinkSync(this.authUid);
      }
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
    this.eventBus.on('lobby:tierSelected', ({ tier, customAmount }) => {
      if (this.isHost && this.roomRef && !this.stakingState.hostDeposited) {
        this.lobbyTier = tier;
        this._customStakeAmount = (tier === 'Custom') ? customAmount : null;
        const updates = { tier };
        updates.customAmount = (tier === 'Custom') ? (customAmount || null) : null;
        this.roomRef.update(updates);
        this._refreshStakingUI();
      }
    });
    this.eventBus.on('lobby:depositRequested', () => this.handleDeposit());
    this.eventBus.on('ui:searchBattleTierSelected', async ({ tier }) => {
      this.uiManager.showScreen('matchmakingSearchScreen');
      const badge = document.getElementById('matchmakingTierBadge');
      if (badge) {
        const label = tier === 'Small' ? 'Low' : tier;
        badge.textContent = `${label} Stake`;
        badge.style.display = 'inline-block';
      }
      try {
        if (!this.matchmaking) { this.eventBus.emit('matchmaking:error', { message: 'Matchmaking is not ready yet. Please try again in a moment.' }); return; }
        await this.matchmaking.startSearch(tier);
      } catch (err) {
        this.eventBus.emit('matchmaking:error', { message: err?.message || 'Could not start matchmaking.' });
      }
    });
    this.eventBus.on('matchmaking:matched', ({ roomCode, isInitiator, tier, matchId, roomReady }) => {
      this._pendingMatch = { roomCode, isInitiator, tier, matchId, roomReady: !!roomReady };
      if (isInitiator) {
        this._prepareMatchedRoomAsOwner(tier, roomCode, matchId);
      }
      this.uiManager.showOpponentFound(tier);
    });
    this.eventBus.on('matchmaking:roomReady', ({ roomCode, matchId }) => {
      if (this._pendingMatch && this._pendingMatch.matchId === matchId) {
        this._pendingMatch.roomCode = roomCode;
        this._pendingMatch.roomReady = true;
      }
    });
    this.eventBus.on('matchmaking:proceed', () => {
      const m = this._pendingMatch;
      if (!m) { this.uiManager.showScreen('mpMenuScreen'); return; }
      if (m.isInitiator) {
        // Initiator already created the room in _prepareMatchedRoomAsOwner
        this.uiManager.setMatchedLobbyMode(true, m.tier);
        this.uiManager.showScreen('lobbyScreen');
        this._refreshStakingUI();
      } else {
        // Non-initiator: the initiator creates the room AFTER the matched
        // event fires, so m.roomCode is usually null at this point.
        // We need to wait for the roomCode to appear.
        if (m.roomReady && m.roomCode) {
          // RoomCode was included in the matched event — join immediately
          this.joinRoom(m.roomCode);
        } else {
          // RoomCode not yet available — show loading and poll for it.
          // Use a loading screen with a message instead of the broken
          // returnToMenuWithProcessing which has a hardcoded 5s timeout
          // that dumps the player on an empty lobby.
          this.uiManager.showScreen('loadingScreen');
          const msgEl = document.getElementById('loadingMessage') || document.getElementById('loadingText');
          if (msgEl) msgEl.textContent = 'Waiting for host to create the arena…';

          let joined = false;
          let pollAttempts = 0;
          const maxPollAttempts = 40; // backend room handoff: 20s maximum

          const tryJoin = (roomCode) => {
            if (joined) return;
            joined = true;
            this.joinRoom(roomCode);
          };
          const pollInterval = setInterval(() => {
            pollAttempts++;
            if (joined) {
              clearInterval(pollInterval);
              return;
            }
            if (pollAttempts >= maxPollAttempts) {
              clearInterval(pollInterval);
              console.error('[matchmaking:proceed] timed out waiting for roomCode');
              if (this.matchmaking) this.matchmaking.cancelSearch();
              this.uiManager.showScreen('mpMenuScreen');
              const err = document.getElementById('mpJoinError');
              if (err) err.textContent = 'Could not join the arena. Please try again.';
              return;
            }
            const pending = this._pendingMatch;
            if (pending && pending.roomReady && pending.roomCode) {
              clearInterval(pollInterval);
              tryJoin(pending.roomCode);
            }
          }, 500);
        }
      }
    });
    this.eventBus.on('matchmaking:cancelOpponentFound', () => {
      const m = this._pendingMatch;
      this._pendingMatch = null;
      if (m && m.isInitiator && this.roomRef) {
        try { this.roomRef.off(); } catch (_) {}
        this.roomRef.remove().catch(() => {});
        this.roomRef = null;
      }
      if (this.matchmaking) this.matchmaking.cancelSearch();
      this.uiManager.showScreen('mpMenuScreen');
    });
    this.eventBus.on('ui:cancelSearch', () => {
      if (this.matchmaking) this.matchmaking.cancelSearch();
    });
    this.eventBus.on('matchmaking:cancelled', () => {
      this.uiManager.showScreen('mpMenuScreen');
    });
    this.eventBus.on('matchmaking:opponentLeft', () => {
      this._pendingMatch = null;
      if (this.roomRef && this._matchedMode && !this.stakingState?.hostDeposited && !this.stakingState?.opponentDeposited) {
        try { this.roomRef.off(); } catch (_) {}
        this.roomRef.remove().catch(() => {});
        this.roomRef = null;
      }
      this.uiManager.showScreen('mpMenuScreen');
      const err = document.getElementById('mpJoinError');
      if (err) err.textContent = 'Your opponent left before staking. Search again.';
    });
    this.eventBus.on('matchmaking:error', ({ message }) => {
      if (this.matchmaking) this.matchmaking.cancelSearch();
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

  isWaveMode() {
    const mode = this.gameModeManager.getMode();
    return typeof mode === 'string' && mode.startsWith('wave');
  }

  checkMatchEnd() {
    const allDragons = this.dragonManager.getAllDragons();

    // In MP, the server (watchMatches.js) is the authority for match end.
    // We only trigger endGame locally when the LOCAL player is dead.
    if (this.isMultiplayer) {
      if (this.localDragon && this.localDragon.lives <= 0 && !this.localDragon.alive) {
        const living = this.dragonManager.getLivingDragons();
        const othersAlive = living.filter(d => d !== this.localDragon);
        if (othersAlive.length === 0) {
          // Await the backend's canonical settlement instead of ending from
          // a client-side snapshot that may still be catching up.
          return;
        } else if (!this.isSpectating || !this.spectateTarget || !this.spectateTarget.alive) {
          this.enterSpectateMode(othersAlive);
        }
      }
      return;
    }

    // Single-player / AI mode — original logic
    const withLives = allDragons.filter(d => d.lives > 0);
    if (withLives.length === 1 && allDragons.length > 1) {
      if (this.isWaveMode() && withLives[0] === this.localDragon) {
        this.advanceToNextWave();
        return;
      }
      this.winner = withLives[0];
      this.endGame(true);
      return;
    }
    if (withLives.length === 0 && allDragons.length > 0) {
      this.winner = null;
      this.endGame(true);
      return;
    }
    if (this.localDragon && this.localDragon.lives <= 0 && !this.localDragon.alive) {
      const living = this.dragonManager.getLivingDragons();
      const othersAlive = living.filter(d => d !== this.localDragon);
      if (othersAlive.length === 0) {
        this.endGame(true);
      } else if (!this.isSpectating || !this.spectateTarget || !this.spectateTarget.alive) {
        this.enterSpectateMode(othersAlive);
      }
    }
  }

  enterSpectateMode(livingDragons) {
    this.isSpectating = true;
    let target = (this._lastKiller && this._lastKiller.alive) ? this._lastKiller : null;
    if (!target) target = livingDragons[0] || null;
    this.spectateTarget = target;
    if (target) {
      this.uiManager.showSpectateOverlay(target, () => this.endGame(false));
    }
  }

  advanceToNextWave() {
    if (this._waveTransitionPending) return;
    const currentIndex = this.currentWaveIndex;
    const nextWave = AI_WAVES[currentIndex + 1];
    if (!nextWave) {
      this.onTierCleared();
      return;
    }
    this._waveTransitionPending = true;
    this.currentWaveIndex = currentIndex + 1;
    this.isPaused = true;
    this.uiManager.showWaveClearedCountdown(nextWave, () => {
      this._resetDragonToWaveStart(this.localDragon);
      const allDragons = this.dragonManager.getAllDragons();
      for (let i = allDragons.length - 1; i >= 0; i--) {
        const d = allDragons[i];
        if (d !== this.localDragon && !d.alive) {
          allDragons.splice(i, 1);
        }
      }
      this.spawnWaveDragons(nextWave.players - 1);
      this.isPaused = false;
      this.lastTime = performance.now();
      this._waveTransitionPending = false;
    });
  }

  spawnWaveDragons(count) {
    const spawnPositions = this.arenaManager.getSpawnPositions(count + 1);
    const aiNames = ['aegis', 'ignis', 'infinite', 'magnetron'];
    for (let i = 0; i < count; i++) {
      const spawn = spawnPositions[i + 1] || spawnPositions[i % spawnPositions.length];
      const aiName = aiNames[i % aiNames.length];
      const aiDragon = this.dragonManager.createDragon(aiName, spawn.x, spawn.y);
      aiDragon.isAI = true;
      this.effectsSystem.playRespawnSound();
      if (this.aiController) aiDragon.speed *= this.aiController.getSpeedMult();
      this.initMatchStats(aiDragon);
    }
  }

  onTierCleared() {
    this.state = 'GAME_OVER';
    this.uiManager.showPauseOverlay(false);
    this.uiManager.hideCountdown();
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
    const tier = AI_DIFFICULTY_TIERS.find(t => t.id === this.currentTier) || AI_DIFFICULTY_TIERS[0];
    const tierIdx = AI_DIFFICULTY_TIERS.findIndex(t => t.id === tier.id);
    const nextTier = AI_DIFFICULTY_TIERS[tierIdx + 1] || null;
    this.uiManager.showTierComplete(tier, nextTier);
    this._saveTierProgress(tier, tierIdx);
    if (tier.id === 'hard') this.effectsSystem.playVictorySound();
    if (tier.id === 'hard' && !this.isMultiplayer) {
      this._grantSovereign();
    }
  }

  // Persists single-player difficulty progress so it survives app restarts.
  // Writes: highestTierCleared (only moves forward), matchesPlayed, kills,
  // timePlayedMs (session time added on top of running total), and a
  // per-tier "cleared" flag so the picker can show completed tiers.
  async _saveTierProgress(tier, tierIdx) {
    if (!this.authUid || !this.db || typeof firebase === 'undefined') return;
    try {
      const sessionMs = this.gameStartTime ? (Date.now() - this.gameStartTime) : 0;
      const localKills = this.localDragon ? (this.localDragon.kills || 0) : 0;
      const userRef = this.db.ref('users/' + this.authUid);
      const snap = await userRef.once('value');
      const data = snap.val() || {};
      const currentBestIdx = AI_DIFFICULTY_TIERS.findIndex(t => t.id === data.highestTierCleared);
      const updates = {
        matchesPlayed: firebase.database.ServerValue.increment(1),
        dragonKills: firebase.database.ServerValue.increment(localKills),
        timePlayedMs: firebase.database.ServerValue.increment(sessionMs),
        aiMatchesPlayed: firebase.database.ServerValue.increment(1),
        aiKills: firebase.database.ServerValue.increment(localKills),
        aiTimePlayedMs: firebase.database.ServerValue.increment(sessionMs),
        lastPlayed: firebase.database.ServerValue.TIMESTAMP,
        ['clearedTiers/' + tier.id]: true
      };
      if (tierIdx > currentBestIdx) {
        updates.highestTierCleared = tier.id;
        updates.rank = tier.rank;
      }
      await userRef.update(updates);
      // Visible confirmation so it's obvious in DevTools that the save
      // actually landed in Firebase (was previously silent on success).
      console.log(
        '%c[Progress] ✅ SAVED — tier "' + tier.id + '" cleared, rank: ' + tier.rank +
        ', clearedTiers.' + tier.id + ' = true, kills +' + localKills + ', time +' + Math.round(sessionMs / 1000) + 's',
        'color:#4ade80;font-weight:bold;'
      );
      if (this.uiManager) this.uiManager.clearedTiers[tier.id] = true;
    } catch (e) {
      console.error('%c[Progress] ❌ FAILED to save tier progress: ' + e.message, 'color:#ff5c5c;font-weight:bold;', e);
    }
  }

  startWaveRun(tier) {
    this.currentTier = tier.id;
    this.selectedMode = 'wave1';
    this.aiDifficulty = tier.aiDifficulty;
    const arenaIdx = (this.pendingArenaIndex !== null && this.pendingArenaIndex !== undefined) ? this.pendingArenaIndex : 0;
    this.startLocalGame('wave1', tier.aiDifficulty, arenaIdx);
  }

  _resetDragonToWaveStart(dragon) {
    if (!dragon || !dragon.segments) return;
    const targetLength = CONFIG.DRAGON_START_SEGMENTS;
    const spacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;
    const hx = dragon.head ? dragon.head.x : (dragon.segments[0] ? dragon.segments[0].x : 0);
    const hy = dragon.head ? dragon.head.y : (dragon.segments[0] ? dragon.segments[0].y : 0);
    const angle = dragon.angle || 0;
    const newSegments = [];
    for (let i = 0; i < targetLength; i++) {
      newSegments.push({
        x: hx - Math.cos(angle) * spacing * i,
        y: hy - Math.sin(angle) * spacing * i
      });
    }
    dragon.segments = newSegments;
    if (dragon.growthProgress !== undefined) dragon.growthProgress = 0;
    if (dragon.attackCharge > 0) dragon.attackCharge = Math.min(dragon.attackCharge, 5);
    // Reset growth-milestone popup flags so "Growth Advance" fires again
    // each new wave, instead of only once for the whole mode run.
    dragon._shownPopups = {};
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
      if (!ctx.savedAt || Date.now() - ctx.savedAt > 2 * 60 * 60 * 1000) return null;
      return ctx;
    } catch (_) {
      return null;
    }
  }

  _clearLastRoom() {
    try { localStorage.removeItem(LAST_ROOM_KEY); } catch (_) {}
  }

  async _syncStakeFromChain() {
    if (!this.roomRef || !this.roomCode) return;
    const roomIdNum = parseInt(this.roomCode, 10);
    if (!roomIdNum) return;
    try {
      const onChain = await this.stakingManager.getRoomAccount(roomIdNum);
      if (!onChain.exists) return;
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

  async _restoreLobbyContextIfPresent() {
    if (this.roomRef) return;
    const ctx = this._consumeLobbyContext();
    if (ctx && this.db) await this._rejoinRoom(ctx);
  }

  async _rejoinRoom(ctx) {
    if (!this.authUid) await this._tryRestoreFirebaseAuth();
    this.roomCode = ctx.roomCode;
    this.isHost = ctx.isHost;
    this.localPlayerId = ctx.localPlayerId;
    this.selectedDragon = ctx.selectedDragon;
    this.selectedMpMode = ctx.selectedMpMode || this.selectedMpMode;
    this.lobbyTier = ctx.lobbyTier;
    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    this.uiManager.setAccount(this.isGuest ? null : this.authUid, this.db);
    this.uiManager.showLoginDrop(this.username, this.isGuest);
    this.uiManager.showScreen('lobbyScreen');
    this._attachRoomListener();
    this._ensurePresence();
    this._persistLastRoom();
    this._syncStakeFromChain();
  }

  _ensurePresence() {
    if (!this.roomRef) return;
    const baseFields = {
      dragon: this.selectedDragon || 'ignis',
      ready: true,
      authUid: this.authUid || null,
      sovereign: this.sovereignStatus || false,
    };
    // Set up onDisconnect presence so the server-side handleDisconnect
    // Cloud Function can detect drops and process forfeit after grace period.
    // This is critical for iOS where WebSocket drops on background/screen-lock.
    if (this.authUid) {
      const presenceRef = this.roomRef.child('presence/' + this.authUid);
      presenceRef.onDisconnect().set({
        disconnectedAt: firebase.database.ServerValue.TIMESTAMP,
      }).catch(() => {});
      // Clear disconnect flag on connect/reconnect
      presenceRef.update({ disconnectedAt: null }).catch(() => {});
    }
    if (this.isHost) {
      const hostRef = this.roomRef.child('players/local');
      hostRef.once('value').then(snap => {
        if (!snap.exists()) {
          hostRef.set({
            name: 'Player 1',
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            ...baseFields,
          });
        } else {
          const existing = snap.val() || {};
          const patch = {};
          if (!existing.authUid && this.authUid) patch.authUid = this.authUid;
          if (!existing.joinedAt) patch.joinedAt = firebase.database.ServerValue.TIMESTAMP;
          if (Object.keys(patch).length) hostRef.update(patch);
        }
      }).catch(() => {});
    } else if (this.localPlayerId) {
      const meRef = this.roomRef.child('players/' + this.localPlayerId);
      meRef.once('value').then(snap => {
        if (!snap.exists()) {
          meRef.set({
            name: 'Player',
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            ...baseFields,
          });
        } else {
          const existing = snap.val() || {};
          const patch = {};
          if (!existing.authUid && this.authUid) patch.authUid = this.authUid;
          if (!existing.joinedAt) patch.joinedAt = firebase.database.ServerValue.TIMESTAMP;
          if (Object.keys(patch).length) meRef.update(patch);
        }
      }).catch(() => {});
    }
  }

  async _verifyTxLanded(signature) {
    try {
      const conn = this.walletManager && this.walletManager.connection;
      if (!conn || !signature) return false;
      for (let i = 0; i < 6; i++) {
        try {
          const res = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
          const st = res && res.value;
          if (st) {
            if (st.err) return false;
            if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
              return true;
            }
          }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    } catch (_) { return false; }
  }

  async _resumeStakingAction(pendingAction, signature) {
    if (!pendingAction) {
      const ctx = this._consumeLobbyContext();
      if (ctx && this.db && !this.roomRef) await this._rejoinRoom(ctx);
      if (this.roomRef && this.isHost) {
        pendingAction = { type: 'createRoom', tier: this.lobbyTier };
      } else if (this.roomRef) {
        pendingAction = { type: 'joinRoom' };
      } else {
        this.eventBus.emit('staking:error', {
          message: 'Stake resume failed: no room context found. Please try placing your bet again.'
        });
        return;
      }
    }
    this._stakingResumeInFlight = true;
    try {
      return await this._resumeStakingActionInner(pendingAction, signature);
    } catch (err) {
      console.error('[Staking] resume failed:', err);
      this.eventBus.emit('staking:error', {
        message: err?.message || 'Stake confirmation failed. Please try placing your bet again.'
      });
    } finally {
      this._stakingResumeInFlight = false;
      this._assertLobbyScreen();
      setTimeout(() => this._assertLobbyScreen(), 400);
      setTimeout(() => this._assertLobbyScreen(), 1200);
    }
  }

  async _resumeStakingActionInner(pendingAction, signature) {
    if (!this.roomRef) {
      const ctx = this._consumeLobbyContext();
      if (ctx && this.db) await this._rejoinRoom(ctx);
    }
    const isStakeAction = pendingAction.type === 'createRoom' || pendingAction.type === 'joinRoom';
    if (isStakeAction) {
      if (!signature) {
        console.error('[Staking] resume attempted without a signature — not marking deposited');
        this.eventBus.emit('staking:error', {
          message: 'Your wallet did not return a transaction. No tokens moved. Please try placing your bet again.'
        });
        return;
      }
      const landed = await this._verifyTxLanded(signature);
      if (!landed) {
        console.error(`[Staking] mobile-redirect signature ${signature} did NOT land on-chain — not marking deposited`);
        this.eventBus.emit('staking:error', {
          message: 'Your stake transaction did not confirm on-chain. No tokens moved. Please try placing your bet again.'
        });
        return;
      }
    }
    if (pendingAction.type === 'createRoom') {
      await this._markDeposited('host', pendingAction.tier, signature);
    } else if (pendingAction.type === 'joinRoom') {
      await this._markDeposited('opponent', this.lobbyTier, signature);
    } else if (['mutualCancel', 'claimDepositTimeout', 'claimSettleTimeout'].includes(pendingAction.type)) {
      this.eventBus.emit('staking:confirmed', { label: 'Refund transaction confirmed on-chain.' });
    }
  }

  async _preflightStakeCheck(tier) {
    try {
      let needed;
      if (tier === 'Custom') {
        needed = Math.floor(Number(this._customStakeAmount));
        if (!Number.isFinite(needed) || needed < 1000) {
          this.eventBus.emit('staking:error', { message: 'Enter a valid custom stake (minimum 1,000 INFINITE).' });
          return false;
        }
        if (needed > 10000000) {
          this.eventBus.emit('staking:error', { message: 'Maximum custom stake is 10,000,000 INFINITE.' });
          return false;
        }
      } else {
        needed = TIER_AMOUNTS[tier];
      }
      if (!needed) return true;
      const { sol, infinite } = await this.walletManager.getSpendableBalances();
      if (infinite < needed) {
        this.eventBus.emit('staking:error', {
          message: `You need ${needed.toLocaleString()} INFINITE for this stake, but this wallet holds ${Math.floor(infinite).toLocaleString()}.`
        });
        return false;
      }
      if (sol < 0.0015) {
        this.eventBus.emit('staking:error', {
          message: 'This wallet needs a small amount of SOL (~0.005) to pay the network fee. Send it some SOL and try again.'
        });
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[Staking] pre-flight balance check failed (non-fatal, proceeding):', err?.message || err);
      return true;
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
    this._persistLastRoom();
    if (this.authUid && !this.isGuest) {
      const handoffCode = await this._createAuthHandoffCode(this.roomCode);
      if (handoffCode) {
        this.walletManager.pendingHandoffCode = handoffCode;
        this.walletManager.pendingResumeRoom = this.roomCode;
      }
    }
    try {
      if (this.isHost) {
        if (!this.lobbyTier) {
          this.eventBus.emit('staking:error', { message: 'Pick a stake tier first.' });
          return;
        }
        if (!(await this._preflightStakeCheck(this.lobbyTier))) return;
        this._persistLobbyContext();
        const result = await this.stakingManager.createStakedRoom({ roomId: roomIdNum, tier: this.lobbyTier, customAmount: this._customStakeAmount });
        if (result?.deepLinked) return;
        await this._markDeposited('host', this.lobbyTier, result.signature);
      } else {
        if (!this.lobbyTier) {
          this.eventBus.emit('staking:error', { message: 'Waiting for the host to lock in a tier.' });
          return;
        }
        if (!(await this._preflightStakeCheck(this.lobbyTier))) return;
        this._persistLobbyContext();
        const result = await this.stakingManager.joinStakedRoom({ roomId: roomIdNum, tier: this.lobbyTier, customAmount: this._customStakeAmount });
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
    const myPubkey = this.walletManager.publicKey.toString();
    if (role === 'host') {
      updates.tier = tier;
      updates.hostPubkey = myPubkey;
      updates['staking/hostDeposited'] = true;
      updates['staking/hostTx'] = signature;
    } else {
      updates.opponentPubkey = myPubkey;
      updates.opponentAuthUid = this.authUid || null;
      updates['staking/opponentDeposited'] = true;
      updates['staking/opponentTx'] = signature;
    }
    const myId = this.localPlayerId || 'local';
    updates[`players/${myId}/pubkey`] = myPubkey;
    updates[`players/${myId}/deposited`] = true;
    updates[`players/${myId}/depositTx`] = signature;
    await this.roomRef.update(updates);
    this._consumeLobbyContext();
    this.eventBus.emit('staking:confirmed', { label: `Deposit confirmed on-chain (tx ${String(signature).slice(0, 8)}…).` });
  }

  _refreshStakingUI() {
    const stakingApplies = !!this.lobbyTier;
    const tierSelector = document.getElementById('lobbyTierSelector');
    if (tierSelector) tierSelector.style.display = 'flex';
    if (!stakingApplies) {
      const startBtn = document.getElementById('lobbyStartBtn');
      if (startBtn) { startBtn.disabled = true; startBtn.style.display = 'none'; }
      const statusText = document.getElementById('depositStatusText');
      if (statusText) {
        statusText.textContent = '';
        statusText.className = 'depositStatusText';
      }
      return;
    }
    const playersArr = Object.values(this.roomPlayers || {});
    const myRecord = (this.roomPlayers && this.localPlayerId)
      ? this.roomPlayers[this.localPlayerId] : null;
    const myDeposited = !!(
      (myRecord && myRecord.deposited)
      || (this.isHost ? this.stakingState.hostDeposited : this.stakingState.opponentDeposited)
    );
    const mode = this.selectedMpMode || '1v1';
    const isFFA = mode !== '1v1' && playersArr.length >= 2;
    const allPlayersDeposited = isFFA
      ? (playersArr.length >= 2 && playersArr.every(p => !!(p && p.deposited)))
      : (this.stakingState.hostDeposited && this.stakingState.opponentDeposited);
    this.uiManager.updateStakingUI({
      isHost: this.isHost,
      tier: this.lobbyTier,
      locked: this.stakingState.hostDeposited || !!this.lobbyTier && this.isHost === false,
      hostDeposited: this.stakingState.hostDeposited,
      opponentDeposited: this.stakingState.opponentDeposited,
      myDeposited,
      allPlayersDeposited,
      mode,
      canDeposit: this.walletManager.connected,
    });
  }

  startLocalGame(mode, difficulty, arenaIndex) {
    this.gameModeManager.setMode(mode);
    this.arenaManager.setMode(mode, arenaIndex);
    this.currentWaveIndex = typeof mode === 'string' ? AI_WAVES.findIndex(w => w.id === mode) : -1;
    const maxPlayers = this.gameModeManager.getMaxPlayers();
    const spawnPositions = this.arenaManager.getSpawnPositions(maxPlayers);
    this.dragonManager.clear();
    this.foodSystem.init(this.arenaManager.getBounds(), this.arenaManager.getInnerBounds());
    this.aiController = new AIController(this.arenaManager, this.foodSystem, difficulty);
    this.matchStats = {};
    this.winner = null;
    this._endingGame = false;
    this._pendingPurge = [];
    if (this.isMultiplayer && this.playerIds && this.playerIds.length > 0) {
      const myIndex = this.playerIds.indexOf(this.localPlayerId);
      const localSpawn = spawnPositions[myIndex] || spawnPositions[0];
      this.localDragon = this.dragonManager.createDragon(
        this.selectedDragon || 'ignis',
        localSpawn.x,
        localSpawn.y
      );
      this.localDragon.playerId = this.localPlayerId;
      this.localDragon.sprintCharge = 0;
      this.localDragon.baseSpeed = this.localDragon.speed;
      if (this.uiManager && typeof this.uiManager.getTierSpeedMultiplier === 'function') {
        this.localDragon.baseSpeed *= this.uiManager.getTierSpeedMultiplier();
        this.localDragon.speed = this.localDragon.baseSpeed;
      }
      this.localDragon.sovereign = this.sovereignStatus;
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
        remoteDragon.sovereign = this._isRemoteSovereign(pid);
        this.initMatchStats(remoteDragon);
      }
    } else {
      const localSpawn = spawnPositions[0];
      this.localDragon = this.dragonManager.createDragon(
        this.selectedDragon || 'ignis',
        localSpawn.x,
        localSpawn.y
      );
      this.localDragon.sprintCharge = 0;
      this.localDragon.baseSpeed = this.localDragon.speed;
      if (this.uiManager && typeof this.uiManager.getTierSpeedMultiplier === 'function') {
        this.localDragon.baseSpeed *= this.uiManager.getTierSpeedMultiplier();
        this.localDragon.speed = this.localDragon.baseSpeed;
      }
      this.localDragon.sovereign = this.sovereignStatus;
      this.initMatchStats(this.localDragon);
      const aiNames = ['aegis', 'ignis', 'infinite', 'magnetron'];
      for (let i = 1; i < maxPlayers; i++) {
        const spawn = spawnPositions[i];
        const aiName = aiNames[i % aiNames.length];
        const teamId = this.gameModeManager.getTeamForPlayer(i);
        const aiDragon = this.dragonManager.createDragon(aiName, spawn.x, spawn.y, teamId);
        aiDragon.isAI = true;
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

  createRoom(mpMode, presetTier = null, matched = false, matchOptions = {}) {
    if (!this.db) {
      alert('Multiplayer not available. Running in local mode.');
      this.uiManager.showScreen('modeSelectScreen');
      return;
    }
    this._prepareForNewRoom();
    this.roomCode = /^\d{6}$/.test(String(matchOptions.roomCode || ''))
      ? String(matchOptions.roomCode)
      : Math.floor(100000 + Math.random() * 900000).toString();
    this.currentMatchId = matchOptions.matchId || null;
    this.isHost = true;
    this.selectedMpMode = mpMode || 'FFA';
    this.localPlayerId = 'local';
    this.playerIds = ['local'];
    this.lobbyArenaIndex = 0;
    this.lobbyTier = presetTier;
    this._matchedMode = !!matched;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    const MP_MAX = { '1v1': 2, 'FFA': 4, '2v2': 4 };
    const maxPlayers = matched
      ? 2
      : (MP_MAX[this.selectedMpMode] || (CONFIG.MAX_PLAYERS && CONFIG.MAX_PLAYERS[this.selectedMpMode]) || 4);
    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    // Automatch is always 1v1 — force it regardless of previously selected mode
    const roomMode = matched ? '1v1' : (mpMode || 'FFA');
    this.selectedMpMode = roomMode;
    this.roomRef.set({
      host: 'local',
      hostId: 'local',
      hostAuthUid: this.authUid || null,
      mode: roomMode,
      maxPlayers: maxPlayers,
      arenaIndex: 0,
      status: 'waiting',
      tier: presetTier,
      matched: !!matched,
      matchId: this.currentMatchId,
      staking: { hostDeposited: false, opponentDeposited: false },
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      players: {
        local: {
          name: this.username || 'Player 1',
          dragon: this.selectedDragon || 'ignis',
          ready: true,
          joinedAt: firebase.database.ServerValue.TIMESTAMP,
          authUid: this.authUid || null,
        }
      }
    }).then(() => {
      if (matched && this.matchmaking) {
        return this.matchmaking.announceRoomReady(this.roomCode);
      }
    }).catch((error) => {
      console.error('[createRoom] failed to create matched room:', error);
      if (matched) this.eventBus.emit('matchmaking:error', { message: 'Could not create the matched room. Please try again.' });
    });
    this.roomPlayers = { local: { name: this.username || 'Player 1', dragon: this.selectedDragon || 'ignis', ready: true } };
    if (matched) {
      this.uiManager.updateLobby(
        [{ name: this.username || 'Player 1', dragon: this.selectedDragon, isLocal: true, isHost: true, deposited: false }],
        maxPlayers, this.roomCode, true, '1v1'
      );
      this.uiManager.updateLobbyArena(this.lobbyArenaIndex || 0, true);
      if (!this._suppressMatchedNav) {
        this.uiManager.setMatchedLobbyMode(true, presetTier);
        this.uiManager.showScreen('lobbyScreen');
        this._refreshStakingUI();
      }
      this._attachRoomListener();
      this._ensurePresence();
      this._persistLastRoom();
      return;
    }
    this.uiManager.updateLobby(
      [{ name: this.username || 'Player 1', dragon: this.selectedDragon, isLocal: true, isHost: true, deposited: false }],
      maxPlayers,
      this.roomCode,
      true,
      this.selectedMpMode
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
    if (this._joinInProgress) {
      console.warn('[joinRoom] already in progress — ignoring duplicate call');
      return;
    }
    if (this.roomRef) {
      console.warn('[joinRoom] already in a room — ignoring duplicate call');
      return;
    }
    this._prepareForNewRoom();
    this._joinInProgress = true;
    this.roomCode = code;
    this.isHost = false;
    this.roomRef = this.db.ref('rooms/' + code);

    // Retry up to 4 times with 700ms delay. The host's roomRef.set() is
    // async — if the opponent tries to join immediately after receiving
    // the code, Firebase may not have completed the write yet, causing
    // a false "Room not found". Each retry gives the write more time to
    // propagate.
    const _tryRead = (attempt) => {
      this.roomRef.once('value').then(snapshot => {
        const data = snapshot.val();
        if (!data) {
          if (attempt < 4) {
            console.log('[joinRoom] room not found, retry ' + (attempt + 1) + '/4 in 700ms');
            setTimeout(() => _tryRead(attempt + 1), 700);
            return;
          }
          const err = document.getElementById('mpJoinError');
          if (err) err.textContent = 'Room not found. Double-check the code and try again.';
          this.roomRef = null;
          return;
        }

        // ── Room exists — join it ──
        const _MP_MAX = { '1v1': 2, 'FFA': 4, '2v2': 4 };
        const roomMax = data.maxPlayers || _MP_MAX[data.mode] || (CONFIG.MAX_PLAYERS && CONFIG.MAX_PLAYERS[data.mode]) || 4;
        const existingPlayers = data.players || {};

        // If we already have a player record (e.g. rejoining), reuse it
        if (this.authUid) {
          const preExisting = Object.entries(existingPlayers)
            .find(([, p]) => p && p.authUid && p.authUid === this.authUid);
          if (preExisting) {
            const [existingKey] = preExisting;
            console.log('[joinRoom] found existing record ' + existingKey + ' for my authUid — reusing');
            this.localPlayerId = existingKey;
            this.lobbyArenaIndex = data.arenaIndex !== undefined ? data.arenaIndex : 0;
            this.selectedMpMode = data.mode || this.selectedMpMode;
            this.lobbyTier = data.tier || null;
            this._matchedMode = !!data.matched;
            this.uiManager.setMatchedLobbyMode(!!data.matched, this.lobbyTier);
            this.uiManager.showScreen('lobbyScreen');
            this.uiManager.updateLobbyArena(this.lobbyArenaIndex, false);
            this._attachRoomListener();
            this._ensurePresence();
            this._persistLastRoom();
            return;
          }
        }

        const playerCount = Object.keys(existingPlayers).length;
        if (playerCount >= roomMax) {
          const err = document.getElementById('mpJoinError');
          if (err) err.textContent = 'Room is full';
          this.roomRef = null;
          return;
        }

        const newPlayerRef = this.roomRef.child('players').push({
          name: this.username || ('Player ' + (playerCount + 1)),
          dragon: this.selectedDragon || 'ignis',
          ready: true,
          joinedAt: firebase.database.ServerValue.TIMESTAMP,
          authUid: this.authUid || null,
        });
        this.localPlayerId = newPlayerRef.key;
        this.lobbyArenaIndex = data.arenaIndex !== undefined ? data.arenaIndex : 0;
        this.selectedMpMode = data.mode || this.selectedMpMode;
        this.lobbyTier = data.tier || null;
        this._matchedMode = !!data.matched;
        this.uiManager.setMatchedLobbyMode(!!data.matched, this.lobbyTier);
        this.uiManager.showScreen('lobbyScreen');
        this.uiManager.updateLobbyArena(this.lobbyArenaIndex, false);
        this._attachRoomListener();
        this._ensurePresence();
        this._persistLastRoom();
      }).catch(err => {
        console.error('[joinRoom] error:', err);
        const errEl = document.getElementById('mpJoinError');
        if (errEl) errEl.textContent = 'Connection error. Try again.';
        this.roomRef = null;
      }).finally(() => {
        this._joinInProgress = false;
      });
    };
    _tryRead(0);
  }

  _attachRoomListener() {
    if (!this.roomRef) return;
    if (this._roomListener) {
      try { this.roomRef.off('value', this._roomListener); } catch (_) {}
    }
    this._roomListener = (snap) => {
      const data = snap.val();
      if (!data) return;
      if (this.localPlayerId && data.kickedPlayers && data.kickedPlayers[this.localPlayerId]) {
        this._handleKickedFromRoom();
        return;
      }
      this.roomPlayers = data.players || {};
      this.playerIds = Object.keys(this.roomPlayers);
      this._remoteSovereign = {};
      for (const [pid, p] of Object.entries(this.roomPlayers)) {
        if (p && p.sovereign) this._remoteSovereign[pid] = true;
      }
      this.lobbyTier = data.tier || null;
      this._customStakeAmount = data.customAmount || null;
      this.matchId = data.matchId || null;
      this.stakingState = {
        hostDeposited: !!(data.staking && data.staking.hostDeposited),
        opponentDeposited: !!(data.staking && data.staking.opponentDeposited),
      };
      if (data.arenaIndex !== undefined && data.arenaIndex !== this.lobbyArenaIndex) {
        this.lobbyArenaIndex = data.arenaIndex;
        this.uiManager.updateLobbyArena(data.arenaIndex, this.isHost);
      }
      const stampedHostId = data.hostId || data.host || 'local';
      let computedHostId = stampedHostId;
      if (!this.roomPlayers[stampedHostId]) {
        const sorted = Object.entries(this.roomPlayers)
          .map(([id, p]) => ({ id, joinedAt: (p && p.joinedAt) || 0 }))
          .sort((a, b) => a.joinedAt - b.joinedAt);
        if (sorted.length) computedHostId = sorted[0].id;
      }
      if (computedHostId !== stampedHostId && this.localPlayerId === computedHostId) {
        try { this.roomRef.update({ hostId: computedHostId }); } catch (_) {}
      }
      this.isHost = (this.localPlayerId === computedHostId);
      const players = Object.entries(this.roomPlayers).map(([id, p]) => ({
        ...p,
        id,
        isLocal: id === this.localPlayerId,
        isHost: id === computedHostId,
        deposited: (p && p.deposited !== undefined)
          ? !!p.deposited
          : (id === stampedHostId ? this.stakingState.hostDeposited : this.stakingState.opponentDeposited),
      }));
      const _MP_MAX = { '1v1': 2, 'FFA': 4, '2v2': 4 };
      const roomMax = data.maxPlayers || _MP_MAX[data.mode] || (CONFIG.MAX_PLAYERS && CONFIG.MAX_PLAYERS[data.mode]) || 4;
      const roomMode = data.mode || this.selectedMpMode || (roomMax <= 2 ? '1v1' : 'FFA');
      this.uiManager.updateLobby(players, roomMax, this.roomCode, this.isHost, roomMode);
      this._refreshStakingUI();
      if (this._matchedMode && this.stakingState.hostDeposited && this.stakingState.opponentDeposited
          && this.isHost && this.state !== 'PLAYING' && this.state !== 'GAME_OVER' && data.status !== 'playing') {
        this.startMpGame();
      }
      if (this._shouldRunFFACountdown(data, players, roomMode)) {
        this._startFFACountdown();
      } else {
        this._stopFFACountdown();
      }
      const prevCount = this._lastPlayerCount || 0;
      this._lastPlayerCount = players.length;
      // Show "USERNAME joined" toast when a new player appears
      if (players.length > prevCount && prevCount > 0) {
        const newPlayers = players.slice(prevCount);
        for (const np of newPlayers) {
          if (np && np.name && !np.isLocal) {
            this.uiManager.showJoinToast(np.name);
          }
        }
      }
      if (data.status === 'playing'
          && this.state !== 'PLAYING'
          && this.state !== 'GAME_OVER'
          && !this.isHost) {
        const gameConfig = data.gameConfig || {};
        this.selectedMode = gameConfig.mode || data.mode || 'FFA';
        this.lobbyArenaIndex = gameConfig.arenaIndex !== undefined ? gameConfig.arenaIndex : (data.arenaIndex !== undefined ? data.arenaIndex : 0);
        this.isMultiplayer = true;
        this.startLocalGame(this.selectedMode, 'advanced', this.lobbyArenaIndex);
      }
    };
    this.roomRef.on('value', this._roomListener);
  }

  _prepareMatchedRoomAsOwner(tier, roomCode, matchId) {
    this._suppressMatchedNav = true;
    this.createRoom('1v1', tier, true, { roomCode, matchId });
    this._suppressMatchedNav = false;
  }

  async kickPlayer(playerId) {
    if (!this.isHost || !this.roomRef || !playerId) return;
    if (playerId === 'local') return;
    const p = (this.roomPlayers && this.roomPlayers[playerId]) || null;
    const staked = !!(p && (p.deposited || p.staked));
    if (staked) {
      console.warn('kickPlayer: refusing to kick staked player', playerId);
      return;
    }
    try {
      // Publish the notice and remove the player atomically. The kicked
      // client can leave locally without deleting the host's room.
      const updates = {};
      updates[`kickedPlayers/${playerId}`] = {
        kickedAt: firebase.database.ServerValue.TIMESTAMP,
        kickedBy: this.localPlayerId || 'local',
      };
      updates[`players/${playerId}`] = null;
      await this.roomRef.update(updates);
    } catch (e) { console.warn('kickPlayer error:', e); }
  }

  _handleKickedFromRoom() {
    const oldRoomRef = this.roomRef;
    const oldPlayerId = this.localPlayerId;
    this.stopNetworkSync();
    this._stopFFACountdown();
    if (oldRoomRef && this._roomListener) {
      try { oldRoomRef.off('value', this._roomListener); } catch (_) {}
    }
    if (oldRoomRef) {
      try { oldRoomRef.off(); } catch (_) {}
      if (this.authUid) {
        try { oldRoomRef.child('presence/' + this.authUid).remove(); } catch (_) {}
      }
      if (oldPlayerId) {
        try { oldRoomRef.child('kickedPlayers/' + oldPlayerId).remove(); } catch (_) {}
      }
    }
    this._roomListener = null;
    this.roomRef = null;
    this.roomCode = '';
    this.localPlayerId = null;
    this.playerIds = [];
    this.roomPlayers = {};
    this._lastPlayerCount = 0;
    this.isHost = false;
    this.isMultiplayer = false;
    this._matchedMode = false;
    this.lobbyTier = null;
    this._customStakeAmount = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this._consumeLobbyContext();
    this._clearLastRoom();
    if (this.uiManager.resetLobbyState) this.uiManager.resetLobbyState();
    this.uiManager.returnToMenuWithProcessing('mpMenuScreen', 'You were removed from the room.');
  }

  _shouldRunFFACountdown(roomData, players, roomMode) {
    if (roomMode === '1v1') return false;
    if (!roomData || roomData.status === 'playing') return false;
    if (this._matchedMode) return false;
    if (!Array.isArray(players) || players.length < 2) return false;
    const maxPlayers = roomData.maxPlayers || 4;
    if (players.length < maxPlayers) return false;
    return players.every(p => !!p.deposited);
  }

  _startFFACountdown() {
    if (this._ffaCountdownActive) return;
    this._ffaCountdownActive = true;
    this._ffaCountdownSecs = 60;
    if (this.uiManager && this.uiManager.showFFACountdown) {
      this.uiManager.showFFACountdown(60);
    }
    this._ffaCountdownTimer = setInterval(() => {
      this._ffaCountdownSecs -= 1;
      if (this.uiManager && this.uiManager.updateFFACountdown) {
        this.uiManager.updateFFACountdown(this._ffaCountdownSecs);
      }
      if (this._ffaCountdownSecs <= 0) {
        this._stopFFACountdown();
        if (this.isHost && this.state !== 'PLAYING') {
          this.startMpGame();
        }
      }
    }, 1000);
  }

  _stopFFACountdown() {
    if (this._ffaCountdownTimer) {
      clearInterval(this._ffaCountdownTimer);
      this._ffaCountdownTimer = null;
    }
    this._ffaCountdownActive = false;
    this._ffaCountdownSecs = 0;
    if (this.uiManager && this.uiManager.hideFFACountdown) {
      this.uiManager.hideFFACountdown();
    }
  }

  leaveRoom() {
    const myRecord = (this.roomPlayers && this.localPlayerId)
      ? this.roomPlayers[this.localPlayerId] : null;
    const iStakedPerPlayer = !!(myRecord && myRecord.deposited);
    const iStakedLegacy = this.isHost
      ? this.stakingState.hostDeposited
      : this.stakingState.opponentDeposited;
    const iStaked = iStakedPerPlayer || iStakedLegacy;
    const matchStarted = this.state === 'PLAYING' || this.state === 'GAME_OVER';
    if (iStaked && matchStarted) {
      this.eventBus.emit('staking:error', {
        message: 'Leaving a match in progress counts as a forfeit — your opponent(s) will be awarded the pot.'
      });
    } else if (iStaked) {
      this.eventBus.emit('staking:pending', {
        label: 'Refund in progress — your stake is being returned in full. Check your wallet in ~30 seconds to confirm your balance.'
      });
    }
    this.stopNetworkSync();
    this._stopFFACountdown();
    if (this.roomRef && this.localPlayerId) {
      if (this._roomListener) {
        try { this.roomRef.off('value', this._roomListener); } catch (_) {}
        this._roomListener = null;
      }
      try { this.roomRef.off(); } catch (_) {}
      try {
        this.roomRef.child('players/' + this.localPlayerId).remove();
      } catch (_) {}
      const remainingCount = Math.max(0, this.playerIds.length - 1);
      if (remainingCount === 0) {
        try { this.roomRef.remove(); } catch (_) {}
      }
      this.roomRef = null;
    }
    this.isHost = false;
    this.roomCode = '';
    this.matchId = null;
    this.localPlayerId = null;
    this.playerIds = [];
    this.roomPlayers = {};
    this._lastPlayerCount = 0;
    this.isMultiplayer = false;
    this._matchedMode = false;
    this.lobbyArenaIndex = 0;
    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this._customStakeAmount = null;
    this._stakingResumeInFlight = false;
    this._consumeLobbyContext();
    this._clearLastRoom();
    if (this.uiManager.resetLobbyState) this.uiManager.resetLobbyState();
    if (iStaked && !matchStarted) {
      this.uiManager.returnToMenuWithProcessing('titleScreen', 'Processing your refund…');
    } else {
      this.uiManager.showScreen('titleScreen');
    }
  }

  _prepareForNewRoom() {
    // Reset room and match UI only. Wallet/provider state is intentionally
    // outside this method and remains connected.
    this.state = 'MENU';
    this._endingGame = false;
    this.matchId = null;
    this._lastPlayerCount = 0;
    this._customStakeAmount = null;
    this._stakingResumeInFlight = false;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this.roomPlayers = {};
    this.playerIds = [];
    this._stopFFACountdown();
    if (this.uiManager.resetLobbyState) this.uiManager.resetLobbyState();
  }

  startMpGame() {
    if (!this.lobbyTier) {
      this.eventBus.emit('staking:error', { message: 'Pick a stake tier and place your bet before starting.' });
      return;
    }
    const players = Object.values(this.roomPlayers || {});
    const isFFA = (this.selectedMpMode || '') !== '1v1' && players.length > 2;
    let everyoneStaked;
    if (isFFA) {
      everyoneStaked = players.length >= 2 && players.every(p => !!(p && p.deposited));
    } else {
      everyoneStaked = this.stakingState.hostDeposited && this.stakingState.opponentDeposited;
    }
    if (!everyoneStaked) {
      this.eventBus.emit('staking:error', { message: 'All players must deposit their stake before the match can start.' });
      return;
    }
    if (this.roomRef && this.isHost) {
      // A room code can be reused; settlement must never be keyed by it alone.
      // Generate an immutable identity for this exact match before play starts.
      this.matchId = [
        this.roomCode,
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 10)
      ].join('-');
      this.roomRef.update({
        status: 'playing',
        matchId: this.matchId,
        gameStartedAt: firebase.database.ServerValue.TIMESTAMP,
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

  _getDragonByPlayerId(playerId) {
    if (!playerId) return null;
    return this.dragonManager.getAllDragons().find(
      dragon => dragon.playerId === playerId
    ) || null;
  }

  _rememberCombatEvent(eventId) {
    if (!eventId) return;
    this._processedCombatEvents.add(eventId);
    // Bound memory use during long matches.
    if (this._processedCombatEvents.size > 256) {
      const oldest = this._processedCombatEvents.values().next().value;
      this._processedCombatEvents.delete(oldest);
    }
  }

  _publishCombatDeath(victim, killer) {
    if (!this.isMultiplayer || !this.isHost || !this.combatEventsRef) return null;
    const victimId = victim && victim.playerId;
    const killerId = killer && killer.playerId;
    if (!victimId) return null;

    const previousLives = Number.isFinite(victim.lives) ? victim.lives : null;
    const pending = this._pendingCombatDeaths.get(victimId);
    if (pending && (previousLives === null || pending.previousLives === previousLives)) {
      return null;
    }

    const eventRef = this.combatEventsRef.push();
    const eventId = eventRef.key;
    if (!eventId) return null;

    // Lock this victim/life before writing. Position sync must acknowledge a
    // lower life count before another death can be published for this player.
    this._pendingCombatDeaths.set(victimId, { eventId, previousLives });

    // Mark before writing so the host does not process its own child_added
    // notification after already applying the collision locally.
    this._rememberCombatEvent(eventId);
    eventRef.set({
      type: 'death',
      matchId: this.matchId,
      victimId,
      killerId: killerId || null,
      createdAt: Date.now()
    }).catch(error => {
      console.error('[Combat] Failed to publish authoritative death:', error);
      this._processedCombatEvents.delete(eventId);
      const current = this._pendingCombatDeaths.get(victimId);
      if (current && current.eventId === eventId) this._pendingCombatDeaths.delete(victimId);
    });
    return eventId;
  }

  _startCombatEventSync() {
    if (!this.roomRef || !this.localPlayerId || !this.matchId) {
      console.error('[Combat] Cannot start sync without room, player and match identity.');
      return;
    }
    this.combatEventsRef = this.roomRef.child('combatEvents/' + this.matchId);
    this._processedCombatEvents.clear();
    this._pendingCombatDeaths.clear();
    this._combatListenStartedAt = Date.now();

    this._combatEventListener = snapshot => {
      const eventId = snapshot.key;
      const event = snapshot.val();
      if (!eventId || !event || event.type !== 'death') return;
      if (event.matchId !== this.matchId) return;
      if (this._processedCombatEvents.has(eventId)) return;

      // child_added also replays old children. Ignore events from an earlier
      // run so reconnecting players cannot lose lives to stale collisions.
      if (typeof event.createdAt === 'number' &&
          event.createdAt < this._combatListenStartedAt - 5000) {
        this._rememberCombatEvent(eventId);
        return;
      }

      const victim = this._getDragonByPlayerId(event.victimId);
      const killer = this._getDragonByPlayerId(event.killerId);
      this._rememberCombatEvent(eventId);
      if (!victim || !victim.alive) return;

      this.eventBus.emit('dragon:death', {
        dragon: victim,
        killer,
        networkEventId: eventId
      });
    };

    this.combatEventsRef.on('child_added', this._combatEventListener);
  }

  startNetworkSync() {
    if (!this.roomRef) return;
    this.positionsRef = this.roomRef.child('positions');
    this.positionsListenerSet = false;
    this.lastBroadcast = 0;
    this._startCombatEventSync();
    this._watchSettlement();
    this._startConnectionWatchdog();
  }

  _startConnectionWatchdog() {
    if (!this.lobbyTier) return;
    this._clearConnectionWatchdog();
    const onOffline = () => {
      if (this.state !== 'PLAYING') return;
      this.uiManager.showForfeitDefeat();
    };
    this._offlineHandler = onOffline;
    window.addEventListener('offline', onOffline);
    try {
      this._connRef = firebase.database().ref('.info/connected');
      this._connListener = this._connRef.on('value', (snap) => {
        if (snap.val() === false && this.state === 'PLAYING') {
          clearTimeout(this._connDropTimer);
          this._connDropTimer = setTimeout(() => {
            if (this.state === 'PLAYING') this.uiManager.showForfeitDefeat();
          }, 6000);
        } else if (snap.val() === true) {
          clearTimeout(this._connDropTimer);
          // Reconnected — re-establish presence so server knows we're back
          if (this.roomRef) this._ensurePresence();
        }
      });
    } catch (_) {}
  }

  _clearConnectionWatchdog() {
    if (this._offlineHandler) { try { window.removeEventListener('offline', this._offlineHandler); } catch (_) {} this._offlineHandler = null; }
    if (this._connRef && this._connListener) { try { this._connRef.off('value', this._connListener); } catch (_) {} }
    clearTimeout(this._connDropTimer);
    this._connRef = null; this._connListener = null;
  }

  _watchSettlement() {
    if (!this.roomRef) return;
    if (this._settlementRef && this._settlementListener) {
      try { this._settlementRef.off('value', this._settlementListener); } catch (_) {}
    }
    this._settlementHandled = false;
    if (this._settlementTimeoutId) { clearTimeout(this._settlementTimeoutId); this._settlementTimeoutId = null; }
    if (this.lobbyTier) {
      const stuckRoom = this.roomCode;
      this._settlementTimeoutId = setTimeout(() => {
        if (this._settlementHandled) return;
        console.warn(`[Settlement] no result after 90s for room ${stuckRoom} — showing delay message`);
        this.uiManager.showStakeBreakdown({
          delayed: true,
          roomCode: stuckRoom,
        });
      }, 90000);
    }
    this._settlementRef = this.roomRef.child('settlement');
    this._settlementListener = this._settlementRef.on('value', snap => {
      const s = snap.val();
      if (!s || this._settlementHandled) return;
      if (s.status === 'draw_needs_dispute_resolution') {
        this._settlementHandled = true;
        if (this._settlementTimeoutId) { clearTimeout(this._settlementTimeoutId); this._settlementTimeoutId = null; }
        this.uiManager.showStakeBreakdown({ draw: true });
        return;
      }
      if (typeof s.status === 'string' && s.status.startsWith('error_')) {
        this._settlementHandled = true;
        if (this._settlementTimeoutId) { clearTimeout(this._settlementTimeoutId); this._settlementTimeoutId = null; }
        console.error(`[Settlement] backend error status for room ${this.roomCode}: ${s.status}`, s);
        this.uiManager.showStakeBreakdown({
          error: true,
          errorStatus: s.status,
          errorMessage: s.errorMessage || null,
          roomCode: this.roomCode,
        });
        return;
      }
      if (s.status !== 'settled') return;
      this._settlementHandled = true;
      if (this._settlementTimeoutId) { clearTimeout(this._settlementTimeoutId); this._settlementTimeoutId = null; }
      let iWon;
      if (s.winnerId) {
        iWon = this.localPlayerId
          ? (this.localPlayerId === s.winnerId)
          : (this.isHost && s.winnerId === 'local');
      } else {
        iWon = (s.winner === 'host') === !!this.isHost;
      }
      if (this.state === 'PLAYING') {
        const all = this.dragonManager.getAllDragons();
        this.winner = iWon
          ? this.localDragon
          : (all.find(d => d !== this.localDragon) || null);
        this.endGame(true);
      } else if (this._lastStats) {
        const localStat = this._lastStats.find(st => st.isLocal);
        this.winner = iWon && localStat ? { id: localStat.id } : { id: '__remote__' };
        this.uiManager.showMatchStats(this._lastStats, this.winner);
      }
      if (s.signature) {
        this.eventBus.emit('staking:confirmed', {
          label: `Match settled on-chain - payout sent (tx ${String(s.signature).slice(0, 8)}…).`
        });
      }
      if (s.forfeit && iWon) {
        this.uiManager.showForfeitVictory();
      this.effectsSystem.playVictorySound();
      }
      this._showStakeBreakdown(iWon, s);
    });
  }

  stopNetworkSync() {
    if (this.positionsRef) {
      this.positionsRef.off();
      this.positionsRef = null;
    }
    if (this.combatEventsRef && this._combatEventListener) {
      this.combatEventsRef.off('child_added', this._combatEventListener);
    }
    this.combatEventsRef = null;
    this._combatEventListener = null;
    this._processedCombatEvents.clear();
    this._pendingCombatDeaths.clear();
    for (const predicted of this._predictedCombatDeaths.values()) clearTimeout(predicted.timer);
    this._predictedCombatDeaths.clear();
    this._combatListenStartedAt = 0;
    this.positionsListenerSet = false;
    this.remotePositions = {};
    this._clearConnectionWatchdog();
  }

  broadcastPosition() {
    if (!this.positionsRef || !this.localDragon || !this.localPlayerId) return;
    const now = Date.now();
    // Use 20Hz near opponents for responsive combat and 10Hz elsewhere to
    // avoid paying the higher Firebase/write cost for the whole match.
    let syncInterval = 100;
    const localHead = this.localDragon.head;
    for (const dragon of this.dragonManager.getAllDragons()) {
      if (!dragon.isRemote || !dragon.alive) continue;
      const dx = localHead.x - dragon.head.x;
      const dy = localHead.y - dragon.head.y;
      if (dx * dx + dy * dy < 700 * 700) { syncInterval = 50; break; }
    }
    if (this.lastBroadcast && now - this.lastBroadcast < syncInterval) return;
    this.lastBroadcast = now;
    this.positionsRef.child(this.localPlayerId).set({
      x: this.localDragon.head.x,
      y: this.localDragon.head.y,
      angle: this.localDragon.angle,
      score: this.localDragon.score || 0,
      segments: this.localDragon.segments.length,
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
      this._remotePosCache = {};
      this._lastRemoteApply = 0;
      // Just cache the snapshot — don't process it here
      this.positionsRef.on('value', snap => {
        this._remotePosCache = snap.val() || {};
      });
    }

    // Apply cached positions at 20Hz. This is local interpolation work and
    // does not increase Firebase reads; it reduces close-combat visual delay.
    const now = performance.now();
    if (now - this._lastRemoteApply < 50) return;
    this._lastRemoteApply = now;

    const remoteData = this._remotePosCache;
    if (!remoteData) return;

    for (const dragon of this.dragonManager.getAllDragons()) {
      if (!dragon.isRemote || !dragon.playerId) continue;
      const pos = remoteData[dragon.playerId];
      if (!pos) continue;

      // A host-published death remains locked until the victim broadcasts a
      // lower life count. Older snapshots may move the corpse, but cannot set
      // it alive again or make the same life eligible for another kill.
      let pendingDeath = this._pendingCombatDeaths.get(dragon.playerId);
      if (pendingDeath && typeof pos.lives === 'number' &&
          (pendingDeath.previousLives === null || pos.lives < pendingDeath.previousLives)) {
        this._pendingCombatDeaths.delete(dragon.playerId);
        pendingDeath = null;
      }

      const isConfirmedRespawn = pos.alive === true && !dragon.alive && !pendingDeath;
      if (isConfirmedRespawn) {
        // Rebuild the complete body while it is still hidden. Interpolating
        // from the death location exposed a travelling shadow and leaked the
        // next spawn edge to opponents.
        dragon.head.x = pos.x;
        dragon.head.y = pos.y;
        if (Number.isFinite(pos.angle)) dragon.angle = pos.angle;
        dragon.remoteTarget = { x: pos.x, y: pos.y, angle: pos.angle };
        dragon.collisionRecoilX = 0;
        dragon.collisionRecoilY = 0;
        this.dragonManager.initDragonSegments(dragon, pos.x, pos.y);
        if (typeof pos.segments === 'number') this._resizeRemoteDragon(dragon, pos.segments);
      } else {
        // Normal live snapshots remain smoothly interpolated.
        dragon.remoteTarget = { x: pos.x, y: pos.y, angle: pos.angle };
      }
      dragon.attackActive = !!pos.attackActive;
      dragon.boostActive = dragon.attackActive;

      if (!isConfirmedRespawn && typeof pos.segments === 'number' && pos.segments !== dragon.segments.length) {
        this._resizeRemoteDragon(dragon, pos.segments);
      }
      if (!pendingDeath && typeof pos.lives === 'number' && pos.lives !== dragon.lives) {
        dragon.lives = pos.lives;
      }
      if (typeof pos.alive === 'boolean' && pos.alive !== dragon.alive) {
        if (pos.alive && pendingDeath) {
          // Ignore stale resurrection until the victim acknowledges life loss.
          dragon.alive = false;
        } else if (pos.alive) {
          dragon.alive = true;
          this.effectsSystem.spawnParticles(pos.x, pos.y, '#00ff88', 10, 3, 400);
        } else {
          dragon.alive = false;
        }
      }
    }
  }

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
    this._frameCount = 0;
    this._pendingPurge = [];
    this._pendingCombatDeaths.clear();
    this._cacheGameDOM();
    if (this.uiManager.setLocalDragonRef) this.uiManager.setLocalDragonRef(this.localDragon);
    const sab = document.getElementById('stoneAgeBar');
    if (sab) { sab.style.display = 'flex'; sab.dataset.stage = ''; }
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
    const pauseBtn = document.getElementById('pauseBtn');
    const scoreDisplay = document.getElementById('scoreDisplay');
    if (pauseBtn) {
      if (this.isMultiplayer) pauseBtn.style.setProperty('display', 'none', 'important');
      else pauseBtn.style.removeProperty('display');
      pauseBtn.setAttribute('aria-hidden', this.isMultiplayer ? 'true' : 'false');
      pauseBtn.disabled = this.isMultiplayer;
    }
    if (scoreDisplay) {
      if (this.isMultiplayer) scoreDisplay.style.setProperty('display', 'none', 'important');
      else scoreDisplay.style.removeProperty('display');
      scoreDisplay.setAttribute('aria-hidden', this.isMultiplayer ? 'true' : 'false');
    }
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
    this._frameCount++;
    const doDOM = this._frameCount % 6 === 0;
    this._processPurge();

    this.gameTimer = Date.now() - this.gameStartTime;
    const minutes = Math.floor(this.gameTimer / 60000);
    const seconds = Math.floor((this.gameTimer % 60000) / 1000);
    const timeStr = minutes + ':' + seconds.toString().padStart(2, '0');

    this.foodSystem.update(deltaTime);
    this.movementSystem.update(this.dragonManager, this.cameraSystem, deltaTime);
    this.effectsSystem.update(deltaTime);

    const inputMap = this._inputMap;
    inputMap.clear();
    const allDragons = this.dragonManager.getAllDragons();

    const _livingDragons = this.dragonManager.getLivingDragons();
    let aiIndex = 0;
    for (const dragon of _livingDragons) {
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
        // Spread AI thinking across four frame buckets. Movement remains at
        // full frame rate using the previous heading, but expensive target
        // searches no longer all land in one frame and freeze every mode.
        const thinkPhase = aiIndex++ & 3;
        const shouldThink = (this._frameCount & 3) === thinkPhase;
        if (shouldThink) {
          angle = this.aiController.getInputAngle(dragon, allDragons);
          dragon._lastAIAngle = angle;
          dragon._lastAISprint = this.aiController.getSprintDecision(
            dragon,
            dragon._aiMode || 'food'
          );
        } else {
          // A newly spawned AI can safely hold its spawn heading for at most
          // three frames until its assigned think slot arrives.
          angle = dragon._lastAIAngle ?? dragon.angle ?? 0;
        }
        dragon.attackHeld = !!(dragon.aiHuntTarget && dragon.aiHuntTarget.alive &&
                               (dragon.attackCharge || 0) > 0);
        // AI sprint decision — uses the mode stored by getInputAngle
        if (dragon.sprintCharge === undefined) dragon.sprintCharge = 0;
        if (dragon.baseSpeed === undefined) dragon.baseSpeed = dragon.speed;
        dragon.sprintHeld = !!dragon._lastAISprint;
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

    const followDragon = (this.isSpectating && this.spectateTarget && this.spectateTarget.alive)
      ? this.spectateTarget
      : this.localDragon;
    this.cameraSystem.update(followDragon, this.arenaManager);
    // All clients keep responsive collision feedback, but only the room
    // host is allowed to decide multiplayer deaths.
    const resolvesDragonDeaths = !this.isMultiplayer || this.isHost;
    this.collisionSystem.checkAll(
      this.dragonManager,
      this.foodSystem,
      this.arenaManager,
      resolvesDragonDeaths
    );

    for (const dragon of _livingDragons) {
      if (this.matchStats[dragon.id]) {
        this.matchStats[dragon.id].timeSurvived = Date.now() - this.matchStats[dragon.id].startTime;
      }
    }

    if (this.state === 'PLAYING' && !this.isMultiplayer) {
      // Multiplayer waits for the backend's canonical settlement result.
      // Reuse the already-iterated _livingDragons instead of re-filtering
      // allDragons (avoids 2x Array allocation + 2x full scan per frame).
      let livingWithLivesCount = 0;
      let totalWithLivesCount = 0;
      let soleLivingDragon = null;
      for (const d of allDragons) {
        if (d.lives > 0) {
          totalWithLivesCount++;
          if (d.alive) {
            livingWithLivesCount++;
            soleLivingDragon = d;
          }
        }
      }
      if (livingWithLivesCount === 1 && totalWithLivesCount === 1 && allDragons.length > 1) {
        if (this.isWaveMode() && soleLivingDragon === this.localDragon) {
          this.advanceToNextWave();
          return;
        }
        this.winner = soleLivingDragon;
        this.endGame(true);
        return;
      }
    }

    if (this.localDragon) {
      this.localDragon.attackHeld = this.localDragon.alive && this.movementSystem.isAttackHeld();
    }

    this._updateSprintMath(deltaTime);
    if (doDOM) {
      const score = this.localDragon ? this.localDragon.score : 0;
      const waveNum = !this.isMultiplayer && this.isWaveMode()
        ? (this.currentWaveIndex + 1)
        : null;
      this.uiManager.updateHUD(score, timeStr, this.localDragon, waveNum);
      this.uiManager.updateAttackMeter(this.localDragon);
      if (this.localDragon && this.localDragon.segments) {
        this._updateStoneAgeBar(this.localDragon.segments.length, CONFIG.DRAGON_MAX_SEGMENTS || 50);
      }
      this._updateSprintDOM();
    }

    // Throttle minimap to every 3rd frame — it's a small overview,
    // redrawing it at 60fps wastes CPU/GPU on gradient creation + shadowBlur.
    if (this._frameCount % 4 === 0) {
      const minimap = this._domRefs.minimapCanvas || document.getElementById('minimapCanvas');
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
  }

  render() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = this._gameCtx || (this._gameCtx = canvas.getContext('2d'));
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
    // Competitive multiplayer cannot be paused by one client. The match,
    // network sync and host collision authority must remain live for everyone.
    if (this.isMultiplayer) {
      this.isPaused = false;
      this.uiManager.showPauseOverlay(false);
      return;
    }
    this.isPaused = true;
    this.uiManager.showPauseOverlay(true, this.isMultiplayer);
    // Hide HUD elements so they don't poke through the pause overlay
    ['gameHud', 'sprintHud', 'sprintHudLabel', 'growthPopup'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  resumeGame() {
    this.isPaused = false;
    this.uiManager.showPauseOverlay(false);
    // Restore HUD elements
    document.getElementById('gameHud') && (document.getElementById('gameHud').style.display = '');
    document.getElementById('sprintHud') && (document.getElementById('sprintHud').style.display = '');
    document.getElementById('sprintHudLabel') && (document.getElementById('sprintHudLabel').style.display = '');
    // growthPopup uses opacity/display toggle for its show animation, restore to hidden
    const gp = document.getElementById('growthPopup');
    if (gp && !gp.classList.contains('show')) gp.style.display = '';
    this.lastTime = performance.now();
  }

  endGame(hasWinner = false) {
    // Multiple Firebase callbacks and render frames can observe the same
    // terminal state. Only the first call may record stats or change screens.
    if (this._endingGame || this.state === 'GAME_OVER') return;
    this._endingGame = true;

    // Computed once so both the DB-write branch below and the
    // game-over-sound gate at screen-show time agree on the outcome.
    const _localWon = hasWinner && this.winner === this.localDragon;
    const sab = document.getElementById('stoneAgeBar');
    if (sab) sab.style.display = 'none';
    if (this.localDragon) {
      this.localDragon.sprintHeld = false;
      this.localDragon.sprintActive = false;
    }
    const sprintBtn = this._domRefs.sprintBtn || document.getElementById('sprintBtn');
    if (sprintBtn) {
      sprintBtn.classList.remove('sprint-ready', 'sprint-active');
      sprintBtn.style.setProperty('--sprint-fill', '0%');
    }
    if (this.roomRef && this.authUid && this.db && typeof firebase !== 'undefined') {
      // Multiplayer match end.
      const won = _localWon;
      const sessionMs = this.gameStartTime ? (Date.now() - this.gameStartTime) : 0;
      const localKills = this.localDragon ? (this.localDragon.kills || 0) : 0;
      const updates = {
        matchesPlayed: firebase.database.ServerValue.increment(1),
        dragonKills: firebase.database.ServerValue.increment(localKills),
        timePlayedMs: firebase.database.ServerValue.increment(sessionMs),
        mpMatchesPlayed: firebase.database.ServerValue.increment(1),
        mpKills: firebase.database.ServerValue.increment(localKills),
        mpTimePlayedMs: firebase.database.ServerValue.increment(sessionMs),
        lastPlayed: firebase.database.ServerValue.TIMESTAMP
      };
      if (won) {
        updates.multiplayerWins = firebase.database.ServerValue.increment(1);
        this.effectsSystem.playVictorySound();
      }
      this.db.ref('users/' + this.authUid).update(updates).catch(() => {});
    } else if (!this.isMultiplayer && this.authUid && this.db && typeof firebase !== 'undefined') {
      // Single-player run ended without clearing the tier (death/quit) —
      // still record the match, kills, and time played so nothing is lost.
      const sessionMs = this.gameStartTime ? (Date.now() - this.gameStartTime) : 0;
      const localKills = this.localDragon ? (this.localDragon.kills || 0) : 0;
      this.db.ref('users/' + this.authUid).update({
        matchesPlayed: firebase.database.ServerValue.increment(1),
        dragonKills: firebase.database.ServerValue.increment(localKills),
        timePlayedMs: firebase.database.ServerValue.increment(sessionMs),
        aiMatchesPlayed: firebase.database.ServerValue.increment(1),
        aiKills: firebase.database.ServerValue.increment(localKills),
        aiTimePlayedMs: firebase.database.ServerValue.increment(sessionMs),
        lastPlayed: firebase.database.ServerValue.TIMESTAMP
      }).catch(() => {});
    }
    this.state = 'GAME_OVER';
    this.isSpectating = false;
    this.spectateTarget = null;
    this.uiManager.hideSpectateOverlay();
    this.uiManager.hideQuitConfirm();
    this.uiManager.showPauseOverlay(false);
    this.uiManager.hideCountdown();
    this._pendingPurge = [];
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
    // Play the game-over screech when the death screen appears —
    // only on a loss. On a win, the victory roar already played above
    // and the screech shouldn't step on it.
    if (!_localWon) this.effectsSystem.playDeathSound(true);
    this._lastStats = stats;
    if (this.isMultiplayer) {
      try { localStorage.removeItem(LOBBY_CONTEXT_KEY); } catch (_) {}
      try { localStorage.removeItem(LAST_ROOM_KEY); } catch (_) {}
      const playAgain = document.getElementById('btnPlayAgain');
      if (playAgain) playAgain.style.display = 'none';
      if (this.lobbyTier) this.uiManager.showStakeBreakdown({ pending: true });
    } else {
      const playAgain = document.getElementById('btnPlayAgain');
      if (playAgain) playAgain.style.display = 'flex';
    }
  }

  _checkGrowthPopup(dragon) {
    const segments = dragon.segments ? dragon.segments.length : 0;
    if (!dragon._shownPopups) dragon._shownPopups = {};
    const milestones = [
      { seg: 10, stage: 'DRAKE', text: 'The Arena begins to recognize your name.' },
      { seg: 15, stage: 'WYRM', text: 'The fire in your chest burns brighter.' },
      { seg: 25, stage: 'ANCIENT', text: 'The Arena is yours to conquer.' }
    ];
    for (const m of milestones) {
      if (segments >= m.seg && !dragon._shownPopups[m.seg]) {
        dragon._shownPopups[m.seg] = true;
        const color = (CONFIG.DRAGON_NEON && CONFIG.DRAGON_NEON[dragon.type]) || '#ffd700';
        this.uiManager.showGrowthPopup(m.stage, m.text, color);
        break;
      }
    }
  }

  _setupSprintButton() {
    const sprintBtn = document.getElementById('sprintBtn');
    if (!sprintBtn) return;
    const start = (e) => {
      e.preventDefault();
      if (this.localDragon) {
        this.localDragon.sprintHeld = true;
      }
    };
    const end = (e) => {
      e.preventDefault();
      if (this.localDragon) {
        this.localDragon.sprintHeld = false;
      }
    };
    sprintBtn.addEventListener('pointerdown', start, { passive: false });
    sprintBtn.addEventListener('pointerup', end, { passive: false });
    sprintBtn.addEventListener('pointercancel', end, { passive: false });
    sprintBtn.addEventListener('lostpointercapture', end);
    sprintBtn.addEventListener('pointerdown', (e) => {
      try {
        sprintBtn.setPointerCapture(e.pointerId);
      } catch (_) {}
    }, { passive: false });
  }

  _updateSprintMath(deltaTime) {
    // Process local dragon sprint
    const dragon = this.localDragon;
    if (dragon && dragon.alive) {
      if (dragon.baseSpeed === undefined) dragon.baseSpeed = dragon.speed;
      if (dragon.sprintCharge === undefined) dragon.sprintCharge = 0;
      if (dragon.sprintHeld && dragon.sprintCharge > 0) {
        dragon.sprintActive = true;
        const drain = (CONFIG.SPRINT_METER_MAX / CONFIG.SPRINT_DURATION_MS) * deltaTime;
        dragon.sprintCharge = Math.max(0, dragon.sprintCharge - drain);
        dragon.speed = dragon.baseSpeed * 1.5;
      } else {
        dragon.sprintActive = false;
        dragon.speed = dragon.baseSpeed;
      }
    }

    // Process AI dragon sprint — same physics as the player
    if (!this.isMultiplayer) {
      const allDragons = this.dragonManager.getAllDragons();
      for (const d of allDragons) {
        if (d === this.localDragon || !d.alive || !d.isAI) continue;
        if (d.baseSpeed === undefined) d.baseSpeed = d.speed;
        if (d.sprintCharge === undefined) d.sprintCharge = 0;
        if (d.sprintHeld && d.sprintCharge > 0) {
          d.sprintActive = true;
          const drain = (CONFIG.SPRINT_METER_MAX / CONFIG.SPRINT_DURATION_MS) * deltaTime;
          d.sprintCharge = Math.max(0, d.sprintCharge - drain);
          d.speed = d.baseSpeed * 1.5;
        } else {
          d.sprintActive = false;
          d.speed = d.baseSpeed;
        }
      }
    }
  }

  _updateSprintDOM() {
    const dragon = this.localDragon;
    if (!dragon) return;
    const btn = this._domRefs.sprintBtn || document.getElementById('sprintBtn');
    if (!btn) return;
    const pct = Math.min(100, (dragon.sprintCharge / CONFIG.SPRINT_METER_MAX) * 100);
    btn.style.setProperty('--sprint-fill', pct + '%');
    if (dragon.sprintActive) {
      btn.classList.add('sprint-active');
      btn.classList.remove('sprint-ready');
    } else if (dragon.sprintCharge >= CONFIG.SPRINT_METER_MAX) {
      btn.classList.add('sprint-ready');
      btn.classList.remove('sprint-active');
    } else {
      btn.classList.remove('sprint-ready', 'sprint-active');
    }
    // Update the new sprint HUD bar
    const bar = document.getElementById('sprintHudBar');
    if (bar) {
      bar.style.width = pct + '%';
      if (dragon.sprintCharge >= CONFIG.SPRINT_METER_MAX) {
        bar.classList.add('sprint-full');
      } else {
        bar.classList.remove('sprint-full');
      }
      if (dragon.sprintActive) {
        bar.classList.add('sprint-draining');
      } else {
        bar.classList.remove('sprint-draining');
      }
    }
  }

  _showKillFeed(killerName, victimName, killerColor, killerSov, victimSov) {
    const feed = this._domRefs.killFeed || document.getElementById('killFeed');
    const content = this._domRefs.killFeedContent || document.getElementById('killFeedContent');
    if (!feed || !content) return;
    const killerDisplay = killerSov
      ? '<span class="sovereignBadge"><i class="fa-solid fa-crown"></i></span><span class="sovereignName">' + (killerName || 'Unknown') + '</span>'
      : '<span style="color:' + (killerColor || '#d4af37') + ';">' + (killerName || 'Unknown') + '</span>';
    const victimDisplay = victimSov
      ? '<span class="sovereignBadge"><i class="fa-solid fa-crown"></i></span><span class="sovereignName">' + (victimName || 'Unknown') + '</span>'
      : '<span>' + (victimName || 'Unknown') + '</span>';
    content.innerHTML = `
      <span class="kill-killer">${killerDisplay}</span>
      <span class="kill-action">Slayed</span>
      <span class="kill-divider"></span>
      <span class="kill-victim">${victimDisplay}</span>
    `;
    feed.classList.add('show');
    feed.style.display = 'block';
    if (this._killFeedTimer) clearTimeout(this._killFeedTimer);
    this._killFeedTimer = setTimeout(() => {
      feed.classList.remove('show');
      setTimeout(() => { feed.style.display = 'none'; }, 400);
    }, 3000);
  }

  _getStageName(segments) {
    if (segments >= 50) return 'MAX';
    if (segments >= 25) return 'ANCIENT';
    if (segments >= 15) return 'WYRM';
    if (segments >= 10) return 'DRAKE';
    return 'HATCHLING';
  }

  _updateStoneAgeBar(segments, maxSegments) {
    const bar = this._domRefs.stoneAgeBar;
    const fill = this._domRefs.stoneAgeBarFill;
    const number = this._domRefs.stoneAgeBarNumber;
    const label = this._domRefs.stoneAgeStageLabel;
    if (!bar || !fill || !label) return;
    const pct = Math.min(100, (segments / Math.max(1, maxSegments)) * 100);
    fill.style.width = pct + '%';
    if (number) number.textContent = segments;
    const stage = this._getStageName(segments);
    const prevStage = bar.dataset.stage || '';
    if (stage !== prevStage) {
      bar.dataset.stage = stage;
      label.textContent = stage;
      label.classList.remove('stage-pop');
      void label.offsetWidth;
      label.classList.add('stage-pop');
      fill.classList.remove('bar-pulse');
      void fill.offsetWidth;
      fill.classList.add('bar-pulse');
    }
  }

  _getUsernameForDragon(dragon) {
    if (!dragon) return null;
    if (dragon === this.localDragon) {
      return this.username || 'You';
    }
    if (dragon.isRemote && dragon.playerId) {
      const player = this.roomPlayers ? this.roomPlayers[dragon.playerId] : null;
      if (player && player.name) {
        return player.name;
      }
      if (this.roomPlayers) {
        for (const [id, p] of Object.entries(this.roomPlayers)) {
          if (p.dragon && p.dragon.toLowerCase() === dragon.type.toLowerCase()) {
            return p.name || dragon.type;
          }
        }
      }
    }
    if (dragon.isAI) {
      return dragon.type || 'AI';
    }
    return dragon.type || null;
  }

  async _showStakeBreakdown(iWon, settlement) {
    try {
      const tiers = await this.stakingManager.getDisplayTiers();
      const tierName = String(settlement?.tier || this.lobbyTier || '').toLowerCase();
      const parseAmt = (v) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

      // ── Resolve stake amount ──
      let stake;
      if (tierName === 'custom') {
        stake = Number(this._customStakeAmount)
             || parseAmt(settlement?.customAmount)
             || 0;
      } else {
        const tierKey = Object.keys(tiers).find(k => k.toLowerCase() === tierName);
        stake = tierKey ? parseAmt(tiers[tierKey]) : 0;
      }

      // ── Player count: 1v1 = 2, FFA = 4, 2v2 = 4 ──
      const numPlayers = (this.playerIds && this.playerIds.length)
                      || (this.roomPlayers && Object.keys(this.roomPlayers).length)
                      || 2;

      // Treasury receives one flat 5% of the combined pot in every mode.
      // Prefer canonical backend amounts once settlement exists; calculation
      // is only the pre-result fallback, so the UI cannot disagree on payout.
      const feePct = 5;
      const calculatedPot = stake * numPlayers;
      const canonicalPot = Number(settlement?.pot);
      const canonicalFee = Number(settlement?.fee);
      const canonicalPayout = Number(settlement?.payout);
      const pot = Number.isFinite(canonicalPot) && canonicalPot > 0 ? canonicalPot : calculatedPot;
      const fee = Number.isFinite(canonicalFee) && canonicalFee >= 0
        ? canonicalFee
        : pot * (feePct / 100);
      const payout = Number.isFinite(canonicalPayout) && canonicalPayout >= 0
        ? canonicalPayout
        : pot - fee;
      const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

      this.uiManager.showStakeBreakdown({
        won: iWon,
        stakeText: stake ? `${fmt(stake)} INFINITE` : null,
        potText: stake ? `${fmt(pot)} INFINITE` : null,
        feeText: stake ? `-${fmt(fee)} INFINITE` : null,
        payoutText: stake ? `${fmt(payout)} INFINITE` : null,
        feePct,
        signature: settlement?.signature || null,
        cluster: settlement?.cluster || 'mainnet-beta',
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

    // ── Reset ALL multiplayer state ──
    this.isMultiplayer = false;
    this.playerIds = [];
    this.roomPlayers = {};
    this.localPlayerId = null;
    this.isHost = false;
    this.roomCode = '';
    this.matchId = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this.lobbyTier = null;
    this._customStakeAmount = null;
    this._lastPlayerCount = 0;
    this._stakingResumeInFlight = false;
    this._matchedMode = false;
    this.remotePositions = {};
    this.winner = null;
    this._pendingPurge = [];
    this._pendingCombatDeaths.clear();
    for (const predicted of this._predictedCombatDeaths.values()) clearTimeout(predicted.timer);
    this._predictedCombatDeaths.clear();
    this._remoteSovereign = {};
    this.positionsListenerSet = false;

    // ── Clean up settlement listener + timeout ──
    if (this._settlementRef && this._settlementListener) {
      try { this._settlementRef.off('value', this._settlementListener); } catch (_) {}
    }
    this._settlementRef = null;
    this._settlementListener = null;
    this._settlementHandled = false;
    if (this._settlementTimeoutId) {
      clearTimeout(this._settlementTimeoutId);
      this._settlementTimeoutId = null;
    }

    // ── Clean up room listener ──
    if (this._roomListener && this.roomRef) {
      try { this.roomRef.off('value', this._roomListener); } catch (_) {}
      this._roomListener = null;
    }
    if (this.roomRef) {
      try { this.roomRef.off(); } catch (_) {}
      this.roomRef = null;
    }
    this.positionsRef = null;
    this._consumeLobbyContext();
    this._clearLastRoom();
    if (this.uiManager.resetLobbyState) this.uiManager.resetLobbyState();

    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  _cacheGameDOM() {
    this._domRefs = {
      stoneAgeBar: document.getElementById('stoneAgeBar'),
      stoneAgeBarFill: document.getElementById('stoneAgeBarFill'),
      stoneAgeBarNumber: document.getElementById('stoneAgeBarNumber'),
      stoneAgeStageLabel: document.getElementById('stoneAgeStageLabel'),
      sprintBtn: document.getElementById('sprintBtn'),
      timerDisplay: document.getElementById('timerDisplay'),
      scoreVal: document.getElementById('scoreVal'),
      killFeed: document.getElementById('killFeed'),
      killFeedContent: document.getElementById('killFeedContent'),
      minimapCanvas: document.getElementById('minimapCanvas'),
    };
  }

  _processPurge() {
    if (!this._pendingPurge.length) return;
    const now = Date.now();
    const all = this.dragonManager.getAllDragons();
    for (let i = this._pendingPurge.length - 1; i >= 0; i--) {
      const entry = this._pendingPurge[i];
      if (now - entry.time < 1200) continue;
      const idx = all.indexOf(entry.dragon);
      if (idx > -1) {
        all.splice(idx, 1);
        delete this.matchStats[entry.dragon.id];
      }
      this._pendingPurge.splice(i, 1);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
// ==================== END OF main.js ====================
