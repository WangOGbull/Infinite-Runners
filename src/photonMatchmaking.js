// photonMatchmaking.js
//
// Handles ONLY the "find a stranger to play" step for the new "Search
// Battle" quick-match option. Once two players are matched and both
// confirm, this hands off entirely to the EXISTING Firebase
// createRoom()/joinRoom() flow (see main.js) - staking, gameplay sync,
// everything else stays exactly as it already works today. Photon never
// touches any of that.
//
// ===================== SETUP REQUIRED (do this first) =====================
// 1. Go to dashboard.photonengine.com -> SDKs tab -> download the
//    "Realtime" JavaScript SDK (make sure your Photon app itself is also
//    type "Realtime", not PUN/Fusion/Quantum - those are Unity-specific).
// 2. Unzip it, find Photon-Javascript_SDK.min.js inside the lib/ folder.
// 3. Add that file to this repo (e.g. at /lib/Photon-Javascript_SDK.min.js)
//    and reference it with a plain <script> tag in index.html, same as
//    everything else in this project - deliberately NOT loaded from a CDN
//    guess, since Photon doesn't officially publish one and guessing a
//    path has burned real time before on other integrations.
// 4. Paste your real Photon App ID below.
// ============================================================================

const PHOTON_APP_ID = '9dad70be-61cb-4d4e-bba4-ca57fa9942f3';
const PHOTON_APP_VERSION = '1.0';
const PHOTON_REGION = 'us'; // change to whichever Photon region is closest to your players
const MAX_ACCEPTABLE_RTT_MS = 3000; // "strong network connection" gate - full connect time, not raw ping (see checkConnectionQuality)
const ROOM_READY_EVENT_CODE = 1;

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
  }

  _newClient() {
    return new Photon.LoadBalancing.LoadBalancingClient(
      Photon.ConnectionProtocol.Wss,
      PHOTON_APP_ID,
      PHOTON_APP_VERSION
    );
  }

  /**
   * Quick connectivity check BEFORE committing to a real search - this is
   * the "should require strong network connection" requirement. Connects
   * briefly and measures how long it takes to reach the master server,
   * reports back whether it's good enough, then disconnects. startSearch()
   * below does its own separate, full connection.
   *
   * NOTE: this measures OUR OWN wall-clock connect time, not the SDK's
   * getRtt() - per the actual SDK source, getRtt() only returns a real
   * value once you're in a game room with an active gamePeer; called any
   * earlier (like right after reaching ConnectedToMaster, before joining
   * any room) it always returns 0, which would make this check fail
   * permanently even on a perfect connection. Since this measures full
   * connection setup time (DNS + handshake + auth), not a single ping, the
   * threshold is intentionally generous compared to a raw RTT figure.
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
   * Starts searching for an opponent. Emits on the shared eventBus:
   *   'matchmaking:searching'   - entered the queue, waiting for someone
   *   'matchmaking:found'       - paired with someone; UI should show
   *                               "Opponent Found" with Cancel/Proceed
   *   'matchmaking:ready'       - both sides confirmed and a real Firebase
   *                               room code is ready - main.js should hand
   *                               off to its existing joinRoom(roomCode)
   *                               (or, for the initiator, it already ran
   *                               createRoom() and is just confirming)
   *   'matchmaking:cancelled'
   *   'matchmaking:error'
   */
  startSearch() {
    assertConfigured();
    if (this.isSearching) return;
    this.isSearching = true;
    this.matchedRoomCode = null;

    this.client = this._newClient();

    this.client.onStateChange = (state) => {
      if (state === Photon.LoadBalancing.LoadBalancingClient.State.JoinedLobby) {
        this.client.joinRandomOrCreateRoom(
          {},
          null,
          { maxPlayers: 2, isVisible: true, isOpen: true }
        );
      }
    };

    this.client.onJoinRoom = () => {
      // NOTE: joinRandomOrCreateRoom() always completes via the game
      // server's JoinGame response internally, regardless of whether this
      // client's request was the one that actually created the room - so
      // the createdByMe parameter here is NOT reliable (it's always false
      // in this flow, confirmed against the actual SDK source, not
      // assumed). This was why BOTH matched players ended up on the same
      // "non-initiator" branch and got sent back to the searching screen
      // instead of one of them ever creating the real room.
      //
      // actorNr === 1 is the reliable signal instead: Photon always
      // assigns the FIRST player to join a room actorNr 1, server-side,
      // with no ambiguity - so exactly one matched player ends up the
      // initiator, deterministically.
      this.iAmInitiator = this.client.myActor().actorNr === 1;
      this.eventBus.emit('matchmaking:searching');
    };

    this.client.onActorJoin = () => {
      const actors = typeof this.client.myRoomActorsArray === 'function'
        ? this.client.myRoomActorsArray()
        : [];
      if (actors.length >= 2) {
        this.eventBus.emit('matchmaking:found', {});
      }
    };

    this.client.onEvent = (code, content) => {
      // The initiator broadcasts the real Firebase room code once THEY'VE
      // created it via the existing createRoom() flow - this is the ONLY
      // payload Photon ever carries. Once the non-initiator gets this,
      // Photon's job is completely done.
      if (code === ROOM_READY_EVENT_CODE && content && content.roomCode) {
        this.matchedRoomCode = content.roomCode;
        this.eventBus.emit('matchmaking:ready', { roomCode: content.roomCode, isInitiator: false });
      }
    };

    this.client.onError = (errorCode, errorMsg) => {
      this.isSearching = false;
      this.eventBus.emit('matchmaking:error', { message: errorMsg || 'Matchmaking connection failed.' });
    };

    this.client.connectToRegionMaster(PHOTON_REGION);
  }

  /**
   * Called by the INITIATOR (the player whose Photon room creation
   * actually happened first) once they've hit "Proceed" AND already
   * created the real Firebase room via the existing createRoom() flow -
   * broadcasts that room code to the matched opponent so they can join it
   * exactly as if they'd typed a code in manually.
   */
  announceRoomReady(roomCode) {
    if (!this.client) return;
    this.client.raiseEvent(ROOM_READY_EVENT_CODE, { roomCode });
    this.matchedRoomCode = roomCode;
    this.eventBus.emit('matchmaking:ready', { roomCode, isInitiator: true });
  }

  cancelSearch() {
    this.isSearching = false;
    if (this.client) {
      try { this.client.disconnect(); } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.eventBus.emit('matchmaking:cancelled');
  }

  /** Call once the match is fully handed off to Firebase - Photon's role ends here. */
  cleanup() {
    if (this.client) {
      try { this.client.disconnect(); } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.isSearching = false;
    this.matchedRoomCode = null;
  }
}

export default PhotonMatchmaking;
