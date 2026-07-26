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
    this._checkAutoConnectQueryParam();
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

  // FIX: added Solflare provider detection for when game opens inside Solflare browser
  getSolflareProvider() {
    if (window?.solflare?.isSolflare) return window.solflare;
    return null;
  }

  isPhantomInstalled() { return !!this.getProvider(); }

  isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

  // FIX: removed broken browse-url methods. The "browse" deep link opens the
  // wallet's WEBSITE instead of the app from Telegram/Chrome. Reverted to
  // the proper encrypted /ul/v1/connect deep link which opens the app directly.

  // FIX: script-invoked window.location.replace()/href to a Universal Link is
  // handled less reliably by iOS/Android than a real user-gesture anchor click.
  _navigateToUniversalLink(url) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

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
          message: `Couldn\'t open ${walletLabel}. Make sure the app is installed, then try again.`
        });
      }
    }, 2500);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', cleanup, { once: true });
  }

  _bindProviderEvents(provider, walletType = 'phantom') {
    provider = provider || this.getProvider();
    if (!provider || provider === this.provider) return;
    this.provider = provider;
    provider.on('connect', (publicKey) => {
      this.publicKey = publicKey || provider.publicKey;
      this.connected = true;
      this.connecting = false; // FIX: clear stuck connecting flag
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
    try {
      const params = new URLSearchParams(window.location.search);
      const walletReturn = params.get('walletReturn');
      if (!walletReturn) return;
      const dsk = params.get('dsk');
      const walletType = params.get('walletType') || 'phantom';
      if (!dsk) return;

      const keyPair = { secretKey: b58decode(dsk) };
      keyPair.publicKey = nacl.box.keyPair.fromSecretKey(keyPair.secretKey).publicKey;
      this.dappKeyPair = keyPair;
      this._persistDappKeyPair(keyPair);

      if (walletReturn === 'connect') {
        const phantomEncryptionPublicKey = params.get('phantom_encryption_public_key');
        const data = params.get('data');
        const nonce = params.get('nonce');
        if (phantomEncryptionPublicKey && data && nonce) {
          this.phantomWalletPublicKey = b58decode(phantomEncryptionPublicKey);
          const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);
          const decryptedData = nacl.box.open.after(b58decode(data), b58decode(nonce), sharedSecret);
          if (!decryptedData) throw new Error('Failed to decrypt connect response.');
          const response = JSON.parse(new TextDecoder().decode(decryptedData));
          this.mobileSession = response.session;
          this.publicKey = new solanaWeb3.PublicKey(response.public_key);
          this.connected = true;
          this.connecting = false; // FIX: clear stuck connecting flag
          this.walletType = walletType;

          const sessionKey = walletType === 'phantom' ? PHANTOM_SESSION_KEY : JUPITER_SESSION_KEY;
          const walletPubkeyKey = walletType === 'phantom' ? PHANTOM_WALLET_PUBKEY_KEY : JUPITER_WALLET_PUBKEY_KEY;
          const userAddressKey = walletType === 'phantom' ? PHANTOM_USER_ADDRESS_KEY : JUPITER_USER_ADDRESS_KEY;
          try {
            localStorage.setItem(sessionKey, response.session);
            localStorage.setItem(walletPubkeyKey, phantomEncryptionPublicKey);
            localStorage.setItem(userAddressKey, response.public_key);
            localStorage.setItem('irWalletType', walletType);
          } catch (_) {}
          this._broadcastWalletSync();
          this._refreshBalance().then(() => {
            this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
          });
        }
      } else if (walletReturn === 'signMessage') {
        const data = params.get('data');
        const nonce = params.get('nonce');
        if (data && nonce && this.phantomWalletPublicKey) {
          const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);
          const decryptedData = nacl.box.open.after(b58decode(data), b58decode(nonce), sharedSecret);
          if (!decryptedData) throw new Error('Failed to decrypt signMessage response.');
          const response = JSON.parse(new TextDecoder().decode(decryptedData));
          this.eventBus.emit('wallet:signedMessage', { signature: response.signature });
        }
      } else if (walletReturn === 'signTransaction') {
        const data = params.get('data');
        const nonce = params.get('nonce');
        if (data && nonce && this.phantomWalletPublicKey) {
          const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);
          const decryptedData = nacl.box.open.after(b58decode(data), b58decode(nonce), sharedSecret);
          if (!decryptedData) throw new Error('Failed to decrypt signTransaction response.');
          const response = JSON.parse(new TextDecoder().decode(decryptedData));
          const signature = response.signature;
          const pendingAction = JSON.parse(localStorage.getItem(walletType === 'phantom' ? PHANTOM_PENDING_ACTION_KEY : JUPITER_PENDING_ACTION_KEY) || 'null');
          this.eventBus.emit('wallet:txConfirmed', { signature, pendingAction });
        }
      }

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('walletReturn');
      cleanUrl.searchParams.delete('dsk');
      cleanUrl.searchParams.delete('walletType');
      cleanUrl.searchParams.delete('phantom_encryption_public_key');
      cleanUrl.searchParams.delete('data');
      cleanUrl.searchParams.delete('nonce');
      window.history.replaceState({}, document.title, cleanUrl.toString());
    } catch (err) {
      console.error('[WalletManager] Mobile redirect handling failed:', err);
      this.connecting = false; // FIX: clear stuck connecting flag on error
      this.eventBus.emit('wallet:error', { message: 'Failed to process wallet redirect.' });
    }
  }

  // ---------------------------------------------------------------------
  // FIX: reverted from broken "browse" deep links back to proper encrypted
  // /ul/v1/connect deep links. The "browse" URLs open the wallet WEBSITE
  // instead of the app when opened from Telegram/Chrome.
  // ---------------------------------------------------------------------
  async connect() {
    if (this.connected) return;
    if (this.connecting) return;
    this.connecting = true;

    try {
      // FIX: if we're already inside Phantom's in-app browser, provider is injected
      const provider = this.getProvider();
      if (provider) {
        this._bindProviderEvents(provider, 'phantom');
        const resp = await provider.connect();
        this.publicKey = resp.publicKey;
        this.connected = true;
        this.connecting = false;
        this.walletType = 'phantom';
        try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'phantom'); } catch (_) {}
        this._broadcastWalletSync();
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        });
        return;
      }

      if (this.isMobile()) {
        // FIX: use proper encrypted connect deep link, not broken browse link
        const url = this._buildMobileConnectUrl('phantom');
        this._navigateToUniversalLink(url);
        this._armMobileConnectFallback('Phantom');
        return;
      }

      // Desktop: no extension installed
      this.connecting = false;
      this.eventBus.emit('wallet:error', { message: 'Phantom wallet not found. Please install the Phantom extension.' });
    } catch (err) {
      this.connecting = false;
      this.eventBus.emit('wallet:error', { message: err?.message || 'Failed to connect Phantom wallet.' });
    }
  }

  async connectSolflare() {
    if (this.connected) return;
    if (this.connecting) return;
    this.connecting = true;

    try {
      // FIX: if we're already inside Solflare's in-app browser, provider is injected
      const solflareProvider = this.getSolflareProvider();
      if (solflareProvider) {
        this._bindProviderEvents(solflareProvider, 'solflare');
        const resp = await solflareProvider.connect();
        this.publicKey = resp.publicKey;
        this.connected = true;
        this.connecting = false;
        this.walletType = 'solflare';
        try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'solflare'); } catch (_) {}
        this._broadcastWalletSync();
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        });
        return;
      }

      if (this.isMobile()) {
        // FIX: use proper encrypted connect deep link, not broken browse link
        const url = this._buildMobileConnectUrl('solflare');
        this._navigateToUniversalLink(url);
        this._armMobileConnectFallback('Solflare');
        return;
      }

      // Desktop: no extension installed
      this.connecting = false;
      this.eventBus.emit('wallet:error', { message: 'Solflare wallet not found. Please install the Solflare extension.' });
    } catch (err) {
      this.connecting = false;
      this.eventBus.emit('wallet:error', { message: err?.message || 'Failed to connect Solflare wallet.' });
    }
  }

  async disconnect() {
    try {
      if (this.provider && this.provider.disconnect) {
        await this.provider.disconnect();
      }
    } catch (_) {}
    this.connected = false;
    this.publicKey = null;
    this.balance = null;
    this.walletType = null;
    this.provider = null;
    this.mobileSession = null;
    this.phantomWalletPublicKey = null;
    try {
      [PHANTOM_SESSION_KEY, PHANTOM_KEYPAIR_KEY, PHANTOM_WALLET_PUBKEY_KEY, PHANTOM_USER_ADDRESS_KEY,
       JUPITER_SESSION_KEY, JUPITER_WALLET_PUBKEY_KEY, JUPITER_USER_ADDRESS_KEY, WALLET_SYNC_KEY,
       'irWalletType', EXT_WALLET_TYPE_KEY].forEach(k => localStorage.removeItem(k));
    } catch (_) {}
    this.eventBus.emit('wallet:disconnected');
  }

  async _trySilentExtensionReconnect() {
    try {
      const extType = localStorage.getItem(EXT_WALLET_TYPE_KEY);

      // FIX: try Solflare first if it was last used
      if (extType === 'solflare') {
        const solflareProvider = this.getSolflareProvider();
        if (solflareProvider && solflareProvider.isConnected && solflareProvider.publicKey) {
          this._bindProviderEvents(solflareProvider, 'solflare');
          this.publicKey = solflareProvider.publicKey;
          this.connected = true;
          this.connecting = false;
          this.walletType = 'solflare';
          this._broadcastWalletSync();
          this._refreshBalance().then(() => {
            this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
          });
          return;
        }
      }

      const provider = this.getProvider();
      if (provider && provider.isConnected && provider.publicKey) {
        this._bindProviderEvents(provider, 'phantom');
        this.publicKey = provider.publicKey;
        this.connected = true;
        this.connecting = false;
        this.walletType = 'phantom';
        this._broadcastWalletSync();
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
        });
      }
    } catch (_) {}
  }

  async _refreshBalance() {
    if (!this.publicKey || !this.connection) return;
    try {
      const balance = await this.connection.getBalance(this.publicKey);
      this.balance = balance / solanaWeb3.LAMPORTS_PER_SOL;
    } catch (_) { this.balance = null; }
  }

  async scanBalances() {
    if (!this.publicKey || !this.connection) return;
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.publicKey,
        { programId: new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') }
      );
      const balances = {};
      for (const { account } of tokenAccounts.value) {
        const info = account.data.parsed.info;
        balances[info.mint] = info.tokenAmount.uiAmount;
      }
      this.eventBus.emit('wallet:tokenBalances', balances);
    } catch (err) {
      console.error('[WalletManager] scanBalances failed:', err);
    }
  }

  async sendTransaction(transaction, pendingAction = null) {
    if (!this.connected || !this.publicKey) {
      throw new Error('Wallet not connected.');
    }

    try {
      if (this.provider && this.provider.signAndSendTransaction) {
        const { signature } = await this.provider.signAndSendTransaction(transaction);
        return { signature };
      }

      if (this.provider && this.provider.signTransaction) {
        const signed = await this.provider.signTransaction(transaction);
        const signature = await this.connection.sendRawTransaction(signed.serialize());
        return { signature };
      }

      if (this.mobileSession && this.phantomWalletPublicKey) {
        const serialized = transaction.serialize({ requireAllSignatures: false });
        const url = this._buildMobileSignTransactionUrl(serialized, pendingAction);
        this._navigateToUniversalLink(url);
        return { deepLinked: true };
      }

      throw new Error('No available signing method.');
    } catch (err) {
      console.error('[WalletManager] sendTransaction failed:', err);
      throw err;
    }
  }

  async signMessage(message) {
    if (!this.connected || !this.publicKey) {
      throw new Error('Wallet not connected.');
    }

    try {
      if (this.provider && this.provider.signMessage) {
        const encodedMessage = new TextEncoder().encode(message);
        const { signature } = await this.provider.signMessage(encodedMessage, 'utf8');
        return signature;
      }

      if (this.mobileSession && this.phantomWalletPublicKey) {
        const encodedMessage = new TextEncoder().encode(message);
        const url = this._buildMobileSignMessageUrl(encodedMessage);
        this._navigateToUniversalLink(url);
        return null;
      }

      throw new Error('No available message signing method.');
    } catch (err) {
      console.error('[WalletManager] signMessage failed:', err);
      throw err;
    }
  }

  _notifyRestoredConnection() {
    if (this.publicKey) {
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType });
      });
    }
  }
}

export default WalletManager;
