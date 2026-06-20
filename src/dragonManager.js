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

    this.x = x;
    this.y = y;
    this.angle = 0;
    this.speed = CONFIG.DRAGON_BASE_SPEED;
    this.boostActive = false;

    this.segmentSize = this.asset ? this.asset.body.width : 64;
    this.history = [];
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

    // Constant speed — Snake Clash does NOT slow down as you grow
    let currentSpeed = CONFIG.DRAGON_BASE_SPEED;
    if (this.boostActive) currentSpeed *= 1.8;

    // Move head
    const head = this.head;
    head.x += Math.cos(this.angle) * currentSpeed * (deltaTime / 16);
    head.y += Math.sin(this.angle) * currentSpeed * (deltaTime / 16);
    head.angle = this.angle;

    // Record head position into path history
    this.history.unshift({ x: head.x, y: head.y, angle: this.angle });
    if (this.history.length > CONFIG.POSITION_HISTORY_BUFFER_SIZE) {
      this.history.pop();
    }

    // Place body segments at exact path-distance from head
    const spacing = this.segmentSize * CONFIG.DRAGON_SEGMENT_SPACING;

    for (let i = 1; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const targetDist = i * spacing;
      let accumulated = 0;
      let placed = false;

      for (let j = 0; j < this.history.length - 1; j++) {
        const p1 = this.history[j];
        const p2 = this.history[j + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (accumulated + dist >= targetDist) {
          const t = (targetDist - accumulated) / dist;
          seg.x = p1.x + dx * t;
          seg.y = p1.y + dy * t;
          // Face toward head (direction from older to newer point)
          seg.angle = Math.atan2(p1.y - p2.y, p1.x - p2.x);
          placed = true;
          break;
        }
        accumulated += dist;
      }

      if (!placed) {
        // Not enough history yet — clamp to last known point
        const last = this.history[this.history.length - 1];
        seg.x = last.x;
        seg.y = last.y;
        seg.angle = last.angle;
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
    for (let i = 0; i < amount; i++) {
      if (this.segments.length <= CONFIG.DRAGON_START_SEGMENTS) break;
      this.segments.splice(this.segments.length - 2, 1);
    }
  }

  render(ctx, camera) {
    if (!this.asset) return;

    // Draw tail first, head last
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
      const input = inputMap.get(dragon.id) || dragon.angle;
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
