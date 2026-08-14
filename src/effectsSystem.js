import CONFIG from './config.js';

class EffectsSystem {
  constructor() {
    this.particles = [];
    this.shake = {
      x: 0,
      y: 0,
      intensity: 0,
      decay: 0.9
    };

    this.vignette = {
      color: '#000000',
      intensity: 0,
      decay: 0.92
    };

    this.maxParticles = 500;

    // ================================================================
    // AUDIO
    // ================================================================
    this._audioContext = null;
  }

  init() {
    this.particles = [];

    this.shake.intensity = 0;

    this.vignette.intensity = 0;

    // AudioContext is created lazily when a sound is actually played.
    this._audioContext = null;
  }

  _addParticle(
    x,
    y,
    color,
    speed,
    life,
    size = 2
  ) {
    if (
      this.particles.length >=
      this.maxParticles
    ) {
      this.particles.shift();
    }

    const angle =
      Math.random() *
      Math.PI *
      2;

    const vel =
      Math.random() *
      speed;

    this.particles.push({
      x,
      y,

      vx:
        Math.cos(angle) *
        vel,

      vy:
        Math.sin(angle) *
        vel,

      life,
      maxLife: life,

      color,
      size,

      active: true
    });
  }

  spawnEatParticles(
    x,
    y,
    color
  ) {
    const count =
      CONFIG.EFFECTS.EAT_PARTICLES ||
      8;

    const speed =
      CONFIG.EFFECTS.EAT_PARTICLE_SPEED ||
      3;

    const life =
      CONFIG.EFFECTS.EAT_PARTICLE_LIFE ||
      400;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      this._addParticle(
        x,
        y,
        color,
        speed,
        life
      );
    }
  }

  spawnDeathExplosion(
    x,
    y,
    color
  ) {
    const count =
      CONFIG.EFFECTS.DEATH_PARTICLES ||
      30;

    const speed =
      CONFIG.EFFECTS.DEATH_PARTICLE_SPEED ||
      6;

    const life =
      CONFIG.EFFECTS.DEATH_PARTICLE_LIFE ||
      800;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      this._addParticle(
        x,
        y,
        color,
        speed,
        life,
        3 +
          Math.random() * 2
      );
    }
  }

  spawnImpactSparks(
    x,
    y,
    color
  ) {
    const count =
      CONFIG.EFFECTS.IMPACT_SPARKS ||
      10;

    const speed =
      CONFIG.EFFECTS.IMPACT_SPARK_SPEED ||
      5;

    const life =
      CONFIG.EFFECTS.IMPACT_SPARK_LIFE ||
      300;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      this._addParticle(
        x,
        y,
        color,
        speed,
        life
      );
    }
  }

  spawnKillSparkles(
    x,
    y,
    color
  ) {
    const count =
      CONFIG.EFFECTS.KILL_SPARKLES ||
      12;

    const speed =
      CONFIG.EFFECTS.KILL_SPARKLE_SPEED ||
      4;

    const life =
      CONFIG.EFFECTS.KILL_SPARKLE_LIFE ||
      600;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      this._addParticle(
        x,
        y,
        color,
        speed,
        life,
        2 +
          Math.random() * 2
      );
    }
  }

  spawnParticles(
    x,
    y,
    color,
    count,
    speed,
    life
  ) {
    for (
      let i = 0;
      i < count;
      i++
    ) {
      this._addParticle(
        x,
        y,
        color,
        speed,
        life
      );
    }
  }

  addShake(
    amount,
    duration
  ) {
    this.shake.intensity =
      Math.min(
        this.shake.intensity +
          amount,
        30
      );

    this.shake.decay =
      CONFIG.EFFECTS.SHAKE_DECAY ||
      0.9;
  }

  flashVignette(
    color,
    intensity,
    duration
  ) {
    this.vignette.color =
      color;

    this.vignette.intensity =
      Math.min(
        intensity,
        0.8
      );

    this.vignette.decay =
      CONFIG.EFFECTS.VIGNETTE_DECAY ||
      0.92;
  }

  getShake() {
    return {
      x: this.shake.x,
      y: this.shake.y
    };
  }

  update(deltaTime) {
    const dt =
      deltaTime /
      16.67;

    for (
      let i =
        this.particles.length - 1;
      i >= 0;
      i--
    ) {
      const p =
        this.particles[i];

      p.x +=
        p.vx * dt;

      p.y +=
        p.vy * dt;

      p.life -=
        deltaTime;

      if (
        p.life <= 0
      ) {
        this.particles.splice(
          i,
          1
        );
      }
    }

    if (
      this.shake.intensity >
      0.5
    ) {
      this.shake.x =
        (Math.random() - 0.5) *
        this.shake.intensity;

      this.shake.y =
        (Math.random() - 0.5) *
        this.shake.intensity;

      this.shake.intensity *=
        this.shake.decay;
    } else {
      this.shake.x = 0;
      this.shake.y = 0;
      this.shake.intensity = 0;
    }

    if (
      this.vignette.intensity >
      0.01
    ) {
      this.vignette.intensity *=
        this.vignette.decay;
    } else {
      this.vignette.intensity = 0;
    }
  }

  renderParticles(
    ctx,
    cameraSystem
  ) {
    for (
      const p of this.particles
    ) {
      const alpha =
        Math.max(
          0,
          p.life /
            p.maxLife
        );

      ctx.globalAlpha =
        alpha;

      ctx.fillStyle =
        p.color;

      ctx.beginPath();

      ctx.arc(
        p.x,
        p.y,
        p.size *
          (0.5 +
            alpha *
              0.5),
        0,
        Math.PI * 2
      );

      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  renderVignette(
    ctx,
    canvas
  ) {
    if (
      this.vignette.intensity <=
      0
    ) {
      return;
    }

    const gradient =
      ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.3,

        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.8
      );

    gradient.addColorStop(
      0,
      'transparent'
    );

    gradient.addColorStop(
      1,
      this.vignette.color
    );

    ctx.fillStyle =
      gradient;

    ctx.globalAlpha =
      this.vignette.intensity;

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.globalAlpha = 1;
  }

  // ================================================================
  // AUDIO SYSTEM
  // ================================================================

  _getAudioContext() {
    if (
      !this._audioContext
    ) {
      const AudioContextClass =
        window.AudioContext ||
        window.webkitAudioContext;

      if (
        !AudioContextClass
      ) {
        return null;
      }

      this._audioContext =
        new AudioContextClass();
    }

    if (
      this._audioContext.state ===
      'suspended'
    ) {
      this._audioContext
        .resume()
        .catch(() => {});
    }

    return this._audioContext;
  }

  _random(
    min,
    max
  ) {
    return (
      min +
      Math.random() *
        (max - min)
    );
  }

  _pick(
    array
  ) {
    return array[
      Math.floor(
        Math.random() *
          array.length
      )
    ];
  }

  _createNoiseBuffer(
    ctx,
    duration
  ) {
    const sampleRate =
      ctx.sampleRate;

    const length =
      Math.max(
        1,
        Math.floor(
          sampleRate *
            duration
        )
      );

    const buffer =
      ctx.createBuffer(
        1,
        length,
        sampleRate
      );

    const data =
      buffer.getChannelData(
        0
      );

    for (
      let i = 0;
      i < length;
      i++
    ) {
      data[i] =
        Math.random() *
          2 -
        1;
    }

    return buffer;
  }

  _playNoise({
    volume = 0.15,
    duration = 0.08,
    filterType = 'lowpass',
    frequency = 1400,
    q = 0.8,
    attack = 0.001,
    release = 0.08
  } = {}) {
    const ctx =
      this._getAudioContext();

    if (!ctx) return;

    const now =
      ctx.currentTime;

    const source =
      ctx.createBufferSource();

    source.buffer =
      this._createNoiseBuffer(
        ctx,
        duration
      );

    const filter =
      ctx.createBiquadFilter();

    filter.type =
      filterType;

    filter.frequency.setValueAtTime(
      frequency,
      now
    );

    filter.Q.setValueAtTime(
      q,
      now
    );

    const gain =
      ctx.createGain();

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.linearRampToValueAtTime(
      volume,
      now + attack
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now +
        Math.max(
          attack + 0.005,
          release
        )
    );

    source.connect(
      filter
    );

    filter.connect(
      gain
    );

    gain.connect(
      ctx.destination
    );

    source.start(
      now
    );

    source.stop(
      now +
        Math.max(
          duration,
          release
        ) +
        0.02
    );
  }

  _playImpactTone({
    startFrequency = 120,
    endFrequency = 55,
    volume = 0.18,
    duration = 0.12,
    type = 'sine'
  } = {}) {
    const ctx =
      this._getAudioContext();

    if (!ctx) return;

    const now =
      ctx.currentTime;

    const oscillator =
      ctx.createOscillator();

    const gain =
      ctx.createGain();

    oscillator.type =
      type;

    oscillator.frequency.setValueAtTime(
      startFrequency,
      now
    );

    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(
        20,
        endFrequency
      ),
      now + duration
    );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.exponentialRampToValueAtTime(
      volume,
      now + 0.003
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + duration
    );

    oscillator.connect(
      gain
    );

    gain.connect(
      ctx.destination
    );

    oscillator.start(
      now
    );

    oscillator.stop(
      now +
        duration +
        0.02
    );
  }

  // ================================================================
  // PUNCH
  // ================================================================


