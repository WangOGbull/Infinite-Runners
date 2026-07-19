import CONFIG, { DRAGONS } from './config.js';

// ==================== HEAD DISPLAY CALIBRATION ====================
// The new front-facing heads have different pixel sizes per file, so each
// dragon gets its own head scale. Calibrated so every head renders at the
// EXACT same in-game width as the old 680px-wide heads:
//   680 x DRAGON_DISPLAY_SCALE(0.08) x 0.95 x 1.5 = 77.5 world units
// Formula: scale = 646 / headContentWidthPx
const HEAD_DISPLAY_SCALE = {
  aegis:     0.7645, // purple head - content 845px wide
  ignis:     0.8065, // fire head   - content 801px wide
  infinite:  0.9818, // blue head   - content 658px wide
  magnetron: 0.9613  // pink head   - content 672px wide
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
            body: { scale: 0.85 },
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
