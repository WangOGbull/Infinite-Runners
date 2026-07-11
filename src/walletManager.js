// walletManager.js
const RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=de2fb44b-73e1-4ee5-aa9d-b1134825a8b0'; // Dedicated Devnet RPC (Helius) - swap back to your mainnet endpoint before launch. The old public api.devnet.solana.com endpoint was blocking a method Phantom needs for signAndSendTransaction (-32601 errors), which a dedicated provider doesn't do.

// Phantom's mobile "connect" deep link needs to know which cluster to
// establish the session against. This MUST match RPC_ENDPOINT above - if
// they drift apart (e.g. RPC_ENDPOINT is Devnet but connect says
// mainnet-beta), Phantom will happily connect, but then reject any
// signAndSendTransaction built against Devnet with a "-32601 / method not
// supported" error, since it's not looking at the cluster the transaction
// actually belongs to. Deriving it from RPC_ENDPOINT instead of hardcoding
// it means swapping RPC_ENDPOINT to mainnet later automatically keeps
// this in sync too.
function clusterFromEndpoint(endpoint) {
  if (endpoint.includes('devnet')) return 'devnet';
  if (endpoint.includes('testnet')) return 'testnet';
  return 'mainnet-beta';
}
const PHANTOM_CLUSTER = clusterFromEndpoint(RPC_ENDPOINT);

// ---- minimal base58 helpers (avoids pulling in a separate bs58 package) ----
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
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
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
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; str[k] === '1' && k < str.length - 1; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

const PHANTOM_SESSION_KEY = 'phantomDappSession';
const PHANTOM_KEYPAIR_KEY = 'phantomDappKeyPair';
const PHANTOM_PENDING_ACTION_KEY = 'phantomPendingAction';

class WalletManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.provider = null;
    this.publicKey = null;
    this.connected = false;
    this.connecting = false;
    this.balance = null;
    this.connection = null;

    // mobile deep-link session state
    this.mobileSession = null;
    this.dappKeyPair = null;
    this.phantomWalletPublicKey = null;

    this._initConnection();
    this._bindProviderEvents();
    this._restoreMobileKeyPair();

    this.eventBus.on('wallet:scanRequest', () => {
      this.scanBalances();
    });

    // NOTE: we deliberately do NOT call _handleMobileRedirect() here anymore.
    // Doing it from inside the constructor fired 'wallet:txConfirmed' /
    // 'wallet:txError' before Game.setupEventListeners() had registered its
    // listeners for those events (WalletManager is constructed before
    // Game.init() runs). The emit happened into an empty EventBus and was
    // silently lost - which is why room-rejoin after a mobile Phantom
    // redirect never fired. Call processMobileRedirect() explicitly from
    // Game, after setupEventListeners()/setupFirebase() are ready.
  }

  // Public entry point - call this AFTER the owning app has registered its
  // eventBus listeners (and ideally after Firebase is initialized), so any
  // 'wallet:connected' / 'wallet:txConfirmed' / 'wallet:txError' emitted as
  // a result of a Phantom redirect actually reaches its listeners.
  processMobileRedirect() {
    this._handleMobileRedirect();
  }

  _initConnection() {
    if (typeof solanaWeb3 === 'undefined') {
      console.error('[WalletManager] solana web3.js not loaded');
      return;
    }
    this.connection = new solanaWeb3.Connection(RPC_ENDPOINT, 'confirmed');
  }

  getProvider() {
    if (window?.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window?.solana?.isPhantom) return window.solana;
    return null;
  }

  isPhantomInstalled() {
    return !!this.getProvider();
  }

  isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  _bindProviderEvents() {
    const provider = this.getProvider();
    if (!provider || provider === this.provider) return;
    this.provider = provider;

    provider.on('connect', (publicKey) => {
      this.publicKey = publicKey || provider.publicKey;
      this.connected = true;
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:connected', {
          address: this.publicKey.toString(),
          balance: this.balance
        });
      });
    });

    provider.on('disconnect', () => {
      this.connected = false;
      this.publicKey = null;
      this.balance = null;
      this.eventBus.emit('wallet:disconnected');
    });

    provider.on('accountChanged', (publicKey) => {
      if (publicKey) {
        this.publicKey = publicKey;
        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', {
            address: this.publicKey.toString(),
            balance: this.balance
          });
        });
      } else {
        this.connected = false;
        this.publicKey = null;
        this.eventBus.emit('wallet:disconnected');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Mobile deep-link (Phantom Connect API) handling
  // ---------------------------------------------------------------------

  _restoreMobileKeyPair() {
    // We need the SAME keypair before and after the redirect round-trip,
    // so persist it across the navigation.
    try {
      const saved = localStorage.getItem(PHANTOM_KEYPAIR_KEY);
      if (saved) {
        const { publicKey, secretKey } = JSON.parse(saved);
        this.dappKeyPair = {
          publicKey: new Uint8Array(publicKey),
          secretKey: new Uint8Array(secretKey)
        };
      }
      const savedSession = localStorage.getItem(PHANTOM_SESSION_KEY);
      if (savedSession) this.mobileSession = savedSession;
    } catch (_) { /* ignore */ }
  }

  // TEMPORARY diagnostic aid: renders a small on-screen log so we can see
  // exactly what's happening around the Phantom mobile redirect without
  // needing USB/remote debugging. Off by default - enable by running
  // `localStorage.setItem('wmDebug','1')` (e.g. via a bookmarklet or the
  // desktop console on a synced tab) then reloading; disable the same way
  // with `localStorage.removeItem('wmDebug')`. Uses localStorage (not a
  // URL param) specifically so it survives the Phantom redirect round-trip
  // without having to thread a debug flag through every deep-link URL.
  _debugLog(msg) {
    try {
      if (localStorage.getItem('wmDebug') !== '1') return;
      let box = document.getElementById('wmDebugOverlay');
      if (!box) {
        box = document.createElement('div');
        box.id = 'wmDebugOverlay';
        box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:32vh;overflow-y:auto;background:rgba(0,0,0,0.88);color:#39ff6a;font-size:10px;font-family:monospace;padding:6px;z-index:999999;white-space:pre-wrap;word-break:break-all;border-top:1px solid #39ff6a;';
        document.body.appendChild(box);
      }
      const line = document.createElement('div');
      line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    } catch (_) { /* ignore */ }
  }

  _getOrCreateDappKeyPair() {
    if (this.dappKeyPair) return this.dappKeyPair;
    if (typeof nacl === 'undefined') {
      throw new Error('tweetnacl is not loaded. Add tweetnacl-js to index.html.');
    }
    this.dappKeyPair = nacl.box.keyPair();
    this._persistDappKeyPair(this.dappKeyPair);
    return this.dappKeyPair;
  }

  _persistDappKeyPair(keyPair) {
    try {
      localStorage.setItem(PHANTOM_KEYPAIR_KEY, JSON.stringify({
        publicKey: Array.from(keyPair.publicKey),
        secretKey: Array.from(keyPair.secretKey)
      }));
    } catch (_) { /* storage may be unavailable, ignore */ }
  }

  // Opening the link from Telegram/Instagram/etc. means the page first loads
  // in that app's in-app browser. Phantom's redirect back, however, lands in
  // the device's default browser (e.g. Chrome) -- a completely different
  // storage context. localStorage set in the in-app browser is invisible
  // there. To survive that hop, we embed the dapp secret key directly in the
  // redirect_link so whatever browser opens it can rebuild the same keypair.
  _buildMobileConnectUrl() {
    const keyPair = this._getOrCreateDappKeyPair();
    const appUrl = encodeURIComponent(window.location.href.split('?')[0].split('#')[0]);

    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(
      `${redirectBase}?walletReturn=connect&dsk=${dsk}`
    );
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));

    return `https://phantom.app/ul/v1/connect?app_url=${appUrl}&dapp_encryption_public_key=${dappPubKey}&redirect_link=${redirectUrl}&cluster=${PHANTOM_CLUSTER}`;
  }

  _buildMobileSignMessageUrl(message) {
    if (!this.mobileSession) throw new Error('No active mobile session.');
    const keyPair = this._getOrCreateDappKeyPair();
    const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);

    const payload = { session: this.mobileSession, message: b58encode(message), display: 'utf8' };
    const nonce = nacl.randomBytes(24);
    const encryptedPayload = nacl.box.after(
      new TextEncoder().encode(JSON.stringify(payload)),
      nonce,
      sharedSecret
    );

    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(
      `${redirectBase}?walletReturn=signMessage&dsk=${dsk}`
    );
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));

    return `https://phantom.app/ul/v1/signMessage?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrl}&payload=${payloadParam}`;
  }

  // Same encrypted-payload pattern as signMessage, but for signAndSendTransaction.
  // `pendingAction` is an arbitrary small JSON object (e.g. { type: 'createRoom',
  // roomId, tier }) describing what this transaction was for - it's stashed in
  // localStorage and handed back via 'wallet:txConfirmed' once Phantom redirects
  // back, since the page fully reloads in between and loses all JS memory state.
  _buildMobileSignAndSendUrl(serializedTransaction, pendingAction) {
    this._debugLog(
      `buildSignAndSend: mobileSession=${this.mobileSession ? 'present' : 'MISSING'} ` +
      `phantomPubKey=${this.phantomWalletPublicKey ? 'present' : 'MISSING'} ` +
      `dappKeyPair=${this.dappKeyPair ? 'present' : 'MISSING'} ` +
      `pendingAction=${JSON.stringify(pendingAction)}`
    );
    if (!this.mobileSession) throw new Error('No active mobile session.');
    const keyPair = this._getOrCreateDappKeyPair();
    const sharedSecret = nacl.box.before(this.phantomWalletPublicKey, keyPair.secretKey);

    const payload = {
      session: this.mobileSession,
      transaction: b58encode(serializedTransaction),
    };
    const nonce = nacl.randomBytes(24);
    const encryptedPayload = nacl.box.after(
      new TextEncoder().encode(JSON.stringify(payload)),
      nonce,
      sharedSecret
    );

    try {
      localStorage.setItem(PHANTOM_PENDING_ACTION_KEY, JSON.stringify(pendingAction || null));
    } catch (_) { /* ignore */ }

    const redirectBase = window.location.href.split('?')[0].split('#')[0];
    const dsk = encodeURIComponent(b58encode(keyPair.secretKey));
    const redirectUrl = encodeURIComponent(
      `${redirectBase}?walletReturn=signAndSendTransaction&dsk=${dsk}`
    );
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));

    return `https://phantom.app/ul/v1/signAndSendTransaction?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrl}&payload=${payloadParam}`;
  }

  _handleMobileRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const returnType = urlParams.get('walletReturn');
    if (!returnType) return;

    this._debugLog(
      `redirect received: type=${returnType} ` +
      `errorCode=${urlParams.get('errorCode') || 'none'} ` +
      `errorMessage=${urlParams.get('errorMessage') || 'none'} ` +
      `hasPhantomPubKey=${!!urlParams.get('phantom_encryption_public_key')} ` +
      `hasNonce=${!!urlParams.get('nonce')} ` +
      `hasData=${!!urlParams.get('data')} ` +
      `hasDsk=${!!urlParams.get('dsk')} ` +
      `mobileSessionBeforeProcessing=${this.mobileSession ? 'present' : 'MISSING'}`
    );

    // Clean the URL so a page refresh doesn't try to re-process this
    const cleanUrl = window.location.href.split('?')[0];
    window.history.replaceState({}, document.title, cleanUrl);

    if (urlParams.get('errorCode')) {
      const message = urlParams.get('errorMessage') || 'Phantom request was rejected.';
      this._debugLog(`=> ERROR PATH: ${message}`);
      if (returnType === 'signMessage') {
        this.eventBus.emit('wallet:signTestError', { message });
      } else if (returnType === 'signAndSendTransaction') {
        const pendingAction = this._consumePendingAction();
        this.eventBus.emit('wallet:txError', { message, pendingAction });
      } else {
        this.eventBus.emit('wallet:error', { message });
      }
      return;
    }

    const phantomPubKeyParam = urlParams.get('phantom_encryption_public_key');
    const nonceParam = urlParams.get('nonce');
    const dataParam = urlParams.get('data');
    if (!phantomPubKeyParam || !nonceParam || !dataParam) return;

    try {
      // Prefer the keypair embedded in the URL (dsk) -- it's guaranteed to
      // match what we used to build the original request, even if Phantom's
      // redirect opened in a different browser than the one that sent it.
      const dskParam = urlParams.get('dsk');
      let keyPair;
      if (dskParam) {
        const secretKey = b58decode(dskParam);
        keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
        this.dappKeyPair = keyPair;
        this._persistDappKeyPair(keyPair); // keep this browser usable going forward
      } else {
        keyPair = this._getOrCreateDappKeyPair();
      }
      const phantomPubKey = b58decode(phantomPubKeyParam);
      const sharedSecret = nacl.box.before(phantomPubKey, keyPair.secretKey);
      const decrypted = nacl.box.open.after(b58decode(dataParam), b58decode(nonceParam), sharedSecret);

      if (!decrypted) throw new Error('Failed to decrypt Phantom response.');
      const result = JSON.parse(new TextDecoder().decode(decrypted));
      this._debugLog(`decrypt OK for type=${returnType}`);

      if (returnType === 'connect') {
        this.phantomWalletPublicKey = phantomPubKey;
        this.mobileSession = result.session;
        localStorage.setItem(PHANTOM_SESSION_KEY, this.mobileSession);

        this.publicKey = new solanaWeb3.PublicKey(result.public_key);
        this.connected = true;

        this._refreshBalance().then(() => {
          this.eventBus.emit('wallet:connected', {
            address: this.publicKey.toString(),
            balance: this.balance
          });
        });
      } else if (returnType === 'signMessage') {
        this.eventBus.emit('wallet:signTestResult', {
          signatureHex: Array.from(b58decode(result.signature))
            .map(b => b.toString(16).padStart(2, '0')).join(''),
          publicKey: this.publicKey ? this.publicKey.toString() : ''
        });
      } else if (returnType === 'signAndSendTransaction') {
        const pendingAction = this._consumePendingAction();
        this.eventBus.emit('wallet:txConfirmed', {
          signature: result.signature,
          pendingAction,
        });
      }
    } catch (err) {
      console.error('[WalletManager] Failed to process Phantom redirect:', err);
      this._debugLog(`=> CAUGHT EXCEPTION processing redirect: ${err?.message || err}`);
      if (returnType === 'signAndSendTransaction') {
        const pendingAction = this._consumePendingAction();
        this.eventBus.emit('wallet:txError', {
          message: 'Could not complete the staking transaction.',
          pendingAction,
        });
      } else {
        this.eventBus.emit('wallet:error', { message: 'Could not complete Phantom connection.' });
      }
    }
  }

  _consumePendingAction() {
    try {
      const raw = localStorage.getItem(PHANTOM_PENDING_ACTION_KEY);
      localStorage.removeItem(PHANTOM_PENDING_ACTION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------

  async connect() {
    if (this.connecting) return; // prevent spamming multiple deep-link tabs
    const provider = this.getProvider();

    if (provider) {
      return this._connectProvider(provider);
    }

    if (this.isMobile()) {
      this.connecting = true;
      this.eventBus.emit('wallet:connecting');
      // location.replace (not href) avoids stacking extra history entries
      // in this tab while we wait for Phantom to redirect back.
      window.location.replace(this._buildMobileConnectUrl());
      return { deepLinked: true };
    }

    window.open('https://phantom.app/', '_blank');
    this.eventBus.emit('wallet:error', { message: 'Phantom is not installed.' });
    throw new Error('Phantom not installed');
  }

  async _connectProvider(provider) {
    this.connecting = true;
    this.eventBus.emit('wallet:connecting');

    try {
      const resp = await provider.connect();
      this._bindProviderEvents();
      this.publicKey = resp.publicKey;
      this.connected = true;
      await this._refreshBalance();

      this.eventBus.emit('wallet:connected', {
        address: this.publicKey.toString(),
        balance: this.balance
      });

      return { address: this.publicKey.toString(), balance: this.balance };
    } catch (err) {
      const message = err?.code === 4001
        ? 'Connection request was rejected.'
        : (err?.message || 'Connection failed.');
      this.eventBus.emit('wallet:error', { message });
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    if (this.provider) {
      try { await this.provider.disconnect(); } catch (_) { }
    }
    this.connected = false;
    this.publicKey = null;
    this.balance = null;
    this.mobileSession = null;
    this.phantomWalletPublicKey = null;
    localStorage.removeItem(PHANTOM_SESSION_KEY);
    this.eventBus.emit('wallet:disconnected');
  }

  async _refreshBalance() {
    if (!this.connection || !this.publicKey) {
      this.balance = null;
      return null;
    }
    try {
      const lamports = await this.connection.getBalance(this.publicKey, 'confirmed');
      this.balance = lamports / solanaWeb3.LAMPORTS_PER_SOL;
    } catch (err) {
      console.error('[WalletManager] balance fetch failed:', err);
      this.balance = null;
    }
    return this.balance;
  }

  async _scanTokenBalance(mintAddress) {
    if (!this.connection || !this.publicKey) return 0;
    try {
      const mintPubkey = new solanaWeb3.PublicKey(mintAddress);
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        this.publicKey,
        { mint: mintPubkey }
      );

      if (tokenAccounts.value.length > 0) {
        const accountInfo = await this.connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
        return accountInfo.value.uiAmount || 0;
      }
      return 0;
    } catch (err) {
      console.warn('[WalletManager] Token fetch failed:', err);
      return 0;
    }
  }

  async scanBalances() {
    if (!this.connected || !this.publicKey) {
      this.eventBus.emit('wallet:error', { message: 'Wallet not connected.' });
      return;
    }

    this.eventBus.emit('wallet:balanceUpdated', { balance: 'Scanning...' });

    const solBalance = await this._refreshBalance();
    const INFINITE_COIN_MINT = 'C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump';
    const infiniteBalance = await this._scanTokenBalance(INFINITE_COIN_MINT);

    this.eventBus.emit('wallet:scanResult', {
      sol: solBalance || 0,
      infinite: infiniteBalance
    });

    return { sol: solBalance, infinite: infiniteBalance };
  }

  async refreshBalance() {
    const balance = await this._refreshBalance();
    this.eventBus.emit('wallet:balanceUpdated', { balance });
    return balance;
  }

  async signTestMessage() {
    if (!this.connected) {
      throw new Error('Wallet not connected.');
    }

    const message =
      `Infinite Runners — verify wallet ownership\n` +
      `Address: ${this.publicKey.toString()}\n` +
      `Timestamp: ${new Date().toISOString()}`;
    const encoded = new TextEncoder().encode(message);

    // Mobile: no injected provider, must use the deep-link sign flow.
    if (this.isMobile() && !this.provider) {
      window.location.href = this._buildMobileSignMessageUrl(encoded);
      return { deepLinked: true };
    }

    if (!this.provider) {
      throw new Error('Wallet not connected.');
    }

    const { signature, publicKey } = await this.provider.signMessage(encoded, 'utf8');

    return {
      message,
      signatureHex: Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join(''),
      publicKey: publicKey.toString()
    };
  }

  /**
   * Signs and sends a Transaction that already has feePayer/blockhash set.
   * Desktop (extension present): signs+sends immediately and resolves with
   * { signature }. Mobile (no extension): redirects to Phantom and resolves
   * with { deepLinked: true } - the actual result arrives later via the
   * 'wallet:txConfirmed' / 'wallet:txError' events after Phantom redirects back.
   */
  async sendTransaction(transaction, pendingAction) {
    if (!this.connected) {
      throw new Error('Wallet not connected.');
    }

    if (this.provider && this.provider.signAndSendTransaction) {
      const { signature } = await this.provider.signAndSendTransaction(transaction);
      return { signature };
    }

    if (this.isMobile()) {
      const serialized = transaction.serialize({ requireAllSignatures: false });
      window.location.replace(this._buildMobileSignAndSendUrl(serialized, pendingAction));
      return { deepLinked: true };
    }

    throw new Error('No wallet provider available to sign this transaction.');
  }

  getShortAddress() {
    if (!this.publicKey) return '';
    const s = this.publicKey.toString();
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
  }
}

export default WalletManager;
