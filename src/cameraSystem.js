import CONFIG from './config.js';

export default class CameraSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = CONFIG.CAMERA_BASE_ZOOM;
    this.targetX = 0;
    this.targetY = 0;
    this.targetZoom = CONFIG.CAMERA_BASE_ZOOM;
  }

  update(localDragon, arenaManager) {
    if (!localDragon) return;

    const leadDist = CONFIG.CAMERA_LEAD_DISTANCE;
    const targetX = localDragon.head.x + Math.cos(localDragon.angle) * leadDist;
    const targetY = localDragon.head.y + Math.sin(localDragon.angle) * leadDist;

    const segCount = localDragon.segments ? localDragon.segments.length : CONFIG.DRAGON_START_SEGMENTS;
    const growthRatio = Math.min(segCount / CONFIG.DRAGON_MAX_SEGMENTS, 1);

    const maxZ = CONFIG.CAMERA_MAX_ZOOM;
    const minZ = CONFIG.CAMERA_MIN_ZOOM;
    this.targetZoom = maxZ - (growthRatio * (maxZ - minZ));

    const smooth = CONFIG.CAMERA_SMOOTH_FACTOR;
    this.x += (targetX - this.x) * smooth;
    this.y += (targetY - this.y) * smooth;
    this.zoom += (this.targetZoom - this.zoom) * smooth;

    const bounds = arenaManager.getBounds();
    const viewW = this.canvas.width / this.zoom;
    const viewH = this.canvas.height / this.zoom;

    const minCamX = bounds.minX + viewW / 2;
    const maxCamX = bounds.maxX - viewW / 2;
    const minCamY = bounds.minY + viewH / 2;
    const maxCamY = bounds.maxY - viewH / 2;

    if (minCamX < maxCamX) {
      this.x = Math.max(minCamX, Math.min(maxCamX, this.x));
    }
    if (minCamY < maxCamY) {
      this.y = Math.max(minCamY, Math.min(maxCamY, this.y));
    }
  }

  apply(ctx) {
    ctx.save();
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  reset(ctx) {
    ctx.restore();
  }

  worldToScreen(wx, wy) {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return {
      x: cx + (wx - this.x) * this.zoom,
      y: cy + (wy - this.y) * this.zoom
    };
  }
}
