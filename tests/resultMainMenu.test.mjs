import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, ui, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/uiManager.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('there is no global emoji back button', () => {
  assert.doesNotMatch(html, /id=["']btnBack["']/);
  assert.doesNotMatch(html, /↩️/);
  assert.doesNotMatch(main, /_initBackButton/);
});

test('Main Menu button exists only inside the game-over screen', () => {
  const gameOverStart = html.indexOf('id="gameOverScreen"');
  const nextScreen = html.indexOf('class="screen"', gameOverStart + 30);
  const gameOverMarkup = html.slice(gameOverStart, nextScreen);
  assert.ok(gameOverStart >= 0 && nextScreen > gameOverStart);
  assert.equal((html.match(/id="btnMainMenu"/g) || []).length, 1);
  assert.match(gameOverMarkup, /<a[^>]+id="btnMainMenu"[^>]+href="\/"/);
  assert.match(gameOverMarkup, /data-native-main-menu="true"/);
  assert.match(gameOverMarkup, /data-lucide="home"/);
  assert.match(css, /#gameOverScreen:not\(\.active\) #btnMainMenu/);
});

test('Main Menu uses a dedicated mobile activation path', () => {
  assert.doesNotMatch(ui, /bindMainMenu\(document\.getElementById\('btnMainMenu'\)\)/);
  assert.match(ui, /bindMainMenu\(document\.getElementById\('btnMpMainMenu'\)\)/);
  assert.match(html, /id="btnMainMenu"[^>]+href="\/"/);
  assert.doesNotMatch(html, /id="btnMainMenu"[^>]+onclick=/);
  assert.doesNotMatch(ui, /bindMobileActivation/);
  assert.match(ui, /this\.eventBus\.emit\('game:returnToMainMenu'\)/);
  assert.match(main, /this\.eventBus\.on\('game:returnToMainMenu'/);
  assert.match(main, /this\._returnToMainMenuSafely\(\)/);
  assert.match(main, /Multiplayer result-screen preparation/);
  assert.match(main, /this\.movementSystem\?\.endJoystick\?\.\(\)/);
  assert.doesNotMatch(main, /releasePointerCapture/);
  assert.match(css, /#gameOverScreen\.active\{z-index:5000!important;pointer-events:auto!important\}/);
  assert.match(html, /id="btnMainMenu"[^>]+data-native-main-menu="true"/);
});
