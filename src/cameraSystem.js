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
    this.targetX = head.x;
    this.targetY = head.y;

    // Calculate zoom based on dragon length
    const zoomFromLength = CONFIG.CAMERA_BASE_ZOOM + 
      (targetDragon.length - CONFIG.DRAGON_START_SEGMENTS) * CONFIG.CAMERA_ZOOM_PER_SEGMENT;

    // Ensure dragon doesn't exceed max screen percentage
    const bounds = targetDragon.getBounds();
    const dragonWidth = bounds.maxX - bounds.minX;
    const dragonHeight = bounds.maxY - bounds.minY;
    const screenW = this.canvas.width;
    const screenH = this.canvas.height;

    let zoomFromSize = this.zoom;
    if (screenW > 0 && screenH > 0) {
      const maxDragonScreen = CONFIG.CAMERA_DRAGON_SCREEN_PERCENT_MAX;
      const zoomX = (screenW * maxDragonScreen) / (dragonWidth + 100);
      const zoomY = (screenH * maxDragonScreen) / (dragonHeight + 100);
      zoomFromSize = Math.min(zoomX, zoomY);
    }

    this.targetZoom = Math.max(CONFIG.CAMERA_MIN_ZOOM, 
      Math.min(CONFIG.CAMERA_MAX_ZOOM, Math.min(zoomFromLength, zoomFromSize)));

    // Smooth lerp
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
