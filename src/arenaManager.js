import CONFIG from './config.js';

class ArenaManager {
  constructor() {
    this.mode = 'FFA';
    this.width = 4200;
    this.height = 4200;
  }

  setMode(mode) {
    this.mode = mode;
    const size = CONFIG.ARENA[mode] || CONFIG.ARENA.FFA;
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
    const positions = [];
    const radius = Math.min(this.width, this.height) * 0.28;
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

  // Uniform random point inside the circle
  getRandomPointInside() {
    const radius = this.getRadius();
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (radius - 60);
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r
    };
  }

  isInside(x, y) {
    const radius = this.getRadius();
    return (x * x + y * y) <= (radius * radius);
  }

  render(ctx, camera) {
    const bounds = this.getBounds();
    const radius = this.getRadius();

    ctx.fillStyle = '#071018';
    ctx.fillRect(bounds.minX, bounds.minY, this.width, this.height);

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

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,255,255,0.35)';
    ctx.lineWidth = CONFIG.ARENA_BOUNDARY_THICKNESS;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
  }
}

export default ArenaManager;
