// photonMatchmaking.js
//
// Handles ONLY the "find a stranger to play, at the same stake tier" step
// for "Search Battle". Player picks a tier BEFORE searching; Photon only
// matches them with someone who picked the same tier. The moment two
// players are matched, this hands off entirely to the EXISTING Firebase
// createRoom()/joinRoom() flow (see main.js) with that tier already locked
// in - staking, gameplay sync, everything else stays exactly as it already
// works today. Photon never touches any of that.
//
// ===================== SETUP REQUIRED (do this first) =====================
// 1. Go to dashboard.photonengine.com -> SDKs tab -> download the
//    "Realtime" JavaScript SDK (make sure your Photon app itself is also
//    type "Realtime", not PUN/Fusion/Quantum - those are Unity-specific).
// 2. Unzip it, find Photon-Javascript_SDK.min.js inside the lib/ folder.
// 3. Add that file to this repo at /lib/Photon-Javascript_SDK.min.js and
//    reference it with a plain <script> tag in index.html.
// 4. Paste your real Photon App ID below.
// ============================================================================

const PHOTON_APP_ID = '9dad70be-61cb-4d4e-bba4-ca57fa9942f3';
const PHOTON_APP_VERSION = '1.0';
const PHOTON_REGION = 'us'; // change to whichever Photon region is closest to your players
const MAX_ACCEPTABLE_RTT_MS = 3000; // "strong network connection" gate - full connect time, not raw ping (see checkConnectionQuality)
const ROOM_READY_EVENT_CODE = 1;
// How long to wait after raiseEvent() before disconnecting the initiator's
// Photon connection. Previously this disconnected immediately, which could
// (and did, per real testing) tear down the WebSocket before the "room is
// ready" message had actually finished transmitting to the matched
// opponent - the opponent would just sit on "searching" forever with no
// way to know a room existed. This buffer gives the message time to land.
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

  /**
   * Quick connectivity check BEFORE committing to a real search - the
   * "should require strong network connection" requirement. Connects
   * briefly, measures how long it takes to reach the master server (full
   * connection setup time, not a raw ping - see the constant comment
   * above), reports back whether it's good enough, then disconnects.
   * startSearch() below does its own separate, full connection.
   */
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

  /**
   * Starts searching for an opponent who picked the SAME stake tier.
   * `tier` is one of 'Small' | 'Medium' | 'High' - matches the exact same
   * strings already used everywhere else in the app (Create Room's tier
   * buttons, Firebase's room.tier field, stakingManager.js's TIER map).
   *
   * Emits on the shared eventBus:
   *   'matchmaking:searching' - entered the queue, waiting for someone
   *   'matchmaking:matched'   - a same-tier opponent was found AND the
   *                             real Firebase room is already being set
   *                             up / joined - no separate confirm step,
   *                             since picking a tier and starting the
   *                             search already IS the commitment.
   *   'matchmaking:cancelled'
   *   'matchmaking:error'
   */
  startSearch(tier) {
    assertConfigured();
    if (this.isSearching) return;
    this.isSearching = true;
    this.matchedRoomCode = null;
    this.tier = tier;

    this.client = this._newClient();

    this.client.onStateChange = (state) => {
      if (state === Photon.LoadBalancing.LoadBalancingClient.State.JoinedLobby) {
        // Only match with someone who picked the exact same tier - Photon
        // filters this natively via expectedCustomRoomProperties, so we
        // never even see/join a room where the tier doesn't match.
        this.client.joinRandomOrCreateRoom(
          { expectedCustomRoomProperties: { tier } },
          null,
          { maxPlayers: 2, isVisible: true, isOpen: true, customGameProperties: { tier } }
        );
      }
    };

    this.client.onJoinRoom = () => {
      // NOTE: joinRandomOrCreateRoom() always completes via the game
      // server's JoinGame response internally (confirmed against the
      // actual SDK source), regardless of whether this client's request
      // was the one that created the room - so a createdByMe-style
      // parameter is NOT reliable here. actorNr === 1 is: Photon always
      // assigns the FIRST player to join a room actorNr 1, server-side.
      this.iAmInitiator = this.client.myActor().actorNr === 1;
      this.eventBus.emit('matchmaking:searching');
    };

    this.client.onActorJoin = () => {
      const actors = typeof this.client.myRoomActorsArray === 'function'
        ? this.client.myRoomActorsArray()
        : [];
      if (actors.length >= 2) {
        this._handleMatched();
      }
    };

    this.client.onEvent = (code, content) => {
      if (code === ROOM_READY_EVENT_CODE && content && content.roomCode) {
        this.matchedRoomCode = content.roomCode;
        this.eventBus.emit('matchmaking:matched', { roomCode: content.roomCode, isInitiator: false, tier: this.tier });
        this._scheduleCleanup();
      }
    };

    this.client.onError = (errorCode, errorMsg) => {
      this.isSearching = false;
      this.eventBus.emit('matchmaking:error', { message: errorMsg || 'Matchmaking connection failed.' });
    };

    this.client.connectToRegionMaster(PHOTON_REGION);
  }

  // Called once two players are confirmed present in the same Photon room.
  // No manual "Proceed" step anymore - choosing a tier and starting the
  // search already is the commitment (this is what you asked for: stake
  // amount picked first, then matched only with someone at that same
  // amount - there's nothing left to separately confirm).
  _handleMatched() {
    if (this.iAmInitiator) {
      this.eventBus.emit('matchmaking:matched', { isInitiator: true, tier: this.tier });
      // The actual Firebase room + raiseEvent happen in main.js's handler
      // for this event (it needs to call createRoom(), which lives there).
    }
    // Non-initiator just waits for the ROOM_READY_EVENT_CODE via onEvent
    // above - the initiator announces once their real room actually exists.
  }

  /**
   * Called by the INITIATOR once they've created the real Firebase room -
   * broadcasts that room code to the matched opponent so they can join it
   * exactly as if they'd typed a code in manually.
   */
  announceRoomReady(roomCode) {
    if (!this.client) return;
    this.client.raiseEvent(ROOM_READY_EVENT_CODE, { roomCode });
    this.matchedRoomCode = roomCode;
    this._scheduleCleanup();
  }

  // Delays disconnecting until the just-sent raiseEvent has had time to
  // actually reach Photon's server and relay to the opponent - see the
  // POST_ANNOUNCE_DISCONNECT_DELAY_MS comment above for why this exists.
  _scheduleCleanup() {
    if (this._disconnectTimer) clearTimeout(this._disconnectTimer);
    this._disconnectTimer = setTimeout(() => this.cleanup(), POST_ANNOUNCE_DISCONNECT_DELAY_MS);
  }

  cancelSearch() {
    this.isSearching = false;
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { this.client.disconnect(); } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.eventBus.emit('matchmaking:cancelled');
  }

  /** Photon's role is done - disconnect cleanly. */
  cleanup() {
    if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; }
    if (this.client) {
      try { this.client.disconnect(); } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.isSearching = false;
    this.matchedRoomCode = null;
  }
}

export default PhotonMatchmaking;
