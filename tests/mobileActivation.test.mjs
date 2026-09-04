import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMobileActivation } from '../src/mobileActivation.js';

class FakeButton {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) {
    if (this.listeners.get(type) === callback) this.listeners.delete(type);
  }
  fire(type) {
    let prevented = false;
    this.listeners.get(type)?.({
      type,
      cancelable: true,
      preventDefault() { prevented = true; },
    });
    return prevented;
  }
}

test('one mobile tap activates once across pointer, touch and click events', () => {
  const button = new FakeButton();
  let time = 1000;
  let activations = 0;
  bindMobileActivation(button, () => { activations += 1; }, { now: () => time });

  assert.equal(button.fire('pointerup'), true);
  time += 10;
  button.fire('touchend');
  time += 10;
  button.fire('click');
  assert.equal(activations, 1);
});

test('touch-only and native click activation both work', () => {
  const button = new FakeButton();
  let time = 1000;
  let activations = 0;
  const unbind = bindMobileActivation(button, () => { activations += 1; }, { now: () => time });

  button.fire('touchend');
  time += 701;
  button.fire('click');
  assert.equal(activations, 2);

  unbind();
  assert.equal(button.listeners.size, 0);
});
