// walletManager.js
// FIX: this was pointing at DEVNET while the INFINITE mint, the hot
// wallet, and every player's actual tokens live on MAINNET.
const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=de2fb44b-73e1-4ee5-aa9d-b1134825a8b0';

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
    this.walletType = null;

    this.mobileSession = null;
    this.dappKeyPair = null;
    this.phantomWalletPublicKey = null;

    this.pendingLinkCode = null;
    this._arrivedLinkCode = null;

    this.pendingHandoffCode = null;
    this.pendingResumeRoom = null;
    this._arrivedHandoffCode = null;
    this._arrivedResumeRoom = null;

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

  isPhantomInstalled() { return !!this.getProvider(); }

  isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

  _buildBrowseUrl(walletType, targetUrl) {
    const encodedUrl = encodeURIComponent(targetUrl);
    const encodedRef = encodeURIComponent(window.location.origin);
    return `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedRef}`;
  }

  openInWalletBrowser(walletType) {
    const currentUrl = new URL(window.location.href.split('?')[0].split('#')[0]);
    currentUrl.searchParams.set('autoConnectWallet', walletType);
    if (this.pendingLinkCode) currentUrl.searchParams.set('linkCode', this.pendingLinkCode);
    if (this.pendingHandoffCode) currentUrl.searchParams.set('handoff', this.pendingHandoffCode);
    if (this.pendingResumeRoom) currentUrl.searchParams.set('resumeRoom', this.pendingResumeRoom);
    const browseUrl = this._buildBrowseUrl(walletType, currentUrl.toString());
    this._navigateTopLevel(browseUrl);
  }

  _checkAutoConnectQueryParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      const handoff = params.get('handoff');
      const resumeRoom = params.get('resumeRoom');
      if (handoff) this._arrivedHandoffCode = handoff;
      if (resumeRoom) this._arrivedResumeRoom = resumeRoom;

      const autoConnectWallet = params.get('autoConnectWallet');
      if (!autoConnectWallet) return;
      this._arrivedInWalletBrowser = autoConnectWallet;
      this._arrivedLinkCode = params.get('linkCode') || null;
      this._arrivedHandoffCode = params.get('handoff') || null;
      this._arrivedResumeRoom = params.get('resumeRoom') || null;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('autoConnectWallet');
      cleanUrl.searchParams.delete('linkCode');
      cleanUrl.searchParams.delete('handoff');
      cleanUrl.searchParams.delete('resumeRoom');
      window.history.replaceState({}, document.title, cleanUrl.toString());

      const startedAt = Date.now();
      const providerPresent = () => !!this.getProvider();
      const poll = () => {
        if (this.connected || this.connecting) return;
        if (providerPresent()) {
          this._debugLog(`autoConnect: provider injected after ${Date.now() - startedAt}ms - connecting`);
          this.connect().catch(() => {});
          return;
        }
        if (Date.now() - startedAt > 12000) {
          this._debugLog('autoConnect: provider never injected after 12s');
          this.eventBus.emit('wallet:error', {
            message: 'The wallet is still starting up. Tap "Connect Wallet" to finish connecting.'
          });
          return;
        }
        setTimeout(poll, 250);
      };
      setTimeout(poll, 300);
    } catch (_) {}
  }

  _navigateTopLevel(url) {
    try {
      window.location.href = url;
    } catch (_) {
      try {
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
      } catch (_) {}
    }
  }

  _navigateToUniversalLink(url) {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 3000);
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
          message: `Couldn't open ${walletLabel}. Make sure the app is installed, then try again.`
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
      if (this.provider !== provider) return;
      this.publicKey = publicKey || provider.publicKey;
      this.connected = true;
      this.walletType = walletType;
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType, linkCode: this._arrivedLinkCode });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
    });
    provider.on('disconnect', () => {
      if (this.provider !== provider) return;
      this.connected = false; this.publicKey = null; this.balance = null; this.walletType = null;
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:disconnected');
    });
    provider.on('accountChanged', (publicKey) => {
      if (this.provider !== provider) return;
      if (publicKey) {
        this.publicKey = publicKey;
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType, linkCode: this._arrivedLinkCode });
        });
      } else {
        this.connected = false; this.publicKey = null; this.eventBus.emit('wallet:disconnected');
      }
    });
  }

  _activeProvider() {
    if (this.walletType === 'phantom') return this.getProvider();
    return this.provider || null;
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
         WALLET_SYNC_KEY,
         'irWalletType'].forEach(k => localStorage.removeItem(k));
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
      if (this._debugOverlayEnabled === undefined) {
        try {
          this._debugOverlayEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
          if (!this._debugOverlayEnabled) {
            localStorage.removeItem('wmDebug');
            const stale = document.getElementById('wmDebugOverlay');
            if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
          }
        } catch (_) { this._debugOverlayEnabled = false; }
      }
      if (!this._debugOverlayEnabled) return;
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

  setBeforeRedirectCallback(cb) { this._beforeRedirectCallback = cb; }

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
    if (this._beforeRedirectCallback) this._beforeRedirectCallback();
    const keyPair = this._getOrCreateDappKeyPair();
    const appUrl = encodeURIComponent(window.location.href.split('?')[0].split('#')[0]);
    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    let redirectUrl = `${redirectBase}?walletReturn=connect&dsk=${dsk}&walletType=${walletType}`;
    if (this.pendingHandoffCode) redirectUrl += `&handoff=${encodeURIComponent(this.pendingHandoffCode)}`;
    if (this.pendingResumeRoom) redirectUrl += `&resumeRoom=${encodeURIComponent(this.pendingResumeRoom)}`;
    const redirectUrlEncoded = encodeURIComponent(redirectUrl);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const base = 'https://phantom.app/ul/v1/connect';
    return `${base}?app_url=${appUrl}&dapp_encryption_public_key=${dappPubKey}&redirect_link=${redirectUrlEncoded}&cluster=${PHANTOM_CLUSTER}`;
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
    let redirectUrl = `${redirectBase}?walletReturn=signMessage&dsk=${dsk}&walletType=${this.walletType}`;
    if (this.pendingHandoffCode) redirectUrl += `&handoff=${encodeURIComponent(this.pendingHandoffCode)}`;
    if (this.pendingResumeRoom) redirectUrl += `&resumeRoom=${encodeURIComponent(this.pendingResumeRoom)}`;
    const redirectUrlEncoded = encodeURIComponent(redirectUrl);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));
    const appUrl = encodeURIComponent(window.location.href.split('?')[0].split('#')[0]);
    const base = 'https://phantom.app/ul/v1/signMessage';
    return `${base}?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrlEncoded}&payload=${payloadParam}&app_url=${appUrl}`;
  }

  _buildMobileSignTransactionUrl(serializedTransaction, pendingAction) {
    this._debugLog(`buildSignTransaction: mobileSession=${this.mobileSession ? 'present' : 'MISSING'} walletType=${this.walletType} pendingAction=${JSON.stringify(pendingAction)}`);
    if (!this.mobileSession) throw new Error('No active mobile session.');
    const keyPair = this._getOrCreateDappKeyPair();
    const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);
    const payload = { session: this.mobileSession, transaction: b58encode(serializedTransaction) };
    const nonce = nacl.randomBytes(24);
    const encryptedPayload = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, sharedSecret);

    const storageKey = PHANTOM_PENDING_ACTION_KEY;
    const fallbackKey = PHANTOM_PENDING_ACTION_KEY;
    try {
      const payloadStr = JSON.stringify(pendingAction || null);
      localStorage.setItem(storageKey, payloadStr);
      localStorage.setItem(fallbackKey, payloadStr);
    } catch (_) {}

    if (this._beforeRedirectCallback) this._beforeRedirectCallback();
    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const returnType = 'signTransaction';
    let redirectUrl = `${redirectBase}?walletReturn=${returnType}&dsk=${dsk}&walletType=${this.walletType}`;
    if (this.pendingHandoffCode) redirectUrl += `&handoff=${encodeURIComponent(this.pendingHandoffCode)}`;
    if (this.pendingResumeRoom) redirectUrl += `&resumeRoom=${encodeURIComponent(this.pendingResumeRoom)}`;
    const redirectUrlEncoded = encodeURIComponent(redirectUrl);
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));
    const appUrl = encodeURIComponent(window.location.href.split('?')[0].split('#')[0]);
    const base = 'https://phantom.app/ul/v1/signTransaction';
    const url = `${base}?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrlEncoded}&payload=${payloadParam}&app_url=${appUrl}`;
    this._debugLog(`signTransaction deeplink length: ${url.length} chars`);
    if (url.length > 8000) {
      this._debugLog('WARNING: deeplink URL exceeds 8000 chars - may be truncated by browser/wallet');
    }
    return url;
  }

  _handleMobileRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const returnType = urlParams.get('walletReturn');
    const walletType = urlParams.get('walletType') || 'phantom';
    const handoff = urlParams.get('handoff');
    const resumeRoom = urlParams.get('resumeRoom');
    if (handoff) this._arrivedHandoffCode = handoff;
    if (resumeRoom) this._arrivedResumeRoom = resumeRoom;
    this._walletReturnType = returnType || null;
    this._debugLog(`redirect check: raw search="${window.location.search}" returnType=${returnType || 'NONE'} handoff=${handoff ? 'present' : 'none'}`);
    if (!returnType) {
      this._notifyRestoredConnection();
      return;
    }

    this._debugLog(`redirect: type=${returnType} walletType=${walletType} errorCode=${urlParams.get('errorCode') || 'none'} hasNonce=${!!urlParams.get('nonce')} hasData=${!!urlParams.get('data')} hasDsk=${!!urlParams.get('dsk')}`);

    const cleanUrl = window.location.href.split('?')[0];
    window.history.replaceState({}, document.title, cleanUrl);
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

    const encPubKeyParam = urlParams.get('phantom_encryption_public_key');
    const nonceParam = urlParams.get('nonce');
    const dataParam = urlParams.get('data');
    if (!nonceParam || !dataParam) {
      this._debugLog(`=> INCOMPLETE RETURN: hasEncKey=${!!encPubKeyParam} hasNonce=${!!nonceParam} hasData=${!!dataParam}`);
      this.eventBus.emit('wallet:error', {
        message: 'The wallet connection response was incomplete. Please try connecting again.'
      });
      return;
    }

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
      const phantomPubKey = encPubKeyParam ? b58decode(encPubKeyParam) : this.phantomWalletPublicKey;
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
        const sessionKey = PHANTOM_SESSION_KEY;
        const pubkeyKey = PHANTOM_WALLET_PUBKEY_KEY;
        const addrKey = PHANTOM_USER_ADDRESS_KEY;
        localStorage.setItem(sessionKey, this.mobileSession);
        try { localStorage.setItem('irWalletType', walletType); } catch (_) {}
        try { localStorage.setItem(pubkeyKey, b58encode(phantomPubKey)); } catch (_) {}
        const otherSessionKey = PHANTOM_SESSION_KEY;
        const otherPubkeyKey  = PHANTOM_WALLET_PUBKEY_KEY;
        const otherAddrKey    = PHANTOM_USER_ADDRESS_KEY;
        try { localStorage.removeItem(otherSessionKey); } catch (_) {}
        try { localStorage.removeItem(otherPubkeyKey); } catch (_) {}
        try { localStorage.removeItem(otherAddrKey); } catch (_) {}
        this.publicKey = new solanaWeb3.PublicKey(result.public_key);
        this.connected = true;
        try { localStorage.setItem(addrKey, this.publicKey.toString()); } catch (_) {}
        this._broadcastWalletSync();
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: null, walletType: this.walletType, linkCode: this._arrivedLinkCode });
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
        });
      } else if (returnType === 'signMessage') {
        this.eventBus.emit('wallet:signTestResult', {
          signatureHex: Array.from(b58decode(result.signature)).map(b => b.toString(16).padStart(2, '0')).join(''),
          publicKey: this.publicKey ? this.publicKey.toString() : ''
        });
      } else if (returnType === 'signTransaction' || returnType === 'signAndSendTransaction') {
        const pendingAction = this._consumePendingAction(walletType);
        if (!pendingAction) {
          this._debugLog('=> signTransaction: pendingAction is null (walletType mismatch?) - main.js will attempt fallback recovery');
        }
        if (result.signature) {
          this._debugLog(`=> signAndSendTransaction OK: sig=${String(result.signature).slice(0, 8)}…`);
          this.eventBus.emit('wallet:txConfirmed', { signature: result.signature, pendingAction });
          return;
        }
        if (!result.transaction) {
          this._debugLog('=> signTransaction: neither signature nor transaction in response');
          this.eventBus.emit('wallet:txError', { message: 'Transaction response was incomplete. Please try placing your bet again.', pendingAction });
          return;
        }
        if (!this.publicKey) {
          this._debugLog('=> signTransaction: publicKey missing - cannot submit');
          this.eventBus.emit('wallet:txError', { message: 'Wallet address not available after redirect. Please reconnect your wallet.', pendingAction });
          return;
        }
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
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType, linkCode: this._arrivedLinkCode });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
    }
  }

  _trySilentExtensionReconnect() {
    if (this.connected) return;
    const provider = this.getProvider();
    if (!provider) return;
    const finish = (pubkey) => {
      if (!pubkey || this.connected) return;
      this.publicKey = pubkey;
      this.connected = true;
      this.walletType = 'phantom';
      this._bindProviderEvents(provider, 'phantom');
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType, linkCode: this._arrivedLinkCode });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
    };
    try {
      if (provider.publicKey) { finish(provider.publicKey); return; }
      if (typeof provider.connect === 'function') {
        provider.connect({ onlyIfTrusted: true })
          .then((resp) => finish(resp && resp.publicKey))
          .catch(() => {});
      }
    } catch (_) {}
  }

  _consumePendingAction(_walletType) {
    try {
      const raw = localStorage.getItem(PHANTOM_PENDING_ACTION_KEY);
      if (raw) {
        localStorage.removeItem(PHANTOM_PENDING_ACTION_KEY);
        return JSON.parse(raw);
      }
    } catch (_) {}
    return null;
  }

  async connect() {
    if (this.connecting || this.connected) return;
    const provider = this.getProvider();
    if (provider) return this._connectProvider(provider);
    if (this.isMobile()) {
      if (this._arrivedInWalletBrowser) {
        this.eventBus.emit('wallet:error', {
          message: 'The wallet is still starting up. Wait a moment, then tap "Connect Wallet" again.'
        });
        throw new Error('Wallet provider not injected yet');
      }
      this.connecting = true;
      this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });
      const url = this._buildMobileConnectUrl('phantom');
      this._debugLog('connect: encrypted deeplink to Phantom (staying in this browser)');
      this._navigateTopLevel(url);
      this._armMobileConnectFallback('Phantom');
      return { deepLinked: true };
    }
    window.open('https://phantom.app/', '_blank');
    this.eventBus.emit('wallet:error', { message: 'Phantom not installed.' });
    throw new Error('Phantom not installed');
  }

  async _connectProvider(provider) {
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      this.connecting = false;
      this.eventBus.emit('wallet:error', {
        message: "Phantom didn't respond. Try reloading the page, or check that the Phantom extension is enabled."
      });
    }, 25000);
    try {
      const resp = await provider.connect();
      clearTimeout(timeoutId);
      if (timedOut) return;
      this._bindProviderEvents(provider, 'phantom');
      this.publicKey = resp.publicKey;
      this.connected = true;
      this.walletType = 'phantom';
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType, linkCode: this._arrivedLinkCode });
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:balanceUpdated', { balance: this.balance });
      });
      this.connecting = false;
      return { address: this.publicKey.toString(), balance: this.balance };
    } catch (err) {
      clearTimeout(timeoutId);
      if (timedOut) return;
      const message = err?.code === 4001 ? 'Connection rejected.' : (err?.message || 'Connection failed.');
      this.eventBus.emit('wallet:error', { message });
      this.connecting = false;
      throw err;
    }
  }

  async disconnect() {
    const provider = this._activeProvider() || this.provider;
    if (provider) { try { await provider.disconnect(); } catch (_) {} }
    this.connected = false; this.publicKey = null; this.balance = null;
    this.mobileSession = null; this.phantomWalletPublicKey = null; this.walletType = null;
    [PHANTOM_SESSION_KEY, PHANTOM_KEYPAIR_KEY, PHANTOM_WALLET_PUBKEY_KEY, PHANTOM_USER_ADDRESS_KEY,
     WALLET_SYNC_KEY,
     'irWalletType'].forEach(k => localStorage.removeItem(k));
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

  async getSpendableBalances() {
    const sol = await this._refreshBalance();
    const infinite = await this._scanTokenBalance('C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump');
    return { sol: sol || 0, infinite: infinite || 0 };
  }

  async signTestMessage() {
    if (!this.connected) throw new Error('Wallet not connected.');
    const message = `Infinite Runners — verify wallet ownership\nAddress: ${this.publicKey.toString()}\nTimestamp: ${new Date().toISOString()}`;
    const encoded = new TextEncoder().encode(message);
    const signProvider = this._activeProvider();
    if (this.isMobile() && !signProvider) {
      this._navigateTopLevel(this._buildMobileSignMessageUrl(encoded));
      return { deepLinked: true };
    }
    if (!signProvider) throw new Error('Wallet not connected.');
    const { signature, publicKey } = await signProvider.signMessage(encoded, 'utf8');
    return { message, signatureHex: Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join(''), publicKey: publicKey.toString() };
  }

  async sendTransaction(transaction, pendingAction) {
    if (!this.connected) throw new Error('Wallet not connected.');
    const provider = this._activeProvider();
    if (provider && provider.signAndSendTransaction) {
      const { signature } = await provider.signAndSendTransaction(transaction);
      return { signature };
    }
    if (this.isMobile()) {
      const serialized = transaction.serialize({ requireAllSignatures: false });
      this._navigateTopLevel(this._buildMobileSignTransactionUrl(serialized, pendingAction));
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
