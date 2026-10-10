const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/main.js'), 'utf8');
const methods = source.slice(source.indexOf('  async signUpWithEmail('), source.indexOf('  continueAsGuest()'));
const claim = source.slice(source.indexOf('  async claimUsername('), source.indexOf('  async getProfileStats()'));
const Game = vm.runInNewContext(`class Login { ${methods} ${claim} }; Login`, {
  firebase: { auth: { EmailAuthProvider: { credential: (email, password) => ({ email, password }) } } }
});
function fixture() {
  const game = new Game();
  game.auth = {};
  game.db = { ref: path => ({ once: async () => { assert.equal(path, 'users/existing/username'); return { exists: () => true, val: () => 'Player' }; } }) };
  game.uiManager = { showScreen: () => {}, showUsernameError: () => {}, showAuthError: () => {} };
  game.enterMainMenu = () => { game.entered = true; };
  game._friendlyAuthError = error => error.message;
  return game;
}
test('email login continues to use Firebase password sign-in directly', async () => {
  const game = fixture();
  game.auth.signInWithEmailAndPassword = async (email, password) => {
    assert.equal(email, 'player@example.com'); assert.equal(password, 'secret'); return { user: { uid: 'existing' } };
  };
  game._accountRequest = () => { throw new Error('Email login should not require backend'); };
  assert.equal((await game.signInWithEmail('player@example.com', 'secret')).success, true);
  assert.equal(game.authUid, 'existing'); assert.equal(game.entered, true);
});
test('username login sends identifier/password privately and signs into returned UID', async () => {
  const game = fixture();
  game._accountRequest = async (path, body) => {
    assert.equal(path, '/auth/username-login'); assert.equal(body.identifier, 'Player'); assert.equal(body.password, 'secret'); return { customToken: 'private-token' };
  };
  game.auth.signInWithCustomToken = async token => { assert.equal(token, 'private-token'); return { user: { uid: 'existing' } }; };
  assert.equal((await game.signInWithEmail('Player', 'secret')).success, true);
  assert.equal(game.authUid, 'existing'); assert.equal(game.isGuest, false);
});
test('guest registration links the active UID rather than creating a replacement', async () => {
  const game = fixture();
  game.auth.currentUser = { isAnonymous: true, linkWithCredential: async credential => {
    assert.equal(credential.email, 'player@example.com');
    return { user: { uid: 'guest-existing', sendEmailVerification: async () => {} } };
  } };
  game.auth.createUserWithEmailAndPassword = () => { throw new Error('Must preserve guest UID'); };
  game.claimUsername = async () => ({ success: true });
  assert.equal((await game.signUpWithEmail('player@example.com', 'secret', 'Player')).success, true);
  assert.equal(game.authUid, 'guest-existing');
});
test('username claim delegates authenticated write without resetting profile locally', async () => {
  const game = fixture(); game.authUid = 'existing';
  game.db.ref = () => { throw new Error('Must not rewrite defaults locally'); };
  game._accountRequest = async (path, body, authenticated) => {
    assert.equal(path, '/auth/claim-username'); assert.equal(body.username, 'Player'); assert.equal(authenticated, true); return { username: 'Player' };
  };
  assert.equal((await game.claimUsername('Player')).success, true);
});
