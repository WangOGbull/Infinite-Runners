// walletManager.js
const RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=de2fb44b-73e1-4ee5-aa9d-b1134825a8b0';

function clusterFromEndpoint(endpoint) {
  if (endpoint.includes('devnet')) return 'devnet';
  if (endpoint.includes('testnet')) return 'testnet';
  return 'mainnet-beta';
}
const PHANTOM_CLUSTER = clusterFromEndpoint(RPC_ENDPOINT);

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
  let digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) digits.push(0);
  return digits.reverse().map(d => B58_ALPHABET[d]).join('');
}
function b58decode(str) {
  let bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const value = B58_ALPHABET.indexOf(str[i]);
    if (value === -1) throw new Error('Invalid base58 character');
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; str[k] === '1' && k < str.length - 1; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

const PHANTOM_SESSION_KEY = 'phantomDappSession';
const PHANTOM_KEYPAIR_KEY = 'phantomDappKeyPair';
const PHANTOM_WALLET_PUBKEY_KEY = 'phantomWalletPubkey';
const PHANTOM_USER_ADDRESS_KEY = 'phantomUserAddress';
const PHANTOM_PENDING_ACTION_KEY = 'phantomPendingAction';

const JUPITER_SESSION_KEY = 'jupiterDappSession';
const JUPITER_WALLET_PUBKEY_KEY = 'jupiterWalletPubkey';
const JUPITER_USER_ADDRESS_KEY = 'jupiterUserAddress';
const JUPITER_PENDING_ACTION_KEY = 'jupiterPendingAction';

const WALLET_SYNC_KEY = 'irWalletSync';

// Remembers which DESKTOP EXTENSION wallet (phantom / solflare) the user
// last connected with successfully, so a page reload's silent-reconnect
// attempt (see _trySilentExtensionReconnect) tries that wallet first
// instead of always assuming Phantom. Separate from the mobile-deeplink
// 'irWalletType' key, which only applies to the ALT (Jupiter/Solflare)
// mobile session slots.
const EXT_WALLET_TYPE_KEY = 'irExtWalletType';

class WalletManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.provider = null;
    this.publicKey = null;
    this.connected = false;
    this.connecting = false;
    this.balance = null;
    this.connection = null;
    this.walletType = null;

    this.mobileSession = null;
    this.dappKeyPair = null;
    this.phantomWalletPublicKey = null;

    this._initConnection();
    this._bindProviderEvents();
    this._restoreMobileKeyPair();
    this._checkDebugQueryParam();
    this._bindCrossTabSync();
    // Deferred to the next tick: Game's constructor creates this manager
    // BEFORE setupEventListeners() runs, so a 'wallet:connected' emitted
    // synchronously here would fire into an empty EventBus and be lost.
    setTimeout(() => this._trySilentExtensionReconnect(), 0);

    this.eventBus.on('wallet:scanRequest', () => { this.scanBalances(); });
  }

  processMobileRedirect() {
    this._handleMobileRedirect();
  }

  _initConnection() {
    if (typeof solanaWeb3 === 'undefined') { console.error('[WalletManager] solana web3.js not loaded'); return; }
    this.connection = new solanaWeb3.Connection(RPC_ENDPOINT, 'confirmed');
  }

  getProvider() {
    if (window?.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window?.solana?.isPhantom) return window.solana;
    return null;
  }

  isPhantomInstalled() { return !!this.getProvider(); }

  isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

  // FIX (bug 2): script-invoked window.location.replace()/href to a
  // Universal Link is handled less reliably by iOS/Android than a real
  // user-gesture anchor click - a known cause of "app opens, shows
  // confirm screen, then bounces back without completing the handshake"
  // because the OS can treat it as a soft/interceptible navigation rather
  // than a committed one. Routing every mobile wallet deep link through a
  // real <a> click instead fixes this without touching URL-building or
  // encryption logic, which was already correct.
  _navigateToUniversalLink(url) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    // FIX: index.html has <base target="_blank"> in <head>, which makes
    // every <a> without an explicit target attribute default to opening in
    // a NEW tab/window. On mobile, forcing this Universal Link open as a
    // "new tab" is what silently broke the Phantom hand-off - the OS
    // reliably intercepts a same-tab top-level navigation to a Universal
    // Link, but not one launched via a new-window anchor click, so tapping
    // "Phantom" appeared to do nothing at all.
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // If a mobile deep link actually opens the wallet app, this tab gets
  // backgrounded almost immediately. If it DOESN'T (app not installed, or
  // the OS failed to intercept the link), the tab stays visible and
  // `connecting` would otherwise stay stuck `true` forever - silently
  // blocking every future tap on that wallet button with no feedback.
  // This clears that stuck state and surfaces a real error instead.
  _armMobileConnectFallback(walletLabel) {
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', cleanup);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') cleanup(); };
    const timer = setTimeout(() => {
      cleanup();
      if (document.visibilityState === 'visible' && this.connecting) {
        this.connecting = false;
        this.eventBus.emit('wallet:error', {
          message: `Couldn't open ${walletLabel}. Make sure the app is installed, then try again.`
        });
      }
    }, 2500);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', cleanup, { once: true });
  }

  // FIX: now takes an explicit provider + walletType instead of always
  // re-resolving via getProvider() (which ONLY ever looks for Phantom).
  // Previously connectSolflare() called this with no args, which silently
  // rebound this.provider back to the Phantom extension object (if
  // installed) right after Solflare had just connected - leaving
  // disconnect()/signMessage/sendTransaction all secretly targeting the
  // wrong wallet. Defaults preserve the original Phantom-only call sites.
  _bindProviderEvents(provider, walletType = 'phantom') {
    provider = provider || this.getProvider();
    if (!provider || provider === this.provider) return;
    this.provider = provider;
    provider.on('connect', (publicKey) => {
      this.publicKey = publicKey || provider.publicKey;
      this.connected = true;
      this.walletType = walletType;
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
    });
    provider.on('disconnect', () => {
      this.connected = false; this.publicKey = null; this.balance = null; this.walletType = null;
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:disconnected');
    });
    provider.on('accountChanged', (publicKey) => {
      if (publicKey) {
        this.publicKey = publicKey;
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        });
      } else {
        this.connected = false; this.publicKey = null; this.eventBus.emit('wallet:disconnected');
      }
    });
  }

  _bindCrossTabSync() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('storage', (e) => {
      if (e.key !== WALLET_SYNC_KEY) return;
      this._handleCrossTabSync(e.newValue);
    });
  }

  _handleCrossTabSync(raw) {
    try {
      const data = raw ? JSON.parse(raw) : null;
      if (!data) return;
      if (data.address) {
        if (!this.connected) {
          this._restoreMobileKeyPair();
          this._notifyRestoredConnection();
        }
      } else {
        if (this.connected) {
          this.connected = false; this.publicKey = null; this.balance = null;
          this.mobileSession = null; this.phantomWalletPublicKey = null; this.walletType = null;
          this.eventBus.emit('wallet:disconnected');
        }
      }
    } catch (_) {}
  }

  _broadcastWalletSync() {
    try {
      localStorage.setItem(WALLET_SYNC_KEY, JSON.stringify({
        address: this.publicKey ? this.publicKey.toString() : null,
        ts: Date.now()
      }));
    } catch (_) {}
  }

  _checkDebugQueryParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1') localStorage.setItem('wmDebug', '1');
      else if (params.get('debug') === '0') localStorage.removeItem('wmDebug');
      if (params.get('resetWallet') === '1') {
        [PHANTOM_SESSION_KEY, PHANTOM_KEYPAIR_KEY, PHANTOM_WALLET_PUBKEY_KEY, PHANTOM_USER_ADDRESS_KEY,
         JUPITER_SESSION_KEY, JUPITER_WALLET_PUBKEY_KEY, JUPITER_USER_ADDRESS_KEY, WALLET_SYNC_KEY,
         'irWalletType', EXT_WALLET_TYPE_KEY].forEach(k => localStorage.removeItem(k));
        this.mobileSession = null; this.dappKeyPair = null; this.phantomWalletPublicKey = null;
        this.publicKey = null; this.connected = false; this.walletType = null;
      }
    } catch (_) {}
  }

  _restoreMobileKeyPair() {
    try {
      const saved = localStorage.getItem(PHANTOM_KEYPAIR_KEY);
      if (saved) {
        const { publicKey, secretKey } = JSON.parse(saved);
        this.dappKeyPair = { publicKey: new Uint8Array(publicKey), secretKey: new Uint8Array(secretKey) };
      }
      let savedSession = localStorage.getItem(PHANTOM_SESSION_KEY);
      let savedWalletPubkey = localStorage.getItem(PHANTOM_WALLET_PUBKEY_KEY);
      let savedAddress = localStorage.getItem(PHANTOM_USER_ADDRESS_KEY);
      let type = 'phantom';
      if (!savedSession) {
        savedSession = localStorage.getItem(JUPITER_SESSION_KEY);
        savedWalletPubkey = localStorage.getItem(JUPITER_WALLET_PUBKEY_KEY);
        savedAddress = localStorage.getItem(JUPITER_USER_ADDRESS_KEY);
        // ALT slots hold any non-phantom wallet - recover the real type.
        type = localStorage.getItem('irWalletType') || 'jupiter';
      }
      if (savedSession && savedWalletPubkey && savedAddress && this.dappKeyPair) {
        this.phantomWalletPublicKey = b58decode(savedWalletPubkey);
        this.publicKey = new solanaWeb3.PublicKey(savedAddress);
        this.connected = true;
        this.walletType = type;
        this.mobileSession = savedSession;
      }
    } catch (_) {}
  }

  _debugLog(msg) {
    try {
      if (localStorage.getItem('wmDebug') !== '1') return;
      let box = document.getElementById('wmDebugOverlay');
      if (!box) {
        box = document.createElement('div');
        box.id = 'wmDebugOverlay';
        box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:16vh;overflow-y:auto;background:rgba(0,0,0,0.75);color:#39ff6a;font-size:8px;font-family:monospace;padding:4px;z-index:999999;white-space:pre-wrap;word-break:break-all;border-top:1px solid #39ff6a;pointer-events:none;';
        document.body.appendChild(box);
      }
      const line = document.createElement('div');
      line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    } catch (_) {}
  }

  _getOrCreateDappKeyPair() {
    if (this.dappKeyPair) return this.dappKeyPair;
    if (typeof nacl === 'undefined') throw new Error('tweetnacl is not loaded.');
    this.dappKeyPair = nacl.box.keyPair();
    this._persistDappKeyPair(this.dappKeyPair);
    return this.dappKeyPair;
  }

  _persistDappKeyPair(keyPair) {
    try {
      localStorage.setItem(PHANTOM_KEYPAIR_KEY, JSON.stringify({
        publicKey: Array.from(keyPair.publicKey), secretKey: Array.from(keyPair.secretKey)
      }));
    } catch (_) {}
  }

  _buildMobileConnectUrl(walletType = 'phantom') {
    const keyPair = this._getOrCreateDappKeyPair();
    const appUrl = encodeURIComponent(window.location.href.split('?')[0].split('#')[0]);
    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(`${redirectBase}?walletReturn=connect&dsk=${dsk}&walletType=${walletType}`);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const base = walletType === 'jupiter'
      ? 'https://jup.ag/wallet/v1/connect'
      : walletType === 'solflare'
        ? 'https://solflare.com/ul/v1/connect'
        : 'https://phantom.app/ul/v1/connect';
    return `${base}?app_url=${appUrl}&dapp_encryption_public_key=${dappPubKey}&redirect_link=${redirectUrl}&cluster=${PHANTOM_CLUSTER}`;
  }

  _buildMobileSignMessageUrl(message) {
    if (!this.mobileSession) throw new Error('No active mobile session.');
    const keyPair = this._getOrCreateDappKeyPair();
    const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);
    const payload = { session: this.mobileSession, message: b58encode(message), display: 'utf8' };
    const nonce = nacl.randomBytes(24);
    const encryptedPayload = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, sharedSecret);
    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(`${redirectBase}?walletReturn=signMessage&dsk=${dsk}&walletType=${this.walletType}`);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));
    const base = this.walletType === 'jupiter'
      ? 'https://jup.ag/wallet/v1/signMessage'
      : this.walletType === 'solflare'
        ? 'https://solflare.com/ul/v1/signMessage'
        : 'https://phantom.app/ul/v1/signMessage';
    return `${base}?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrl}&payload=${payloadParam}`;
  }

  _buildMobileSignTransactionUrl(serializedTransaction, pendingAction) {
    this._debugLog(`buildSignTransaction: mobileSession=${this.mobileSession ? 'present' : 'MISSING'} walletType=${this.walletType} pendingAction=${JSON.stringify(pendingAction)}`);
    if (!this.mobileSession) throw new Error('No active mobile session.');
    const keyPair = this._getOrCreateDappKeyPair();
    const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);
    const payload = { session: this.mobileSession, transaction: b58encode(serializedTransaction) };
    const nonce = nacl.randomBytes(24);
    const encryptedPayload = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, sharedSecret);

    // Non-phantom mobile wallets share the generic ALT session slots.
    const storageKey = this.walletType === 'phantom' ? PHANTOM_PENDING_ACTION_KEY : JUPITER_PENDING_ACTION_KEY;
    try { localStorage.setItem(storageKey, JSON.stringify(pendingAction || null)); } catch (_) {}

    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(`${redirectBase}?walletReturn=signTransaction&dsk=${dsk}&walletType=${this.walletType}`);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));
    const base = this.walletType === 'jupiter'
      ? 'https://jup.ag/wallet/v1/signTransaction'
      : this.walletType === 'solflare'
        ? 'https://solflare.com/ul/v1/signTransaction'
        : 'https://phantom.app/ul/v1/signTransaction';
    return `${base}?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrl}&payload=${payloadParam}`;
  }

  _handleMobileRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const returnType = urlParams.get('walletReturn');
    const walletType = urlParams.get('walletType') || 'phantom';
    if (!returnType) { this._notifyRestoredConnection(); return; }

    this._debugLog(`redirect: type=${returnType} walletType=${walletType} errorCode=${urlParams.get('errorCode') || 'none'} hasNonce=${!!urlParams.get('nonce')} hasData=${!!urlParams.get('data')} hasDsk=${!!urlParams.get('dsk')}`);

    const cleanUrl = window.location.href.split('?')[0];
    window.history.replaceState({}, document.title, cleanUrl);

    // The constructor already restored the saved mobile session from
    // localStorage - but that ran before any UI listeners existed, so the
    // wallet button still shows "Connect Wallet" after a Phantom redirect
    // return. Re-announce the restored session now that listeners are up.
    this._notifyRestoredConnection();

    if (urlParams.get('errorCode')) {
      const message = urlParams.get('errorMessage') || 'Wallet request rejected.';
      this._debugLog(`=> ERROR: ${message}`);
      if (returnType === 'signMessage') {
        this.eventBus.emit('wallet:signTestError', { message });
      } else if (returnType === 'signTransaction') {
        const pendingAction = this._consumePendingAction(walletType);
        this.eventBus.emit('wallet:txError', { message, pendingAction });
      } else {
        this.eventBus.emit('wallet:error', { message });
      }
      return;
    }

    const phantomPubKeyParam = urlParams.get('phantom_encryption_public_key');
    const nonceParam = urlParams.get('nonce');
    const dataParam = urlParams.get('data');
    if (!nonceParam || !dataParam) return;

    try {
      const dskParam = urlParams.get('dsk');
      let keyPair;
      if (dskParam) {
        keyPair = nacl.box.keyPair.fromSecretKey(b58decode(dskParam));
        this.dappKeyPair = keyPair;
        this._persistDappKeyPair(keyPair);
      } else {
        keyPair = this._getOrCreateDappKeyPair();
      }
      const phantomPubKey = phantomPubKeyParam ? b58decode(phantomPubKeyParam) : this.phantomWalletPublicKey;
      if (!phantomPubKey) throw new Error('No wallet public key available.');
      const sharedSecret = nacl.box.before(phantomPubKey, keyPair.secretKey);
      const decrypted = nacl.box.open.after(b58decode(dataParam), b58decode(nonceParam), sharedSecret);
      if (!decrypted) throw new Error('Failed to decrypt response.');
      const result = JSON.parse(new TextDecoder().decode(decrypted));
      this._debugLog(`decrypt OK: type=${returnType}`);

      if (returnType === 'connect') {
        this.phantomWalletPublicKey = phantomPubKey;
        this.mobileSession = result.session;
        this.walletType = walletType;
        // Non-phantom mobile wallets share the generic ALT session slots;
        // the actual wallet type is persisted separately so restores and
        // future deeplinks (signMessage/signTransaction) target the right app.
        const sessionKey = walletType === 'phantom' ? PHANTOM_SESSION_KEY : JUPITER_SESSION_KEY;
        const pubkeyKey = walletType === 'phantom' ? PHANTOM_WALLET_PUBKEY_KEY : JUPITER_WALLET_PUBKEY_KEY;
        const addrKey = walletType === 'phantom' ? PHANTOM_USER_ADDRESS_KEY : JUPITER_USER_ADDRESS_KEY;
        localStorage.setItem(sessionKey, this.mobileSession);
        try { localStorage.setItem('irWalletType', walletType); } catch (_) {}
        try { localStorage.setItem(pubkeyKey, b58encode(phantomPubKey)); } catch (_) {}
        this.publicKey = new solanaWeb3.PublicKey(result.public_key);
        this.connected = true;
        try { localStorage.setItem(addrKey, this.publicKey.toString()); } catch (_) {}
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: null, walletType: this.walletType });
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
        });
      } else if (returnType === 'signMessage') {
        this.eventBus.emit('wallet:signTestResult', {
          signatureHex: Array.from(b58decode(result.signature)).map(b => b.toString(16).padStart(2, '0')).join(''),
          publicKey: this.publicKey ? this.publicKey.toString() : ''
        });
      } else if (returnType === 'signTransaction') {
        const pendingAction = this._consumePendingAction(walletType);
        const signedTxBytes = b58decode(result.transaction);
        this.connection.sendRawTransaction(signedTxBytes)
          .then(signature => { this.eventBus.emit('wallet:txConfirmed', { signature, pendingAction }); })
          .catch(err => {
            this._debugLog(`=> sendRawTransaction FAILED: ${err?.message || err}`);
            this.eventBus.emit('wallet:txError', { message: err?.message || 'Failed to submit transaction.', pendingAction });
          });
      }
    } catch (err) {
      console.error('[WalletManager] Redirect processing failed:', err);
      this._debugLog(`=> EXCEPTION: ${err?.message || err}`);
      if (returnType === 'signTransaction') {
        const pendingAction = this._consumePendingAction(walletType);
        this.eventBus.emit('wallet:txError', { message: 'Transaction failed.', pendingAction });
      } else {
        this.eventBus.emit('wallet:error', { message: 'Could not complete wallet connection.' });
      }
    }
  }

  _notifyRestoredConnection() {
    if (this.connected && this.publicKey) {
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
    }
  }

  // Silently reconnect a browser-extension wallet (Phantom or Solflare) on
  // page load when the extension still trusts this dapp - no popup.
  //
  // FIX: previously this ONLY ever tried Phantom (via getProvider(), which
  // is hardcoded to Phantom's isPhantom flag). If you last connected with
  // Solflare, a refresh would find no trusted Phantom session, give up
  // silently, and leave the UI showing "Connect Wallet" even though
  // Solflare was still trusted by the extension - the "already connected
  // but wallet button says disconnected" confusion after refresh.
  //
  // Now it checks EXT_WALLET_TYPE_KEY (set on every successful desktop
  // extension connect) and tries THAT wallet first, falling back to the
  // other extension if the preferred one isn't installed.
  _trySilentExtensionReconnect() {
    if (this.connected) return; // mobile session (or something else) already restored

    let lastExtWallet = null;
    try { lastExtWallet = localStorage.getItem(EXT_WALLET_TYPE_KEY); } catch (_) {}

    const tryPhantom = () => {
      const provider = this.getProvider();
      if (!provider) return false;
      const finish = (pubkey) => {
        if (!pubkey || this.connected) return;
        this.publicKey = pubkey;
        this.connected = true;
        this.walletType = 'phantom';
        this._bindProviderEvents(provider, 'phantom');
        try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'phantom'); } catch (_) {}
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
        });
      };
      try {
        if (provider.publicKey) { finish(provider.publicKey); return true; }
        if (typeof provider.connect === 'function') {
          provider.connect({ onlyIfTrusted: true })
            .then((resp) => finish(resp && resp.publicKey))
            .catch(() => { /* not trusted yet - user connects manually */ });
        }
      } catch (_) { /* silent-restore is best-effort only */ }
      return true;
    };

    const trySolflare = () => {
      const provider = window?.solflare;
      if (!provider) return false;
      const finish = (pubkey) => {
        if (!pubkey || this.connected) return;
        this.publicKey = pubkey;
        this.connected = true;
        this.walletType = 'solflare';
        this._bindProviderEvents(provider, 'solflare');
        try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'solflare'); } catch (_) {}
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
        });
      };
      try {
        if (provider.isConnected && provider.publicKey) { finish(provider.publicKey); return true; }
        if (typeof provider.connect === 'function') {
          provider.connect({ onlyIfTrusted: true })
            .then((resp) => finish((resp && resp.publicKey) || provider.publicKey))
            .catch(() => { /* not trusted yet - user connects manually */ });
        }
      } catch (_) { /* silent-restore is best-effort only */ }
      return true;
    };

    // Try whichever wallet was used last time first; fall back to the other
    // installed extension if that one isn't available.
    if (lastExtWallet === 'solflare') {
      if (!trySolflare()) tryPhantom();
    } else {
      if (!tryPhantom()) trySolflare();
    }
  }

  _consumePendingAction(walletType) {
    const key = walletType === 'jupiter' ? JUPITER_PENDING_ACTION_KEY : PHANTOM_PENDING_ACTION_KEY;
    try {
      const raw = localStorage.getItem(key);
      localStorage.removeItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ------------------------------------------------------------------
  // CONNECT
  // ------------------------------------------------------------------
  async connect(preferredWallet) {
    // FIX (bug 3): previously only guarded on `connecting`, so clicking a
    // second wallet option while one was ALREADY connected (e.g. Solflare
    // connected, then click Phantom) would kick off a second, independent
    // connect flow and stomp whichever wallet's state resolved last.
    if (this.connecting || this.connected) return;
    if (preferredWallet === 'jupiter') {
      return this.connectJupiter();
    }
    if (preferredWallet === 'solflare') {
      return this.connectSolflare();
    }
    const provider = this.getProvider();
    if (provider) return this._connectProvider(provider);
    if (this.isMobile()) {
      this.connecting = true;
      this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });
      const url = this._buildMobileConnectUrl('phantom');
      this._debugLog(`connect: navigating (anchor-click)`);
      this._navigateToUniversalLink(url);
      this._armMobileConnectFallback('Phantom');
      return { deepLinked: true };
    }
    window.open('https://phantom.app/', '_blank');
    this.eventBus.emit('wallet:error', { message: 'Phantom not installed.' });
    throw new Error('Phantom not installed');
  }

  async connectJupiter() {
    if (this.connecting || this.connected) return;
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'jupiter' });
    if (this.isMobile()) {
      const url = this._buildMobileConnectUrl('jupiter');
      this._debugLog(`connectJupiter: navigating (anchor-click)`);
      this._navigateToUniversalLink(url);
      this._armMobileConnectFallback('Jupiter');
      return { deepLinked: true };
    }
    if (window?.jupiter?.solana) {
      try {
        const resp = await window.jupiter.solana.connect();
        this.publicKey = resp.publicKey;
        this.connected = true;
        this.walletType = 'jupiter';
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
        });
        return { address: this.publicKey.toString(), balance: this.balance };
      } catch (err) {
        this.eventBus.emit('wallet:error', { message: err?.message || 'Jupiter connection rejected.' });
        throw err;
      } finally { this.connecting = false; }
    }
    window.open('https://jup.ag/', '_blank');
    this.eventBus.emit('wallet:error', { message: 'Jupiter wallet not installed.' });
    throw new Error('Jupiter not installed');
  }

  // Solflare - replaces Jupiter on MOBILE (Jupiter's mobile "wallet" link is
  // just the jup.ag swap site; it has no Phantom-style dapp deeplink). Solflare
  // supports the same encrypted /ul/v1 deeplink protocol as Phantom, so mobile
  // connect/sign/transaction flows work identically. Desktop uses the Solflare
  // browser extension when present.
  async connectSolflare() {
    // FIX (bug 3): guard against a duplicate/overlapping connect attempt.
    if (this.connecting || this.connected) return;
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'solflare' });
    if (this.isMobile()) {
      const url = this._buildMobileConnectUrl('solflare');
      this._debugLog(`connectSolflare: navigating (anchor-click)`);
      this._navigateToUniversalLink(url);
      this._armMobileConnectFallback('Solflare');
      return { deepLinked: true };
    }
    if (window?.solflare) {
      try {
        const resp = await window.solflare.connect();
        // Solflare's extension does NOT reliably return { publicKey } from
        // connect() the way Phantom does - on several versions the promise
        // resolves empty and the key only appears on window.solflare.publicKey.
        // Reading resp.publicKey blindly crashed with
        // "Cannot read properties of undefined (reading 'toString')" and left
        // the wallet half-connected with no UI update.
        const pk = (resp && resp.publicKey) || window.solflare.publicKey || null;
        if (!pk) throw new Error('Solflare did not return a public key. Please try again.');
        // FIX (bug 2): pass the Solflare provider + wallet type explicitly.
        // The old call `this._bindProviderEvents()` took no args, which made
        // it re-resolve via getProvider() - a function that ONLY ever
        // recognizes Phantom. If the Phantom extension was also installed,
        // this silently rebound this.provider (and its connect/disconnect
        // listeners) to Phantom right after Solflare connected, so
        // disconnect()/signMessage/sendTransaction all quietly targeted the
        // wrong wallet and cross-wired state between the two providers.
        this._bindProviderEvents(window.solflare, 'solflare');
        this.publicKey = pk;
        this.connected = true;
        this.walletType = 'solflare';
        try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'solflare'); } catch (_) {}
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
        });
        return { address: this.publicKey.toString(), balance: this.balance };
      } catch (err) {
        this.connected = false;
        this.publicKey = null;
        this.eventBus.emit('wallet:error', { message: err?.message || 'Solflare connection rejected.' });
        throw err;
      } finally { this.connecting = false; }
    }
    this.connecting = false;
    window.open('https://solflare.com/', '_blank');
    this.eventBus.emit('wallet:error', { message: 'Solflare wallet not installed.' });
    throw new Error('Solflare not installed');
  }

  async _connectProvider(provider) {
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });
    try {
      const resp = await provider.connect();
      this._bindProviderEvents(provider, 'phantom');
      this.publicKey = resp.publicKey;
      this.connected = true;
      this.walletType = 'phantom';
      try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'phantom'); } catch (_) {}
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
      return { address: this.publicKey.toString(), balance: this.balance };
    } catch (err) {
      const message = err?.code === 4001 ? 'Connection rejected.' : (err?.message || 'Connection failed.');
      this.eventBus.emit('wallet:error', { message });
      throw err;
    } finally { this.connecting = false; }
  }

  async disconnect() {
    if (this.provider) { try { await this.provider.disconnect(); } catch (_) {} }
    this.connected = false; this.publicKey = null; this.balance = null;
    this.mobileSession = null; this.phantomWalletPublicKey = null; this.walletType = null;
    [PHANTOM_SESSION_KEY, PHANTOM_WALLET_PUBKEY_KEY, PHANTOM_USER_ADDRESS_KEY,
     JUPITER_SESSION_KEY, JUPITER_WALLET_PUBKEY_KEY, JUPITER_USER_ADDRESS_KEY,
     'irWalletType', EXT_WALLET_TYPE_KEY].forEach(k => localStorage.removeItem(k));
    this._broadcastWalletSync();
    this.eventBus.emit('wallet:disconnected');
  }

  async _refreshBalance() {
    if (!this.connection || !this.publicKey) { this.balance = null; return null; }
    try {
      const lamports = await this.connection.getBalance(this.publicKey, 'confirmed');
      this.balance = lamports / solanaWeb3.LAMPORTS_PER_SOL;
    } catch (err) { console.error('[WalletManager] balance fetch failed:', err); this.balance = null; }
    return this.balance;
  }

  async _scanTokenBalance(mintAddress) {
    if (!this.connection || !this.publicKey) return 0;
    try {
      const mintPubkey = new solanaWeb3.PublicKey(mintAddress);
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(this.publicKey, { mint: mintPubkey });
      if (tokenAccounts.value.length > 0) {
        const accountInfo = await this.connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
        return accountInfo.value.uiAmount || 0;
      }
      return 0;
    } catch (err) { console.warn('[WalletManager] Token fetch failed:', err); return 0; }
  }

  async scanBalances() {
    if (!this.connected || !this.publicKey) { this.eventBus.emit('wallet:error', { message: 'Wallet not connected.' }); return; }
    this.eventBus.emit('wallet:balanceUpdated', { balance: 'Scanning...' });
    const solBalance = await this._refreshBalance();
    const INFINITE_COIN_MINT = 'C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump';
    const infiniteBalance = await this._scanTokenBalance(INFINITE_COIN_MINT);
    this.eventBus.emit('wallet:scanResult', { sol: solBalance || 0, infinite: infiniteBalance });
    return { sol: solBalance, infinite: infiniteBalance };
  }

  async refreshBalance() {
    const balance = await this._refreshBalance();
    this.eventBus.emit('wallet:balanceUpdated', { balance });
    return balance;
  }

  async signTestMessage() {
    if (!this.connected) throw new Error('Wallet not connected.');
    const message = `Infinite Runners — verify wallet ownership\nAddress: ${this.publicKey.toString()}\nTimestamp: ${new Date().toISOString()}`;
    const encoded = new TextEncoder().encode(message);
    if (this.isMobile() && !this.provider) {
      this._navigateToUniversalLink(this._buildMobileSignMessageUrl(encoded));
      return { deepLinked: true };
    }
    if (!this.provider) throw new Error('Wallet not connected.');
    const { signature, publicKey } = await this.provider.signMessage(encoded, 'utf8');
    return { message, signatureHex: Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join(''), publicKey: publicKey.toString() };
  }

  async sendTransaction(transaction, pendingAction) {
    if (!this.connected) throw new Error('Wallet not connected.');
    if (this.provider && this.provider.signAndSendTransaction) {
      const { signature } = await this.provider.signAndSendTransaction(transaction);
      return { signature };
    }
    if (this.isMobile()) {
      const serialized = transaction.serialize({ requireAllSignatures: false });
      this._navigateToUniversalLink(this._buildMobileSignTransactionUrl(serialized, pendingAction));
      return { deepLinked: true };
    }
    throw new Error('No wallet provider available.');
  }

  getShortAddress() {
    if (!this.publicKey) return '';
    const s = this.publicKey.toString();
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
  }
}

export default WalletManager;
