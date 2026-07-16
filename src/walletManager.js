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

// Jupiter uses the same keys — shared session state
const JUPITER_SESSION_KEY = 'jupiterDappSession';
const JUPITER_WALLET_PUBKEY_KEY = 'jupiterWalletPubkey';
const JUPITER_USER_ADDRESS_KEY = 'jupiterUserAddress';
const JUPITER_PENDING_ACTION_KEY = 'jupiterPendingAction';

// Cross-tab sync channel — when ANY tab completes a connect/disconnect,
// all other open tabs update instantly (fixes the "Approve in Phantom..."
// tab that never learns the wallet connected in the redirect tab).
const WALLET_SYNC_KEY = 'irWalletSync';

class WalletManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.provider = null;
    this.publicKey = null;
    this.connected = false;
    this.connecting = false;
    this.balance = null;
    this.connection = null;
    this.walletType = null; // 'phantom' | 'jupiter'

    this.mobileSession = null;
    this.dappKeyPair = null;
    this.phantomWalletPublicKey = null;

    this._initConnection();
    this._bindProviderEvents();
    this._restoreMobileKeyPair();
    this._checkDebugQueryParam();
    this._bindCrossTabSync();

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

  _bindProviderEvents() {
    const provider = this.getProvider();
    if (!provider || provider === this.provider) return;
    this.provider = provider;
    provider.on('connect', (publicKey) => {
      this.publicKey = publicKey || provider.publicKey;
      this.connected = true;
      this.walletType = 'phantom';
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance });
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
          this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance });
        });
      } else {
        this.connected = false; this.publicKey = null; this.eventBus.emit('wallet:disconnected');
      }
    });
  }

  // ---------------------------------------------------------------
  // CROSS-TAB SYNC
  // localStorage is shared across tabs of the same origin, so the
  // session written by the redirect tab is already readable here —
  // the old tab just never re-read it. The storage event fixes that.
  // ---------------------------------------------------------------
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
        // Another tab connected → adopt the shared session in this tab too
        if (!this.connected) {
          this._restoreMobileKeyPair();
          this._notifyRestoredConnection();
        }
      } else {
        // Another tab disconnected → mirror it here
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
         JUPITER_SESSION_KEY, JUPITER_WALLET_PUBKEY_KEY, JUPITER_USER_ADDRESS_KEY, WALLET_SYNC_KEY].forEach(k => localStorage.removeItem(k));
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
      // Try Phantom first, then Jupiter
      let savedSession = localStorage.getItem(PHANTOM_SESSION_KEY);
      let savedWalletPubkey = localStorage.getItem(PHANTOM_WALLET_PUBKEY_KEY);
      let savedAddress = localStorage.getItem(PHANTOM_USER_ADDRESS_KEY);
      let type = 'phantom';
      if (!savedSession) {
        savedSession = localStorage.getItem(JUPITER_SESSION_KEY);
        savedWalletPubkey = localStorage.getItem(JUPITER_WALLET_PUBKEY_KEY);
        savedAddress = localStorage.getItem(JUPITER_USER_ADDRESS_KEY);
        type = 'jupiter';
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

    const storageKey = this.walletType === 'jupiter' ? JUPITER_PENDING_ACTION_KEY : PHANTOM_PENDING_ACTION_KEY;
    try { localStorage.setItem(storageKey, JSON.stringify(pendingAction || null)); } catch (_) {}

    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(`${redirectBase}?walletReturn=signTransaction&dsk=${dsk}&walletType=${this.walletType}`);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));
    const base = this.walletType === 'jupiter'
      ? 'https://jup.ag/wallet/v1/signTransaction'
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
        const sessionKey = walletType === 'jupiter' ? JUPITER_SESSION_KEY : PHANTOM_SESSION_KEY;
        const pubkeyKey = walletType === 'jupiter' ? JUPITER_WALLET_PUBKEY_KEY : PHANTOM_WALLET_PUBKEY_KEY;
        const addrKey = walletType === 'jupiter' ? JUPITER_USER_ADDRESS_KEY : PHANTOM_USER_ADDRESS_KEY;
        localStorage.setItem(sessionKey, this.mobileSession);
        try { localStorage.setItem(pubkeyKey, b58encode(phantomPubKey)); } catch (_) {}
        this.publicKey = new solanaWeb3.PublicKey(result.public_key);
        this.connected = true;
        try { localStorage.setItem(addrKey, this.publicKey.toString()); } catch (_) {}
        // Emit connected IMMEDIATELY — don't hold the UI hostage to the
        // Helius balance fetch. Balance arrives via wallet:balanceUpdated.
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: null });
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
      // Emit first with whatever balance we have (possibly null), refresh after.
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
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
    if (this.connecting) return;
    if (preferredWallet === 'jupiter') {
      // FIX: was this._connectJupiter() — that method doesn't exist and
      // would throw. The public method is connectJupiter().
      return this.connectJupiter();
    }
    const provider = this.getProvider();
    if (provider) return this._connectProvider(provider);
    if (this.isMobile()) {
      this.connecting = true;
      this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });
      window.location.replace(this._buildMobileConnectUrl('phantom'));
      return { deepLinked: true };
    }
    window.open('https://phantom.app/', '_blank');
    this.eventBus.emit('wallet:error', { message: 'Phantom not installed.' });
    throw new Error('Phantom not installed');
  }

  async connectJupiter() {
    if (this.connecting) return;
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'jupiter' });
    if (this.isMobile()) {
      window.location.replace(this._buildMobileConnectUrl('jupiter'));
      return { deepLinked: true };
    }
    // Desktop Jupiter extension
    if (window?.jupiter?.solana) {
      try {
        const resp = await window.jupiter.solana.connect();
        this.publicKey = resp.publicKey;
        this.connected = true;
        this.walletType = 'jupiter';
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance });
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

  async _connectProvider(provider) {
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });
    try {
      const resp = await provider.connect();
      this._bindProviderEvents();
      this.publicKey = resp.publicKey;
      this.connected = true;
      this.walletType = 'phantom';
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance });
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
     JUPITER_SESSION_KEY, JUPITER_WALLET_PUBKEY_KEY, JUPITER_USER_ADDRESS_KEY].forEach(k => localStorage.removeItem(k));
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
      window.location.href = this._buildMobileSignMessageUrl(encoded);
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
      window.location.replace(this._buildMobileSignTransactionUrl(serialized, pendingAction));
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
