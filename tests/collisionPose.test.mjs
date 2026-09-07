import test from 'node:test';
import assert from 'node:assert/strict';

import CollisionSystem from '../src/collisionSystem.js';

function makeDragon({
  id,
  x,
  y = 0,
  segments = 5,
  isRemote = false,
  collisionX = null,
  attackActive = false,
}) {
  return {
    id,
    playerId: id,
    alive: true,
    immunityTimer: 0,
    isRemote,
    networkCollisionHead: Number.isFinite(collisionX)
      ? { x: collisionX, y, receivedAt: performance.now(), predictionMs: 0 }
      : null,
    head: { x, y },
    segments: Array.from({ length: segments }, (_, index) => ({
      x: x - (index + 1) * 12,
      y,
    })),
    attackActive,
    angle: 0,
    collisionRecoilX: 0,
    collisionRecoilY: 0,
  };
}

function createSystem() {
  const events = [];
  const system = new CollisionSystem({
    emit(type, payload) {
      events.push({ type, payload });
    },
  });
  return { system, events };
}

test('authoritative combat uses the current remote network pose', () => {
  const { system, events } = createSystem();
  const attacker = makeDragon({
    id: 'host',
    x: 0,
    segments: 10,
    attackActive: true,
  });
  const remote = makeDragon({
    id: 'remote',
    x: 1000,
    segments: 5,
    isRemote: true,
    collisionX: 10,
  });

  system.checkDragonCollisions(attacker, remote, true);

  const death = events.find(event => event.type === 'dragon:death');
  assert.ok(death, 'network pose should produce a collision');
  assert.equal(death.payload.dragon, remote);
  assert.equal(death.payload.killer, attacker);
  assert.equal(remote.head.x, 1000, 'rendered pose must remain untouched');
});

test('an old rendered overlap does not create a network-pose collision', () => {
  const { system, events } = createSystem();
  const local = makeDragon({ id: 'host', x: 0, segments: 10 });
  const remote = makeDragon({
    id: 'remote',
    x: 10,
    segments: 5,
    isRemote: true,
    collisionX: 1000,
  });

  system.checkDragonCollisions(local, remote, true);

  assert.equal(
    events.some(event => event.type === 'dragon:death'),
    false,
  );
});
