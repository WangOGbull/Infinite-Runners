const PHOTON_APP_ID = '9dad70be-61cb-4d4e-bba4-ca57fa9942f3';
const PHOTON_APP_VERSION = '1.0';
const PHOTON_REGION = 'us';
const MAX_ACCEPTABLE_RTT_MS = 3000;
const ROOM_READY_EVENT_CODE = 1;
const POST_ANNOUNCE_DISCONNECT_DELAY_MS = 1500;

let _appIdWarningShown = false;
function assertConfigured() {
  if (typeof Photon === 'undefined') {
    throw new Error('Photon SDK not loaded — add Photon-Javascript_SDK.min.js before using Search Battle.');
  }
  if (!PHOTON_APP_ID || PHOTON_APP_ID.startsWith('REPLACE_')) {
    if (!_appIdWarningShown) {
      _appIdWarningShown = true;
      console.warn('[Matchmaking] PHOTON_APP_ID not set.');
    }
    throw new Error('Search Battle not configured: set PHOTON_APP_ID in photonMatchmaking.js.');
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
        try { console.log('[Matchmaking TRACE] disconnect() called from checkConnectionQuality/finish()'); testClient.disconnect(); } catch (_) {}
        resolve(result);
      };
      testClient.onStateChange = (state) => {
        if (state === Photon.LoadBalancing.LoadBalancingClient.State.ConnectedToMaster) {
          const elapsed = Date.now() - startedAt;
          finish({ ok: elapsed <= MAX_ACCEPTABLE_RTT_MS, rtt: elapsed });
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
    this.iAmInitiator = false;

    this.client = this._newClient();

    this.client.onStateChange = (state) => {
      console.log('[Matchmaking TRACE] onStateChange fired with state:', state);
      if (state === Photon.LoadBalancing.LoadBalancingClient.State.JoinedLobby) {
        console.log('[Matchmaking TRACE] calling joinRandomOrCreateRoom');
        this.client.joinRandomOrCreateRoom(
          { expectedCustomRoomProperties: { tier } },
          null,
          { maxPlayers: 2, isVisible: true, isOpen: true, customGameProperties: { tier } }
        );
      }
    };

    // NOTE: onCreateRoom is not a real SDK callback (verified against the
    // actual source - it's not in the LoadBalancingClient prototype's list
    // of overridable callbacks). It's harmless dead code, not a bug, since
    // onJoinRoom below fires unconditionally for both the create-then-join
    // and pure-join cases when using joinRandomOrCreateRoom - it already
    // covers everything this would have. Left removed for clarity.
    this.client.onJoinRoom = () => {
      this._setInitiator();
      this.eventBus.emit('matchmaking:searching');
    };

    this.client.onActorJoin = () => {
      // FIXED: Room.getActors() does not exist on the real SDK's Room
      // class (confirmed against source) - it was silently falling back to
      // an empty array every time via the defensive `room.getActors ? ... : []`,
      // meaning `count` was always 0 and this condition never fired at all.
      // matchmaking:opponentFound never happened, so proceed() always hit
      // its early-return guard - this was the entire "stuck at Searching
      // forever" bug. The real, correct method lives on the CLIENT, not
      // the room.
      const count = this.client.myRoomActorCount();
      if (count >= 2 && !this.opponentFound) {
        this.opponentFound = true;
        this.eventBus.emit('matchmaking:opponentFound', {
          isInitiator: this.iAmInitiator,
          tier: this.tier
        });
      }
    };

    this.client.onEvent = (code, content) => {
      if (code === ROOM_READY_EVENT_CODE && content && content.roomCode) {
        this.matchedRoomCode = content.roomCode;
      }
    };

    this.client.onError = (errorCode, errorMsg) => {
      console.log('[Matchmaking TRACE] onError fired! code:', errorCode, 'msg:', errorMsg);
      this.isSearching = false;
      this.opponentFound = false;
      this.eventBus.emit('matchmaking:error', {
        message: errorMsg || 'Matchmaking connection failed.'
      });
    };

    console.log('[Matchmaking TRACE] calling connectToRegionMaster (real search client)');
    this.client.connectToRegionMaster(PHOTON_REGION);
  }

  _setInitiator() {
    this.iAmInitiator = this.client.myActor().actorNr === 1;
  }

  proceed() {
    if (!this.opponentFound) {
      console.warn('[Matchmaking] proceed() called but opponent not found yet');
      return;
    }
    if (this.iAmInitiator) {
      this.eventBus.emit('matchmaking:matched', {
        isInitiator: true,
        tier: this.tier
      });
    } else if (this.matchedRoomCode) {
      this.eventBus.emit('matchmaking:matched', {
        roomCode: this.matchedRoomCode,
        isInitiator: false,
        tier: this.tier
      });
    } else {
      setTimeout(() => {
        if (this.matchedRoomCode) {
          this.eventBus.emit('matchmaking:matched', {
            roomCode: this.matchedRoomCode,
            isInitiator: false,
            tier: this.tier
          });
        }
      }, 800);
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
      try { console.log('[Matchmaking TRACE] disconnect() called from cancelSearch()'); this.client.disconnect(); } catch (_) {}
      this.client = null;
    }
    this.eventBus.emit('matchmaking:cancelled');
  }

  cleanup() {
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { console.log('[Matchmaking TRACE] disconnect() called from cleanup()'); this.client.disconnect(); } catch (_) {}
      this.client = null;
    }
    this.isSearching = false;
    this.opponentFound = false;
    this.matchedRoomCode = null;
  }
}

export default PhotonMatchmaking;
