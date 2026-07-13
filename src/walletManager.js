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
const PHANTOM_WALLET_PUBKEY_KEY = 'phantomWalletPubkey';
const PHANTOM_USER_ADDRESS_KEY = 'phantomUserAddress';
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
    this._checkDebugQueryParam();

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

  // Enables/disables the debug overlay via a plain URL query param instead
  // of a javascript: bookmarklet, since mobile Chrome blocks javascript:
  // URLs typed directly into the address bar (silently does nothing -
  // which is exactly why the earlier bookmarklet approach didn't work).
  // Visit the site once with ?debug=1 to turn it on, ?debug=0 to turn it
  // off - it's stored in localStorage either way, so it persists across
  // reloads and redirects without needing the query param every time.
  _checkDebugQueryParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1') {
        localStorage.setItem('wmDebug', '1');
      } else if (params.get('debug') === '0') {
        localStorage.removeItem('wmDebug');
      }
      // Forcibly clears every Phantom-related localStorage key, guaranteeing
      // the next "Connect Wallet" creates a genuinely fresh session instead
      // of relying on the Disconnect button (or this restore logic) having
      // fully cleaned up a stale one. Specifically for stale sessions that
      // were established before the mainnet/devnet cluster fix - those
      // sessions are permanently tied to the wrong cluster and will keep
      // producing "-32601 method not supported" errors from Phantom no
      // matter how many times you reconnect through the normal UI, since
      // reconnecting alone doesn't necessarily invalidate the old session
      // token if something upstream still has it cached.
      if (params.get('resetWallet') === '1') {
        [PHANTOM_SESSION_KEY, PHANTOM_KEYPAIR_KEY, PHANTOM_WALLET_PUBKEY_KEY, PHANTOM_USER_ADDRESS_KEY]
          .forEach(key => localStorage.removeItem(key));
        this.mobileSession = null;
        this.dappKeyPair = null;
        this.phantomWalletPublicKey = null;
        this.publicKey = null;
        this.connected = false;
      }
    } catch (_) { /* ignore */ }
  }

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

      // Restore full connected state, not just the session token. Before
      // this fix, `connected` / `publicKey` / `phantomWalletPublicKey` were
      // ONLY ever set during a fresh 'connect' redirect - so reloading the
      // page after ANY other redirect (signAndSendTransaction, signMessage)
      // silently reset the wallet to looking disconnected, even though the
      // underlying session was still perfectly valid. That's exactly why
      // the deposit button showed disabled ("Place Bet to Join", greyed
      // out) the instant you landed back in the room after staking on
      // mobile - canDeposit was false because `connected` never got
      // restored, regardless of whether the deposit itself worked.
      const savedWalletPubkey = localStorage.getItem(PHANTOM_WALLET_PUBKEY_KEY);
      const savedAddress = localStorage.getItem(PHANTOM_USER_ADDRESS_KEY);
      if (savedSession && savedWalletPubkey && savedAddress && this.dappKeyPair) {
        this.phantomWalletPublicKey = b58decode(savedWalletPubkey);
        this.publicKey = new solanaWeb3.PublicKey(savedAddress);
        this.connected = true;
      }
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

  // Phantom's signAndSendTransaction deeplink is DEPRECATED (confirmed on
  // Phantom's own current docs: "Use signAllTransactions or signTransaction
  // instead"). That's the actual cause of the -32601 "method not supported"
  // errors we kept hitting on mobile, regardless of RPC endpoint, cluster,
  // or session freshness - none of those were ever the real problem. This
  // uses signTransaction instead: Phantom signs the transaction and hands
  // the signed bytes back to us, then WE submit it via our own RPC
  // connection (see the signTransaction branch in _handleMobileRedirect).
  //
  // `pendingAction` is an arbitrary small JSON object (e.g. { type: 'createRoom',
  // roomId, tier }) describing what this transaction was for - it's stashed in
  // localStorage and handed back via 'wallet:txConfirmed' once Phantom redirects
  // back, since the page fully reloads in between and loses all JS memory state.
  _buildMobileSignTransactionUrl(serializedTransaction, pendingAction) {
    this._debugLog(
      `buildSignTransaction: mobileSession=${this.mobileSession ? 'present' : 'MISSING'} ` +
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
      `${redirectBase}?walletReturn=signTransaction&dsk=${dsk}`
    );
    const dappPubKey = encodeURIComponent(b58encode(keyPair.publicKey));
    const nonceParam = encodeURIComponent(b58encode(nonce));
    const payloadParam = encodeURIComponent(b58encode(encryptedPayload));

    return `https://phantom.app/ul/v1/signTransaction?dapp_encryption_public_key=${dappPubKey}&nonce=${nonceParam}&redirect_link=${redirectUrl}&payload=${payloadParam}`;
  }

  _handleMobileRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const returnType = urlParams.get('walletReturn');
    if (!returnType) {
      // Nothing to process this load, but if _restoreMobileKeyPair()
      // found a valid persisted session (address + Phantom pubkey), let
      // the rest of the app know now that it's safe to emit events (this
      // runs from processMobileRedirect(), called after
      // Game.setupEventListeners() has registered its listeners).
      this._notifyRestoredConnection();
      return;
    }

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
      } else if (returnType === 'signTransaction') {
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
    // phantom_encryption_public_key is only resent on 'connect' responses -
    // signTransaction/signMessage responses only include nonce+data per
    // Phantom's docs, reusing the public key we already got at connect
    // time. Requiring it on every redirect type meant this whole handler
    // silently no-op'd on every non-connect response (hasPhantomPubKey was
    // false, so this returned before ever attempting to decrypt) - which is
    // exactly why staking landed back on the title screen with nothing
    // restored, even though Phantom had genuinely signed the transaction.
    if (!nonceParam || !dataParam) return;

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
      // Use the fresh key if Phantom sent one (connect), otherwise fall
      // back to the one we stored from the original connect response.
      const phantomPubKey = phantomPubKeyParam
        ? b58decode(phantomPubKeyParam)
        : this.phantomWalletPublicKey;
      if (!phantomPubKey) {
        throw new Error('No Phantom public key available - please reconnect your wallet.');
      }
      const sharedSecret = nacl.box.before(phantomPubKey, keyPair.secretKey);
      const decrypted = nacl.box.open.after(b58decode(dataParam), b58decode(nonceParam), sharedSecret);

      if (!decrypted) throw new Error('Failed to decrypt Phantom response.');
      const result = JSON.parse(new TextDecoder().decode(decrypted));
      this._debugLog(`decrypt OK for type=${returnType}`);

      if (returnType === 'connect') {
        this.phantomWalletPublicKey = phantomPubKey;
        this.mobileSession = result.session;
        localStorage.setItem(PHANTOM_SESSION_KEY, this.mobileSession);
        try {
          localStorage.setItem(PHANTOM_WALLET_PUBKEY_KEY, b58encode(phantomPubKey));
        } catch (_) { /* ignore */ }

        this.publicKey = new solanaWeb3.PublicKey(result.public_key);
        this.connected = true;
        try {
          localStorage.setItem(PHANTOM_USER_ADDRESS_KEY, this.publicKey.toString());
        } catch (_) { /* ignore */ }

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
      } else if (returnType === 'signTransaction') {
        // Phantom only SIGNED this - it does not submit it (that method's
        // deprecated). result.transaction is the signed, serialized
        // transaction, base58-encoded. We submit it ourselves via our own
        // RPC connection, then treat a successful submission exactly like
        // the old signAndSendTransaction flow used to (same event, same
        // payload shape), so main.js's existing handling doesn't need to
        // change at all.
        const pendingAction = this._consumePendingAction();
        const signedTxBytes = b58decode(result.transaction);
        this.connection.sendRawTransaction(signedTxBytes)
          .then(signature => {
            this.eventBus.emit('wallet:txConfirmed', { signature, pendingAction });
          })
          .catch(err => {
            this._debugLog(`=> sendRawTransaction FAILED: ${err?.message || err}`);
            this.eventBus.emit('wallet:txError', {
              message: err?.message || 'Failed to submit the signed transaction.',
              pendingAction,
            });
          });
      }
    } catch (err) {
      console.error('[WalletManager] Failed to process Phantom redirect:', err);
      this._debugLog(`=> CAUGHT EXCEPTION processing redirect: ${err?.message || err}`);
      if (returnType === 'signTransaction') {
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

  _notifyRestoredConnection() {
    if (this.connected && this.publicKey) {
      this._refreshBalance().then(() => {
        this.eventBus.emit('wallet:connected', {
          address: this.publicKey.toString(),
          balance: this.balance
        });
      });
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
    localStorage.removeItem(PHANTOM_WALLET_PUBKEY_KEY);
    localStorage.removeItem(PHANTOM_USER_ADDRESS_KEY);
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
   * Desktop (extension present): signs+sends immediately via the injected
   * provider's signAndSendTransaction - this is the Wallet Standard provider
   * API and is NOT the same thing as Phantom's deprecated HTTP deeplink of
   * the same name, so it's unaffected by that deprecation. Resolves with
   * { signature }.
   * Mobile (no extension): redirects to Phantom's signTransaction deeplink
   * (sign-only - the signAndSendTransaction deeplink is deprecated) and
   * resolves with { deepLinked: true }. The signed transaction comes back
   * via the redirect, gets submitted via our own RPC connection in
   * _handleMobileRedirect(), and the actual result arrives later via the
   * 'wallet:txConfirmed' / 'wallet:txError' events.
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
      window.location.replace(this._buildMobileSignTransactionUrl(serialized, pendingAction));
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
