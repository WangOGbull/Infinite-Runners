import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REMOTE_SYNC } from '../src/remoteSync.js';

const [main, html] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

test('realtime movement is 20 Hz with a slower fallback', () => {
  assert.equal(REMOTE_SYNC.websocketSendMs, 50);
  assert.equal(REMOTE_SYNC.firebaseSendMs, 100);
});

test('transport-ready handoff does not erase remote state', () => {
  const readyStart = main.indexOf("if (message.type === 'ready')");
  const readyEnd = main.indexOf("if (message.type === 'combat'", readyStart);
  const readyHandler = main.slice(readyStart, readyEnd);
  assert.ok(readyStart >= 0 && readyEnd > readyStart);
  assert.doesNotMatch(readyHandler, /_remotePosCache\s*=/);
  assert.doesNotMatch(readyHandler, /_lastRemoteSequences\.clear/);
});

test('menu recovery contains only valid selectors and real button ids', () => {
  assert.doesNotMatch(main, /:contains\(/);
  for (const id of ['btnMainMenu', 'btnMpMainMenu']) {
    assert.match(main, new RegExp(`#${id}\\b`));
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('movement application cannot directly hide a living remote dragon', () => {
  const applyStart = main.indexOf('  applyRemotePositions()');
  const applyEnd = main.indexOf('  _resizeRemoteDragon(', applyStart);
  const applyBody = main.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.doesNotMatch(applyBody, /dragon\.alive\s*=\s*false/);
});
