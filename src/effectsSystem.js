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
    this._audioUnlockPromise = null;
    this._audioLoadedCount = 0;
    this._audioFailedCount = 0;
    const savedVolumeRaw = localStorage.getItem('irMasterVolume');
    const savedVolume = savedVolumeRaw === null ? NaN : Number(savedVolumeRaw);
    this._masterVolume = Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume / 100)) : 0.5;
    this._soundEnabled = localStorage.getItem('irSoundEnabled') !== 'false';
    this._reducedMotion = localStorage.getItem('irReducedMotion') === 'true';

    // Real audio file URLs (Mixkit free SFX, no attribution required)
    this._audioFiles = {
      eat: './assets/food-collect-bubble-pop.mp3',
      kill: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/2705fe0df_dragon-kill.mp3',
      hit: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/586846b71_hit-damage.mp3',
      death: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/53bdc70cd_game-over.mp3',
      respawn: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/dc5b302a3_dragon-respawn.mp3',
      victory: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/cd9d3ec3d_victory-roar.mp3',
      dragonDeath: 'https://base44.app/api/apps/6a7decc0634fef0eafb32f0e/files/mp/public/6a7decc0634fef0eafb32f0e/d3a265df1_dragon-death.mp3',
      searchSonar: './assets/automatch-sonar-search.mp3',
      opponentFound: './assets/automatch-opponent-found.mp3'
    };

    // Premium audio chain nodes (created lazily, reused)
    this._masterChain = null;
    this._reverbBuffer = null;
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

    const entries = Object.entries(this._audioFiles);

    // Fetch and decode together. Sequential loading allowed one slow CDN file
    // to delay every sound behind it, sometimes until well after play began.
    await Promise.all(entries.map(async ([key, url]) => {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          this._audioFailedCount++;
          console.warn(`[Audio] Failed to fetch ${key}: ${response.status}`);
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        this._audioBuffers[key] = await ctx.decodeAudioData(arrayBuffer);
        this._audioLoadedCount++;
        console.log(`[Audio] Loaded ${key}`);
      } catch (error) {
        this._audioFailedCount++;
        console.warn(`[Audio] Failed to load ${key}:`, error.message);
      } finally {
        clearTimeout(fetchTimeout);
      }
    }));

    const total = entries.length;
    console.log(`[Audio] Preload complete: ${this._audioLoadedCount}/${total} loaded, ${this._audioFailedCount} failed`);
  }

  // Build the premium master chain: compressor -> reverb send -> master gain -> destination
  _buildMasterChain() {
    const ctx = this._getAudioContext();
    if (!ctx || this._masterChain) return this._masterChain;

    // Compressor for punch and loudness control
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 6;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = this._soundEnabled ? this._masterVolume : 0;

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
    reverbGain.connect(masterGain);

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

  // Play a loaded audio buffer through the premium chain
  _playBuffer(key, volume = 0.5, playbackRate = 1, subBassFreq = 0) {
    if (!this._soundEnabled || this._masterVolume <= 0) return true;
    const ctx = this._getAudioContext();
    if (!ctx) return false;

    const buffer = this._audioBuffers[key];
    if (!buffer) return false;

    const chain = this._buildMasterChain();
    if (!chain) return false;

    const now = ctx.currentTime;

    // Source -> EQ -> Compressor chain
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    // Per-sound gain
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, volume), now);

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 200;
    lowShelf.gain.value = 2;
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 3000;
    highShelf.gain.value = 1;
    source.connect(lowShelf);
    lowShelf.connect(highShelf);
    highShelf.connect(gain);
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

    source.onended = () => {
      try { source.disconnect(); } catch (_) {}
      try { lowShelf.disconnect(); } catch (_) {}
      try { highShelf.disconnect(); } catch (_) {}
      try { gain.disconnect(); } catch (_) {}
    };
    source.start(0);
    return true;
  }

  getAudioSettings() {
    return { enabled: this._soundEnabled, volume: Math.round(this._masterVolume * 100) };
  }

  setSoundEnabled(enabled) {
    this._soundEnabled = !!enabled;
    localStorage.setItem('irSoundEnabled', String(this._soundEnabled));
    if (!this._soundEnabled) this.stopSearchSound();
    if (this._masterChain && this._audioContext) {
      this._masterChain.masterGain.gain.setTargetAtTime(this._soundEnabled ? this._masterVolume : 0, this._audioContext.currentTime, 0.02);
    }
  }

  setMasterVolume(percent) {
    const value = Math.min(100, Math.max(0, Number(percent) || 0));
    this._masterVolume = value / 100;
    localStorage.setItem('irMasterVolume', String(value));
    if (this._masterChain && this._audioContext) {
      this._masterChain.masterGain.gain.setTargetAtTime(this._soundEnabled ? this._masterVolume : 0, this._audioContext.currentTime, 0.02);
    }
  }

  setReducedMotion(enabled) {
    this._reducedMotion = !!enabled;
    if (this._reducedMotion) {
      this.shake.x = 0;
      this.shake.y = 0;
      this.shake.intensity = 0;
    }
  }

  init() {
    this.particles = [];

    this.shake.intensity = 0;

    this.vignette.intensity = 0;

    // AudioContext is created lazily when a sound is actually played.
    this._audioContext = null;
  }

  startSearchSound() {
    this._searchRequested = true;
    if (!this._soundEnabled || this._masterVolume <= 0) return;
    if (this._searchSound) return;
    const ctx = this._getAudioContext();
    const chain = this._buildMasterChain();
    if (!ctx || !chain) return;
    const buffer = this._audioBuffers.searchSonar;
    if (!buffer) {
      this._preloadAudio().then(() => {
        if (this._searchRequested && !this._searchSound) this.startSearchSound();
      }).catch(() => {});
      return;
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.34;
    source.connect(gain);
    gain.connect(chain.compressor);
    source.start();
    this._searchSound = { source, gain };
  }

  stopSearchSound() {
    this._searchRequested = false;
    const sound = this._searchSound;
    if (!sound) return;
    this._searchSound = null;
    try { sound.source.stop(); } catch (_) {}
    try { sound.source.disconnect(); } catch (_) {}
    try { sound.gain.disconnect(); } catch (_) {}
  }

  playOpponentFoundSound() {
    if (!this._soundEnabled || this._masterVolume <= 0) return;
    const ctx = this._getAudioContext();
    const chain = this._buildMasterChain();
    const buffer = this._audioBuffers.opponentFound;
    if (!ctx || !chain || !buffer) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.42;
    source.connect(gain);
    gain.connect(chain.compressor);
    const duration = Math.min(2, buffer.duration);
    source.start(ctx.currentTime, 0, duration);
    source.stop(ctx.currentTime + duration + 0.02);
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
    if (this._reducedMotion) return { x: 0, y: 0 };
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
    if (!this._audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this._audioContext = new AudioContextClass();
    }
    return this._audioContext;
  }

  // Must begin inside a trusted tap/click/keydown. Mobile browsers otherwise
  // keep a successfully-loaded AudioContext suspended and every sound is silent.
  unlockAudio() {
    if (!this._soundEnabled || this._masterVolume <= 0) {
      return Promise.resolve(false);
    }

    const ctx = this._getAudioContext();
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    if (this._audioUnlockPromise) return this._audioUnlockPromise;

    this._audioUnlockPromise = ctx.resume()
      .then(() => {
        if (ctx.state !== 'running') return false;

        // A zero-volume buffer makes the unlock stick on iOS/WebKit.
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        source.onended = () => {
          try { source.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
        };
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this._audioUnlockPromise = null;
      });

    return this._audioUnlockPromise;
  }

  isAudioRunning() {
    return !!this._audioContext && this._audioContext.state === 'running';
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
    // Play the approved collection asset at its original pitch and speed.
    if (this._playBuffer('eat', 0.3, 1)) return;

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
    gain.connect(this._buildMasterChain().compressor);
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
    gain.connect(this._buildMasterChain().compressor);
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
    gain.connect(this._buildMasterChain().compressor);
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
    gain.connect(this._buildMasterChain().compressor);
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
      gain.connect(this._buildMasterChain().compressor);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.22);
    });
  }

  /**
   * Respawn — Monster roar when dragons spawn/respawn into the arena.
   */
  playRespawnSound() {
    if (this._playBuffer('respawn', 0.18, 1)) return;

    // Fallback: low growl
    const ctx = this._getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(this._buildMasterChain().compressor);
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
      gain.connect(this._buildMasterChain().compressor);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.45);
    });
  }

  /**
   * Generic tone — kept for backward compatibility.
   */
  playTone(freq, type = 'sine', vol = 0.2, duration = 0.12) {
    if (!this._soundEnabled || this._masterVolume <= 0) return;
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
    gain.connect(this._buildMasterChain().compressor);
    osc.start(now);
    osc.stop(now + Math.max(0.03, duration || 0.12) + 0.02);
  }
}

export default EffectsSystem;
