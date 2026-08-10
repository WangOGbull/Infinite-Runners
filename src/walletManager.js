// walletManager.js
// FIX: this was pointing at DEVNET while the INFINITE mint, the hot
// refused to sign outright ("network mismatch"); Phantom signed anyway
// and submitted to mainnet, where a devnet blockhash can never land -
// which is what every "expired: block height exceeded" failure actually
// was. Same Helius API key works on both clusters.
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

// Remembers which DESKTOP EXTENSION wallet (phantom) the user
// last connected with successfully, so a page reload's silent-reconnect
// attempt (see _trySilentExtensionReconnect) tries that wallet first
// instead of always assuming Phantom. Separate from the mobile-deeplink
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

    // Wallet-account link bridge: when a logged-in player connects via the
    // in-app-browser approach, that browser is a genuinely separate
    // environment (its own storage, no shared session) from the tab they
    // were logged in on. main.js sets pendingLinkCode to a short-lived code
    // (registered in Firebase against their uid) right before triggering
    // connect(); it rides along in the browse URL and comes back out via
    // the wallet:connected event so main.js can attach the address to the
    // right account even though this whole flow ran in an isolated context.
    this.pendingLinkCode = null;
    this._arrivedLinkCode = null;

    // AUTH HANDOFF (see authHandoff.js on the backend).
    // The wallet's in-app browser is a separate browser with its own
    // IndexedDB, so Firebase Auth persistence does NOT carry across and the
    // player arrives SIGNED OUT. That matters far beyond a login prompt:
    // main.js joinRoom() GUARD 3 reuses an existing seat only when
    // this.authUid is set. Signed out, it pushes a SECOND player record
    // while the original seat still holds pubkey/deposited - the duplicate
    // dragon that makes an FFA room read as full.
    //
    // main.js sets pendingHandoffCode (a single-use code minted by the
    // backend against the signed-in uid) and pendingResumeRoom right before
    // triggering the browse deeplink. Both ride along in the URL and come
    // back out as _arrivedHandoffCode / _arrivedResumeRoom, which main.js
    // reads on boot to restore the session BEFORE any room join happens.
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
    // Deferred to the next tick: Game's constructor creates this manager
    // BEFORE setupEventListeners() runs, so a 'wallet:connected' emitted
    // synchronously here would fire into an empty EventBus and be lost.
    setTimeout(() => this._trySilentExtensionReconnect(), 0);

    this.eventBus.on('wallet:scanRequest', () => { this.scanBalances(); });

    // stake transaction in localStorage, execute it natively. This fires
    // regardless of how we got here — browse URL, deeplink fallback, or
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

  // Builds the official "Browse" deeplink for either wallet - opens the
  // given URL directly INSIDE that wallet app's own in-app browser, rather
  // than the encrypted /ul/v1/connect round-trip. Confirmed directly from
  // each wallet's own developer docs:
  //   Phantom:  https://phantom.app/ul/browse/<url>?ref=<ref>
  // Both require url-encoded `url` (page to open) and `ref` (this site).
  _buildBrowseUrl(walletType, targetUrl) {
    const encodedUrl = encodeURIComponent(targetUrl);
    const encodedRef = encodeURIComponent(window.location.origin);
    return `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedRef}`;
  }

  // FIX: relaunches the CURRENT page inside the chosen wallet's own in-app
  // browser instead of doing the old encrypted deep-link round-trip. Both
  // reliable way to connect on mobile ("connecting only works inside
  // Phantom's in-app browser - you can't connect from Safari, Chrome, or
  // other mobile browsers"). Once the page reloads inside the wallet's
  // browser, the wallet injects itself just like a desktop extension -
  // connect() and every later stake transaction then happen as a native
  // in-app confirmation sheet, with NO redirect at all, because
  // sendTransaction() already prefers an injected provider over any deep
  // link (see below) - this fixes the connect step, and staking inherits
  // the no-redirect behavior automatically, no other code needed.
  //
  // A marker query param travels along so the page can auto-trigger
  // connect() the instant it reloads there, instead of requiring the
  // player to tap "Connect Wallet" a second time once they arrive.
  openInWalletBrowser(walletType) {
    const currentUrl = new URL(window.location.href.split('?')[0].split('#')[0]);
    currentUrl.searchParams.set('autoConnectWallet', walletType);
    if (this.pendingLinkCode) currentUrl.searchParams.set('linkCode', this.pendingLinkCode);
    // Auth handoff: `handoff` is a single-use code, NOT a credential on its
    // own - it is exchanged over HTTPS POST for a Firebase custom token on
    // arrival, so no token ever appears in an address bar, a Referer
    // header, or a server access log. `resumeRoom` tells the arriving page
    // which lobby to go straight back to instead of booting to the title
    // screen and stranding the player.
    if (this.pendingHandoffCode) currentUrl.searchParams.set('handoff', this.pendingHandoffCode);
    if (this.pendingResumeRoom) currentUrl.searchParams.set('resumeRoom', this.pendingResumeRoom);
    const browseUrl = this._buildBrowseUrl(walletType, currentUrl.toString());
    this._debugLog(`openInWalletBrowser: relaunching inside ${walletType}'s browser (handoff=${this.pendingHandoffCode ? 'yes' : 'no'} room=${this.pendingResumeRoom || 'none'})`);
    this._navigateTopLevel(browseUrl);
  }

  // Runs once on every page load. If we just arrived here via
  // openInWalletBrowser() above (i.e. we're now running inside the
  // wallet's own in-app browser, provider injection imminent), this
  // auto-triggers the actual connect - no second tap needed from the
  // player. Harmless no-op on every normal page load without that param.
  //
  // FIX: a single fixed 400ms delay raced the wallet's provider
  // injection. On the first-ever load of the in-app browser, injection
  // routinely takes longer than that - connect() then found no provider,
  // saw isMobile()===true, and relaunched the browse link, looping the
  // page forever. This now POLLS for the expected provider (up to 12s)
  // and only fires connect once it's actually there. It also records
  // _arrivedInWalletBrowser so no code path can ever build another
  // browse link from inside the wallet's own browser.
  _checkAutoConnectQueryParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      // Capture handoff/resumeRoom unconditionally — they may ride on
      // encrypted deeplink returns (walletReturn=...) even when
      // autoConnectWallet is absent.
      const handoff = params.get('handoff');
      const resumeRoom = params.get('resumeRoom');
      if (handoff) this._arrivedHandoffCode = handoff;
      if (resumeRoom) this._arrivedResumeRoom = resumeRoom;

      const autoConnectWallet = params.get('autoConnectWallet');
      if (!autoConnectWallet) return;
      // We are now INSIDE this wallet's in-app browser. Remember that for
      // the whole session - openInWalletBrowser() must never fire again
      // from in here, or the page relaunches itself in a loop.
      this._arrivedInWalletBrowser = autoConnectWallet;
      // Account-link bridge (see pendingLinkCode comment in constructor):
      // if the tab that sent us here was logged in, this carries the code
      // that ties whatever wallet connects here back to that account.
      this._arrivedLinkCode = params.get('linkCode') || null;
      // Auth handoff payload (see the constructor comment). main.js reads
      // these off this object during init() - they must be captured HERE
      // because this method strips them from the URL moments later, and
      // WalletManager's constructor runs before Game.init() ever does.
      this._arrivedHandoffCode = params.get('handoff') || null;
      this._arrivedResumeRoom = params.get('resumeRoom') || null;
      // Strip immediately so refreshing or sharing this URL later doesn't
      // re-trigger an unwanted auto-connect prompt. Stripping `handoff` is
      // security-relevant on top of that: the code is single-use, but a URL
      // left sitting in an address bar can be screenshotted or shared
      // within its validity window.
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('autoConnectWallet');
      cleanUrl.searchParams.delete('linkCode');
      cleanUrl.searchParams.delete('handoff');
      cleanUrl.searchParams.delete('resumeRoom');
      cleanUrl.searchParams.delete('autoExecuteStake');
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
    } catch (_) { /* best-effort only */ }
  }
      // Small initial delay: (per the setTimeout(0) comment above) ensures
      // the EventBus is already wired up before anything emits through it.
      setTimeout(poll, 300);
    } catch (_) { /* best-effort only */ }
  }

  // FIX (bug 2): script-invoked window.location.replace()/href to a
  // Universal Link is handled less reliably by iOS/Android than a real
  // user-gesture anchor click - a known cause of "app opens, shows
  // confirm screen, then bounces back without completing the handshake"
  // because the OS can treat it as a soft/interceptible navigation rather
  // than a committed one. Routing every mobile wallet deep link through a
  // real <a> click instead fixes this without touching URL-building or
  // encryption logic, which was already correct.
  // Used for BOTH the browse deeplink (which hands the player over to the
  // wallet's in-app browser) and the encrypted /ul/v1 connect deeplink
  // (which opens the wallet app and bounces back here). Both are universal
  // links, and both need a real top-level, user-gesture navigation.
  //
  // FIX: these used to route through _navigateToUniversalLink(), which
  // loads the URL in a HIDDEN IFRAME. Modern iOS Safari and Android Chrome
  // both block cross-origin iframe navigations to universal links unless
  // they are top-level and user-initiated, so the tap frequently did
  // nothing at all.
  _navigateTopLevel(url) {
    try {
      window.location.href = url;
    } catch (_) {
      // Extremely defensive: if assignment is blocked for any reason, fall
      // back to a synthesised anchor click, which some WebViews accept when
      // direct assignment is refused.
      try {
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
      } catch (_) { /* nothing further we can do */ }
    }
  }

  _navigateToUniversalLink(url) {
    // Load the wallet deep link in a hidden iframe so the current browser
    // tab (Chrome) stays on the game page. The OS intercepts the iframe's
    // navigation and opens the wallet app separately. After the player taps
    // Connect in the wallet, the wallet redirects back to Chrome's game
    // tab — the game never leaves Chrome, never reloads in a wallet browser.
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    // Remove the iframe after a short delay so it doesn't linger in DOM
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 3000);
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
  // rebound this.provider back to the Phantom extension object (if
  // disconnect()/signMessage/sendTransaction all secretly targeting the
  // wrong wallet. Defaults preserve the original Phantom-only call sites.
  _bindProviderEvents(provider, walletType = 'phantom') {
    provider = provider || this.getProvider();
    if (!provider || provider === this.provider) return;
    this.provider = provider;
    // Every handler below checks it still belongs to the ACTIVE provider
    // at fire time. Listeners can't be reliably removed when the player
    // switches wallets (each extension keeps its own emitter), so without
    // this guard the OTHER wallet firing a late 'connect' event would
    // session and Place Bet opening the wrong wallet.
    provider.on('connect', (publicKey) => {
      if (this.provider !== provider) return; // stale listener from a previous wallet
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
      if (this.provider !== provider) return; // stale listener from a previous wallet
      this.connected = false; this.publicKey = null; this.balance = null; this.walletType = null;
      this._broadcastWalletSync();
      this.eventBus.emit('wallet:disconnected');
    });
    provider.on('accountChanged', (publicKey) => {
      if (this.provider !== provider) return; // stale listener from a previous wallet
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

  // The ONE authority on which extension object signs things: strictly
  // derived from this.walletType, so the wallet shown on the logo and the
  // wallet that opens for a stake can never diverge again.
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
         WALLET_SYNC_KEY, 'irWalletType', EXT_WALLET_TYPE_KEY].forEach(k => localStorage.removeItem(k));
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
      if (savedSession && savedWalletPubkey && savedAddress && this.dappKeyPair) {
        this.phantomWalletPublicKey = b58decode(savedWalletPubkey);
        this.publicKey = new solanaWeb3.PublicKey(savedAddress);
        this.connected = true;
        this.walletType = 'phantom';
        this.mobileSession = savedSession;
      }
    } catch (_) {}
  }

  _debugLog(msg) {
    try {
      // On-screen overlay is gated on the URL ONLY (?debug=1). The old
      // localStorage switch ('wmDebug') is deliberately ignored AND
      // scrubbed below, because phones that had it enabled during earlier
      // debugging kept showing the green overlay forever in normal play.
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

    // Non-phantom mobile wallets share the generic ALT session slots.
    try {
      const payloadStr = JSON.stringify(pendingAction || null);
      localStorage.setItem(PHANTOM_PENDING_ACTION_KEY, payloadStr);
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
    // FIX: capture handoff/resumeRoom from encrypted deeplink returns BEFORE
    // stripping the URL. _checkAutoConnectQueryParam only captures them for
    // the browse-in-wallet flow (autoConnectWallet param); encrypted deeplink
    // returns (walletReturn=connect/signTransaction) need them captured here.
    const handoff = urlParams.get('handoff');
    const resumeRoom = urlParams.get('resumeRoom');
    if (handoff) this._arrivedHandoffCode = handoff;
    if (resumeRoom) this._arrivedResumeRoom = resumeRoom;
    // FIX: expose return type before the URL is stripped so main.js can
    // detect that a wallet redirect happened even after history.replaceState.
    this._walletReturnType = returnType || null;
    // FIX: log this BEFORE the early return, not after - if the wallet's
    // redirect never carried our query params at all (lost along the way,
    // or the OS/app handled the hand-off differently than expected), the
    // debug overlay used to show nothing whatsoever for that attempt,
    // making it impossible to tell "no redirect happened" apart from
    // "redirect happened but something else broke."
    this._debugLog(`redirect check: raw search="${window.location.search}" returnType=${returnType || 'NONE'} handoff=${handoff ? 'present' : 'none'}`);
    if (!returnType) {
      this._notifyRestoredConnection();
      return;
    }

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

    const encPubKeyParam = urlParams.get('phantom_encryption_public_key');
    const nonceParam = urlParams.get('nonce');
    const dataParam = urlParams.get('data');
    if (!nonceParam || !dataParam) {
      // FIX: this used to just `return` here with zero feedback. If the
      // wallet redirected back without these params - a cancelled/rejected
      // connection some wallets signal by omitting params instead of
      // setting errorCode, or a redirect that lost query params somewhere
      // along the way - the user was left staring at "wallet not
      // connected" with no explanation and no way to tell what happened.
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
        localStorage.setItem(PHANTOM_SESSION_KEY, this.mobileSession);
        try { localStorage.setItem('irWalletType', walletType); } catch (_) {}
        try { localStorage.setItem(PHANTOM_WALLET_PUBKEY_KEY, b58encode(phantomPubKey)); } catch (_) {}
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
        // Some wallets may not preserve the walletType
        // query param on redirect, causing pendingAction to be read from the
        // wrong localStorage slot. If it's null here, the _resumeStakingAction
        // handler in main.js will try to reconstruct it from room context.
        if (!pendingAction) {
          this._debugLog('=> signTransaction: pendingAction is null (walletType mismatch?) - main.js will attempt fallback recovery');
        }
        // signAndSendTransaction: wallet already submitted the tx and returns
        // the signature directly. No need to call sendRawTransaction ourselves.
        if (result.signature) {
          this._debugLog(`=> signAndSendTransaction OK: sig=${String(result.signature).slice(0, 8)}…`);
          this.eventBus.emit('wallet:txConfirmed', { signature: result.signature, pendingAction });
          return;
        }
        // signTransaction: we receive the signed tx bytes and submit ourselves.
        if (!result.transaction) {
          this._debugLog('=> signTransaction: neither signature nor transaction in response');
          this.eventBus.emit('wallet:txError', { message: 'Transaction response was incomplete. Please try placing your bet again.', pendingAction });
          return;
        }
        // Ensure publicKey is available before we try to submit. On a fresh
        // page load after redirect, _restoreMobileKeyPair() should have set
        // it, but if anything went wrong we need to know now.
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

  // page load when the extension still trusts this dapp - no popup.
  //
  // FIX: previously this ONLY ever tried Phantom (via getProvider(), which
  // is hardcoded to Phantom's isPhantom flag). If you last connected with
  // silently, and leave the UI showing "Connect Wallet" even though
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
        this.eventBus.emit('wallet:connected', { address: this.publicKey.toString(), balance: this.balance, walletType: this.walletType, linkCode: this._arrivedLinkCode });
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


    // STRICT: silently reconnect ONLY to the wallet the player explicitly
    // connected last time - never guess, never fall back to the other
    // installed extension. Falling back is exactly how the identity
    // restore wasn't possible, so the old code quietly connected PHANTOM
    // instead - wrong logo, and Place Bet opened a wallet the player
    // never chose. No saved choice (or restore not possible) = stay
    // disconnected; the player picks their wallet with one tap.
    else if (lastExtWallet === 'phantom') tryPhantom();
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

  // ------------------------------------------------------------------
  // CONNECT
  // ------------------------------------------------------------------
  async connect() {
    if (this.connecting || this.connected) return;
    const provider = this.getProvider();
    if (provider) return this._connectProvider(provider);
    if (this.isMobile()) {
      // Never relaunch from INSIDE a wallet's own in-app browser - if the
      // provider isn't injected yet, relaunching just loops the page. The
      // auto-connect poller is already waiting for injection; tell the
      // player to give it a moment instead.
      if (this._arrivedInWalletBrowser) {
        this.eventBus.emit('wallet:error', {
          message: 'The wallet is still starting up. Wait a moment, then tap "Connect Wallet" again.'
        });
        throw new Error('Wallet provider not injected yet');
      }
      // ENCRYPTED DEEPLINK, not a browse link. This opens the Phantom APP,
      // shows its native Connect / Cancel sheet, and then returns the
      // player to THIS Chrome/Safari tab with the result appended to the
      // redirect URL. The game never loads inside Phantom's browser.
      //
      // The redirect is driven entirely by Phantom, only after the player
      // approves: on Connect it appends phantom_encryption_public_key,
      // nonce, and data; on Cancel it appends errorCode instead. There is
      // no path where we come back holding a decryptable payload without a
      // real approval, and _handleMobileRedirect() only marks the wallet
      // connected once that payload actually decrypts.
      //
      // Staking is deliberately NOT handled this way - handleDeposit() in
      // main.js hands the player into the wallet's in-app browser for the
      // signature, because per-transaction deeplink round-trips are where
      // this flow gets fragile with real money involved.
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


  // supports the same encrypted /ul/v1 deeplink protocol as Phantom, so mobile
  // browser extension when present.

  async _connectProvider(provider) {
    this.connecting = true;
    this.eventBus.emit('wallet:connecting', { wallet: 'phantom' });

    // FIX: when the Phantom extension's own content script fails to inject
    // (visible in the console as "[PHANTOM] error getting provider
    // injection options" / "Receiving end does not exist" - a Phantom-side
    // bug, usually from the extension being reloaded/updated while the tab
    // was already open), provider.connect() can hang forever - it never
    // resolves OR rejects. With no timeout, `connecting` stayed stuck true
    // permanently, and every future wallet click - including a totally
    // because of the duplicate-connect guard. This timeout guarantees
    // `connecting` always gets released.
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
      if (timedOut) return; // already reset state and shown an error; ignore this late resolution
      this._bindProviderEvents(provider, 'phantom');
      this.publicKey = resp.publicKey;
      this.connected = true;
      this.walletType = 'phantom';
      try { localStorage.setItem(EXT_WALLET_TYPE_KEY, 'phantom'); } catch (_) {}
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
    // Disconnect the provider matching the active walletType (falling
    // back to whatever was bound), so the RIGHT extension drops the session.
    const provider = this._activeProvider() || this.provider;
    if (provider) { try { await provider.disconnect(); } catch (_) {} }
    this.connected = false; this.publicKey = null; this.balance = null;
    this.mobileSession = null; this.phantomWalletPublicKey = null; this.walletType = null;
    [PHANTOM_SESSION_KEY, PHANTOM_WALLET_PUBKEY_KEY, PHANTOM_USER_ADDRESS_KEY,
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

  // Pre-stake check helper: what can this wallet actually pay right now?
  // Returns SOL (for network fees/rent) and INFINITE (the stake itself).
  async getSpendableBalances() {
    const sol = await this._refreshBalance();
    const infinite = await this._scanTokenBalance('C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump');
    return { sol: sol || 0, infinite: infinite || 0 };
  }

  async signTestMessage() {
    if (!this.connected) throw new Error('Wallet not connected.');
    const message = `Infinite Runners — verify wallet ownership\nAddress: ${this.publicKey.toString()}\nTimestamp: ${new Date().toISOString()}`;
    const encoded = new TextEncoder().encode(message);
    // Same rule as sendTransaction: sign strictly through the provider
    // matching the connected walletType.
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
