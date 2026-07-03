// walletManager.js
const RPC_ENDPOINT = 'https://broken-dimensional-bridge.solana-mainnet.quiknode.pro/71331ad63dbca61e4f46856dbe393fad7465aa4a/';

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

    // Handle the redirect Phantom sends us back to on mobile
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
      const saved = sessionStorage.getItem(PHANTOM_KEYPAIR_KEY);
      if (saved) {
        const { publicKey, secretKey } = JSON.parse(saved);
        this.dappKeyPair = {
          publicKey: new Uint8Array(publicKey),
          secretKey: new Uint8Array(secretKey)
        };
      }
      const savedSession = sessionStorage.getItem(PHANTOM_SESSION_KEY);
      if (savedSession) this.mobileSession = savedSession;
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
      sessionStorage.setItem(PHANTOM_KEYPAIR_KEY, JSON.stringify({
        publicKey: Array.from(keyPair.publicKey),
        secretKey: Array.from(keyPair.secretKey)
      }));
    } catch (_) { /* storage may be unavailable, ignore */ }
  }

  // Opening the link from Telegram/Instagram/etc. means the page first loads
  // in that app's in-app browser. Phantom's redirect back, however, lands in
  // the device's default browser (e.g. Chrome) -- a completely different
  // storage context. sessionStorage set in the in-app browser is invisible
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

    return `https://phantom.app/ul/v1/connect?app_url=${appUrl}&dapp_encryption_public_key=${dappPubKey}&redirect_link=${redirectUrl}&cluster=mainnet-beta`;
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

  _handleMobileRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const returnType = urlParams.get('walletReturn');
    if (!returnType) return;

    // Clean the URL so a page refresh doesn't try to re-process this
    const cleanUrl = window.location.href.split('?')[0];
    window.history.replaceState({}, document.title, cleanUrl);

    if (urlParams.get('errorCode')) {
      const message = urlParams.get('errorMessage') || 'Phantom request was rejected.';
      if (returnType === 'signMessage') {
        this.eventBus.emit('wallet:signTestError', { message });
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

      if (returnType === 'connect') {
        this.phantomWalletPublicKey = phantomPubKey;
        this.mobileSession = result.session;
        sessionStorage.setItem(PHANTOM_SESSION_KEY, this.mobileSession);

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
      }
    } catch (err) {
      console.error('[WalletManager] Failed to process Phantom redirect:', err);
      this.eventBus.emit('wallet:error', { message: 'Could not complete Phantom connection.' });
    }
  }

  // ---------------------------------------------------------------------

  async connect() {
    const provider = this.getProvider();

    if (provider) {
      return this._connectProvider(provider);
    }

    if (this.isMobile()) {
      this.eventBus.emit('wallet:connecting');
      window.location.href = this._buildMobileConnectUrl();
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
    sessionStorage.removeItem(PHANTOM_SESSION_KEY);
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

  getShortAddress() {
    if (!this.publicKey) return '';
    const s = this.publicKey.toString();
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
  }
}

export default WalletManager;