// ============================================================
// PREMIUM SOUND SYSTEM — effectsSystem.js
// ============================================================
// Replace the PUBLIC SOUND METHODS section (lines ~1040-1173)
// and the helper methods (_playPunch through _playFinisherImpact)
// with this file.
//
// These sounds use layered oscillators, harmonic overtones,
// sub-bass, shimmer effects, and proper ADSR envelopes to
// create rich, satisfying game audio that rivals Snake Clash.
// No external files needed — all procedural but MUCH better.
//
// ============================================================
// WHAT CHANGED:
//   playEatSound()      → Crystalline chime with harmonics
//   playHeadCollisionSound() → Deep impact + sub-bass + crunch
//   playDeathSound()   → Dramatic descending sweep + crash
//   playKillSound()    → Triumphant fanfare stinger
//   playTone()         → Kept (used elsewhere)
//   + Added: _playReverbTail() for spatial depth
//   + Added: _playSubBass() for weight on impacts
//   + Added: _playShimmer() for magical collect feel
// ============================================================

  // ================================================================
  // PREMIUM SOUND HELPERS
  // ================================================================

  /**
   * Sub-bass thump — adds weight and physicality to impacts.
   */
  _playSubBass({ freq = 50, volume = 0.25, duration = 0.3 } = {}) {
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), now + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Crystalline shimmer — bright sparkly tones for collect/magic.
   * Plays a root frequency + perfect 5th + octave for a bell-like quality.
   */
  _playShimmer({ freq = 880, volume = 0.15, duration = 0.25 } = {}) {
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const harmonics = [
      { ratio: 1,     vol: 1.0,  type: 'sine' },
      { ratio: 1.5,   vol: 0.5,  type: 'sine' },
      { ratio: 2,     vol: 0.3,  type: 'sine' },
      { ratio: 3,     vol: 0.15, type: 'triangle' }
    ];

    harmonics.forEach((h, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = h.type;
      osc.frequency.setValueAtTime(freq * h.ratio, now + i * 0.008);
      gain.gain.setValueAtTime(0.0001, now + i * 0.008);
      gain.gain.exponentialRampToValueAtTime(volume * h.vol, now + i * 0.008 + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.008 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.008);
      osc.stop(now + i * 0.008 + duration + 0.02);
    });
  }

  /**
   * Reverb-like decay tail using a delay feedback loop.
   * Adds spatial depth to any sound.
   */
  _playReverbTail({ freq = 200, volume = 0.08, duration = 0.4 } = {}) {
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const delay = ctx.createDelay();
    const feedback = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + duration);

    delay.delayTime.setValueAtTime(0.08, now);
    feedback.gain.setValueAtTime(0.35, now);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(filter);
    filter.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Whoosh — air movement for attack/sprint activation.
   */
  _playWhoosh({ volume = 0.12, duration = 0.2, rising = true } = {}) {
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Filtered noise sweep
    const buffer = this._createNoiseBuffer(ctx, duration);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(0.6, now);
    if (rising) {
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(2400, now + duration);
    } else {
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(400, now + duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  // ================================================================
  // IMPROVED IMPACT SOUNDS
  // ================================================================

  _playPunch() {
    // Quick sharp hit + sub-bass for weight
    this._playNoise({
      volume: this._random(0.14, 0.20),
      duration: this._random(0.03, 0.05),
      filterType: 'bandpass',
      frequency: this._random(1200, 2000),
      q: this._random(1.0, 1.8),
      release: 0.06
    });
    this._playSubBass({ freq: 80, volume: 0.12, duration: 0.08 });
  }

  _playBodyImpact() {
    // Fuller body hit — noise + tone + sub-bass
    this._playNoise({
      volume: this._random(0.16, 0.24),
      duration: this._random(0.06, 0.10),
      filterType: 'lowpass',
      frequency: this._random(600, 1100),
      q: 0.9,
      release: 0.12
    });
    this._playImpactTone({
      startFrequency: this._random(90, 130),
      endFrequency: this._random(40, 60),
      volume: this._random(0.14, 0.22),
      duration: this._random(0.10, 0.16),
      type: 'sine'
    });
    this._playSubBass({ freq: 55, volume: 0.15, duration: 0.12 });
  }

  _playHeavyHit() {
    // Heavy crash — layered noise + tone + sub + reverb
    this._playNoise({
      volume: this._random(0.20, 0.30),
      duration: this._random(0.08, 0.14),
      filterType: 'lowpass',
      frequency: this._random(400, 800),
      q: 1.0,
      release: 0.18
    });
    this._playImpactTone({
      startFrequency: this._random(75, 105),
      endFrequency: this._random(28, 45),
      volume: this._random(0.20, 0.30),
      duration: this._random(0.14, 0.22),
      type: 'sawtooth'
    });
    this._playSubBass({ freq: 45, volume: 0.22, duration: 0.25 });
    this._playReverbTail({ freq: 120, volume: 0.06, duration: 0.35 });
  }

  _playSmash() {
    // Devastating smash — everything layered
    this._playNoise({
      volume: this._random(0.26, 0.36),
      duration: this._random(0.10, 0.18),
      filterType: 'lowpass',
      frequency: this._random(300, 600),
      q: this._random(0.7, 1.2),
      release: 0.25
    });
    this._playImpactTone({
      startFrequency: this._random(60, 85),
      endFrequency: this._random(20, 30),
      volume: this._random(0.26, 0.38),
      duration: this._random(0.18, 0.28),
      type: 'square'
    });
    this._playSubBass({ freq: 38, volume: 0.28, duration: 0.35 });
    this._playReverbTail({ freq: 80, volume: 0.08, duration: 0.45 });
  }

  _playBoneCrack() {
    // Sharp crack — high-pass noise burst
    this._playNoise({
      volume: this._random(0.14, 0.22),
      duration: this._random(0.015, 0.03),
      filterType: 'highpass',
      frequency: this._random(2800, 4500),
      q: this._random(0.9, 1.8),
      attack: 0.001,
      release: 0.04
    });
    this._playImpactTone({
      startFrequency: this._random(800, 1200),
      endFrequency: this._random(200, 320),
      volume: this._random(0.08, 0.14),
      duration: this._random(0.02, 0.05),
      type: 'square'
    });
  }

  _playFinisherImpact() {
    this._playHeavyHit();
    setTimeout(() => this._playSmash(), 30);
    setTimeout(() => this._playBoneCrack(), 55);
    setTimeout(() => this._playSubBass({ freq: 35, volume: 0.25, duration: 0.4 }), 20);
  }

  // ================================================================
  // PUBLIC SOUND METHODS — Premium Versions
  // ================================================================

  /**
   * Eat / collect ∞ — Crystalline bell chime with pitch variation.
   * Bright, satisfying, and never grating even when spammed.
   */
  playEatSound() {
    const baseFreq = 700 + Math.random() * 300;
    this._playShimmer({
      freq: baseFreq,
      volume: this._random(0.10, 0.16),
      duration: this._random(0.15, 0.22)
    });
  }

  /**
   * Head collision — Deep impact with sub-bass and crunch.
   * Weighty and physical, scales with the variant picked.
   */
  playHeadCollisionSound() {
    const variants = [
      () => this._playPunch(),
      () => this._playPunch(),
      () => this._playBodyImpact(),
      () => this._playHeavyHit(),
      () => this._playSmash(),
      () => this._playBoneCrack()
    ];
    this._pick(variants)();
  }

  /**
   * Death — Dramatic descending sweep + crash + reverb tail.
   * Local death is bigger and more dramatic than remote.
   */
  playDeathSound(isLocal = false) {
    if (isLocal) {
      // Your death — full dramatic sequence
      this._playFinisherImpact();
      setTimeout(() => {
        this._playReverbTail({ freq: 150, volume: 0.10, duration: 0.6 });
      }, 100);
    } else {
      // Someone else's death — still satisfying but shorter
      this._playSmash();
      this._playReverbTail({ freq: 180, volume: 0.06, duration: 0.4 });
    }
  }

  /**
   * Kill confirm — Triumphant ascending fanfare.
   * Three-note major arpeggio + shimmer sparkle on top.
   */
  playKillSound() {
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Ascending triad: C5 → E5 → G5 → C6 (major arpeggio)
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.035);
      gain.gain.setValueAtTime(0.0001, now + i * 0.035);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.035 + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.035 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.035);
      osc.stop(now + i * 0.035 + 0.27);
    });

    // Sparkle on top
    setTimeout(() => {
      this._playShimmer({ freq: 1568, volume: 0.08, duration: 0.3 });
    }, 80);

    // Sub-bass for impact
    this._playSubBass({ freq: 65, volume: 0.12, duration: 0.2 });
  }

  /**
   * Generic tone — kept for backward compatibility.
   * Enhanced with a cleaner envelope.
   */
  playTone(freq, type = 'sine', vol = 0.2, duration = 0.12) {
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, freq || 20), now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol || 0.1), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, duration || 0.12));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + Math.max(0.03, duration || 0.12) + 0.02);
  }

}

export default EffectsSystem;
