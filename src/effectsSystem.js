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

    this.maxParticles = 250;

    // ================================================================
    // AUDIO
    // ================================================================
    this._audioContext = null;
    this._audioBuffers = {};
    this._audioLoaded = false;
    this._audioLoadedCount = 0;
    this._audioFailedCount = 0;
    this._masterVolume = 0.5;

    // Real audio file URLs (Mixkit free SFX, no attribution required)
    this._audioFiles = {
      eat: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/1486df0f3_food-collect-new.mp3',
      kill: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/2705fe0df_dragon-kill.mp3',
      hit: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/586846b71_hit-damage.mp3',
      death: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/53bdc70cd_game-over.mp3',
      respawn: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/dc5b302a3_dragon-respawn.mp3',
      victory: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/cd9d3ec3d_victory-roar.mp3',
      dragonDeath: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/d3a265df1_dragon-death.mp3'
    };

    // Premium audio chain nodes (created lazily, reused)
    this._masterChain = null;
    this._reverbBuffer = null;
    this._eqFilters = null; // Cache EQ filters to avoid per-frame creation
  }

  // Preload all audio files with 30s timeout — call after first user interaction
  async _preloadAudio() {
    if (this._audioLoaded) return;
    this._audioLoaded = true;
    const ctx = this._getAudioContext();
    if (!ctx) {
      console.warn('[Audio] No AudioContext available');
      return;
    }

    const timeoutMs = 30000;
    const startTime = Date.now();
    const entries = Object.entries(this._audioFiles);
    
    for (const [key, url] of entries) {
      try {
        // Abort individual fetch if total time exceeds timeout
        if (Date.now() - startTime > timeoutMs) {
          console.warn(`[Audio] Timeout loading ${key} (overall timeout reached)`);
          this._audioFailedCount++;
          continue;
        }

        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(fetchTimeout);
        
        if (!response.ok) {
          this._audioFailedCount++;
          console.warn(`[Audio] Failed to fetch ${key}: ${response.status}`);
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this._audioBuffers[key] = audioBuffer;
        this._audioLoadedCount++;
        console.log(`[Audio] Loaded ${key}`);
      } catch (e) {
        this._audioFailedCount++;
        console.warn(`[Audio] Failed to load ${key}:`, e.message);
      }
    }
    
    const total = entries.length;
    console.log(`[Audio] Preload complete: ${this._audioLoadedCount}/${total} loaded, ${this._audioFailedCount} failed`);
  }

  // Build the premium master chain: compressor -> reverb send -> master gain -> destination
  _buildMasterChain() {
    const ctx = this._getAudioContext();
    if (!ctx || this._masterChain) return this._masterChain;

    // Compressor for punch and loudness control
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.1;

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = this._masterVolume;

    // Reverb (convolver with synthesized impulse response)
    const reverb = ctx.createConvolver();
    this._reverbBuffer = this._createImpulseResponse(ctx, 1.2, 2.5);
    reverb.buffer = this._reverbBuffer;

    // Reverb send gain (subtle)
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.18;

    // Dry/wet mix
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Reverb parallel path
    compressor.connect(reverb);
    reverb.connect(reverbGain);
    reverbGain.connect(ctx.destination);

    this._masterChain = { compressor, masterGain, reverb, reverbGain };
    return this._masterChain;
  }

  // Generate a synthetic impulse response for reverb
  _createImpulseResponse(ctx, duration, decay) {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  // Get or create cached EQ filters
  _getEQFilters() {
    if (this._eqFilters) return this._eqFilters;
    
    const ctx = this._getAudioContext();
    if (!ctx) return null;

    // EQ: low-shelf boost for warmth + high-shelf for clarity
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 200;
    lowShelf.gain.value = 4;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 3000;
    highShelf.gain.value = 2;

    lowShelf.connect(highShelf);
    
    this._eqFilters = { lowShelf, highShelf };
    return this._eqFilters;
  }

  // Play a loaded audio buffer through the premium chain
  _playBuffer(key, volume = 0.5, playbackRate = 1, subBassFreq = 0) {
    const ctx = this._getAudioContext();
    if (!ctx) return false;

    const buffer = this._audioBuffers[key];
    if (!buffer) return false;

    const chain = this._buildMasterChain();
    if (!chain) return false;

    const eqFilters = this._getEQFilters();
    if (!eqFilters) return false;

    const now = ctx.currentTime;

    // Source -> EQ -> Compressor chain
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    // Per-sound gain
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, volume), now);

    source.connect(eqFilters.lowShelf);
    eqFilters.highShelf.connect(gain);
    gain.connect(chain.compressor);

    // Sub-bass layer for depth (optional)
    if (subBassFreq > 0) {
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(subBassFreq, now);
      subOsc.frequency.exponentialRampToValueAtTime(Math.max(20, subBassFreq * 0.5), now + 0.15);
      subGain.gain.setValueAtTime(volume * 0.4, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      subOsc.connect(subGain);
      subGain.connect(chain.compressor);
      subOsc.start(now);
      subOsc.stop(now + 0.22);
    }

    source.start(0);
    return true;
  }

  init() {
    this.particles = [];

    this.shake.intensity = 0;

    this.vignette.intensity = 0;

    // AudioContext is created lazily when a sound is actually played.
    this._audioContext = null;
  }

  startSearchSound() {
    if (this._searchSound) return;
    const ctx = this._getAudioContext();
    const chain = this._buildMasterChain();
    if (!ctx || !chain) return;

    const now = ctx.currentTime;
    const output = ctx.createGain();
    output.gain.setValueAtTime(0.001, now);
    output.gain.exponentialRampToValueAtTime(0.11, now + 0.45);
    output.connect(chain.compressor);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 720;
    filter.Q.value = 1.8;
    filter.connect(output);

    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 58;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.56;
    hum.connect(humGain);
    humGain.connect(filter);

    const energy = ctx.createOscillator();
    energy.type = 'triangle';
    energy.frequency.value = 116;
    const energyGain = ctx.createGain();
    energyGain.gain.value = 0.2;
    energy.connect(energyGain);
    energyGain.connect(filter);

    const drift = ctx.createOscillator();
    drift.type = 'sine';
    drift.frequency.value = 0.18;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 36;
    drift.connect(driftDepth);
    driftDepth.connect(energy.frequency);

    hum.start(now);
    energy.start(now);
    drift.start(now);
    this._searchSound = { output, hum, energy, drift, pulseTimer: 0 };
    this._playSearchPulse();
    this._searchSound.pulseTimer = window.setInterval(() => this._playSearchPulse(), 1250);
  }

  _playSearchPulse() {
    if (!this._searchSound) return;
    const ctx = this._getAudioContext();
    const chain = this._buildMasterChain();
    if (!ctx || !chain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.48);
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 2.4;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(chain.compressor);
    osc.start(now);
    osc.stop(now + 0.58);
  }

  stopSearchSound() {
    const sound = this._searchSound;
    if (!sound) return;
    this._searchSound = null;
    if (sound.pulseTimer) window.clearInterval(sound.pulseTimer);
    const ctx = this._audioContext;
    const now = ctx?.currentTime || 0;
    try {
      sound.output.gain.cancelScheduledValues(now);
      sound.output.gain.setValueAtTime(Math.max(0.001, sound.output.gain.value), now);
      sound.output.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      sound.hum.stop(now + 0.2);
      sound.energy.stop(now + 0.2);
      sound.drift.stop(now + 0.2);
    } catch (_) {}
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
      12;

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
      120;

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
        12
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


  // ================================================================
  // REAL AUDIO FILE SOUNDS (Mixkit free SFX)
  // Falls back to simple procedural sounds if files fail to load
  // ================================================================

  /**
   * Eat / collect — Short coin/chime sound.
   * Uses real audio file. Pitch varies slightly so it never gets stale.
   */
  playEatSound() {
    // Try real audio file first
    const rate = 0.9 + Math.random() * 0.3; // 0.9x to 1.2x playback speed
    if (this._playBuffer('eat', 0.3, rate, 80)) return;

    // Fallback: quick bright blip
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800 + Math.random() * 200, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /**
   * Head collision — Punchy impact sound.
   * Uses real audio file for the hit, with a heavier variant for big hits.
   */
  playHeadCollisionSound() {
    const variants = [
      () => this._playBuffer('hit', 0.5),
      () => this._playBuffer('hit', 0.5),
      () => this._playBuffer('hit', 0.6),
      () => this._playBuffer('hitHeavy', 0.5),
      () => this._playBuffer('hitHeavy', 0.6),
    ];

    // Try real audio first
    for (const v of variants) {
      if (v()) return;
    }

    // Fallback: punchy noise burst
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const buffer = this._createNoiseBuffer(ctx, 0.05);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000 + Math.random() * 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }

  /**
   * Death — Dramatic game-over sound.
   * Uses real audio file. Local death is louder.
   */
  playDeathSound(isLocal = false) {
    if (this._playBuffer('death', isLocal ? 0.7 : 0.4, 1, 40)) return;

    // Fallback: descending tone
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.52);
  }

  /**
   * Kill confirm — Satisfying bonus/score sound.
   * Uses real audio file.
   */
  /**
   * Dragon death — wet splat impact at the exact moment YOUR dragon dies.
   * Distinct from playDeathSound (game-over screech) which plays later
   * when the Game Over screen appears.
   */
  playDragonDeathSound() {
    if (this._playBuffer('dragonDeath', 0.65, 1, 60)) return;

    // Fallback: heavy thud
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  playKillSound(vol = 0.6) {
    if (this._playBuffer('kill', vol, 1, 70)) return;

    // Fallback: ascending arpeggio
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523, 659, 784];
    const baseGain = vol * 0.2; // scale fallback volume by param
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.04);
      gain.gain.setValueAtTime(baseGain, now + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.22);
    });
  }

  /**
   * Respawn — Monster roar when dragons spawn/respawn into the arena.
   */
  playRespawnSound() {
    if (this._playBuffer('respawn', 0.5, 1, 50)) return;

    // Fallback: low growl
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  /**
   * Victory — Dragon roar when player beats Hard mode or wins MP.
   */
  playVictorySound() {
    if (this._playBuffer('victory', 0.7, 1, 40)) return;

    // Fallback: triumphant fanfare
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.15, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.45);
    });
  }

  /**
   * Generic tone — kept for backward compatibility.
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
