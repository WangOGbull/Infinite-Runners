import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_SYNC,
  classifyRemoteSnapshot,
  getRemoteRenderTiming,
  isConfirmedRemoteRespawn,
} from '../src/remoteSync.js';

const state = (overrides = {}) => ({
  x: 100,
  y: 200,
  streamId: 'stream-a',
  seq: 1,
  t: 1000,
  ...overrides,
});

test('accepts the first valid snapshot', () => {
  const result = classifyRemoteSnapshot(null, state());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.cursor, { streamId: 'stream-a', seq: 1, t: 1000 });
});

test('rejects duplicate and reordered packets in one stream', () => {
  const previous = { streamId: 'stream-a', seq: 8, t: 1800 };
  assert.equal(classifyRemoteSnapshot(previous, state({ seq: 8, t: 1900 })).accepted, false);
  assert.equal(classifyRemoteSnapshot(previous, state({ seq: 7, t: 2000 })).accepted, false);
});

test('accepts a newer browser stream even when its sequence restarts', () => {
  const previous = { streamId: 'stream-a', seq: 80, t: 5000 };
  const result = classifyRemoteSnapshot(previous, state({
    streamId: 'stream-b',
    seq: 1,
    t: 5100,
  }));
  assert.equal(result.accepted, true);
});

test('rejects an old Firebase stream replay after transport fallback', () => {
  const previous = { streamId: 'stream-b', seq: 5, t: 6000 };
  const result = classifyRemoteSnapshot(previous, state({
    streamId: 'stream-a',
    seq: 90,
    t: 5900,
  }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'stale_stream');
});

test('rejects malformed coordinates before they reach the renderer', () => {
  assert.equal(classifyRemoteSnapshot(null, state({ x: Number.NaN })).accepted, false);
  assert.equal(classifyRemoteSnapshot(null, state({ y: undefined })).accepted, false);
});

test('render timing covers missed packets but remains bounded', () => {
  assert.deepEqual(getRemoteRenderTiming(50, 0), {
    interpolationMs: REMOTE_SYNC.minInterpolationMs,
    extrapolationMs: REMOTE_SYNC.minExtrapolationMs,
  });
  assert.deepEqual(getRemoteRenderTiming(1000, 1000), {
    interpolationMs: REMOTE_SYNC.maxInterpolationMs,
    extrapolationMs: REMOTE_SYNC.maxExtrapolationMs,
  });
});

test('respawn requires a confirmed lower life and no pending death', () => {
  const valid = {
    reportedAlive: true,
    reportedLives: 2,
    deathLives: 3,
    pendingDeath: false,
  };
  assert.equal(isConfirmedRemoteRespawn(valid), true);
  assert.equal(isConfirmedRemoteRespawn({ ...valid, reportedLives: 3 }), false);
  assert.equal(isConfirmedRemoteRespawn({ ...valid, reportedAlive: false }), false);
  assert.equal(isConfirmedRemoteRespawn({ ...valid, pendingDeath: true }), false);
  assert.equal(isConfirmedRemoteRespawn({ ...valid, reportedLives: 0 }), false);
});
