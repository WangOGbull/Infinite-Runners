import { REMOTE_SYNC } from './remoteSync.js';

export const REMOTE_SYNC = Object.freeze({
  websocketSendMs: 50,
  firebaseSendMs: 100,
  minInterpolationMs: 80,
  maxInterpolationMs: 220,
  minExtrapolationMs: 100,
  maxExtrapolationMs: 350,
});

export function classifyRemoteSnapshot(previous, state) {
  if (!state || !Number.isFinite(Number(state.x)) || !Number.isFinite(Number(state.y))) {
    return { accepted: false, reason: 'invalid_position' };
  }

  const seq = Number(state.seq);
  const t = Number(state.t || 0);
  const streamId = typeof state.streamId === 'string' ? state.streamId : '';
  const cursor = {
    streamId,
    seq: Number.isFinite(seq) ? seq : null,
    t: Number.isFinite(t) ? t : 0,
  };

  if (!previous) return { accepted: true, cursor };

  const sameStream = !!(
    streamId
    && previous.streamId
    && streamId === previous.streamId
  );

  if (sameStream) {
    if (!Number.isFinite(seq) || (Number.isFinite(previous.seq) && seq <= previous.seq)) {
      return { accepted: false, reason: 'stale_sequence' };
    }
    return { accepted: true, cursor };
  }

  // A browser refresh creates a new stream and resets its sequence. Its wall
  // clock still advances, allowing the new stream while rejecting replayed
  // Firebase children from the old stream during a transport fallback.
  if (Number.isFinite(previous.t) && previous.t > 0 && (!Number.isFinite(t) || t <= previous.t)) {
    return { accepted: false, reason: 'stale_stream' };
  }

  return { accepted: true, cursor };
}

export function getRemoteRenderTiming(packetInterval, packetJitter) {
  const interval = Number.isFinite(Number(packetInterval))
    ? Number(packetInterval)
    : REMOTE_SYNC.firebaseSendMs;
  const jitter = Number.isFinite(Number(packetJitter))
    ? Math.max(0, Number(packetJitter))
    : 0;

  return {
    interpolationMs: Math.max(
      REMOTE_SYNC.minInterpolationMs,
      Math.min(REMOTE_SYNC.maxInterpolationMs, interval + jitter * 2)
    ),
    extrapolationMs: Math.max(
      REMOTE_SYNC.minExtrapolationMs,
      Math.min(REMOTE_SYNC.maxExtrapolationMs, interval * 1.5 + jitter * 2)
    ),
  };
}

export function isConfirmedRemoteRespawn({
  reportedAlive,
  reportedLives,
  deathLives,
  pendingDeath,
}) {
  return reportedAlive === true
    && pendingDeath !== true
    && Number.isFinite(Number(reportedLives))
    && Number.isFinite(Number(deathLives))
    && Number(reportedLives) < Number(deathLives)
    && Number(reportedLives) > 0;
}
