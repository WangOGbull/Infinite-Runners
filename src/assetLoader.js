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
  }

  async loadImage(src) {
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

  async loadDragons() {
    const dragons = [];
    for (const name of DRAGONS) {
      const headSrc = `${CONFIG.ASSET_BASE_URL}${name}_head.png`;
      const headCloseSrc = `${CONFIG.ASSET_BASE_URL}${name}_head_close.png`;
      const headOpenSrc = `${CONFIG.ASSET_BASE_URL}${name}_head_open.png`;
      const bodySrc = `${CONFIG.ASSET_BASE_URL}${name}_body.png`;
      const tailSrc = `${CONFIG.ASSET_BASE_URL}${name}_tail.png`;
      try {
        const [head, body, tail] = await Promise.all([
          this.loadImage(headSrc),
          this.loadImage(bodySrc),
          this.loadImage(tailSrc)
        ]);
        // Attack-system head frames: _close = default (mouth closed),
        // _open = attack mode. Both optional - they fall back to the
        // plain {name}_head.png so a missing frame never breaks a dragon.
        let headClose = null;
        let headOpen = null;
        try { headClose = await this.loadImage(headCloseSrc); } catch (e) { /* optional */ }
        try { headOpen = await this.loadImage(headOpenSrc); } catch (e) { /* optional */ }
        const defaultHead = (headClose && headClose.naturalWidth > 0) ? headClose : head;
        const attackHead = (headOpen && headOpen.naturalWidth > 0) ? headOpen : null;
        dragons.push({
          name,
          head: defaultHead,
          headOpen: attackHead,
          body,
          tail,
          headSrc: headClose ? headCloseSrc : headSrc,
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
