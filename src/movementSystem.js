import CONFIG from './config.js';

class MovementSystem {
  constructor() {
    this.inputAngles = new Map();
    this.boosting = new Map();
    this.attackHeld = false;

    this.joystickActive = false;
    this.joystickCenter = { x: 0, y: 0 };
    this.joystickCurrent = { x: 0, y: 0 };
    this.joystickPointerId = null;

    this.mousePos = { x: 0, y: 0 };
    this.hasMouseInput = false;
    this.lastAngle = 0;
    this.keys = new Set();

    this.setupInputs();
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);

      if (e.code === 'Space') {
        e.preventDefault();
        this.attackHeld = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);

      if (e.code === 'Space') {
        this.attackHeld = false;
      }
    });

    window.addEventListener('blur', () => {
      this.attackHeld = false;
      this.endJoystick();
    });

    window.addEventListener('mousemove', (e) => {
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
      this.hasMouseInput = true;
    });

    window.addEventListener('mousedown', (e) => {
      if (
        e.button === 0 &&
        !e.target.closest('#joyArea, #boostBtn, #sprintBtn')
      ) {
        this.attackHeld = true;
      }
    });

    window.addEventListener('mouseup', () => {
      this.attackHeld = false;
    });

    const joyArea = document.getElementById('joyArea');
    const boostBtn = document.getElementById('boostBtn');

    // ================================================================
    // REAL ANALOG JOYSTICK
    // ================================================================

    if (joyArea) {
      joyArea.style.touchAction = 'none';

      joyArea.addEventListener(
        'pointerdown',
        (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if (this.joystickActive) return;

          e.preventDefault();

          const rect = joyArea.getBoundingClientRect();

          this.joystickCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };

          this.joystickCurrent = {
            x: e.clientX,
            y: e.clientY
          };

          this.joystickPointerId = e.pointerId;
          this.joystickActive = true;

          try {
            joyArea.setPointerCapture(e.pointerId);
          } catch (_) {}

          this.updateJoystickVisual();
        },
        { passive: false }
      );

      joyArea.addEventListener(
        'pointermove',
        (e) => {
          if (
            !this.joystickActive ||
            e.pointerId !== this.joystickPointerId
          ) {
            return;
          }

          e.preventDefault();

          this.joystickCurrent = {
            x: e.clientX,
            y: e.clientY
          };

          this.updateJoystickVisual();
        },
        { passive: false }
      );

      const endJoystickPointer = (e) => {
        if (
          this.joystickPointerId !== null &&
          e.pointerId !== this.joystickPointerId
        ) {
          return;
        }

        e.preventDefault();
        this.endJoystick();
      };

      joyArea.addEventListener(
        'pointerup',
        endJoystickPointer,
        { passive: false }
      );

      joyArea.addEventListener(
        'pointercancel',
        endJoystickPointer,
        { passive: false }
      );

      joyArea.addEventListener('lostpointercapture', () => {
        if (this.joystickActive) {
          this.endJoystick();
        }
      });
    }

    // ================================================================
    // ATTACK BUTTON
    // ================================================================

    if (boostBtn) {
      boostBtn.style.touchAction = 'none';

      const pressAttack = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        e.preventDefault();

        this.attackHeld = true;
        boostBtn.classList.add('attack-active');

        try {
          boostBtn.setPointerCapture(e.pointerId);
        } catch (_) {}
      };

      const releaseAttack = (e) => {
        e.preventDefault();

        this.attackHeld = false;
        boostBtn.classList.remove('attack-active');
      };

      boostBtn.addEventListener(
        'pointerdown',
        pressAttack,
        { passive: false }
      );

      boostBtn.addEventListener(
        'pointerup',
        releaseAttack,
        { passive: false }
      );

      boostBtn.addEventListener(
        'pointercancel',
        releaseAttack,
        { passive: false }
      );

      boostBtn.addEventListener('lostpointercapture', () => {
        this.attackHeld = false;
        boostBtn.classList.remove('attack-active');
      });
    }
  }

  endJoystick() {
    this.joystickActive = false;
    this.joystickPointerId = null;
    this.joystickCurrent = { ...this.joystickCenter };

    this.updateJoystickVisual();
  }

  updateJoystickVisual() {
    const knob = document.getElementById('joyKnob');
    const joyArea = document.getElementById('joyArea');

    if (!knob || !joyArea) return;

    if (!this.joystickActive) {
      knob.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const maxDist = 40;

    const dx =
      this.joystickCurrent.x -
      this.joystickCenter.x;

    const dy =
      this.joystickCurrent.y -
      this.joystickCenter.y;

    const dist = Math.sqrt(
      dx * dx + dy * dy
    );

    if (dist <= 0.001) {
      knob.style.transform =
        'translate(-50%, -50%)';

      return;
    }

    const clampedDist =
      Math.min(dist, maxDist);

    const angle =
      Math.atan2(dy, dx);

    const kx =
      Math.cos(angle) *
      clampedDist;

    const ky =
      Math.sin(angle) *
      clampedDist;

    knob.style.transform =
      `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }

  setBoost(dragonId, active) {
    this.boosting.set(dragonId, active);
  }

  isAttackHeld() {
    return this.attackHeld;
  }

  getInputAngle(
    dragonId,
    headX,
    headY,
    camera
  ) {
    if (this.joystickActive) {
      const dx =
        this.joystickCurrent.x -
        this.joystickCenter.x;

      const dy =
        this.joystickCurrent.y -
        this.joystickCenter.y;

      const dist =
        Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        this.lastAngle =
          Math.atan2(dy, dx);

        return this.lastAngle;
      }

      return this.lastAngle;
    }

    if (this.hasMouseInput) {
      const screenPos =
        camera.worldToScreen(
          headX,
          headY
        );

      const dx =
        this.mousePos.x -
        screenPos.x;

      const dy =
        this.mousePos.y -
        screenPos.y;

      this.lastAngle =
        Math.atan2(dy, dx);

      return this.lastAngle;
    }

    return this.lastAngle;
  }

  update(
    dragonManager,
    camera,
    deltaTime
  ) {
    this.updateJoystickVisual();
  }
}

export default MovementSystem;
