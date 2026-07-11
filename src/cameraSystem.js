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

  // Returns a multiplier applied on top of the growth-based zoom so the
  // amount of the arena actually visible (in world units) stays roughly
  // consistent across very different screen sizes.
  //
  // Previously CAMERA_MIN_ZOOM === CAMERA_MAX_ZOOM === 0.85, a hardcoded
  // constant used on every device. Since the visible world width is
  // `canvas.width / zoom`, a phone's much smaller canvas.width at that
  // SAME fixed zoom shows a far smaller slice of the arena than a desktop
  // monitor does - that's what read as the mobile view being "zoomed in."
  // This scales zoom down (zooms out) as canvas width shrinks, using a
  // desktop-ish reference width the base zoom was tuned against, clamped
  // so tiny phones don't zoom out so far detail becomes unreadable.
  _getResponsiveZoomMultiplier() {
    if (!this.canvas || !this.canvas.width) return 1;
    const REFERENCE_WIDTH = 1280;
    const MIN_MULTIPLIER = 0.55;
    const MAX_MULTIPLIER = 1;
    const raw = this.canvas.width / REFERENCE_WIDTH;
    return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw));
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
    const growthZoom = maxZ - (growthRatio * (maxZ - minZ));
    this.targetZoom = growthZoom * this._getResponsiveZoomMultiplier();
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
  apply(ctx, shakeX = 0, shakeY = 0) {
    ctx.save();
    const cx = this.canvas.width / 2 + shakeX;
    const cy = this.canvas.height / 2 + shakeY;
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
  isInView(wx, wy, radius) {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const sx = cx + (wx - this.x) * this.zoom;
    const sy = cy + (wy - this.y) * this.zoom;
    const margin = radius * this.zoom;
    return sx > -margin && sx < this.canvas.width + margin &&
           sy > -margin && sy < this.canvas.height + margin;
  }
}
