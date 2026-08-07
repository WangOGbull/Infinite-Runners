import CONFIG, { DRAGON_IMAGES, AI_WAVES, AI_DIFFICULTY_TIERS } from './config.js';
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
import StakingManager, { TIER_AMOUNTS } from './stakingManager.js';
import AIController from './aiController.js';
import FirebaseMatchmaking from './firebaseMatchmaking.js';

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

  // Call this the moment actual asset fetching begins (not at construction
  // time) - BootLoader gets created before Firebase setup, wallet redirect
  // handling, and the login-gate decision run, all of which take real time
  // before a single image request even fires. Without this, that setup
  // time was silently eating into the 10s stall grace period, so a
  // perfectly healthy connection could trip the "weak network" warning
  // before loading had genuinely had a fair chance to prove itself.
  startWatchdog() {
    this.lastTick = Date.now();
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
    this.matchmaking = null; // created once Firebase db is ready (see setup)
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
    this.isMultiplayer = false;
    this.aiDifficulty = 'advanced';
    this.selectedMpMode = 'FFA';
    this.pendingArenaIndex = null;
    this.lobbyArenaIndex = 0;

    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };

    // Wallet link that arrived before Firebase auth restored (mobile redirect)
    this._pendingWalletLink = null;

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

    // AI wave chaining (see isWaveMode()/advanceToNextWave()/startWaveRun())
    // - -1 means "not currently in a wave match"; currentWaveIndex is reset
    // properly every startLocalGame(). currentTier ('easy'/'medium'/'hard')
    // is set from ui:arenaSelected or startWaveRun().
    this.currentWaveIndex = -1;
    this.currentTier = null;
    this._waveTransitionPending = false;

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
      try {
        // walletReturn (encrypted deep-link redirect) is still safe to read
        // from the URL directly - nothing strips it this early. But
        // autoConnectWallet is NOT: WalletManager's constructor (which runs
        // before this, in Game's own constructor) already stripped it via
        // history.replaceState inside _checkAutoConnectQueryParam(), so by
        // the time this code runs the URL no longer has it - reading the
        // URL for it here always returns false. Check the property that
        // survives that stripping instead.
        const params = new URLSearchParams(window.location.search);
        urlHasWalletReturn = !!(params.get('walletReturn') || this.walletManager._arrivedInWalletBrowser);
      } catch (_) { /* ignore */ }

      if (urlHasWalletReturn) {
        this.uiManager.showScreen('loadingScreen');
        // Safety net: even if a redirect IS genuinely in flight, don't ever
        // strand the user here forever if restoration fails silently for
        // some future, unforeseen reason. Fall back to the title screen.
        setTimeout(() => {
          if (!this.roomRef && this.uiManager.currentScreen === 'loadingScreen') {
            this.uiManager.showScreen('titleScreen');
          }
        }, 6000);
        // Time-critical redirect-resume flow - load assets right away
        // rather than waiting on a login decision.
        await this.loadGameAssets();
      } else {
        // NORMAL BOOT: Load assets FIRST with progress bar, then route.
        // New players see login after loading. Returning players auto-login
        // and land on the title screen with their username displayed.
        await this.loadGameAssets();
        const screen = await this.determineStartScreen();
        if (screen === 'titleScreen') this.enterMainMenu();
        else this.uiManager.showScreen(screen);
      }
      // REMOVED: the "Resume Room" banner that used to appear here when a
      // lastRoomInfo entry existed. It was a workaround for Android
      // dropping Phantom's redirect data during the old encrypted
      // deep-link flow - now that wallet flows run inside the wallet's
      // own in-app browser with no redirect at all, that failure mode is
      // gone and the banner had become a recurring nuisance on refresh.
    }

    if (this.roomRef) {
      // Already resuming a room (wallet redirect resolved one synchronously
      // above) - no login gate needed here, load assets immediately.
      await this.loadGameAssets();
    }

    this.stakingManager.getDisplayTiers()
      .then(tiers => this.uiManager.updateTierAmounts(tiers))
      .catch(err => console.warn('[Staking] Could not load tier amounts yet:', err.message));
  }

  // Guarded so it only ever runs once, however many places call it (see
  // enterMainMenu() below and the wallet-return/room-resume paths in init()).
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

  // Shows the title screen and kicks off asset preloading - the ONE place
  // that transition happens post-login, so the boot loader's progress UI
  // never appears until the player is actually past login/guest selection.
  enterMainMenu() {
    this.uiManager.setAccount(this.isGuest ? null : this.authUid, this.db);
    this.uiManager.showScreen('titleScreen');
    this.uiManager.showLoginDrop(this.username, this.isGuest);
    // If wallet connected while auth was still resolving, link it now
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
        // Firebase-based automatic matchmaking (replaces Photon). Uses the
        // same db as every room/stake/settlement, and identifies the player
        // by their connected wallet when available so two tabs on one wallet
        // never match themselves.
        this.matchmaking = new FirebaseMatchmaking(this.eventBus, this.db, {
          getIdentity: () => ({
            uid: this.authUid || ((this.walletManager && this.walletManager.publicKey)
              ? this.walletManager.publicKey.toString()
              : 'anon_' + Math.random().toString(36).slice(2)),
            name: this.username || 'Player',
          }),
        });
        // Auth is now used deliberately for the required-login system (see
        // determineStartScreen()). The network-blocking failure mode
        // described below is real and still possible - determineStartScreen()
        // guards against it with a hard timeout that falls back to guest
        // mode rather than hanging forever, so this file previously
        // disabled auth entirely; here it's back on with that specific
        // failure mode handled instead of avoided.
        //
        // Original note, kept for context: on networks that block Google's
        // auth domains (identitytoolkit.googleapis.com, oauth2.googleapis.com,
        // securetoken.googleapis.com), a hanging token refresh can make the
        // Realtime Database SDK enter an endless reconnect loop, which can
        // stall the ENTIRE database connection - not just auth. Database
        // rules remain wide open (.read: true, .write: true) so no write
        // actually requires a token; this is purely for login/identity.
      }
    } catch (e) {
      console.log('Firebase not available, running in local mode');
    }
  }

  // Decides which screen to show on boot: title (already logged in, or
  // returning guest), username picker (logged in but no username on file
  // yet), or login (nobody logged in). Hard-capped at AUTH_TIMEOUT_MS so the
  // documented auth-domain-blocked failure mode (see setupFirebase())
  // degrades to guest mode instead of hanging the whole boot sequence
  // forever. Guest status is intentionally NOT persisted to localStorage -
  // every fresh page load re-requires login; only Firebase Auth's own
  // (properly managed) session cache can skip it.
  async determineStartScreen() {
    const AUTH_TIMEOUT_MS = 4000;

    if (!this.auth) {
      this.isGuest = true;
      return 'titleScreen';
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (screen) => { if (!settled) { settled = true; resolve(screen); } };

      const timeoutId = setTimeout(() => {
        console.warn('[Auth] Timed out waiting for auth state - falling back to guest mode (this session only)');
        this.isGuest = true;
        finish('titleScreen');
      }, AUTH_TIMEOUT_MS);

      this.auth.onAuthStateChanged((user) => {
        clearTimeout(timeoutId);
        if (user) {
          this.authUid = user.uid;
          this.isGuest = false;
          // Process any wallet link that arrived BEFORE auth restored
          // (mobile wallet redirect back to browser before Firebase session
          // was ready). Link the wallet to this account immediately.
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
                finish('titleScreen');
              } else {
                finish('usernameScreen');
              }
            })
            .catch(() => finish('titleScreen'));
        } else {
          finish('loginScreen');
        }
      });
    });
  }

  // Translates Firebase's raw auth error codes into something a player can
  // actually act on. network-request-failed specifically means the request
  // never reached Google's servers - the documented auth-domain-blocking
  // issue this project has hit before, not a bug in this code to "fix".
  _friendlyAuthError(e) {
    const code = e && e.code;
    if (code === 'auth/network-request-failed') {
      return "Connection trouble reaching the login server. Try again in a moment, or tap Continue as Guest for now.";
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
      // Send email verification immediately after account creation
      await result.user.sendEmailVerification();
      // Claim the username right here as part of signup - the account now
      // exists either way, so on failure (name taken/invalid) fall back to
      // the dedicated username screen to retry rather than losing the flow.
      const claim = await this.claimUsername(username);
      if (claim.error) {
        this.uiManager.showScreen('usernameScreen');
        this.uiManager.showUsernameError(claim.error);
      }
      return { success: true };
    } catch (e) {
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
      return { error: this._friendlyAuthError(e) };
    }
  }

  continueAsGuest() {
    this.isGuest = true;
    this.enterMainMenu();
  }

  async signOut() {
    try { if (this.auth) await this.auth.signOut(); } catch (_) {}
    this.authUid = null;
    this.username = null;
    this.isGuest = false;
    this.uiManager.setAccount(null, this.db);
    this.uiManager.showScreen('loginScreen');
  }

  // Username uniqueness is checked against users/*/username before saving -
  // O(n) scan is fine at this scale; move to a dedicated usernames/{name}
  // index if the player base grows large enough for it to matter.
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

  setupEventListeners() {
    // ===== AUTH / LOGIN =====
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
        // Guests have no account/stats to show - send them to login instead.
        this.uiManager.showScreen('loginScreen');
        return;
      }
      const stats = await this.getProfileStats();
      this.uiManager.showProfileStats(stats || {});
    });

    // Wallet-sync-at-signup: once a wallet connects, remember it on the
    // right account. Two cases: this tab is the logged-in one (authUid
    // known locally - e.g. desktop extension connect), or this connection
    // happened inside an isolated wallet-browser session that has no login
    // of its own, in which case linkCode says whose account it belongs to.
    this.eventBus.on('wallet:connected', ({ address, linkCode }) => {
      if (!this.db || !address) return;
      // If auth hasn't restored yet (e.g. fresh page load after mobile wallet
      // redirect), queue the wallet link. Once Firebase auth fires in
      // determineStartScreen(), we'll process it and link the wallet to the
      // correct account automatically.
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
        // This connection happened inside the isolated Solflare/Phantom
        // browser (that's the only place a linkCode ever arrives from) -
        // show the plain "you're done here, go back" screen instead of
        // letting it fall through to the normal title screen, which has
        // no account session of its own and would confusingly show login
        // prompts right after the player just successfully connected.
        this.uiManager.showScreen('walletSyncedScreen');
        return;
      }
      if (this.isGuest || !this.authUid) return;
      this.db.ref('users/' + this.authUid + '/walletAddress').set(address).catch(() => {});
    });

    // Called right after registering a link code (see wallet:connectRequest
    // above) - listens for the wallet address to actually show up on this
    // account (written from the OTHER, isolated session), and reflects it
    // in this tab's UI without needing walletManager's own state to change
    // (it never connected anything in THIS tab - the other session did).
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
      // Stop listening after 3 minutes regardless - the player either
      // completed the connect flow by then or gave up.
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
      // FIX: these were never stored anywhere before. restartGame() (Play
      // Again) reads this.selectedMode / this.aiDifficulty, which without
      // this line were stuck at their constructor defaults ('FFA' /
      // 'advanced') forever - so Play Again silently replayed a DIFFERENT
      // mode/dragon-count than whatever the player actually just played.
      this.selectedMode = mode;
      this.aiDifficulty = difficulty;
      this.currentTier = tierId || null;
      this.startLocalGame(mode, difficulty, arenaIndex);
    });

    // Tier-complete screen: Advance to the next tier, or Restart the
    // current one. Both start a fresh wave1 match at the given tier -
    // pendingArenaIndex (last picked arena) is reused so the player isn't
    // re-prompted for arena skin on every tier transition.
    this.eventBus.on('ui:tierAdvance', ({ tierId }) => {
      // ui:tierAdvance only ever fires when moving to a NEW, harder tier
      // (restarting the same tier goes through ui:tierRestart instead) -
      // so any advance past Easy is gated for guests.
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
      this.effectsSystem.spawnEatParticles(food.x, food.y, food.color);
      this.effectsSystem.playEatSound();
    });

    // Non-lethal tail bite (attacker not in attack mode, or attacker
    // isn't the smaller dragon's case where bite is just a minor nibble)
    this.eventBus.on('collision:tail-cut', ({ victim }) => {
      this.growthSystem.onCollisionTailCut(victim, 0.2);
    });

    // Small dragon lands a tail bite on a BIGGER dragon WITH Attack
    // charged: doesn't kill, but takes a real, meaningful bite out of the
    // bigger dragon (ATTACK_TAIL_DAMAGE_PERCENT, currently 30%) - this is
    // the actual comeback/threat tool for a small dragon against a big
    // one. See collisionSystem.js checkHeadVsBody() for when this fires.
    this.eventBus.on('dragon:tailDamage', ({ victim, attacker }) => {
      this.growthSystem.onCollisionTailCut(victim, CONFIG.ATTACK_TAIL_DAMAGE_PERCENT);
      const neon = (attacker && CONFIG.DRAGON_NEON) ? (CONFIG.DRAGON_NEON[attacker.type] || '#ffffff') : '#ffffff';
      this.effectsSystem.spawnImpactSparks(victim.head.x, victim.head.y, neon);
      this.effectsSystem.addShake(victim === this.localDragon ? 14 : 6, 220);
      this.effectsSystem.playTone(260, 'sawtooth', 0.22, 0.16);
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
      // Lighter per-hit shake now that addShake caps the total - an equal
      // clash fires this handler for BOTH dragons, so keeping each call
      // small prevents the old double-strength jolt.
      this.effectsSystem.addShake(dragon === this.localDragon ? 6 : 3, 160);
      this.effectsSystem.playTone(200, 'sawtooth', 0.28, 0.13);

      // Equal-size head clash: previously both just shrank in place, which
      // felt mushy and unclear. Add a real knockback - shove both dragons
      // directly apart from the point of contact - plus a brighter spark
      // burst, so an even clash reads as a genuine collision with weight.
      if ((reason === 'equal_head' || reason === 'equal_body') && other && other.head) {
        const dxk = dragon.head.x - other.head.x;
        const dyk = dragon.head.y - other.head.y;
        const d = Math.hypot(dxk, dyk) || 1;
        const KNOCK = 26; // px shove apart
        const nx = (dxk / d) * KNOCK;
        const ny = (dyk / d) * KNOCK;
        dragon.head.x += nx;
        dragon.head.y += ny;
        // Drag the front few segments along so the body follows the shove
        // instead of stretching unnaturally.
        if (dragon.segments) {
          for (let s = 0; s < Math.min(3, dragon.segments.length); s++) {
            dragon.segments[s].x += nx * (1 - s * 0.3);
            dragon.segments[s].y += ny * (1 - s * 0.3);
          }
        }
        this.effectsSystem.spawnImpactSparks(dragon.head.x, dragon.head.y, '#ffd24d');
      }
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
        // Kill streak / combo announcements — local player only. AI dragons
        // still track their own killStreak for internal logic, but never
        // trigger the on-screen combo banner.
        killer.killStreak = (killer.killStreak || 0) + 1;
        const killerIsLocal = killer === this.localDragon;
        if (killerIsLocal) {
          this._checkCombo(killer);
          this.effectsSystem.spawnKillSparkles(killer.head.x, killer.head.y, neon || '#ffd700');
          this.effectsSystem.flashVignette(neon || '#ffd700', 0.35, 300);
          this.effectsSystem.playKillSound();
          if (this.authUid && this.db && typeof firebase !== 'undefined') {
            this.db.ref('users/' + this.authUid + '/dragonKills')
              .set(firebase.database.ServerValue.increment(1))
              .catch(() => {});
          }
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
        if (isLocal) {
          // Remember who got the kill, for spectate mode to follow.
          this._lastKiller = (killer && killer !== dragon) ? killer : null;
        }
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
      if (this.authUid && this.db && !this.isGuest) {
        // Logged-in player, mobile in-app-browser flow ahead: register a
        // short-lived link code in Firebase (both this tab and the isolated
        // wallet-browser session can reach Firebase, even though they can't
        // reach each other directly) so the wallet address that connects
        // over there gets attached to THIS account.
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
        // Store the resolved custom amount on the room so the OPPONENT and
        // the BACKEND both know the exact stake (settlement/refund read it).
        updates.customAmount = (tier === 'Custom') ? (customAmount || null) : null;
        this.roomRef.update(updates);
        this._refreshStakingUI();
      }
    });

    this.eventBus.on('lobby:depositRequested', () => this.handleDeposit());

    // REMOVED: the 'ui:resumeRoom' handler (Resume Room banner) - obsolete
    // now that wallet flows run inside the wallet's in-app browser. Any
    // stale lastRoomInfo still sitting in a player's localStorage from the
    // old flow is cleared here once so nothing can ever act on it again.
    this._clearLastRoom();

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
      // Show which stake we're searching for on the new search modal.
      const badge = document.getElementById('matchmakingTierBadge');
      if (badge) {
        const label = tier === 'Small' ? 'Low' : tier;
        badge.textContent = `${label} Stake`;
        badge.style.display = 'inline-block';
      }
      try {
        if (!this.matchmaking) { this.eventBus.emit('matchmaking:error', { message: 'Matchmaking is not ready yet. Please try again in a moment.' }); return; }
        this.matchmaking.startSearch(tier);
      } catch (err) {
        this.eventBus.emit('matchmaking:error', { message: err?.message || 'Could not start matchmaking.' });
      }
    });

    this.eventBus.on('matchmaking:matched', ({ roomCode, isInitiator, tier }) => {
      // Two paired players are EQUALS. One of them silently owns the
      // Firebase room record (needed for settlement) - but neither
      // experiences "host vs opponent". We create/prepare the room NOW,
      // on pairing, so by the time either player taps Proceed the room
      // already exists and there's no waiting/timing gap.
      this._pendingMatch = { roomCode, isInitiator, tier };
      if (isInitiator) {
        // Owner: create the room immediately and publish its code so the
        // other player can join. This does NOT navigate yet - we stay on
        // the Opponent Found screen until Proceed.
        this._prepareMatchedRoomAsOwner(tier);
      }
      this.uiManager.showOpponentFound(tier);
    });

    this.eventBus.on('matchmaking:proceed', () => {
      // Both players tap Proceed independently and both land in the SAME
      // matched lobby. The owner already created the room on pairing; the
      // other player joins it by code.
      const m = this._pendingMatch;
      if (!m) { this.uiManager.showScreen('mpMenuScreen'); return; }
      if (m.isInitiator) {
        // Owner: room is already created (see _prepareMatchedRoomAsOwner);
        // just show the matched lobby.
        this.uiManager.setMatchedLobbyMode(true, m.tier);
        this.uiManager.showScreen('lobbyScreen');
        this._refreshStakingUI();
      } else {
        // Other player: join the owner's room (code is present because the
        // owner created it on pairing).
        if (m.roomCode) {
          this.joinRoom(m.roomCode);
        } else {
          // Extremely rare: owner hasn't published yet. Wait briefly.
          this.uiManager.returnToMenuWithProcessing('lobbyScreen', 'Joining the arena…');
          const q = this.matchmaking && this.matchmaking._roomWatchRef;
          if (q) {
            q.on('value', (snap) => {
              const t = snap.val();
              if (t && t.roomCode) { q.off('value'); this.joinRoom(t.roomCode); }
            });
          }
        }
      }
    });

    this.eventBus.on('matchmaking:cancelOpponentFound', () => {
      // Player declined the found match BEFORE staking. Plain cancel - no
      // refund (nothing was staked). If we're the owner who pre-created the
      // room, tear it down so no orphan room is left. Then back to the menu.
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

  // True only for the AI wave modes ('wave1'/'wave2'/'wave3', set once at
  // match start and never changed mid-match - see startLocalGame() and
  // advanceToNextWave()) - NOT for '1v1AI' or any multiplayer mode, which
  // stay untouched by any of the wave-chaining logic below.
  isWaveMode() {
    const mode = this.gameModeManager.getMode();
    return typeof mode === 'string' && mode.startsWith('wave');
  }

  checkMatchEnd() {
    const allDragons = this.dragonManager.getAllDragons();
    const withLives = allDragons.filter(d => d.lives > 0);

    // If only one dragon has lives left, they win
    if (withLives.length === 1 && allDragons.length > 1) {
      // Wave mode + the local player is the sole survivor: this is a wave
      // CLEAR, not necessarily the end of the match - continue into the
      // next wave in-place if there is one (see advanceToNextWave()).
      if (this.isWaveMode() && withLives[0] === this.localDragon) {
        this.advanceToNextWave();
        return;
      }
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
      } else if (!this.isSpectating || !this.spectateTarget || !this.spectateTarget.alive) {
        // First death, or our current spectate target just died too -
        // (re-)enter spectate mode, preferring whoever actually killed us.
        this.enterSpectateMode(othersAlive);
      }
    }
  }

  // Local player has been eliminated but the match is still going (other
  // dragons remain). Rather than leaving the camera frozen on the empty
  // spot the player died at, follow whoever killed them (or, if that
  // dragon has since died too, whoever's still alive) so there's always
  // something to watch until the match actually ends.
  enterSpectateMode(livingDragons) {
    this.isSpectating = true;
    let target = (this._lastKiller && this._lastKiller.alive) ? this._lastKiller : null;
    if (!target) target = livingDragons[0] || null;
    this.spectateTarget = target;
    if (target) {
      this.uiManager.showSpectateOverlay(target, () => this.endGame(false));
    }
  }

  // Called the instant a wave's AI dragons are all eliminated and the
  // local player is still alive. Pauses gameplay, shows the "WAVE CLEARED
  // -> next wave incoming" 3-2-1 countdown (uiManager.showWaveClearedCountdown,
  // reusing the existing pre-match countdown overlay), then spawns the
  // next wave's AI dragons into the SAME match - no menu, no game-over
  // screen, no loss of the player's current size/position. If the wave
  // just cleared was the final one (wave3), the tier itself is complete
  // instead (see onTierCleared()).
  advanceToNextWave() {
    // checkMatchEnd() (from the dragon:death handler) and update()'s own
    // inline win-check both evaluate the same win condition in the same
    // frame - without this guard, both would call advanceToNextWave() for
    // the same elimination, double-spawning the next wave and double-
    // firing the countdown.
    if (this._waveTransitionPending) return;
    const currentIndex = this.currentWaveIndex;
    const nextWave = AI_WAVES[currentIndex + 1];

    if (!nextWave) {
      this.onTierCleared();
      return;
    }

    this._waveTransitionPending = true;
    this.currentWaveIndex = currentIndex + 1;
    this.isPaused = true; // freezes update()/render() in loop() - no pause MENU, just frozen gameplay under the countdown
    this.uiManager.showWaveClearedCountdown(nextWave, () => {
      // Reset the player dragon to starting size for the new wave challenge
      this._resetDragonToWaveStart(this.localDragon);

      // Clean up dead AI dragons from the previous wave so they don't linger
      // in the dragon array (alive=false dragons are harmless but bloat state)
      const allDragons = this.dragonManager.getAllDragons();
      for (let i = allDragons.length - 1; i >= 0; i--) {
        const d = allDragons[i];
        if (d !== this.localDragon && !d.alive) {
          allDragons.splice(i, 1);
        }
      }

      this.spawnWaveDragons(nextWave.players - 1); // -1: the local player already counts as one of nextWave.players
      this.isPaused = false;
      this.lastTime = performance.now(); // avoid a huge deltaTime spike from the pause
      this._waveTransitionPending = false;
    });
  }

  // Adds `count` fresh AI dragons into the CURRENT match (does not touch
  // the local player or any existing dragon). AI difficulty stays fixed at
  // whatever the tier was set to at match start (this.aiDifficulty) - it
  // does NOT escalate wave to wave within one run, only tier to tier.
  spawnWaveDragons(count) {
    const spawnPositions = this.arenaManager.getSpawnPositions(count + 1);
    const aiNames = ['aegis', 'ignis', 'infinite', 'magnetron'];
    for (let i = 0; i < count; i++) {
      const spawn = spawnPositions[i + 1] || spawnPositions[i % spawnPositions.length];
      const aiName = aiNames[i % aiNames.length];
      const aiDragon = this.dragonManager.createDragon(aiName, spawn.x, spawn.y);
      if (this.aiController) aiDragon.speed *= this.aiController.getSpeedMult();
      this.initMatchStats(aiDragon);
    }
  }

  // All 3 waves cleared on the current tier. Stops the match WITHOUT going
  // through the normal endGame()/gameOverScreen path - shows the dedicated
  // tier-complete screen (rank + Restart/Advance/Main Menu) instead.
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
  }

  // Starts a fresh wave1 match at the given tier - used by both the
  // tier-complete screen's Restart and Advance buttons. Reuses the last
  // picked arena so the player isn't re-prompted every tier transition.
  startWaveRun(tier) {
    this.currentTier = tier.id;
    this.selectedMode = 'wave1';
    this.aiDifficulty = tier.aiDifficulty;
    const arenaIdx = (this.pendingArenaIndex !== null && this.pendingArenaIndex !== undefined) ? this.pendingArenaIndex : 0;
    this.startLocalGame('wave1', tier.aiDifficulty, arenaIdx);
  }


  // Reset a dragon's body to starting segment count at the beginning of a new wave.
  // Called during wave transitions so every wave is a fresh challenge.
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
    // NOTE: dragon.head must stay its own independent object. Aliasing it to
    // segments[0] here caused placeSegments() to overwrite the head's
    // just-moved position with its own "trailing" position every frame
    // (since they were literally the same object) - freezing the local
    // player's movement until a respawn rebuilt segments with fresh objects
    // and broke the alias.
    // Reset growth progress so the dragon doesn't immediately re-grow from stored progress
    if (dragon.growthProgress !== undefined) dragon.growthProgress = 0;
    // Cap attack charge so the player doesn't carry a full magazine into the next wave
    if (dragon.attackCharge > 0) dragon.attackCharge = Math.min(dragon.attackCharge, 5);
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
    // Use .update() (partial merge) instead of .set() (full replace) so a
    // Telegram round-trip that hits this path CAN'T obliterate the staking
    // fields (pubkey / deposited / depositTx / joinedAt / authUid) already
    // written on the player record. Anything already present is preserved;
    // only missing fields get filled in. Also stamp authUid so joinRoom's
    // dedup guard can find this record on a later re-entry.
    const baseFields = {
      dragon: this.selectedDragon || 'ignis',
      ready: true,
      authUid: this.authUid || null,
    };
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
          // Just fill in any fields the record is missing — never overwrite.
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

  // Polls Solana for a signature's confirmation status via the connection
  // the stakingManager already uses. searchTransactionHistory:true is
  // required so a tx that has slipped out of the recent-status cache is
  // still found. Returns true only for CONFIRMED / FINALIZED. Anything
  // else (unknown, processed-only, err) => false. Matches the private
  // stakingManager._didTxLand logic exactly, so desktop and mobile paths
  // apply the same on-chain proof of deposit.
  async _verifyTxLanded(signature) {
    try {
      const conn = this.walletManager && this.walletManager.connection;
      if (!conn || !signature) return false;
      for (let i = 0; i < 6; i++) {
        try {
          const res = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
          const st = res && res.value;
          if (st) {
            if (st.err) return false; // included on-chain but FAILED — funds did not move
            if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
              return true;
            }
          }
        } catch (_) { /* transient — poll again */ }
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    } catch (_) { return false; }
  }

  async _resumeStakingAction(pendingAction, signature) {
    if (!pendingAction) return;
    if (!this.roomRef) {
      const ctx = this._consumeLobbyContext();
      if (ctx && this.db) this._rejoinRoom(ctx);
    }

    // CRITICAL — mobile deep-link flow: Phantom/Solflare hand us a signature
    // in the redirect URL whether or not the user actually approved the
    // stake. Without an on-chain confirmation check we'd write
    // deposited: true to Firebase for a tx that never moved any tokens,
    // and the settlement pot would end up short by exactly that player's
    // stake. Verify BEFORE _markDeposited runs; if the signature isn't
    // confirmed on-chain within ~9s, refuse to mark deposited and surface
    // a clear error so the user can retry. Refund / cancel resume paths
    // don't touch Firebase staking state, so they skip this check.
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

  // Pre-flight before opening the wallet: does this wallet actually hold
  // the stake plus a little SOL for the network fee? Without this, a
  // player with INFINITE but zero SOL (or vice versa) just sees a scary
  // "simulation failed" inside their wallet with no explanation - exactly
  // what happened on the first mobile test. Fail-open: if the CHECK
  // itself errors (RPC hiccup), staking proceeds normally.
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
    // Stash the depositing wallet's own public key in Firebase so the backend
    // knows where to send a payout later - nothing wrote this before, and
    // settle_match cannot function without it.
    const myPubkey = this.walletManager.publicKey.toString();

    // Dual-format staking writes:
    //   - 1v1: keep the legacy top-level fields (hostPubkey / opponentPubkey
    //     + staking.hostDeposited / staking.opponentDeposited) so anything
    //     already reading them keeps working byte-identically.
    //   - FFA (and any 2+ player mode): ALSO write per-player fields on the
    //     player record (players/{myId}/pubkey + players/{myId}/deposited)
    //     so the backend can attribute each of the 4 stakes to a specific
    //     player without relying on host/opponent slot names.
    // Backend prefers per-player fields when present; top-level as fallback.
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
    // Per-player writes: always write, whichever mode. Cheap, and gives the
    // backend one canonical shape to iterate for FFA/2v2 without dropping
    // the top-level fields the 1v1 code path already depends on.
    const myId = this.localPlayerId || 'local';
    updates[`players/${myId}/pubkey`] = myPubkey;
    updates[`players/${myId}/deposited`] = true;
    updates[`players/${myId}/depositTx`] = signature;

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
      // Staking is MANDATORY and the button slot is a single morphing
      // control: before both players stake, only Place Bet may occupy it.
      // With no tier picked yet, Start stays hidden and locked.
      const startBtn = document.getElementById('lobbyStartBtn');
      if (startBtn) { startBtn.disabled = true; startBtn.style.display = 'none'; }
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
    // FFA/2v2-aware: compute per-player deposit signals so uiManager can
    // gate the deposit button on MY OWN status (not the 1v1 "bothStaked"
    // gate that hid the button for FFA players 3/4 the moment host and
    // player 2 had staked). All-players-deposited is what actually
    // unlocks Start Game for any N.
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

    // Fresh match: reset wave progress. -1 for any non-wave mode (1v1AI,
    // multiplayer modes, etc.) so isWaveMode()/advanceToNextWave() never
    // engage for them.
    this.currentWaveIndex = typeof mode === 'string' ? AI_WAVES.findIndex(w => w.id === mode) : -1;

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
      // Permanent speed bonus from cleared AI difficulty tiers (Emberborn/
      // Voidwalker/etc - see uiManager.getTierSpeedMultiplier()). Local/AI
      // matches only - never applied in staked multiplayer, where a
      // permanent edge from unrelated progress would be unfair.
      if (this.uiManager && typeof this.uiManager.getTierSpeedMultiplier === 'function') {
        this.localDragon.speed *= this.uiManager.getTierSpeedMultiplier();
      }

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

  createRoom(mpMode, presetTier = null, matched = false) {
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
    // Matchmaking rooms are always 1v1 stakes - lock to a 2-player room and
    // remember we came from matchmaking so the UI shows the streamlined
    // stake-confirm screen instead of the full room-code lobby.
    this._matchedMode = !!matched;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    // Local canonical map so 1v1 always seats 2 and FFA always seats 4,
    // independent of whatever CONFIG.MAX_PLAYERS may have (or not have).
    const MP_MAX = { '1v1': 2, 'FFA': 4, '2v2': 4 };
    const maxPlayers = matched
      ? 2
      : (MP_MAX[this.selectedMpMode] || (CONFIG.MAX_PLAYERS && CONFIG.MAX_PLAYERS[this.selectedMpMode]) || 4);

    this.roomRef = this.db.ref('rooms/' + this.roomCode);
    this.roomRef.set({
      host: 'local',
      hostId: 'local', // authoritative host id — migrates if host leaves pre-game
      hostAuthUid: this.authUid || null,
      mode: this.selectedMpMode,
      maxPlayers: maxPlayers,
      arenaIndex: 0,
      status: 'waiting',
      tier: presetTier,
      matched: !!matched,
      staking: { hostDeposited: false, opponentDeposited: false },
      players: {
        local: {
          name: 'Player 1',
          dragon: this.selectedDragon || 'ignis',
          ready: true,
          joinedAt: firebase.database.ServerValue.TIMESTAMP,
          authUid: this.authUid || null,
        }
      }
    });

    this.roomPlayers = { local: { name: 'Player 1', dragon: this.selectedDragon || 'ignis', ready: true } };

    if (matched) {
      // Matched flow: enter the SAME lobby as Create Room, in matched mode.
      // When pre-creating on pairing (_suppressMatchedNav), we set up the
      // room + listener but DON'T navigate - Proceed shows the lobby.
      this.uiManager.updateLobby(
        [{ name: 'Player 1', dragon: this.selectedDragon, isLocal: true, isHost: true, deposited: false }],
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
      [{ name: 'Player 1', dragon: this.selectedDragon, isLocal: true, isHost: true, deposited: false }],
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
    // GUARD 1: don't re-enter. A tap-tap on the Join button, a rapid
    // Telegram→browser round-trip that re-fires a stale click handler, or
    // any visibilitychange rehydration path — all of these were pushing
    // duplicate player records with fresh keys, orphaning the original.
    // The phantom that "showed 🐉 2D and appeared already staked" was the
    // ORIGINAL record (still holding pubkey/deposited) sitting alongside
    // the new bare-name duplicate.
    if (this._joinInProgress) {
      console.warn('[joinRoom] already in progress — ignoring duplicate call');
      return;
    }
    // GUARD 2: if I'm already inside a room, refuse to start another join.
    if (this.roomRef) {
      console.warn('[joinRoom] already in a room — ignoring duplicate call');
      return;
    }
    this._joinInProgress = true;
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
      const _MP_MAX = { '1v1': 2, 'FFA': 4, '2v2': 4 };
      const roomMax = data.maxPlayers || _MP_MAX[data.mode] || (CONFIG.MAX_PLAYERS && CONFIG.MAX_PLAYERS[data.mode]) || 4;
      const existingPlayers = data.players || {};

      // GUARD 3: authUid-based dedup. If ANY existing player record in this
      // room is already stamped with my authUid (from a prior join in the
      // same session — Telegram round-trip, refresh, backgrounded tab), do
      // NOT push a new record. Reuse that existing key so my staking
      // signature stays attached to my identity.
      if (this.authUid) {
        const preExisting = Object.entries(existingPlayers)
          .find(([, p]) => p && p.authUid && p.authUid === this.authUid);
        if (preExisting) {
          const [existingKey] = preExisting;
          console.log(`[joinRoom] found existing record ${existingKey} for my authUid — reusing`);
          this.localPlayerId = existingKey;
          this.lobbyArenaIndex = data.arenaIndex !== undefined ? data.arenaIndex : 0;
          this.selectedMpMode = data.mode || this.selectedMpMode;
          this.lobbyTier = data.tier || null;
          this._matchedMode = !!data.matched;
          if (data.matched) {
            this.uiManager.setMatchedLobbyMode(true, this.lobbyTier);
          } else {
            this.uiManager.setMatchedLobbyMode(false);
          }
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
        name: 'Player ' + (playerCount + 1),
        dragon: this.selectedDragon || 'ignis',
        ready: true,
        joinedAt: firebase.database.ServerValue.TIMESTAMP,
        // Stamp identity so GUARD 3 above can find this record on a
        // subsequent joinRoom call (Telegram round-trip, tab refresh).
        authUid: this.authUid || null,
      });
      this.localPlayerId = newPlayerRef.key;
      this.lobbyArenaIndex = data.arenaIndex !== undefined ? data.arenaIndex : 0;
      this.selectedMpMode = data.mode || this.selectedMpMode;
      this.lobbyTier = data.tier || null;
      this._matchedMode = !!data.matched;
      if (data.matched) {
        // Matched opponent: same lobby, matched mode (bg shown, code +
        // pickers hidden, Place Bet -> Start -> Leave).
        this.uiManager.setMatchedLobbyMode(true, this.lobbyTier);
        this.uiManager.showScreen('lobbyScreen');
        this.uiManager.updateLobbyArena(this.lobbyArenaIndex, false);
        this._attachRoomListener();
        this._ensurePresence();
        this._persistLastRoom();
        return;
      }
      this.uiManager.setMatchedLobbyMode(false);
      this.uiManager.showScreen('lobbyScreen');
      this.uiManager.updateLobbyArena(this.lobbyArenaIndex, false);
      this._attachRoomListener();
      this._ensurePresence();
      this._persistLastRoom();
    }).catch(err => {
      console.error('[joinRoom] error:', err);
    }).finally(() => {
      this._joinInProgress = false;
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
      this._customStakeAmount = data.customAmount || null;
      this.stakingState = {
        hostDeposited: !!(data.staking && data.staking.hostDeposited),
        opponentDeposited: !!(data.staking && data.staking.opponentDeposited),
      };
      if (data.arenaIndex !== undefined && data.arenaIndex !== this.lobbyArenaIndex) {
        this.lobbyArenaIndex = data.arenaIndex;
        this.uiManager.updateLobbyArena(data.arenaIndex, this.isHost);
      }

      // Host role migration (deterministic across clients on the same snap):
      // whoever has the earliest joinedAt among current players IS the host.
      // If the original host has left the room, this promotes the next-oldest
      // remaining player automatically. Every client on the same snapshot
      // agrees on the new host id, so no coordination write is required.
      const stampedHostId = data.hostId || data.host || 'local';
      let computedHostId = stampedHostId;
      if (!this.roomPlayers[stampedHostId]) {
        // Original host isn't in the room anymore → pick earliest joiner.
        const sorted = Object.entries(this.roomPlayers)
          .map(([id, p]) => ({ id, joinedAt: (p && p.joinedAt) || 0 }))
          .sort((a, b) => a.joinedAt - b.joinedAt);
        if (sorted.length) computedHostId = sorted[0].id;
      }
      // If I am the newly-promoted host AND the room record hasn't caught up
      // yet, persist the migration so late-joiners see the same authoritative
      // host id. Only the promoted client writes, so no thundering herd.
      if (computedHostId !== stampedHostId && this.localPlayerId === computedHostId) {
        try { this.roomRef.update({ hostId: computedHostId }); } catch (_) {}
      }
      this.isHost = (this.localPlayerId === computedHostId);

      // The player's Firebase key is what the host needs to kick them, and
      // FFA cards need per-player deposited flags (the 2-player room-level
      // staking flags don't cover challenger slots 3/4). Both are surfaced
      // here so updateLobby can render kick chips and STAKED badges correctly.
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

      // Matched games use the SAME lobby UI as Create Room, with matched
      // styling (bg shown, code + pickers hidden). Both paired players are
      // equals - they stake, and the instant BOTH stakes are in, the match
      // AUTO-STARTS (no manual Start tap).
      this.uiManager.updateLobby(players, roomMax, this.roomCode, this.isHost, roomMode);
      this._refreshStakingUI();
      if (this._matchedMode && this.stakingState.hostDeposited && this.stakingState.opponentDeposited
          && this.isHost && this.state !== 'PLAYING' && this.state !== 'GAME_OVER' && data.status !== 'playing') {
        this.startMpGame();
      }

      // FFA auto-start: when the pot is full and everyone has staked, run a
      // 60s local countdown on every client. Host also sees Start Game and
      // can end it early; if the timer hits 0, host emits mp:startGame so
      // the other players aren't stuck on an AFK host. Guests just watch —
      // their expiry does nothing; they'll pick up status='playing' from
      // the next room snapshot.
      if (this._shouldRunFFACountdown(data, players, roomMode)) {
        this._startFFACountdown();
      } else {
        this._stopFFACountdown();
      }

      // "Last player standing" auto-leave: when the room drops from 2+ down
      // to just me AND the match hasn't started, auto-leave. leaveRoom()
      // removes my player record → backend sees the whole room empty AND
      // still-staked → handleRoomRemoved refunds me and returns me to menu.
      // Guard on prev-count so this doesn't fire when I first create a room
      // (1 player → still 1 player, no leaves happened).
      const prevCount = this._lastPlayerCount || 0;
      if (prevCount >= 2 && players.length === 1
          && this.localPlayerId === players[0].id
          && data.status !== 'playing'
          && this.state !== 'PLAYING' && this.state !== 'GAME_OVER') {
        console.log('[Room] Last player standing — auto-leaving to main menu');
        this.eventBus.emit('staking:pending', {
          label: 'Everyone else left this room — returning you to the menu.',
        });
        setTimeout(() => this.leaveRoom(), 400);
      }
      this._lastPlayerCount = players.length;

      // AUTO-REPLAY BUG FIX: the previous condition (data.status==='playing'
      // && state!=='PLAYING' && !isHost) re-fired startLocalGame on EVERY
      // room update while status was still 'playing' — including the
      // settlement write that happens AFTER game over — dragging non-host
      // clients back into a bogus "settling on chain" replay of an
      // already-finished match. Explicitly bail if the local player has
      // already reached GAME_OVER for this match; the finished-match state
      // is server-authoritative from that point.
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
    });
  }

  // Owner-side: create the matched Firebase room the moment the pair is
  // confirmed (before Proceed), and publish its code so the other player
  // can join. Does NOT navigate - createRoom in matched mode shows the
  // lobby, so we suppress that by deferring the screen switch to Proceed.
  _prepareMatchedRoomAsOwner(tier) {
    this._suppressMatchedNav = true;
    this.createRoom(this.selectedMpMode || 'FFA', tier, true);
    this._suppressMatchedNav = false;
    if (this.roomCode && this.matchmaking) this.matchmaking.announceRoomReady(this.roomCode);
  }

  // Host-only: remove an unstaked player from the room. Kicking a STAKED
  // player would strand their tokens (custodial hot-wallet model refunds
  // on room-remove, not on individual player-remove), so the UI only ever
  // shows the kick button on unstaked slots — this method double-checks
  // the same invariant before writing to Firebase.
  kickPlayer(playerId) {
    if (!this.isHost || !this.roomRef || !playerId) return;
    if (playerId === 'local') return; // host can't kick themselves
    const p = (this.roomPlayers && this.roomPlayers[playerId]) || null;
    // Staking is tracked at the room level (hostDeposited / opponentDeposited)
    // in the 2-player era; for FFA the per-player deposited flag lives on the
    // player record itself. Refuse if either signal says "staked".
    const staked = !!(p && (p.deposited || p.staked));
    if (staked) {
      console.warn('kickPlayer: refusing to kick staked player', playerId);
      return;
    }
    try {
      this.roomRef.child('players/' + playerId).remove();
    } catch (e) { console.warn('kickPlayer error:', e); }
  }

  // ===== FFA 60s host auto-start countdown =====
  // Purely local timer on every client. Every client renders the same UI so
  // all 4 dragons see the same visible clock, but only the HOST's expiry
  // actually emits mp:startGame — guests are passive observers who react to
  // status='playing' the same way they always do. No Firebase schema
  // changes; the countdown is derived from the existing "all staked" signal.
  _shouldRunFFACountdown(roomData, players, roomMode) {
    if (roomMode === '1v1') return false;
    if (!roomData || roomData.status === 'playing') return false;
    if (this._matchedMode) return false; // matched games auto-start on both stakes
    if (!Array.isArray(players) || players.length < 2) return false;
    // Everyone in the room is staked. In FFA the pot is only "full" when
    // maxPlayers seats are filled AND every seated player has deposited.
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
        // Only the host actually starts the game. Guests just wait for the
        // 'playing' status to arrive via the room snapshot.
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
    // Local view of my own stake status. In the dual-format schema my
    // deposited flag lives on the player record itself (players/{id}) for
    // FFA, and also as a role-level flag (staking.hostDeposited /
    // opponentDeposited) for 1v1 legacy. Either is enough to know I'm
    // owed a refund.
    const myRecord = (this.roomPlayers && this.localPlayerId)
      ? this.roomPlayers[this.localPlayerId] : null;
    const iStakedPerPlayer = !!(myRecord && myRecord.deposited);
    const iStakedLegacy = this.isHost
      ? this.stakingState.hostDeposited
      : this.stakingState.opponentDeposited;
    const iStaked = iStakedPerPlayer || iStakedLegacy;
    const matchStarted = this.state === 'PLAYING' || this.state === 'GAME_OVER';

    if (iStaked && matchStarted) {
      // Leaving a LIVE staked match is a forfeit — the backend awards the
      // pot to whoever's left. Don't promise a refund that isn't coming.
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
      // Host and non-host both remove only their OWN player record now.
      // Removing the whole room used to be host-only; that made host
      // leaves auto-refund every player at once and killed FFA rooms just
      // because the host walked away. The new rule: host leaves like
      // anyone else — remaining players stay, host role migrates
      // deterministically by joinedAt (handled in _attachRoomListener),
      // backend refunds this specific player via the child_removed listener.
      // The room record dies naturally when the last player leaves, and
      // handleRoomRemoved then refunds whoever's still staked (which will
      // be nobody, since everyone already got refunded individually).
      try {
        this.roomRef.off();
      } catch (_) {}
      try {
        this.roomRef.child('players/' + this.localPlayerId).remove();
      } catch (_) {}
      // If I'm the last player OR I'm the ORIGINAL host in a 1v1 legacy
      // room where opponent already left / never joined, also remove the
      // whole room record so it doesn't linger. Safe because the backend's
      // handleRoomRemoved won't double-refund (the individualRefunds/
      // marker written when my player record was removed short-circuits
      // the room-removed path).
      const remainingCount = Math.max(0, this.playerIds.length - 1);
      if (remainingCount === 0) {
        try { this.roomRef.remove(); } catch (_) {}
      }
      this.roomRef = null;
    }

    this.isHost = false;
    this.roomCode = '';
    this.localPlayerId = null;
    this.playerIds = [];
    this.roomPlayers = {};
    this._lastPlayerCount = 0;
    this.isMultiplayer = false;
    this._matchedMode = false;
    this.lobbyArenaIndex = 0;
    this.lobbyTier = null;
    this.stakingState = { hostDeposited: false, opponentDeposited: false };
    this._consumeLobbyContext();
    this._clearLastRoom();

    // Drive the exit screen based on what's actually happening:
    //  - never staked            -> straight to menu (NO refund screen)
    //  - staked, match NOT started -> refund is coming, show processing
    //  - staked, match WAS live    -> forfeit (opponent paid), not a refund,
    //                                 so no refund screen - just exit
    if (iStaked && !matchStarted) {
      this.uiManager.returnToMenuWithProcessing('titleScreen', 'Processing your refund…');
    } else {
      this.uiManager.showScreen('titleScreen');
    }
  }

  startMpGame() {
    // Staking is mandatory: no tier picked means no stakes locked, so the
    // match cannot start - and with a tier picked, EVERY seated player
    // must have deposited. Backs up the disabled button so the rule holds
    // even if the UI state is ever stale.
    if (!this.lobbyTier) {
      this.eventBus.emit('staking:error', { message: 'Pick a stake tier and place your bet before starting.' });
      return;
    }
    // FFA-aware guard. In 1v1 the top-level staking flags are the source
    // of truth (host + opponent); in FFA the per-player deposited flag on
    // each player record is authoritative. If ANY seated player hasn't
    // deposited, refuse to start regardless of role.
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
    this._startConnectionWatchdog();
  }

  // Local-side forfeit feedback. If THIS player's connection drops during a
  // live staked match, the server will (after the silence window) award the
  // pot to the opponent - but this client, if it's still alive at all, has
  // no other way to learn it lost. This watchdog shows the defeat screen
  // the moment it can tell the connection is gone, so the quitter isn't
  // left staring at a frozen arena. Best-effort by nature: if the tab was
  // truly killed there's nothing left to render, which is fine - the payout
  // outcome is server-authoritative regardless.
  _startConnectionWatchdog() {
    if (!this.lobbyTier) return; // only meaningful for staked matches
    this._clearConnectionWatchdog();
    const onOffline = () => {
      if (this.state !== 'PLAYING') return;
      this.uiManager.showForfeitDefeat();
    };
    this._offlineHandler = onOffline;
    window.addEventListener('offline', onOffline);
    // Also watch Firebase's own connection state - catches drops that the
    // browser 'offline' event misses (e.g. server unreachable but wifi up).
    try {
      this._connRef = firebase.database().ref('.info/connected');
      this._connListener = this._connRef.on('value', (snap) => {
        if (snap.val() === false && this.state === 'PLAYING') {
          // brief grace so a momentary blip doesn't flash the screen
          clearTimeout(this._connDropTimer);
          this._connDropTimer = setTimeout(() => {
            if (this.state === 'PLAYING') this.uiManager.showForfeitDefeat();
          }, 6000);
        } else if (snap.val() === true) {
          clearTimeout(this._connDropTimer);
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
    // Diagnostic timeout: if the backend hasn't written settlement (of any
    // status) within 90s of the match ending, the "Treasury is weighing
    // the stakes…" panel switches to a plain-language delay message
    // instead of hanging forever. Doesn't ADVANCE the settlement — funds
    // are still owed and the room stays alive for backend recovery — but
    // it tells the player "your funds are safe, this is delayed, contact
    // support with this room code" so they aren't stranded on a screen
    // that looks broken. Fires only for staked matches (this.lobbyTier).
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
      // Error settlement statuses — backend saw the match end but the
      // payout / refund transaction itself failed, or the room record was
      // missing data needed to settle. Surface it instead of hanging the
      // UI on "Treasury weighing the stakes…" forever. Funds are still in
      // the hot wallet; manual review is written to the settlement record
      // for support-side triage.
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
      // FFA-aware win check. Backend writes both `winner` ('host'|'opponent'
      // for 1v1) and `winnerId` (the Firebase key, for any player count).
      // Prefer winnerId — it's correct for all modes; the 'host'/'opponent'
      // string is only meaningful for 1v1 and would misattribute the win
      // in FFA (where winnerSide is a Firebase key, not one of two roles).
      let iWon;
      if (s.winnerId) {
        iWon = this.localPlayerId
          ? (this.localPlayerId === s.winnerId)
          : (this.isHost && s.winnerId === 'local');
      } else {
        iWon = (s.winner === 'host') === !!this.isHost;
      }
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
      // On a forfeit win, surface "opponent left the arena" messaging on
      // the game-over screen (the winner is the one still connected, so
      // this reliably reaches them).
      if (s.forfeit && iWon) {
        this.uiManager.showForfeitVictory();
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
    this._clearConnectionWatchdog();
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
    // Let the minimap identify the local player's dragon for the cyan
    // heading blip (vs red enemy blips).
    if (this.uiManager.setLocalDragonRef) this.uiManager.setLocalDragonRef(this.localDragon);

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

    const followDragon = (this.isSpectating && this.spectateTarget && this.spectateTarget.alive)
      ? this.spectateTarget
      : this.localDragon;
    this.cameraSystem.update(followDragon, this.arenaManager);
    this.collisionSystem.checkAll(this.dragonManager, this.foodSystem, this.arenaManager);

    // Update time survived for all living dragons
    for (const dragon of this.dragonManager.getLivingDragons()) {
      if (this.matchStats[dragon.id]) {
        this.matchStats[dragon.id].timeSurvived = Date.now() - this.matchStats[dragon.id].startTime;
      }
    }

    // Check win condition (last standing with lives). Guarded on
    // this.state === 'PLAYING' for the WHOLE block, not just the
    // advance-branch - collisionSystem.checkAll() above can already have
    // synchronously triggered dragon:death -> checkMatchEnd() ->
    // onTierCleared()/endGame(), which shows its own screen and moves
    // state off 'PLAYING'. Without this guard, this duplicate check ran
    // anyway and immediately overwrote that screen with the generic
    // game-over screen in the same frame.
    if (this.state === 'PLAYING') {
      const livingWithLives = allDragons.filter(d => d.alive && d.lives > 0);
      const totalWithLives = allDragons.filter(d => d.lives > 0);

      if (livingWithLives.length === 1 && totalWithLives.length === 1 && allDragons.length > 1) {
        if (this.isWaveMode() && livingWithLives[0] === this.localDragon) {
          this.advanceToNextWave();
          return;
        }
        this.winner = livingWithLives[0];
        this.endGame(true);
        return;
      }
    }

    // Local player attack activation (ATTACK button / Space / click)
    // Hold-to-attack: dragonManager drains the magazine only while held.
    if (this.localDragon) {
      this.localDragon.attackHeld = this.localDragon.alive && this.movementSystem.isAttackHeld();
    }

    const score = this.localDragon ? this.localDragon.score : 0;
    const waveNum = this.isWaveMode() ? (this.currentWaveIndex + 1) : null;
    this.uiManager.updateHUD(score, timeStr, this.localDragon, waveNum);
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
    // Multiplayer stat tracking - roomRef only exists for actual multiplayer
    // matches (AI/wave mode never creates one), and only for logged-in
    // accounts (guests can't reach multiplayer at all - see the mp:createRoom/
    // mp:joinRoom gates).
    if (this.roomRef && this.authUid && this.db && typeof firebase !== 'undefined') {
      const won = hasWinner && this.winner === this.localDragon;
      const updates = {
        matchesPlayed: firebase.database.ServerValue.increment(1)
      };
      if (won) updates.multiplayerWins = firebase.database.ServerValue.increment(1);
      this.db.ref('users/' + this.authUid).update(updates).catch(() => {});
    }
    this.state = 'GAME_OVER';
    this.isSpectating = false;
    this.spectateTarget = null;
    this.uiManager.hideSpectateOverlay();
    this.uiManager.hideQuitConfirm();
    this.uiManager.showPauseOverlay(false);
    // Make sure the start-of-match countdown overlay isn't still on screen
    // when we jump to game-over - otherwise the loser briefly sees the "3,
    // 2, 1" countdown flash on top of the DEFEATED screen.
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
      // Play Again makes no sense for a multiplayer/staked match - the room
      // is gone and each rematch would need a fresh room + fresh stakes.
      // Only Main Menu is offered. (Solo play keeps Play Again below.)
      const playAgain = document.getElementById('btnPlayAgain');
      if (playAgain) playAgain.style.display = 'none';
      // For staked matches, show the settlement panel in its pending state
      // until the backend writes rooms/{code}/settlement.
      if (this.lobbyTier) this.uiManager.showStakeBreakdown({ pending: true });
    } else {
      // Solo play: always restore Play Again (a prior MP match hides it on
      // this shared screen), whether the player won or lost.
      const playAgain = document.getElementById('btnPlayAgain');
      if (playAgain) playAgain.style.display = 'flex';
      // NOTE: AI wave-mode wins no longer reach this branch at all - they're
      // intercepted earlier by advanceToNextWave()/onTierCleared() (see
      // checkMatchEnd() and update()'s inline win-check), which show the
      // wave countdown or the tier-complete screen instead of ending the
      // match here. This else-branch only runs for normal losses/deaths,
      // or a genuine non-wave-mode win (e.g. 1v1AI).
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
