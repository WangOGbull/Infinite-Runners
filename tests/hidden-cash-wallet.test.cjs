const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const method = source.slice(source.indexOf('  async _ensureHiddenCashWallet('), source.indexOf('  async _accountRequest('));
function fixture(fetchImpl) {
  const Game = vm.runInNewContext(`class Game { ${method} }; Game`, {
    fetch: fetchImpl, BACKEND_URL: 'https://example.test', AbortSignal
  });
  return new Game();
}
test('anonymous guests never request wallet allocation or a token', async () => {
  const game = fixture(() => { throw new Error('Guest must not make request'); });
  await game._ensureHiddenCashWallet({ uid: 'guest', isAnonymous: true, getIdToken: () => { throw new Error('No token request'); } });
  assert.equal(game._cashWalletRequestedUid, undefined);
});
test('registered player silently sends bearer proof, no address or client UID', async () => {
  let count = 0;
  const game = fixture(async (url, options) => {
    count++; assert.equal(url, 'https://example.test/cash-wallet/ensure');
    assert.equal(options.headers.Authorization, 'Bearer proof'); assert.equal(options.body, undefined);
    return { ok: true };
  });
  const user = { uid: 'same-player', isAnonymous: false, getIdToken: async refresh => { assert.equal(refresh, true); return 'proof'; } };
  await game._ensureHiddenCashWallet(user); await game._ensureHiddenCashWallet(user);
  assert.equal(count, 1);
});
test('backend outage never throws or blocks gameplay and permits a later retry', async () => {
  let count = 0;
  const game = fixture(async () => { count++; throw new Error('outage'); });
  const user = { uid: 'player', isAnonymous: false, getIdToken: async () => 'proof' };
  await game._ensureHiddenCashWallet(user); assert.equal(game._cashWalletRequestedUid, null);
  await game._ensureHiddenCashWallet(user); assert.equal(count, 2);
});
