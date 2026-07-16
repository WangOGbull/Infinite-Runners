const PHOTON_APP_ID = '9dad70be-61cb-4d4e-bba4-ca57fa9942f3';
const PHOTON_APP_VERSION = '1.0';
const PHOTON_REGION = 'us';
const MAX_ACCEPTABLE_RTT_MS = 3000;
const ROOM_READY_EVENT_CODE = 1;
const POST_ANNOUNCE_DISCONNECT_DELAY_MS = 1500;
const SEARCH_RETRY_BASE_MS = 3500;

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
    this._retryTimer = null;
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
      // FIX: stop the SDK from auto-sending JoinLobby the moment we connect —
      // that send raced our disconnect() and threw the uncaught Op 229 error.
      testClient.autoJoinLobby = false;
      const startedAt = Date.now();
      let resolved = false;
      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        try { testClient.disconnect(); } catch (_) {}
        resolve(result);
      };
      testClient.onStateChange = (state) => {
        if (state === Photon.LoadBalancing.LoadBalancingClient.State.ConnectedToMaster) {
          const elapsed = Date.now() - startedAt;
          finish({ ok: elapsed <= MAX_ACCEPTABLE_RTT_MS, rtt: elapsed });
        }
      };
      testClient.onError = () => finish({ ok: false, rtt: null, error: true });
      try {
        testClient.connectToRegionMaster(PHOTON_REGION);
      } catch (_) {
        finish({ ok: false, rtt: null, error: true });
      }
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
    this._clearRetryTimer();

    this.client = this._newClient();

    this.client.onStateChange = (state) => {
      if (state === Photon.LoadBalancing.LoadBalancingClient.State.JoinedLobby) {
        this._safeJoinRandomOrCreate();
      }
    };

    this.client.onCreateRoom = () => {
      this._setInitiator();
      this.eventBus.emit('matchmaking:searching');
    };

    this.client.onJoinRoom = () => {
      this._setInitiator();
      this.eventBus.emit('matchmaking:searching');
      // FIX: onActorJoin only fires for actors who join AFTER us — when WE are
      // the second player, the room creator is already inside and no event
      // fires. Check the existing actor list or the joiner waits forever.
      this._checkOpponentPresent();
    };

    this.client.onActorJoin = () => {
      this._checkOpponentPresent();
    };

    this.client.onEvent = (code, content) => {
      if (code === ROOM_READY_EVENT_CODE && content && content.roomCode) {
        this.matchedRoomCode = content.roomCode;
      }
    };

    this.client.onError = (errorCode, errorMsg) => {
      this.isSearching = false;
      this.opponentFound = false;
      this._clearRetryTimer();
      this.eventBus.emit('matchmaking:error', {
        message: errorMsg || 'Matchmaking connection failed.'
      });
    };

    this.client.connectToRegionMaster(PHOTON_REGION);
    this._startRetryTimer();
  }

  _setInitiator() {
    try {
      this.iAmInitiator = this.client.myActor().actorNr === 1;
    } catch (_) {}
  }

  _checkOpponentPresent() {
    if (this.opponentFound || !this.isSearching || !this.client) return;
    try {
      const room = this.client.myRoom();
      if (!room) return;
      const actors = room.getActors ? room.getActors() : {};
      const count = Object.keys(actors).length;
      if (count >= 2) {
        this.opponentFound = true;
        this._clearRetryTimer();
        this.eventBus.emit('matchmaking:opponentFound', {
          isInitiator: this.iAmInitiator,
          tier: this.tier
        });
      }
    } catch (_) {}
  }

  _safeJoinRandomOrCreate() {
    if (!this.isSearching || this.opponentFound || !this.client) return;
    try {
      if (typeof this.client.isInLobby === 'function' && !this.client.isInLobby()) return;
      // FIX: expectedCustomRoomProperties must be the plain filter dict
      // { tier: 'Small' } — not { expectedCustomRoomProperties: { tier } }.
      // And 'tier' must be listed in propsListedInLobby or Photon ignores it
      // when matching — both were why every player created their own room.
      this.client.joinRandomOrCreateRoom(
        { tier: this.tier },
        null,
        {
          maxPlayers: 2,
          isVisible: true,
          isOpen: true,
          customGameProperties: { tier: this.tier },
          propsListedInLobby: ['tier']
        }
      );
    } catch (e) {
      console.warn('[Matchmaking] joinRandomOrCreate failed:', e);
    }
  }

  // FIX: if both players search at the same time, both can create their own
  // room and wait forever. While we sit alone in a room we made, periodically
  // abandon it and retry a random join — jittered so both sides don't collide.
  _startRetryTimer() {
    this._clearRetryTimer();
    const interval = SEARCH_RETRY_BASE_MS + Math.floor(Math.random() * 1500);
    this._retryTimer = setInterval(() => {
      if (!this.isSearching || this.opponentFound || !this.client) return;
      try {
        const inRoom = typeof this.client.isJoinedToRoom === 'function' && this.client.isJoinedToRoom();
        if (inRoom) {
          const room = this.client.myRoom();
          const actors = room && room.getActors ? room.getActors() : {};
          if (Object.keys(actors).length >= 2) return; // matched, timer will be cleared
          this.client.leaveRoom();
          setTimeout(() => this._safeJoinRandomOrCreate(), 600);
        } else {
          this._safeJoinRandomOrCreate();
        }
      } catch (_) {}
    }, interval);
  }

  _clearRetryTimer() {
    if (this._retryTimer) { clearInterval(this._retryTimer); this._retryTimer = null; }
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
    try {
      // Reliable delivery — the opponent MUST receive the room code.
      this.client.raiseEvent(ROOM_READY_EVENT_CODE, { roomCode }, { reliability: 1 });
    } catch (e) {
      try { this.client.raiseEvent(ROOM_READY_EVENT_CODE, { roomCode }); } catch (_) {}
    }
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
    this._clearRetryTimer();
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { this.client.disconnect(); } catch (_) {}
      this.client = null;
    }
    this.eventBus.emit('matchmaking:cancelled');
  }

  cleanup() {
    this._clearRetryTimer();
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { this.client.disconnect(); } catch (_) {}
      this.client = null;
    }
    this.isSearching = false;
    this.opponentFound = false;
    this.matchedRoomCode = null;
  }
}

export default PhotonMatchmaking;
