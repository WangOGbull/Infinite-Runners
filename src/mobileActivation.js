// Reliable activation for controls that must work after a canvas-heavy game.
// pointerup handles current Android/iOS browsers, touchend covers older Safari,
// and click preserves keyboard/accessibility activation. One physical tap can
// generate more than one event, so the callback is de-duplicated.
export function bindMobileActivation(element, callback, options = {}) {
  if (!element || typeof callback !== 'function') return () => {};

  const dedupeMs = Number.isFinite(options.dedupeMs) ? options.dedupeMs : 700;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  let lastActivation = -Infinity;

  const activate = (event) => {
    const timestamp = now();
    if (timestamp - lastActivation < dedupeMs) {
      if (event?.cancelable) event.preventDefault();
      return;
    }

    lastActivation = timestamp;
    if (event?.cancelable) event.preventDefault();
    callback(event);
  };

  element.addEventListener('pointerup', activate);
  element.addEventListener('touchend', activate, { passive: false });
  element.addEventListener('click', activate);

  return () => {
    element.removeEventListener('pointerup', activate);
    element.removeEventListener('touchend', activate);
    element.removeEventListener('click', activate);
  };
}
