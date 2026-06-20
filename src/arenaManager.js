import CONFIG from './config.js';

class ArenaManager {
  constructor() {
    this.width = 3000;
    this.height = 3000;
    this.mode = 'FFA';
  }

  setMode(mode) {
    this.mode = mode;
    const size = CONFIG.ARENA[mode] || CONFIG.ARENA['FFA'];
    this.width = size.width;
    this.height = size.height;
  }

  getBounds() {
    return {
      minX: -this.width / 2,
      minY: -this.height / 2,
      maxX: this.width / 2,
      maxY: this.height / 2
    };
  }

  getSpawnPositions(count) {
    const bounds = this.getBounds();
    const margin = CONFIG.PLAYER_SPAWN_MARGIN;
    const minDist = CONFIG.PLAYER_SPAWN_MIN_DISTANCE;

    const positions = [];
    const maxAttempts = 100;

    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let pos;
      do {
        pos = {
          x: bounds.minX + margin + Math.random() * (this.width - margin * 2),
          y: bounds.minY + margin + Math.random() * (this.height - margin * 2)
        };
        attempts++;
      } while (attempts < maxAttempts && positions.some(p => {
        const dx = p.x - pos.x;
        const dy = p.y - pos.y;
        return Math.sqrt(dx * dx + dy * dy) < minDist;
      }));
      positions.push(pos);
    }
    return positions;
  }

  isInside(x, y) {
    const bounds = this.getBounds();
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  render(ctx, camera) {
    const bounds = this.getBounds();

    // Draw background
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(bounds.minX, bounds.minY, this.width, this.height);

    // Draw grid
    ctx.strokeStyle = 'rgba(0, 180, 216, 0.08)';
    ctx.lineWidth = 1;
    const gridSize = CONFIG.ARENA_GRID_SIZE;

    ctx.beginPath();
    for (let x = bounds.minX; x <= bounds.maxX; x += gridSize) {
      ctx.moveTo(x, bounds.minY);
      ctx.lineTo(x, bounds.maxY);
    }
    for (let y = bounds.minY; y <= bounds.maxY; y += gridSize) {
      ctx.moveTo(bounds.minX, y);
      ctx.lineTo(bounds.maxX, y);
    }
    ctx.stroke();

    // Draw boundary
    ctx.strokeStyle = 'rgba(0, 180, 216, 0.4)';
    ctx.lineWidth = CONFIG.ARENA_BOUNDARY_THICKNESS;
    ctx.strokeRect(bounds.minX, bounds.minY, this.width, this.height);
  }
}

export default ArenaManager;
