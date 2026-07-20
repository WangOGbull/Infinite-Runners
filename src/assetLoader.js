import CONFIG, { DRAGONS } from './config.js';

// ==================== DISPLAY CALIBRATION ====================
// HEADS: all render at exactly 77.5 world units wide (= infinite's size,
// which matches the old 680px heads). Formula: scale = 646 / headPixelWidth
const HEAD_DISPLAY_SCALE = {
  aegis:     0.95,   // 680px
  ignis:     0.95,   // 680px
  infinite:  0.9818, // 658px
  magnetron: 0.9613  // 672px
};

// BODIES: all render at exactly 57.6 world units wide (= magnetron's body).
// infinite_body.png is narrower (680px vs ~840px), so it gets a bigger
// scale to match the others. Formula: scale = 57.6 / (bodyPixelWidth x 0.08)
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
      const bodySrc = `${CONFIG.ASSET_BASE_URL}${name}_body.png`;
      const tailSrc = `${CONFIG.ASSET_BASE_URL}${name}_tail.png`;
      try {
        const [head, body, tail] = await Promise.all([
          this.loadImage(headSrc),
          this.loadImage(bodySrc),
          this.loadImage(tailSrc)
        ]);
        dragons.push({
          name,
          head,
          body,
          tail,
          headSrc,
          bodySrc,
          tailSrc,
          display: {
            head: { scale: HEAD_DISPLAY_SCALE[name] || 0.95 },
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
