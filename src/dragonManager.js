import CONFIG from './config.js';
import AssetLoader from './assetLoader.js';

class Dragon {
  constructor(id, name, x, y, teamId = null) {
    this.id = id;
    this.name = name;
    this.asset = AssetLoader.getDragonByName(name);
    this.teamId = teamId;
    this.state = 'alive';
    this.score = 0;
    this.collected = 0;
    this.kills = 0;

    // Movement
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.targetAngle = 0;
    this.speed = CONFIG.DRAGON_BASE_SPEED;
    this.boostActive = false;

    // Segment size from asset (use body as reference)
    this.segmentSize = this.asset ? this.asset.body.width : 64;

    // Position history for smooth follow
    this.history = [];

    // Segments: [head, body..., tail]
    this.segments = [];
    this.initSegments();
  }

  initSegments() {
    const spacing = this.segmentSize * CONFIG.DRAGON_SEGMENT_SPACING;
    for (let i = 0; i < CONFIG.DRAGON_START_SEGMENTS; i++) {
      const type = i === 0 ? 'head' : (i === CONFIG.DRAGON_START_SEGMENTS - 1 ? 'tail' : 'body');
      this.segments.push({
        x: this.x - i * spacing,
        y: this.y,
        angle: this.angle,
        type
      });
      // Pre-fill history so tail doesn't snap
      this.history.push({ x: this.x - i * spacing, y: this.y, angle: this.angle });
    }
  }

  get head() { return this.segments[0]; }
  get tail() { return this.segments[this.segments.length - 1]; }
  get length() { return this.segments.length; }

  update(deltaTime, inputAngle) {
    if (this.state !== 'alive') return;

    // Smooth turn
    let diff = inputAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.angle += diff * CONFIG.DRAGON_TURN_SPEED * (deltaTime / 16);

    // Calculate current speed with penalty per segment
    const penalty = (this.length - CONFIG.DRAGON_START_SEGMENTS) * CONFIG.DRAGON_SPEED_PER_SEGMENT_PENALTY;
    let currentSpeed = Math.max(CONFIG.DRAGON_MIN_SPEED, CONFIG.DRAGON_BASE_SPEED + penalty);
    if (this.boostActive) currentSpeed *= 1.8;

    // Move head
    const head = this.head;
    head.x += Math.cos(this.angle) * currentSpeed * (deltaTime / 16);
    head.y += Math.sin(this.angle) * currentSpeed * (deltaTime / 16);
    head.angle = this.angle;

    // Record history
    this.history.unshift({ x: head.x, y: head.y, angle: this.angle });
    if (this.history.length > CONFIG.POSITION_HISTORY_BUFFER_SIZE) {
      this.history.pop();
    }

    // Update body segments using history
    const spacing = this.segmentSize * CONFIG.DRAGON_SEGMENT_SPACING;
    const historyStep = Math.max(1, Math.floor(spacing / currentSpeed));

    for (let i = 1; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const targetIndex = Math.min(i * historyStep, this.history.length - 1);
      const target = this.history[targetIndex];

      if (target) {
        const followSpeed = Math.max(0.05, CONFIG.DRAGON_FOLLOW_SPEED - i * CONFIG.DRAGON_FOLLOW_SPEED_DECAY);
        seg.x += (target.x - seg.x) * followSpeed * (deltaTime / 16);
        seg.y += (target.y - seg.y) * followSpeed * (deltaTime / 16);

        // Calculate angle toward target
        const dx = target.x - seg.x;
        const dy = target.y - seg.y;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          seg.angle = Math.atan2(dy, dx);
        }
      }
    }
  }

  grow(amount = 1) {
    if (this.segments.length >= CONFIG.DRAGON_MAX_SEGMENTS) return;

    const tail = this.tail;
    for (let i = 0; i < amount; i++) {
      if (this.segments.length >= CONFIG.DRAGON_MAX_SEGMENTS) break;
      // Insert before tail
      this.segments.splice(this.segments.length - 1, 0, {
        x: tail.x,
        y: tail.y,
        angle: tail.angle,
        type: 'body'
      });
    }
    this.collected += amount;
    this.score += amount * CONFIG.FOOD_NORMAL_POINTS;
  }

  shrink(amount) {
    // Remove body segments from tail side
    for (let i = 0; i < amount; i++) {
      if (this.segments.length <= CONFIG.DRAGON_START_SEGMENTS) break;
      this.segments.splice(this.segments.length - 2, 1); // Remove segment before tail
    }
  }

  render(ctx, camera) {
    if (!this.asset) return;

    // Draw from tail to head so head is on top
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i];
      const screenPos = camera.worldToScreen(seg.x, seg.y);
      const scale = camera.zoom * CONFIG.DRAGON_DISPLAY_SCALE;

      let sprite;
      let spriteScale = scale;
      if (seg.type === 'head') sprite = this.asset.head;
      else if (seg.type === 'tail') {
        sprite = this.asset.tail;
        spriteScale = scale * CONFIG.DRAGON_TAIL_TAPER_SCALE;
      } else {
        sprite = this.asset.body;
      }

      if (!sprite) continue;

      ctx.save();
      ctx.translate(screenPos.x, screenPos.y);
      ctx.rotate(seg.angle);
      ctx.drawImage(
        sprite,
        -sprite.width * spriteScale / 2,
        -sprite.height * spriteScale / 2,
        sprite.width * spriteScale,
        sprite.height * spriteScale
      );
      ctx.restore();
    }
  }

  getBounds() {
    // Simple bounding box for culling
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const seg of this.segments) {
      minX = Math.min(minX, seg.x);
      minY = Math.min(minY, seg.y);
      maxX = Math.max(maxX, seg.x);
      maxY = Math.max(maxY, seg.y);
    }
    return { minX, minY, maxX, maxY };
  }

  destroy() {
    this.state = 'dead';
    this.segments = [];
    this.history = [];
  }
}

class DragonManager {
  constructor() {
    this.dragons = new Map();
    this.nextId = 1;
  }

  createDragon(name, x, y, teamId = null) {
    const id = `dragon_${this.nextId++}`;
    const dragon = new Dragon(id, name, x, y, teamId);
    this.dragons.set(id, dragon);
    return dragon;
  }

  removeDragon(id) {
    const dragon = this.dragons.get(id);
    if (dragon) {
      dragon.destroy();
      this.dragons.delete(id);
    }
  }

  getDragon(id) {
    return this.dragons.get(id);
  }

  getAllDragons() {
    return Array.from(this.dragons.values());
  }

  getLivingDragons() {
    return this.getAllDragons().filter(d => d.state === 'alive');
  }

  update(deltaTime, inputMap) {
    for (const dragon of this.dragons.values()) {
      const input = inputMap.get(dragon.id) || 0;
      dragon.update(deltaTime, input);
    }
  }

  render(ctx, camera) {
    for (const dragon of this.dragons.values()) {
      if (dragon.state === 'alive') {
        dragon.render(ctx, camera);
      }
    }
  }

  clear() {
    for (const dragon of this.dragons.values()) {
      dragon.destroy();
    }
    this.dragons.clear();
    this.nextId = 1;
  }
}

export { Dragon, DragonManager };
