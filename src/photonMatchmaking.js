// photonMatchmaking.js
const PHOTON_APP_ID = '9dad70be-61cb-4d4e-bba4-ca57fa9942f3';
const PHOTON_APP_VERSION = '1.0';
const PHOTON_REGION = 'us';
const MAX_ACCEPTABLE_RTT_MS = 3000;
const ROOM_READY_EVENT_CODE = 1;
const POST_ANNOUNCE_DISCONNECT_DELAY_MS = 1500;

let _appIdWarningShown = false;
function assertConfigured() {
  if (typeof Photon === 'undefined') {
    throw new Error('Photon SDK not loaded - add Photon-Javascript_SDK.min.js to index.html before using Search Battle.');
  }
  if (!PHOTON_APP_ID || PHOTON_APP_ID.startsWith('REPLACE_')) {
    if (!_appIdWarningShown) {
      _appIdWarningShown = true;
      console.warn('[Matchmaking] PHOTON_APP_ID is not set yet - set it in photonMatchmaking.js.');
    }
    throw new Error('Search Battle is not configured yet: set PHOTON_APP_ID in photonMatchmaking.js to your real Photon App ID.');
  }
}

class PhotonMatchmaking {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.client = null;
    this.isSearching = false;
    this.opponentFound = false;
    this.matchedRoomCode = null;
    this.iAmInitiator = false;
    this.tier = null;
    this._disconnectTimer = null;
  }

  _newClient() {
    return new Photon.LoadBalancing.LoadBalancingClient(
      Photon.ConnectionProtocol.Wss,
      PHOTON_APP_ID,
      PHOTON_APP_VERSION
    );
  }

  async checkConnectionQuality() {
    assertConfigured();
    return new Promise((resolve) => {
      const testClient = this._newClient();
      const startedAt = Date.now();
      let resolved = false;
      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        try { testClient.disconnect(); } catch (_) { /* ignore */ }
        resolve(result);
      };
      testClient.onStateChange = (state) => {
        if (state === Photon.LoadBalancing.LoadBalancingClient.State.ConnectedToMaster) {
          const elapsedMs = Date.now() - startedAt;
          finish({ ok: elapsedMs <= MAX_ACCEPTABLE_RTT_MS, rtt: elapsedMs });
        }
      };
      testClient.onError = () => finish({ ok: false, rtt: null, error: true });
      testClient.connectToRegionMaster(PHOTON_REGION);
      setTimeout(() => finish({ ok: false, rtt: null, timeout: true }), 5000);
    });
  }

  startSearch(tier) {
    assertConfigured();
    if (this.isSearching) return;
    this.isSearching = true;
    this.opponentFound = false;
    this.matchedRoomCode = null;
    this.tier = tier;

    this.client = this._newClient();

    this.client.onStateChange = (state) => {
      if (state === Photon.LoadBalancing.LoadBalancingClient.State.JoinedLobby) {
        this.client.joinRandomOrCreateRoom(
          { expectedCustomRoomProperties: { tier } },
          null,
          { maxPlayers: 2, isVisible: true, isOpen: true, customGameProperties: { tier } }
        );
      }
    };

    this.client.onJoinRoom = () => {
      this.iAmInitiator = this.client.myActor().actorNr === 1;
      this.eventBus.emit('matchmaking:searching');
    };

    this.client.onActorJoin = () => {
      const actors = typeof this.client.myRoomActorsArray === 'function'
        ? this.client.myRoomActorsArray()
        : [];
      if (actors.length >= 2 && !this.opponentFound) {
        this.opponentFound = true;
        this.eventBus.emit('matchmaking:opponentFound', { isInitiator: this.iAmInitiator, tier: this.tier });
      }
    };

    this.client.onEvent = (code, content) => {
      if (code === ROOM_READY_EVENT_CODE && content && content.roomCode) {
        this.matchedRoomCode = content.roomCode;
      }
    };

    this.client.onError = (errorCode, errorMsg) => {
      this.isSearching = false;
      this.opponentFound = false;
      this.eventBus.emit('matchmaking:error', { message: errorMsg || 'Matchmaking connection failed.' });
    };

    this.client.connectToRegionMaster(PHOTON_REGION);
  }

  proceed() {
    if (!this.opponentFound) return;
    if (this.iAmInitiator) {
      this.eventBus.emit('matchmaking:matched', { isInitiator: true, tier: this.tier });
    } else if (this.matchedRoomCode) {
      this.eventBus.emit('matchmaking:matched', { roomCode: this.matchedRoomCode, isInitiator: false, tier: this.tier });
    }
  }

  announceRoomReady(roomCode) {
    if (!this.client) return;
    this.client.raiseEvent(ROOM_READY_EVENT_CODE, { roomCode });
    this.matchedRoomCode = roomCode;
    this._scheduleCleanup();
  }

  _scheduleCleanup() {
    if (this._disconnectTimer) clearTimeout(this._disconnectTimer);
    this._disconnectTimer = setTimeout(() => this.cleanup(), POST_ANNOUNCE_DISCONNECT_DELAY_MS);
  }

  cancelSearch() {
    this.isSearching = false;
    this.opponentFound = false;
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { this.client.disconnect(); } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.eventBus.emit('matchmaking:cancelled');
  }

  cleanup() {
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { this.client.disconnect(); } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.isSearching = false;
    this.opponentFound = false;
    this.matchedRoomCode = null;
  }
}

export default PhotonMatchmaking;
