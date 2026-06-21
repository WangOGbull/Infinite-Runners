import CONFIG from './config.js';

class CameraSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = CONFIG.CAMERA_BASE_ZOOM;
    this.targetX = 0;
    this.targetY = 0;
    this.targetZoom = CONFIG.CAMERA_BASE_ZOOM;
  }

  update(targetDragon, arena) {
    if (!targetDragon || targetDragon.state !== 'alive') return;

    const head = targetDragon.head;

    const leadX = Math.cos(head.angle) * CONFIG.CAMERA_LEAD_DISTANCE;
    const leadY = Math.sin(head.angle) * CONFIG.CAMERA_LEAD_DISTANCE;

    this.targetX = head.x + leadX;
    this.targetY = head.y + leadY;

    this.targetZoom = CONFIG.CAMERA_BASE_ZOOM;

    this.x += (this.targetX - this.x) * CONFIG.CAMERA_SMOOTH_FACTOR;
    this.y += (this.targetY - this.y) * CONFIG.CAMERA_SMOOTH_FACTOR;
    this.zoom += (this.targetZoom - this.zoom) * CONFIG.CAMERA_SMOOTH_FACTOR;
  }

  worldToScreen(wx, wy) {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return {
      x: (wx - this.x) * this.zoom + cx,
      y: (wy - this.y) * this.zoom + cy
    };
  }

  screenToWorld(sx, sy) {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return {
      x: (sx - cx) / this.zoom + this.x,
      y: (sy - cy) / this.zoom + this.y
    };
  }

  apply(ctx) {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    ctx.setTransform(this.zoom, 0, 0, this.zoom, cx - this.x * this.zoom, cy - this.y * this.zoom);
  }

  reset(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  isInView(x, y, margin = 100) {
    const screenPos = this.worldToScreen(x, y);
    return screenPos.x > -margin && screenPos.x < this.canvas.width + margin &&
           screenPos.y > -margin && screenPos.y < this.canvas.height + margin;
  }
}

export default CameraSystem;
