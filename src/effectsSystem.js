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

  _playPunch() {
    this._playNoise({
      volume:
        this._random(
          0.10,
          0.18
        ),

      duration:
        this._random(
          0.035,
          0.065
        ),

      filterType:
        'bandpass',

      frequency:
        this._random(
          900,
          1800
        ),

      q:
        this._random(
          0.8,
          1.5
        ),

      release:
        0.07
    });

    this._playImpactTone({
      startFrequency:
        this._random(
          110,
          170
        ),

      endFrequency:
        this._random(
          55,
          80
        ),

      volume:
        this._random(
          0.08,
          0.14
        ),

      duration:
        this._random(
          0.055,
          0.09
        ),

      type:
        'triangle'
    });
  }

  // ================================================================
  // BODY IMPACT
  // ================================================================

  _playBodyImpact() {
    this._playNoise({
      volume:
        this._random(
          0.14,
          0.23
        ),

      duration:
        this._random(
          0.06,
          0.11
        ),

      filterType:
        'lowpass',

      frequency:
        this._random(
          700,
          1200
        ),

      q:
        0.9,

      release:
        0.12
    });

    this._playImpactTone({
      startFrequency:
        this._random(
          80,
          125
        ),

      endFrequency:
        this._random(
          38,
          60
        ),

      volume:
        this._random(
          0.12,
          0.20
        ),

      duration:
        this._random(
          0.09,
          0.15
        ),

      type:
        'sine'
    });
  }

  // ================================================================
  // HEAVY HIT
  // ================================================================

  _playHeavyHit() {
    this._playNoise({
      volume:
        this._random(
          0.18,
          0.28
        ),

      duration:
        this._random(
          0.08,
          0.14
        ),

      filterType:
        'lowpass',

      frequency:
        this._random(
          500,
          900
        ),

      q:
        1.0,

      release:
        0.16
    });

    this._playImpactTone({
      startFrequency:
        this._random(
          70,
          105
        ),

      endFrequency:
        this._random(
          28,
          48
        ),

      volume:
        this._random(
          0.18,
          0.28
        ),

      duration:
        this._random(
          0.12,
          0.20
        ),

      type:
        'sawtooth'
    });
  }

  // ================================================================
  // SMASH
  // ================================================================

  _playSmash() {
    this._playNoise({
      volume:
        this._random(
          0.22,
          0.32
        ),

      duration:
        this._random(
          0.10,
          0.18
        ),

      filterType:
        'lowpass',

      frequency:
        this._random(
          350,
          700
        ),

      q:
        this._random(
          0.7,
          1.2
        ),

      release:
        0.22
    });

    this._playImpactTone({
      startFrequency:
        this._random(
          55,
          85
        ),

      endFrequency:
        this._random(
          20,
          35
        ),

      volume:
        this._random(
          0.22,
          0.34
        ),

      duration:
        this._random(
          0.16,
          0.25
        ),

      type:
        'square'
    });
  }

  // ================================================================
  // BONE-CRACK STYLE IMPACT
  // ================================================================

  _playBoneCrack() {
    this._playNoise({
      volume:
        this._random(
          0.12,
          0.20
        ),

      duration:
        this._random(
          0.018,
          0.035
        ),

      filterType:
        'highpass',

      frequency:
        this._random(
          2200,
          4200
        ),

      q:
        this._random(
          0.8,
          1.6
        ),

      attack:
        0.001,

      release:
        0.045
    });

    this._playImpactTone({
      startFrequency:
        this._random(
          700,
          1100
        ),

      endFrequency:
        this._random(
          180,
          300
        ),

      volume:
        this._random(
          0.07,
          0.13
        ),

      duration:
        this._random(
          0.025,
          0.055
        ),

      type:
        'square'
    });
  }

  // ================================================================
  // FINISHER
  // ================================================================

  _playFinisherImpact() {
    this._playHeavyHit();

    setTimeout(() => {
      this._playSmash();
    }, 25);

    setTimeout(() => {
      this._playBoneCrack();
    }, 45);
  }

  // ================================================================
  // PUBLIC SOUND METHODS
  // ================================================================

  playEatSound() {
    const variants = [
      () =>
        this._playPunch(),

      () =>
        this._playBodyImpact()
    ];

    this._pick(
      variants
    )();
  }

  playHeadCollisionSound() {
    const variants = [
      () =>
        this._playPunch(),

      () =>
        this._playPunch(),

      () =>
        this._playBodyImpact(),

      () =>
        this._playHeavyHit(),

      () =>
        this._playSmash(),

      () =>
        this._playBoneCrack()
    ];

    this._pick(
      variants
    )();
  }

  playDeathSound(
    isLocal = false
  ) {
    if (isLocal) {
      this._playFinisherImpact();
    } else {
      this._playSmash();
    }
  }

  playKillSound() {
    this._playFinisherImpact();
  }

  playTone(
    freq,
    type = 'sine',
    vol = 0.2,
    duration = 0.12
  ) {
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
      type || 'sine';

    oscillator.frequency.setValueAtTime(
      Math.max(
        20,
        freq || 20
      ),
      now
    );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.exponentialRampToValueAtTime(
      Math.max(
        0.0001,
        vol || 0.1
      ),
      now + 0.004
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now +
        Math.max(
          0.02,
          duration || 0.12
        )
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
        Math.max(
          0.03,
          duration || 0.12
        ) +
        0.02
    );
  }
}

export default EffectsSystem;
