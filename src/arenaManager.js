import CONFIG from './config.js';

const ARENA_URLS = [
  '/arenas/arena_stone.png',
  '/arenas/arena_grass.png',
  '/arenas/arena_purple.png',
  '/arenas/arena_fire.png'
];

export const ARENA_NAMES = ['Stone Castle', 'Grass Field', 'Purple Magic', 'Fire Arena'];
export const ARENA_COLORS = ['#8B9DC3', '#4CAF50', '#9C27B0', '#FF5722'];

class ArenaManager {
  constructor() {
    this.mode = 'FFA';
    this.width = 4200;
    this.height = 4200;
    this.loadedImages = [null, null, null, null];
    this.selectedImage = null;
    this.allLoaded = false;
    this.preloadPromise = null;
  }

  preloadAll() {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = Promise.all(
      ARENA_URLS.map((url, index) => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            this.loadedImages[index] = img;
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

  getBounds() {
    return {
      minX: -this.width / 2,
      minY: -this.height / 2,
      maxX: this.width / 2,
      maxY: this.height / 2
    };
  }

  // Inner bounds — tight to the fence (6% horizontal, 9% vertical)
  // Bottom gets extra 5% margin because the bottom fence is thicker
  getInnerBounds() {
    const marginX = this.width * 0.06;
    const marginY = this.height * 0.09;
    const bottomExtra = this.height * 0.05;
    return {
      minX: -this.width / 2 + marginX,
      minY: -this.height / 2 + marginY,
      maxX: this.width / 2 - marginX,
      maxY: this.height / 2 - marginY - bottomExtra
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

    // Grid overlay — only compute lines inside the camera's visible
    // viewport (with a small margin), not the entire 4200x4200 arena.
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    const grid = CONFIG.ARENA_GRID_SIZE;
    let gridMinX = bounds.minX, gridMaxX = bounds.maxX;
    let gridMinY = bounds.minY, gridMaxY = bounds.maxY;
    if (camera && camera.canvas && camera.zoom) {
      const margin = grid;
      const viewW = camera.canvas.width / camera.zoom;
      const viewH = camera.canvas.height / camera.zoom;
      gridMinX = Math.max(bounds.minX, camera.x - viewW / 2 - margin);
      gridMaxX = Math.min(bounds.maxX, camera.x + viewW / 2 + margin);
      gridMinY = Math.max(bounds.minY, camera.y - viewH / 2 - margin);
      gridMaxY = Math.min(bounds.maxY, camera.y + viewH / 2 + margin);
    }
    const startX = bounds.minX + Math.floor((gridMinX - bounds.minX) / grid) * grid;
    const startY = bounds.minY + Math.floor((gridMinY - bounds.minY) / grid) * grid;
    for (let x = startX; x <= gridMaxX; x += grid) {
      ctx.moveTo(x, gridMinY);
      ctx.lineTo(x, gridMaxY);
    }
    for (let y = startY; y <= gridMaxY; y += grid) {
      ctx.moveTo(gridMinX, y);
      ctx.lineTo(gridMaxX, y);
    }
    ctx.stroke();

    // Center safe zone
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
  }
}

export default ArenaManager;
