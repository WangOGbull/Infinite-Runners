import CONFIG from './config.js';

class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  clear() {
    this.cells.clear();
  }
  _key(cx, cy) {
    return cx + ',' + cy;
  }
  insert(x, y, item) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const key = this._key(cx, cy);
    let arr = this.cells.get(key);
    if (!arr) {
      arr = [];
      this.cells.set(key, arr);
    }
    arr.push(item);
  }
  query(x, y, radius) {
    const results = [];
    const rCells = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    for (let dx = -rCells; dx <= rCells; dx++) {
      for (let dy = -rCells; dy <= rCells; dy++) {
        const key = this._key(cx + dx, cy + dy);
        const arr = this.cells.get(key);
        if (arr) results.push(...arr);
      }
    }
    return results;
  }
}

class CollisionSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foodHash = new SpatialHash(80);
    this.bodyHash = new SpatialHash(80);
  }

  checkAll(dragonManager, foodSystem, arenaManager) {
    const dragons = dragonManager.getLivingDragons();
    const foods = foodSystem.getFoods();

    // Build food spatial hash
    this.foodHash.clear();
    const headRadius = CONFIG.DRAGON_HEAD_HITBOX_RADIUS;
    const foodRadius = CONFIG.FOOD_RADIUS;
    const foodThreshold = (headRadius + foodRadius);
    const foodThresholdSq = foodThreshold * foodThreshold;

    for (const food of foods) {
      this.foodHash.insert(food.x, food.y, food);
    }

    // Check food collisions (track eaten IDs to prevent double-eating)
    const eatenThisFrame = new Set();
    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      if (dragon.immunityTimer > 0) continue;
      const head = dragon.head;
      const nearbyFood = this.foodHash.query(head.x, head.y, foodThreshold);
      for (const food of nearbyFood) {
        if (eatenThisFrame.has(food.id)) continue;
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        if (dx * dx + dy * dy < foodThresholdSq) {
          eatenThisFrame.add(food.id);
          foodSystem.removeFood(food.id);
          this.eventBus.emit('collision:eat', { dragon, food });
        }
      }
    }

    // Build body segment spatial hash (exclude head/index 0)
    this.bodyHash.clear();
    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      const segs = dragon.segments;
      for (let i = 1; i < segs.length; i++) {
        this.bodyHash.insert(segs[i].x, segs[i].y, { seg: segs[i], dragon, index: i });
      }
    }

    // Check dragon-to-dragon collisions
    for (let i = 0; i < dragons.length; i++) {
      if (!dragons[i].alive) continue;
      for (let j = i + 1; j < dragons.length; j++) {
        if (!dragons[j].alive) continue;
        this.checkDragonCollisions(dragons[i], dragons[j]);
      }
    }
  }

  checkDragonCollisions(d1, d2) {
    if (d1.immunityTimer > 0 || d2.immunityTimer > 0) return;

    const dx = d1.head.x - d2.head.x;
    const dy = d1.head.y - d2.head.y;
    const distSq = dx * dx + dy * dy;
    const headHitDist = (d1.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) +
                        (d2.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS);
    const headHitDistSq = headHitDist * headHitDist;

    if (distSq < headHitDistSq) {
      const mx = (d1.head.x + d2.head.x) / 2;
      const my = (d1.head.y + d2.head.y) / 2;
      this.eventBus.emit('collision:head-hit', { d1, d2, x: mx, y: my });

      const len1 = d1.segments ? d1.segments.length : 0;
      const len2 = d2.segments ? d2.segments.length : 0;

      if (len1 < len2) {
        if (d2.attackActive) {
          if (!d1.isRemote) this.eventBus.emit('dragon:death', { dragon: d1, killer: d2 });
        } else if (len1 < CONFIG.SMALL_DRAGON_DEATH_THRESHOLD) {
          if (!d1.isRemote) this.eventBus.emit('dragon:death', { dragon: d1, killer: d2 });
        } else {
          if (!d1.isRemote) this.eventBus.emit('dragon:shrink', { dragon: d1, reason: 'head_clash' });
        }
      } else if (len2 < len1) {
        if (d1.attackActive) {
          if (!d2.isRemote) this.eventBus.emit('dragon:death', { dragon: d2, killer: d1 });
        } else if (len2 < CONFIG.SMALL_DRAGON_DEATH_THRESHOLD) {
          if (!d2.isRemote) this.eventBus.emit('dragon:death', { dragon: d2, killer: d1 });
        } else {
          if (!d2.isRemote) this.eventBus.emit('dragon:shrink', { dragon: d2, reason: 'head_clash' });
        }
      } else {
        if (!d1.isRemote) this.eventBus.emit('dragon:shrink', { dragon: d1, reason: 'equal_head', other: d2 });
        if (!d2.isRemote) this.eventBus.emit('dragon:shrink', { dragon: d2, reason: 'equal_head', other: d1 });
      }
      return;
    }

    this.checkHeadVsBody(d1, d2);
    this.checkHeadVsBody(d2, d1);
  }

  checkHeadVsBody(headDragon, bodyDragon) {
    if (headDragon.immunityTimer > 0 || bodyDragon.immunityTimer > 0) return;

    const head = headDragon.head;
    const headRadius = headDragon.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS;
    const bodyRadius = bodyDragon.headRadius || CONFIG.DRAGON_COLLISION_RADIUS;
    const hitDist = headRadius + bodyRadius;
    const hitDistSq = hitDist * hitDist;
    const lastIdx = bodyDragon.segments.length - 1;

    // Query spatial hash for nearby body segments, sorted by index to preserve original check order
    const nearby = this.bodyHash.query(head.x, head.y, hitDist)
      .filter(item => item.dragon === bodyDragon)
      .sort((a, b) => a.index - b.index);

    for (const item of nearby) {
      const seg = item.seg;
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      if (dx * dx + dy * dy >= hitDistSq) continue;

      const isTailHit = (item.index === lastIdx);

      if (isTailHit) {
        const headLen = headDragon.segments.length;
        const bodyLen = bodyDragon.segments.length;

        if (headLen > bodyLen) {
          if (!bodyDragon.isRemote) this.eventBus.emit('dragon:death', { dragon: bodyDragon, killer: headDragon });
        } else if (headLen < bodyLen) {
          const isDrake = headLen >= 10 && headLen <= 14;
          if (isDrake && headDragon.attackActive) {
            if (!bodyDragon.isRemote) this.eventBus.emit('dragon:tailDamage', { victim: bodyDragon, attacker: headDragon });
          } else if (!isDrake && headDragon.attackActive) {
            if (!bodyDragon.isRemote) this.eventBus.emit('collision:tail-cut', { victim: bodyDragon });
          } else {
            if (!bodyDragon.isRemote) this.eventBus.emit('collision:tail-cut', { victim: bodyDragon });
          }
        } else {
          if (!headDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: headDragon, reason: 'equal_tail', other: bodyDragon });
          if (!bodyDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: bodyDragon, reason: 'equal_tail', other: headDragon });
        }
      } else {
        // HEAD vs BODY (non-tail) — no collision
      }
      return;
    }
  }
}

export default CollisionSystem;
