import CONFIG from './config.js';

class EffectsSystem {
  constructor() {
    this.particles = [];
    this.shake = { x: 0, y: 0, intensity: 0, decay: 0.9 };
    this.vignette = { color: '#000000', intensity: 0, decay: 0.92 };
    this.maxParticles = 500;
  }

  init() {
    this.particles = [];
    this.shake.intensity = 0;
    this.vignette.intensity = 0;
  }

  _addParticle(x, y, color, speed, life, size = 2) {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift();
    }
    const angle = Math.random() * Math.PI * 2;
    const vel = Math.random() * speed;
    this.particles.push({
      x, y,
      vx: Math.cos(angle) * vel,
      vy: Math.sin(angle) * vel,
      life, maxLife: life,
      color, size,
      active: true
    });
  }

  spawnEatParticles(x, y, color) {
    const count = CONFIG.EFFECTS.EAT_PARTICLES || 8;
    const speed = CONFIG.EFFECTS.EAT_PARTICLE_SPEED || 3;
    const life = CONFIG.EFFECTS.EAT_PARTICLE_LIFE || 400;
    for (let i = 0; i < count; i++) this._addParticle(x, y, color, speed, life);
  }

  spawnDeathExplosion(x, y, color) {
    const count = CONFIG.EFFECTS.DEATH_PARTICLES || 30;
    const speed = CONFIG.EFFECTS.DEATH_PARTICLE_SPEED || 6;
    const life = CONFIG.EFFECTS.DEATH_PARTICLE_LIFE || 800;
    for (let i = 0; i < count; i++) this._addParticle(x, y, color, speed, life, 3 + Math.random() * 2);
  }

  spawnImpactSparks(x, y, color) {
    const count = CONFIG.EFFECTS.IMPACT_SPARKS || 10;
    const speed = CONFIG.EFFECTS.IMPACT_SPARK_SPEED || 5;
    const life = CONFIG.EFFECTS.IMPACT_SPARK_LIFE || 300;
    for (let i = 0; i < count; i++) this._addParticle(x, y, color, speed, life);
  }

  spawnKillSparkles(x, y, color) {
    const count = CONFIG.EFFECTS.KILL_SPARKLES || 12;
    const speed = CONFIG.EFFECTS.KILL_SPARKLE_SPEED || 4;
    const life = CONFIG.EFFECTS.KILL_SPARKLE_LIFE || 600;
    for (let i = 0; i < count; i++) this._addParticle(x, y, color, speed, life, 2 + Math.random() * 2);
  }

  spawnParticles(x, y, color, count, speed, life) {
    for (let i = 0; i < count; i++) this._addParticle(x, y, color, speed, life);
  }

  addShake(amount, duration) {
    this.shake.intensity = Math.min(this.shake.intensity + amount, 30);
    this.shake.decay = CONFIG.EFFECTS.SHAKE_DECAY || 0.9;
  }

  flashVignette(color, intensity, duration) {
    this.vignette.color = color;
    this.vignette.intensity = Math.min(intensity, 0.8);
    this.vignette.decay = CONFIG.EFFECTS.VIGNETTE_DECAY || 0.92;
  }

  getShake() {
    return { x: this.shake.x, y: this.shake.y };
  }

  update(deltaTime) {
    const dt = deltaTime / 16.67;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= deltaTime;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
    if (this.shake.intensity > 0.5) {
      this.shake.x = (Math.random() - 0.5) * this.shake.intensity;
      this.shake.y = (Math.random() - 0.5) * this.shake.intensity;
      this.shake.intensity *= this.shake.decay;
    } else {
      this.shake.x = 0;
      this.shake.y = 0;
      this.shake.intensity = 0;
    }
    if (this.vignette.intensity > 0.01) {
      this.vignette.intensity *= this.vignette.decay;
    } else {
      this.vignette.intensity = 0;
    }
  }

  renderParticles(ctx, cameraSystem) {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  renderVignette(ctx, canvas) {
    if (this.vignette.intensity <= 0) return;
    const gradient = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.width * 0.3,
      canvas.width / 2, canvas.height / 2, canvas.width * 0.8
    );
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, this.vignette.color);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = this.vignette.intensity;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  // Sound stubs — your existing sound system stays untouched
  playEatSound() {}
  playHeadCollisionSound() {}
  playDeathSound(isLocal) {}
  playTone(freq, type, vol, duration) {}
  playKillSound() {}
}

export default EffectsSystem;
