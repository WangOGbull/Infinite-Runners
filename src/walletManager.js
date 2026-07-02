// walletManager.js
// Handles Phantom (Solana) wallet connect/disconnect, live on-chain balance,
// and a message-signing test that proves the connection actually works.
//
// Requires the Solana web3.js UMD bundle to be loaded on the page before
// this module runs (see index.html) — it exposes the global `solanaWeb3`.

// ----------------- QUICKNODE RPC ENDPOINT -----------------
const RPC_ENDPOINT = 'https://broken-dimensional-bridge.solana-mainnet.quiknode.pro/71331ad63dbca61e4f46856dbe393fad7465aa4a/';

class WalletManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.provider = null;
    this.publicKey = null;
    this.connected = false;
    this.connecting = false;
    this.balance = null;
    this.connection = null;

    this._initConnection();
    this._bindProviderEvents();
    
    // LISTEN FOR THE SCAN EVENT FROM THE UI
    this.eventBus.on('wallet:scanRequest', () => {
      this.scanBalances();
    });
  }

  _initConnection() {
    if (typeof solanaWeb3 === 'undefined') {
      console.error('[WalletManager] solana web3.js not loaded — check the script tag in index.html');
      return;
    }
    this.connection = new solanaWeb3.Connection(RPC_ENDPOINT, 'confirmed');
  }

  // Phantom injects window.phantom.solana (current API) or window.solana (legacy).
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

    // Fires if the user switches accounts inside Phantom without disconnecting.
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

  async connect() {
    const provider = this.getProvider();

    if (!provider) {
      if (this.isMobile()) {
        // Phantom has no browser-extension on mobile — the only way to reach
        // an injected provider is to reopen this page inside Phantom's own
        // in-app browser via a deep link.
        const dappUrl = encodeURIComponent(window.location.href);
        window.location.href = `https://phantom.app/ul/browse/${dappUrl}?ref=${dappUrl}`;
        return { deepLinked: true };
      }
      window.open('https://phantom.app/', '_blank');
      this.eventBus.emit('wallet:error', { message: 'Phantom is not installed.' });
      throw new Error('Phantom not installed');
    }

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
      // err.code === 4001 → user rejected the connection request in Phantom
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
      try { await this.provider.disconnect(); } catch (_) { /* ignore */ }
    }
    this.connected = false;
    this.publicKey = null;
    this.balance = null;
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

  // HELPER TO FETCH SPECIFIC TOKEN BALANCE (InfiniteCoin)
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
      return 0; // User does not hold this token
    } catch (err) {
      console.warn('[WalletManager] Token fetch failed:', err);
      return 0;
    }
  }

  // THE SCAN FUNCTION TRIGGERED BY THE UI BUTTON
  async scanBalances() {
    if (!this.connected || !this.publicKey) {
      this.eventBus.emit('wallet:error', { message: 'Wallet not connected.' });
      return;
    }

    // 1. Update UI to show scanning state
    this.eventBus.emit('wallet:balanceUpdated', { balance: 'Scanning...' });

    // 2. Fetch SOL
    const solBalance = await this._refreshBalance();

    // 3. Fetch InfiniteCoin (Your live token address)
    const INFINITE_COIN_MINT = 'C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump';
    const infiniteBalance = await this._scanTokenBalance(INFINITE_COIN_MINT);

    // 4. Emit the combined result to the UI
    this.eventBus.emit('wallet:scanResult', { 
      sol: solBalance || 0, 
      infinite: infiniteBalance 
    });
    
    return { sol: solBalance, infinite: infiniteBalance };
  }

  // Legacy balance refresh (kept for compatibility with other parts of code)
  async refreshBalance() {
    const balance = await this._refreshBalance();
    this.eventBus.emit('wallet:balanceUpdated', { balance });
    return balance;
  }

  // Proves Phantom can actually sign for the connected wallet
  async signTestMessage() {
    if (!this.provider || !this.connected) {
      throw new Error('Wallet not connected.');
    }
    const message =
      `Infinite Runners — verify wallet ownership\n` +
      `Address: ${this.publicKey.toString()}\n` +
      `Timestamp: ${new Date().toISOString()}`;
    const encoded = new TextEncoder().encode(message);
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

verify
