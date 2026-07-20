import CONFIG from './config.js';

class EffectsSystem {
  constructor() {
    this.particles = [];
    this.shake = { x: 0, y: 0, intensity: 0, duration: 0 };
    this.vignette = { color: '#000000', alpha: 0, duration: 0, active: false };
    this.audioCtx = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not available');
    }
    this.initialized = true;
  }

  // ==================== PARTICLES ====================
  spawnParticles(x, y, color, count, speed, life) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.5 + Math.random() * 0.5);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        life,
        maxLife: life,
        size: 2 + Math.random() * 4
      });
    }
  }

  spawnEatParticles(x, y, color) {
    this.spawnParticles(x, y, color, CONFIG.EFFECTS.EAT_PARTICLES, CONFIG.EFFECTS.EAT_PARTICLE_SPEED, CONFIG.EFFECTS.EAT_PARTICLE_LIFE);
    this.spawnParticles(x, y, '#ffffff', 3, 2, 200);
  }

  spawnDeathExplosion(x, y, color) {
    this.spawnParticles(x, y, color, CONFIG.EFFECTS.DEATH_PARTICLES, CONFIG.EFFECTS.DEATH_PARTICLE_SPEED, CONFIG.EFFECTS.DEATH_PARTICLE_LIFE);
    this.spawnParticles(x, y, '#ffaa00', 10, 4, 600);
    this.spawnParticles(x, y, '#ffffff', 5, 3, 400);
  }

  spawnKillSparkles(x, y, color) {
    this.spawnParticles(x, y, color, CONFIG.EFFECTS.KILL_SPARKLES, CONFIG.EFFECTS.KILL_SPARKLE_SPEED, CONFIG.EFFECTS.KILL_SPARKLE_LIFE);
    this.spawnParticles(x, y, '#ffffff', 6, 3, 400);
  }

  spawnImpactSparks(x, y, color) {
    this.spawnParticles(x, y, color, CONFIG.EFFECTS.IMPACT_SPARKS, CONFIG.EFFECTS.IMPACT_SPARK_SPEED, CONFIG.EFFECTS.IMPACT_SPARK_LIFE);
  }

  // ==================== SCREEN SHAKE ====================
  addShake(intensity, duration) {
    this.shake.intensity = Math.max(this.shake.intensity, intensity);
    this.shake.duration = Math.max(this.shake.duration, duration);
  }

  // ==================== VIGNETTE ====================
  flashVignette(color, alpha, duration) {
    this.vignette.color = color;
    this.vignette.alpha = Math.max(this.vignette.alpha, alpha);
    this.vignette.duration = Math.max(this.vignette.duration, duration);
    this.vignette.active = true;
  }

  // ==================== AUDIO ====================
  playTone(freq, type, duration, volume) {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(volume, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {}
  }

  playEatSound() {
    this.playTone(880, 'sine', 0.08, 0.12);
    setTimeout(() => this.playTone(1100, 'sine', 0.08, 0.08), 40);
  }

  playHeadCollisionSound() {
    this.playTone(120, 'sawtooth', 0.25, 0.2);
    this.playTone(60, 'square', 0.3, 0.15);
  }

  playDeathSound(isLocal) {
    if (isLocal) {
      this.playTone(300, 'sawtooth', 0.4, 0.2);
      setTimeout(() => this.playTone(200, 'sawtooth', 0.5, 0.2), 100);
      setTimeout(() => this.playTone(100, 'square', 0.6, 0.25), 250);
    } else {
      this.playTone(250, 'sawtooth', 0.3, 0.12);
      setTimeout(() => this.playTone(150, 'sawtooth', 0.4, 0.1), 120);
    }
  }

  playKillSound() {
    this.playTone(660, 'square', 0.1, 0.15);
    setTimeout(() => this.playTone(880, 'square', 0.15, 0.15), 80);
    setTimeout(() => this.playTone(1100, 'sine', 0.2, 0.12), 160);
  }

  // ==================== UPDATE & RENDER ====================
  update(deltaTime) {
    const dt = Math.min(deltaTime, 50);

    // Hard cap: never let particles pile up past 400 (multi-death bursts).
    // Drops oldest first. Bounds worst-case render cost per frame.
    if (this.particles.length > 400) {
      this.particles.splice(0, this.particles.length - 400);
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Shake
    if (this.shake.duration > 0) {
      this.shake.duration -= dt;
      this.shake.x = (Math.random() - 0.5) * this.shake.intensity * 2;
      this.shake.y = (Math.random() - 0.5) * this.shake.intensity * 2;
      this.shake.intensity *= Math.pow(CONFIG.EFFECTS.SHAKE_DECAY, dt / 16);
      if (this.shake.duration <= 0) {
        this.shake.x = 0;
        this.shake.y = 0;
        this.shake.intensity = 0;
        this.shake.duration = 0;
      }
    } else {
      this.shake.x = 0;
      this.shake.y = 0;
    }

    // Vignette
    if (this.vignette.active) {
      this.vignette.duration -= dt;
      this.vignette.alpha *= Math.pow(CONFIG.EFFECTS.VIGNETTE_DECAY, dt / 16);
      if (this.vignette.duration <= 0 || this.vignette.alpha < 0.01) {
        this.vignette.active = false;
        this.vignette.alpha = 0;
        this.vignette.duration = 0;
      }
    }
  }

  getShake() {
    return { x: this.shake.x, y: this.shake.y };
  }

  // Pre-rendered glow sprites, one per color, created once and reused.
  // This replaces ctx.shadowBlur (which forced a full blur render PER
  // PARTICLE PER FRAME - the main cause of lag/hangs on collisions).
  // drawImage of a tiny cached sprite is GPU-cheap and looks the same.
  _getGlowSprite(color) {
    if (!this._glowCache) this._glowCache = new Map();
    let sprite = this._glowCache.get(color);
    if (sprite) return sprite;
    sprite = document.createElement('canvas');
    sprite.width = 32;
    sprite.height = 32;
    const c = sprite.getContext('2d');
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const grad = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.35, `rgba(${r},${g},${b},0.5)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = grad;
    c.fillRect(0, 0, 32, 32);
    this._glowCache.set(color, sprite);
    return sprite;
  }

  renderParticles(ctx, camera) {
    for (const p of this.particles) {
      if (!camera.isInView(p.x, p.y, 30)) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      const sprite = this._getGlowSprite(p.color);
      const drawSize = p.size * 4 * alpha + 4;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
    }
    ctx.globalAlpha = 1;
  }

  renderVignette(ctx, canvas) {
    if (!this.vignette.active || this.vignette.alpha <= 0) return;
    // Cache the gradient per (color + canvas size) - creating a radial
    // gradient every frame is wasteful. Fade is applied via globalAlpha
    // so the cached gradient itself never needs rebuilding mid-flash.
    const key = this.vignette.color + '|' + canvas.width + 'x' + canvas.height;
    if (!this._vignetteCache) this._vignetteCache = { key: null, gradient: null };
    if (this._vignetteCache.key !== key) {
      const r = parseInt(this.vignette.color.slice(1, 3), 16);
      const g = parseInt(this.vignette.color.slice(3, 5), 16);
      const b = parseInt(this.vignette.color.slice(5, 7), 16);
      const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.width * 0.3,
        canvas.width / 2, canvas.height / 2, canvas.width * 0.9
      );
      gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},1)`);
      this._vignetteCache = { key, gradient };
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.vignette.alpha);
    ctx.fillStyle = this._vignetteCache.gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

export default EffectsSystem;
