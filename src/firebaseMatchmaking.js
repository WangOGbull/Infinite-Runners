// firebaseMatchmaking.js
//
// Drop-in replacement for the Photon matchmaking system. Photon's JS SDK
// kept disconnecting each client from the Master server right after it
// created a room, so two searchers never coexisted in the lobby to find
// each other ("keeps searching" / "game peer timeout"). Firebase is what
// this game already uses for every room, staking, and settlement - so we
// reuse it for automatic matchmaking too. No Photon, no CCU limit, no
// second service.
//
// HOW IT WORKS (queue-and-pair):
//   matchmaking/{tier}/{ticketId} holds one waiting player.
//   - On search, a player runs a TRANSACTION on the tier's queue:
//       * if another player's ticket is already waiting -> claim it,
//         removing it atomically. The claimer becomes the OPPONENT and
//         the claimed waiter is the HOST-to-be. We hand the pairing back
//         through the normal room flow: the waiter (host) is told to
//         create the room; the claimer (opponent) joins it once the
//         waiter writes the room code into the ticket.
//       * else -> write our own ticket and WAIT to be claimed.
//   - The transaction guarantees only ONE player can claim a given
//     waiter, so two simultaneous searchers can't both create rooms.
//
// This module preserves the exact public interface main.js expects:
//   startSearch(tier), cancelSearch(), announceRoomReady(roomCode)
// and emits: matchmaking:matched { roomCode, isInitiator, tier }
//            matchmaking:cancelled, matchmaking:error

const MATCH_TIMEOUT_MS = 90000; // stop waiting after 90s with no opponent
const STALE_TICKET_MS = 60000;  // ignore/replace tickets older than this

class FirebaseMatchmaking {
  constructor(eventBus, db, opts = {}) {
    this.eventBus = eventBus;
    this.db = db; // firebase.database() instance, same one main.js uses
    this.getIdentity = opts.getIdentity || (() => ({ uid: 'anon_' + Math.random().toString(36).slice(2), name: 'Player' }));

    this.tier = null;
    this.ticketId = null;
    this.ticketRef = null;
    this.queueRef = null;
    this.isSearching = false;
    this.iAmInitiator = false;   // true if WE are the waiter/host-to-be
    this.matched = false;
    this._timeoutTimer = null;
    this._roomWatchRef = null;
  }

