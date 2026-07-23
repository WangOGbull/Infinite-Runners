import CONFIG, { DRAGONS } from './config.js';

// ==================== HEAD CALIBRATION ====================
// Every head frame renders at exactly 77.5 world units wide, no matter
// the PNG's pixel size (77.5 = naturalWidth x 0.08 x scale x 1.5, so
// scale = 646 / naturalWidth). Auto-calibrated at load time - resizing
// or re-exporting the art can never skew head sizes again.
function headScaleFor(img) {
  if (!img || !img.naturalWidth) return 0.95;
  return 646 / img.naturalWidth;
}

// BODIES: all render at exactly 57.6 world units wide.
const BODY_DISPLAY_SCALE = {
  aegis:     0.8581, // 839px
  ignis:     0.8632, // 834px
  infinite:  1.0588, // 680px <- boosted to match the others
  magnetron: 0.85    // 847px
};

class AssetLoader {
  constructor() {
    this.loadedDragons = [];
    this.cache = new Map();
    this.onProgress = null;       // set by preloadAll() during the boot load
    this.failedRequired = [];     // required assets that failed every retry
  }

  async _loadOnce(src) {
    if (this.cache.has(src)) {
      return this.cache.get(src);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.cache.set(src, img);
        resolve(img);
      };
      img.onerror = () => reject(src);
      img.src = src;
    });
  }

  // Loads an image with automatic retries - a hiccuping mobile network
  // gets up to 3 chances per file before we call it a failure.
  async loadImage(src, retries = 2) {
    if (this.cache.has(src)) {
      return this.cache.get(src);
    }
    let lastErr = src;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this._loadOnce(src);
      } catch (e) {
        lastErr = e;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  // Wraps a load so the boot progress bar counts it whether it
  // succeeds or fails - the bar must never freeze waiting on one file.
  _tracked(src) {
    return this.loadImage(src).then(
      img => { this._report(src); return img; },
      err => { this._report(src); throw err; }
    );
  }

  _report(src) {
    if (this.onProgress) this.onProgress(src);
  }

  // Boots the whole game: every dragon sprite + every UI image the
  // menus need, with real per-file progress. Throws if any REQUIRED
  // asset failed all its retries, so the boot screen can offer a retry
  // instead of letting the player in with broken images.
  async preloadAll(progressCb, extraUrls = []) {
    const total = (DRAGONS.length * 5) + extraUrls.length;
    let done = 0;
    this.failedRequired = [];
    this.onProgress = (src) => {
      done++;
      if (progressCb) progressCb(done, total, src);
    };
    try {
      const dragons = await this.loadDragons();
      await Promise.all(extraUrls.map(u =>
        this._tracked(u).catch(() => { /* extras are nice-to-have */ })
      ));
      if (this.failedRequired.length > 0) {
        throw new Error('Required assets failed: ' + this.failedRequired.join(', '));
      }
      return dragons;
    } finally {
      this.onProgress = null;
    }
  }

  async loadDragons() {
    const dragons = [];
    for (const name of DRAGONS) {
      const headSrc = `${CONFIG.ASSET_BASE_URL}${name}_head.png`;
      const headCloseSrc = `${CONFIG.ASSET_BASE_URL}${name}_head_close.png`;
      const headOpenSrc = `${CONFIG.ASSET_BASE_URL}${name}_head_open.png`;
      const bodySrc = `${CONFIG.ASSET_BASE_URL}${name}_body.png`;
      const tailSrc = `${CONFIG.ASSET_BASE_URL}${name}_tail.png`;
      try {
        // REQUIRED: body + tail only. The plain {name}_head.png is just
        // one possible head frame now - it was removed from the repo when
        // the _close/_open frames took over, so demanding it killed every
        // dragon (a missing file returns the SPA fallback HTML page,
        // which a browser cannot decode as an image).
        const [body, tail] = await Promise.all([
          this._tracked(bodySrc),
          this._tracked(tailSrc)
        ]);
        // Head frames, each optional individually: _close = default
        // (mouth closed), _open = attack mode, plain = legacy fallback.
        // A dragon only fails if NONE of the three made it through.
        let headClose = null;
        let headOpen = null;
        let head = null;
        try { headClose = await this._tracked(headCloseSrc); } catch (e) { /* optional */ }
        try { headOpen = await this._tracked(headOpenSrc); } catch (e) { /* optional */ }
        try { head = await this._tracked(headSrc); } catch (e) { /* optional */ }
        const defaultHead = headClose || head || headOpen;
        const attackHead = headOpen || null;
        if (!defaultHead) throw new Error(`No head frame for ${name}`);
        dragons.push({
          name,
          head: defaultHead,
          headOpen: attackHead,
          body,
          tail,
          headSrc: headClose ? headCloseSrc : (head ? headSrc : headOpenSrc),
          bodySrc,
          tailSrc,
          display: {
            head: { scale: headScaleFor(defaultHead) },
            headOpen: { scale: headScaleFor(attackHead || defaultHead) },
            body: { scale: BODY_DISPLAY_SCALE[name] || 0.85 },
            tail: { scale: 0.8 }
          }
        });
      } catch (error) {
        console.warn(`Dragon asset failed: ${name}`);
        this.failedRequired.push(name);
      }
    }
    this.loadedDragons = dragons;
    return dragons;
  }

  getDragonByName(name) {
    return this.loadedDragons.find(dragon => dragon.name === name);
  }

  getAllDragons() {
    return this.loadedDragons;
  }

  clear() {
    this.loadedDragons = [];
    this.cache.clear();
  }
}

const instance = new AssetLoader();
export default instance;
