import CONFIG from './config.js';

class MovementSystem {
  constructor() {
    this.inputAngles = new Map();
    this.boosting = new Map();
    this.attackQueued = false; // edge-triggered attack request (button/Space/click)

    this.joystickActive = false;
    this.joystickCenter = { x: 0, y: 0 };
    this.joystickCurrent = { x: 0, y: 0 };

    this.mousePos = { x: 0, y: 0 };
    this.keys = new Set();

    this.setupInputs();
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        this.attackQueued = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('mousemove', (e) => {
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
    });
    window.addEventListener('mousedown', () => { this.attackQueued = true; });

    const joyArea = document.getElementById('joyArea');
    const boostBtn = document.getElementById('boostBtn');

    if (joyArea) {
      joyArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = joyArea.getBoundingClientRect();
        this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        this.joystickCurrent = { x: touch.clientX, y: touch.clientY };
        this.joystickActive = true;
        this.updateJoystickVisual();
      }, { passive: false });

      joyArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!this.joystickActive) return;
        const touch = e.touches[0];
        this.joystickCurrent = { x: touch.clientX, y: touch.clientY };
        this.updateJoystickVisual();
      }, { passive: false });

      const endJoystick = (e) => {
        e.preventDefault();
        this.joystickActive = false;
        this.updateJoystickVisual();
      };
      joyArea.addEventListener('touchend', endJoystick);
      joyArea.addEventListener('touchcancel', endJoystick);
    }

    if (boostBtn) {
      boostBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.attackQueued = true;
      }, { passive: false });
    }
  }

  updateJoystickVisual() {
    const knob = document.getElementById('joyKnob');
    if (!knob) return;

    if (!this.joystickActive) {
      knob.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const maxDist = 25;
    const dx = this.joystickCurrent.x - this.joystickCenter.x;
    const dy = this.joystickCurrent.y - this.joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);

    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }

  setBoost(dragonId, active) {
    this.boosting.set(dragonId, active);
  }

  // Returns true once if an attack was requested since the last call.
  // The attack system (dragonManager.activateAttack) owns boostActive now.
  consumeAttackRequest() {
    const queued = this.attackQueued;
    this.attackQueued = false;
    return queued;
  }

  getInputAngle(dragonId, headX, headY, camera) {
    if (this.joystickActive) {
      const dx = this.joystickCurrent.x - this.joystickCenter.x;
      const dy = this.joystickCurrent.y - this.joystickCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 5) {
        return Math.atan2(dy, dx);
      }
    }

    const screenPos = camera.worldToScreen(headX, headY);
    const dx = this.mousePos.x - screenPos.x;
    const dy = this.mousePos.y - screenPos.y;
    return Math.atan2(dy, dx);
  }

  // boostActive is owned by the attack system (dragonManager.activateAttack)
  // and by network sync for remote dragons - this system only queues attack
  // requests and feeds movement angles.
  update(dragonManager, camera, deltaTime) {
    this.updateJoystickVisual();
  }
}

export default MovementSystem;