  async startSearch(tier) {
    if (this.isSearching) this.cancelSearch();
    if (!this.db) { this.eventBus.emit('matchmaking:error', { message: 'Matchmaking unavailable (no database).' }); return; }

    this.tier = tier;
    this.isSearching = true;
    this.matched = false;
    this.iAmInitiator = false;

    const id = this.getIdentity();
    this.myUid = id.uid;
    this.queueRef = this.db.ref('matchmaking/' + tier);

    // Try to CLAIM an existing waiter atomically. If we succeed, we're the
    // opponent and they're the host. If nobody's there, we enqueue ourselves.
    let claimed = null;
    try {
      const txResult = await this.queueRef.transaction((queue) => {
        if (!queue) return queue; // empty - abort tx, we'll enqueue below
        const now = Date.now();
        // find the oldest non-stale ticket that isn't ours
        const ids = Object.keys(queue).sort((a, b) => (queue[a].ts || 0) - (queue[b].ts || 0));
        for (const tid of ids) {
          const t = queue[tid];
          if (!t) continue;
          if (t.uid === this.myUid) continue;                 // never match ourselves
          if (now - (t.ts || 0) > STALE_TICKET_MS) continue;  // skip stale, don't claim
          if (t.claimed) continue;                            // already taken
          // claim it: mark it so the waiter learns their opponent arrived
          queue[tid].claimed = true;
          queue[tid].claimedBy = this.myUid;
          return queue;
        }
        return queue; // nothing claimable - abort (we enqueue below)
      });

      // Determine whether our transaction actually claimed anyone.
      if (txResult.committed && txResult.snapshot.exists()) {
        const q = txResult.snapshot.val() || {};
        const mine = Object.keys(q).find(tid => q[tid] && q[tid].claimed && q[tid].claimedBy === this.myUid);
        if (mine) { claimed = { ticketId: mine, ticket: q[mine] }; }
      }
    } catch (err) {
      // transaction error - fall through to enqueue as waiter
      console.warn('[Matchmaking] claim transaction failed, enqueueing instead:', err?.message || err);
    }

    if (!this.matched && claimed) {
      // WE are the opponent. The claimed player (host) will create the room
      // and write its code back into their ticket. Watch that ticket for the
      // room code, then join.
      this.matched = true;
      this.iAmInitiator = false;
      const hostTicketRef = this.queueRef.child(claimed.ticketId);
      this._roomWatchRef = hostTicketRef;
      console.log('[Matchmaking] claimed a waiting host - awaiting room code');
      hostTicketRef.on('value', (snap) => {
        const t = snap.val();
        if (t && t.roomCode) {
          hostTicketRef.off('value');
          // clean the ticket now that both sides have the code
          hostTicketRef.remove().catch(() => {});
          this._finishMatched(t.roomCode, false);
        }
      });
      // Safety timeout: if the host never writes a code (they vanished),
      // fail cleanly rather than hang.
      this._armTimeout();
      return;
    }

    // Nobody to claim - enqueue OURSELVES and wait to be claimed.
    this.iAmInitiator = true;
    this.ticketRef = this.queueRef.push();
    this.ticketId = this.ticketRef.key;
    await this.ticketRef.set({ uid: this.myUid, name: id.name || 'Player', ts: Date.now(), claimed: false });
    // Auto-remove our ticket if we disconnect mid-search.
    this.ticketRef.onDisconnect().remove();
    console.log('[Matchmaking] enqueued as host-to-be, waiting for an opponent');

    // Watch our own ticket: when someone claims it, WE create the room and
    // write the code back so they can join.
    this.ticketRef.on('value', (snap) => {
      const t = snap.val();
      if (t && t.claimed && !this.matched) {
        this.matched = true;
        console.log('[Matchmaking] our ticket was claimed - creating room');
        // main.js will create the room and call announceRoomReady() with the
        // code, which we write back into the ticket for the opponent.
        this._finishMatched(null, true);
      }
    });

    this._armTimeout();
  }

  // Emits matched. For the initiator (host), roomCode is null here - main.js
  // creates the room then calls announceRoomReady() with the real code.
  _finishMatched(roomCode, isInitiator) {
    this.isSearching = false;
    this._clearTimeout();
    this.eventBus.emit('matchmaking:matched', { roomCode, isInitiator, tier: this.tier });
  }

  // Called by main.js after the initiator creates the room. Writes the code
  // into our ticket so the claiming opponent (watching it) can join.
  announceRoomReady(roomCode) {
    if (this.ticketRef) {
      this.ticketRef.update({ roomCode }).catch(() => {});
      // ticket is cleaned up by the opponent once they read the code; also
      // cancel the onDisconnect removal so it isn't yanked mid-handoff.
      this.ticketRef.onDisconnect().cancel();
    }
  }

  _armTimeout() {
    this._clearTimeout();
    this._timeoutTimer = setTimeout(() => {
      if (!this.matched) {
        console.log('[Matchmaking] timed out with no opponent');
        this.cancelSearch();
        this.eventBus.emit('matchmaking:error', { message: 'No opponent found at this stake. Try again or invite a friend with Create Room.' });
      }
    }, MATCH_TIMEOUT_MS);
  }

  _clearTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
  }

  cancelSearch() {
    this.isSearching = false;
    this._clearTimeout();
    if (this.ticketRef) {
      try { this.ticketRef.off('value'); } catch (_) {}
      this.ticketRef.remove().catch(() => {});
      try { this.ticketRef.onDisconnect().cancel(); } catch (_) {}
      this.ticketRef = null;
    }
    if (this._roomWatchRef) {
      try { this._roomWatchRef.off('value'); } catch (_) {}
      this._roomWatchRef = null;
    }
    this.ticketId = null;
    if (!this.matched) this.eventBus.emit('matchmaking:cancelled');
  }
}

export default FirebaseMatchmaking;
