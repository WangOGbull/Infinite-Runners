import CONFIG from './config.js';

const ARENA_URLS = [
  'https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_stone.png',
  'https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_grass.png',
  'https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_purple.png',
  'https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_fire.png'
];

export const ARENA_NAMES = ['Stone Castle', 'Grass Field', 'Purple Magic', 'Fire Arena'];
export const ARENA_COLORS = ['#8B9DC3', '#4CAF50', '#9C27B0', '#FF5722'];

class ArenaManager {
  constructor() {
    this.mode = 'FFA';
    this.width = 4200;
    this.height = 4200;
    this.loadedImages = [];
    this.selectedImage = null;
    this.allLoaded = false;
    this.preloadPromise = null;
  }

  preloadAll() {
    if (this.preloadPromise) return this.preloadPromise;

    this.preloadPromise = Promise.all(
      ARENA_URLS.map(url => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            this.loadedImages.push(img);
            resolve(img);
          };
          img.onerror = () => reject(new Error('Failed to load arena: ' + url));
          img.src = url;
        });
      })
    ).then(() => {
      this.allLoaded = true;
      return this.loadedImages;
    });

    return this.preloadPromise;
  }

  selectArena(index) {
    if (this.loadedImages.length === 0) return;
    const idx = Math.max(0, Math.min(index, this.loadedImages.length - 1));
    this.selectedImage = this.loadedImages[idx];
  }

  pickRandomArena() {
    if (this.loadedImages.length === 0) return;
    this.selectedImage = this.loadedImages[Math.floor(Math.random() * this.loadedImages.length)];
  }

  setMode(mode, arenaIndex = null) {
    this.mode = mode;
    const size = CONFIG.ARENA[mode] || CONFIG.ARENA.FFA;
    this.width = size.width;
    this.height = size.height;
    if (arenaIndex !== null) {
      this.selectArena(arenaIndex);
    } else {
      this.pickRandomArena();
    }
  }

  // Full bounds including the fence/walls
  getBounds() {
    return {
      minX: -this.width / 2,
      minY: -this.height / 2,
      maxX: this.width / 2,
      maxY: this.height / 2
    };
  }

  // Inner bounds - playable floor inside the fence
  // Fence is roughly 9% horizontal and 13% vertical margin
  getInnerBounds() {
    const marginX = this.width * 0.09;
    const marginY = this.height * 0.13;
    return {
      minX: -this.width / 2 + marginX,
      minY: -this.height / 2 + marginY,
      maxX: this.width / 2 - marginX,
      maxY: this.height / 2 - marginY
    };
  }

  getSpawnPositions(count) {
    const positions = [];
    const inner = this.getInnerBounds();
    const innerWidth = inner.maxX - inner.minX;
    const innerHeight = inner.maxY - inner.minY;
    const radius = Math.min(innerWidth, innerHeight) * 0.35;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i;
      positions.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    return positions;
  }

  getRadius() {
    return Math.min(this.width, this.height) / 2;
  }

  isInside(x, y) {
    const inner = this.getInnerBounds();
    return x >= inner.minX && x <= inner.maxX && y >= inner.minY && y <= inner.maxY;
  }

  isReady() {
    return this.allLoaded && this.selectedImage !== null;
  }

  render(ctx, camera) {
    const bounds = this.getBounds();

    if (this.selectedImage && this.selectedImage.complete && this.selectedImage.naturalWidth > 0) {
      ctx.drawImage(this.selectedImage, bounds.minX, bounds.minY, this.width, this.height);
    }

    // Grid overlay
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    const grid = CONFIG.ARENA_GRID_SIZE;
    for (let x = bounds.minX; x <= bounds.maxX; x += grid) {
      ctx.moveTo(x, bounds.minY);
      ctx.lineTo(x, bounds.maxY);
    }
    for (let y = bounds.minY; y <= bounds.maxY; y += grid) {
      ctx.moveTo(bounds.minX, y);
      ctx.lineTo(bounds.maxX, y);
    }
    ctx.stroke();

    // Inner boundary line (the fence line)
    const inner = this.getInnerBounds();
    ctx.strokeStyle = 'rgba(0,255,255,0.35)';
    ctx.lineWidth = CONFIG.ARENA_BOUNDARY_THICKNESS;
    ctx.strokeRect(inner.minX, inner.minY, inner.maxX - inner.minX, inner.maxY - inner.minY);

    // Center safe zone
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
  }
}

export default ArenaManager;
