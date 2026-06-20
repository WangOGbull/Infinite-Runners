import CONFIG from './config.js';

class MovementSystem {
  constructor() {
    this.inputAngles = new Map();
    this.boosting = new Map();

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
        this.setBoost('local', true);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') {
        this.setBoost('local', false);
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
    });
    window.addEventListener('mousedown', () => this.setBoost('local', true));
    window.addEventListener('mouseup', () => this.setBoost('local', false));

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
        this.setBoost('local', true);
      }, { passive: false });
      const endBoost = (e) => {
        e.preventDefault();
        this.setBoost('local', false);
      };
      boostBtn.addEventListener('touchend', endBoost);
      boostBtn.addEventListener('touchcancel', endBoost);
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

  update(dragonManager, camera, deltaTime) {
    // Set boost flags only — movement is handled in main.js via dragonManager.update()
    for (const dragon of dragonManager.getLivingDragons()) {
      dragon.boostActive = !!this.boosting.get(dragon.id) || !!this.boosting.get('local');
    }
    this.updateJoystickVisual();
  }
}

export default MovementSystem;
