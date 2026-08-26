const VALID_TIERS = new Set(['Small', 'Medium', 'High']);

class FirebaseMatchmaking {
  constructor(eventBus, db, opts = {}) {
    this.eventBus = eventBus;
    this.db = db;
    this.getIdentity = opts.getIdentity || (() => ({}));
    this.sessionId = null;
    this.requestRef = null;
    this.resultRef = null;
    this.matchId = null;
    this.roomCode = null;
    this.tier = null;
    this.isSearching = false;
    this.matched = false;
    this._matchedEmitted = false;
    this._resultHandler = null;
  }

  async startSearch(tier) {
    if (!this.db) throw new Error('Matchmaking is unavailable. Please reconnect and try again.');
    if (!VALID_TIERS.has(tier)) throw new Error('Invalid matchmaking stake tier.');
    await this.cancelSearch({ silent: true });

    const identity = this.getIdentity() || {};
    if (!identity.uid || String(identity.uid).startsWith('anon_')) {
      throw new Error('Sign in before searching for an opponent.');
    }

    this.sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    this.tier = tier;
    this.isSearching = true;
    this.matched = false;
    this._matchedEmitted = false;
    this.requestRef = this.db.ref(`matchmakingRequests/${identity.uid}`);
    this.resultRef = this.db.ref(`matchmakingResults/${identity.uid}`);
    this._listenForResult();

    await this.requestRef.set({
      action: 'search', sessionId: this.sessionId, tier,
      name: String(identity.name || 'Player').slice(0, 40),
      dragon: identity.dragon ? String(identity.dragon).slice(0, 40) : null,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
    try {
      await this.requestRef.onDisconnect().update({
        action: 'disconnect', sessionId: this.sessionId,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
    } catch (error) {
      // The backend expires stale searches, so cleanup registration must not
      // prevent an otherwise valid search from entering the queue.
      console.warn('[Matchmaking] disconnect cleanup could not be registered:',
        error?.message || error);
    }
  }

  _listenForResult() {
    this._resultHandler = (snapshot) => {
      const result = snapshot.val();
      if (!result || result.sessionId !== this.sessionId) return;
      if (result.status === 'waiting') return;

      if (result.status === 'paired' || result.status === 'room_ready') {
        this.isSearching = false;
        this.matched = true;
        this.matchId = result.matchId;
        this.roomCode = result.roomCode || null;
        const isInitiator = result.role === 'host';
        if (!this._matchedEmitted) {
          this._matchedEmitted = true;
          this.eventBus.emit('matchmaking:matched', {
            roomCode: this.roomCode, isInitiator,
            tier: result.tier || this.tier, matchId: this.matchId,
            roomReady: result.status === 'room_ready',
            opponentUid: result.opponentUid || null
          });
        }
        if (result.status === 'room_ready') {
          this.eventBus.emit('matchmaking:roomReady', {
            roomCode: this.roomCode, isInitiator,
            tier: result.tier || this.tier, matchId: this.matchId
          });
        }
        return;
      }

      if (result.status === 'cancelled' || result.status === 'expired') {
        const wasMatched = this.matched;
        this._detach(false);
        this.eventBus.emit(wasMatched ? 'matchmaking:opponentLeft' : 'matchmaking:cancelled', {
          reason: result.reason || result.status
        });
        return;
      }
      if (result.status === 'error') {
        const message = result.message || 'Matchmaking failed. Please try again.';
        this._detach(false);
        this.eventBus.emit('matchmaking:error', { message });
      }
    };
    this.resultRef.on('value', this._resultHandler, (error) => {
      this._detach(false);
      this.eventBus.emit('matchmaking:error', {
        message: error?.message || 'Lost connection to matchmaking. Please try again.'
      });
    });
  }

  async announceRoomReady(roomCode) {
    if (!this.requestRef || !this.matchId || !/^\d{6}$/.test(String(roomCode))) {
      throw new Error('Cannot announce an invalid matched room.');
    }
    await this.requestRef.update({
      action: 'room_ready', sessionId: this.sessionId,
      matchId: this.matchId, roomCode: String(roomCode),
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  async cancelSearch({ silent = false } = {}) {
    const ref = this.requestRef;
    const sessionId = this.sessionId;
    if (ref && sessionId) {
      try {
        await ref.update({ action: 'cancel', sessionId,
          updatedAt: firebase.database.ServerValue.TIMESTAMP });
        await ref.onDisconnect().cancel();
      } catch (error) {
        console.warn('[Matchmaking] cancellation could not be confirmed:', error?.message || error);
      }
    }
    const shouldEmit = !silent && this.isSearching && !this.matched;
    this._detach(true);
    if (shouldEmit) this.eventBus.emit('matchmaking:cancelled');
  }

  _detach(clearIdentity) {
    if (this.resultRef && this._resultHandler) {
      try { this.resultRef.off('value', this._resultHandler); } catch (_) {}
    }
    if (this.requestRef) {
      try { this.requestRef.onDisconnect().cancel(); } catch (_) {}
    }
    this.resultRef = null;
    this.requestRef = null;
    this._resultHandler = null;
    this.isSearching = false;
    if (clearIdentity) {
      this.sessionId = null;
      this.matchId = null;
      this.roomCode = null;
      this.tier = null;
      this.matched = false;
      this._matchedEmitted = false;
    }
  }
}

export default FirebaseMatchmaking;
