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
        if (arr) {
          for (let i = 0; i < arr.length; i++) {
            results.push(arr[i]);
          }
        }
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
    this.recoilPairs = new Map();
    this.recoilCooldown = 180;
    this.maxClashPairs = new Map();
    this.maxClashCooldown = 2500;

    this._foodHashDirty = true;
    this._lastFoodCount = -1;
  }

  checkAll(dragonManager, foodSystem, arenaManager, resolveDragonCombat = true) {
    const dragons = dragonManager.getLivingDragons();
    const foods = foodSystem.getFoods();

    const now = performance.now();
    for (const [key, time] of this.recoilPairs) {
      if (now - time > this.recoilCooldown) {
        this.recoilPairs.delete(key);
      }
    }
    for (const [key, time] of this.maxClashPairs) {
      if (now - time > this.maxClashCooldown) this.maxClashPairs.delete(key);
    }

    if (this._foodHashDirty || this._lastFoodCount !== foods.length) {
      this.foodHash.clear();
      const headRadius = CONFIG.DRAGON_HEAD_HITBOX_RADIUS;
      const foodRadius = CONFIG.FOOD_RADIUS;
      const foodThreshold = headRadius + foodRadius;
      const foodThresholdSq = foodThreshold * foodThreshold;

      for (const food of foods) {
        this.foodHash.insert(food.x, food.y, food);
      }
      this._lastFoodCount = foods.length;
      this._foodHashDirty = false;
    } else {
      var headRadius = CONFIG.DRAGON_HEAD_HITBOX_RADIUS;
      var foodRadius = CONFIG.FOOD_RADIUS;
      var foodThreshold = headRadius + foodRadius;
      var foodThresholdSq = foodThreshold * foodThreshold;
    }

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
          this._foodHashDirty = true;
          this.eventBus.emit('collision:eat', { dragon, food });
        }
      }
    }

    this.bodyHash.clear();
    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      const segs = dragon.segments;
      for (let i = 1; i < segs.length; i++) {
        this.bodyHash.insert(segs[i].x, segs[i].y, { seg: segs[i], dragon, index: i });
      }
    }

    // In multiplayer, one client resolves the complete combat interaction.
    // Other clients replay its ordered network events instead of independently
    // inventing hits from an older interpolated opponent position.
    if (!resolveDragonCombat) return;
    for (let i = 0; i < dragons.length; i++) {
      if (!dragons[i].alive) continue;
      for (let j = i + 1; j < dragons.length; j++) {
        if (!dragons[j].alive) continue;
        this.checkDragonCollisions(dragons[i], dragons[j], resolveDragonCombat);
      }
    }
  }

  _getPairKey(d1, d2) {
    const id1 = d1.playerId || d1.id || d1.type || 'dragon-a';
    const id2 = d2.playerId || d2.id || d2.type || 'dragon-b';
    return String(id1) < String(id2) ? String(id1) + '::' + String(id2) : String(id2) + '::' + String(id1);
  }

  _emitRecoil(d1, d2, force = 1) {
    if (!d1 || !d2) return;
    const now = performance.now();
    const pairKey = this._getPairKey(d1, d2);
    const previousTime = this.recoilPairs.get(pairKey) || 0;
    if (now - previousTime < this.recoilCooldown) return;
    this.recoilPairs.set(pairKey, now);

    const dx = d1.head.x - d2.head.x;
    const dy = d1.head.y - d2.head.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let nx, ny;
    if (distance > 0.0001) {
      nx = dx / distance;
      ny = dy / distance;
    } else {
      const angle1 = typeof d1.angle === 'number' ? d1.angle : 0;
      const angle2 = typeof d2.angle === 'number' ? d2.angle : angle1 + Math.PI;
      const fallbackAngle = (angle1 + angle2 + Math.PI) / 2;
      nx = Math.cos(fallbackAngle);
      ny = Math.sin(fallbackAngle);
      const fallbackLength = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= fallbackLength;
      ny /= fallbackLength;
    }

    this.eventBus.emit('collision:recoil', { dragon: d1, other: d2, x: d1.head.x, y: d1.head.y, directionX: nx, directionY: ny, force });
    this.eventBus.emit('collision:recoil', { dragon: d2, other: d1, x: d2.head.x, y: d2.head.y, directionX: -nx, directionY: -ny, force });
  }

  // ─────────────────────────────────────────────────────────────
  // MP COLLISION FIX
  // ─────────────────────────────────────────────────────────────
  // Previously, ALL death/damage events were guarded by `!d.isRemote`,
  // which meant remote dragons in multiplayer NEVER triggered death
  // events locally. The local player would collide with a remote
  // opponent and nothing happened — no kill, no animation, no sound.
  //
  // FIX: Emit death/damage events for ALL dragons (local + remote).
  // The `dragon:death` handler in main.js now checks `isRemote` to
  // decide whether to AUTHORITATIVELY decrement lives/respawn (local
  // only) or just play visual/audio effects (remote — the remote
  // client owns the authoritative death).
  // ─────────────────────────────────────────────────────────────

  _emitDeath(dragon, killer, resolveDeath) {
    this.eventBus.emit(resolveDeath ? 'dragon:death' : 'collision:predicted-death', {
      dragon,
      killer
    });
  }

  checkDragonCollisions(d1, d2, resolveDeath = true) {
    if (d1.immunityTimer > 0 || d2.immunityTimer > 0) return;

    const dx = d1.head.x - d2.head.x;
    const dy = d1.head.y - d2.head.y;
    const distSq = dx * dx + dy * dy;
    const headHitDist = (d1.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) + (d2.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS);
    const headHitDistSq = headHitDist * headHitDist;

    if (distSq < headHitDistSq) {
      const mx = (d1.head.x + d2.head.x) / 2;
      const my = (d1.head.y + d2.head.y) / 2;
      this.eventBus.emit('collision:head-hit', { d1, d2, x: mx, y: my });

      const len1 = d1.segments ? d1.segments.length : 0;
      const len2 = d2.segments ? d2.segments.length : 0;

      const d1AtMax = len1 >= CONFIG.DRAGON_MAX_SEGMENTS || !!d1._networkAtMaxGrowth;
      const d2AtMax = len2 >= CONFIG.DRAGON_MAX_SEGMENTS || !!d2._networkAtMaxGrowth;
      if (d1AtMax && d2AtMax) {
        const pairKey = this._getPairKey(d1, d2);
        const previousTime = this.maxClashPairs.get(pairKey) || 0;
        if (performance.now() - previousTime >= this.maxClashCooldown) {
          this.maxClashPairs.set(pairKey, performance.now());
          if (resolveDeath) this.eventBus.emit('collision:max-clash', { d1, d2 });
        }
        this._emitRecoil(d1, d2, 1.25);
        return;
      }

      if (len1 < len2) {
        if (d2.attackActive) {
          this._emitDeath(d1, d2, resolveDeath)
        } else if (len1 < CONFIG.SMALL_DRAGON_DEATH_THRESHOLD) {
          this._emitDeath(d1, d2, resolveDeath)
        } else {
          this._emitRecoil(d1, d2, 1.0);
        }
      } else if (len2 < len1) {
        if (d1.attackActive) {
          this._emitDeath(d2, d1, resolveDeath)
        } else if (len2 < CONFIG.SMALL_DRAGON_DEATH_THRESHOLD) {
          this._emitDeath(d2, d1, resolveDeath)
        } else {
          this._emitRecoil(d1, d2, 1.0);
        }
      } else {
        this._emitRecoil(d1, d2, 1.0);
      }
      return;
    }

    this.checkHeadVsBody(d1, d2, resolveDeath);
    this.checkHeadVsBody(d2, d1, resolveDeath);
  }

  checkHeadVsBody(headDragon, bodyDragon, resolveDeath = true) {
    if (headDragon.immunityTimer > 0 || bodyDragon.immunityTimer > 0) return;

    const head = headDragon.head;
    const headRadius = headDragon.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS;
    const bodyRadius = bodyDragon.headRadius || CONFIG.DRAGON_COLLISION_RADIUS;
    const hitDist = headRadius + bodyRadius;
    const hitDistSq = hitDist * hitDist;
    const lastIdx = bodyDragon.segments.length - 1;

    // Avoid filter()+sort() allocations for every head/body pair every frame.
    // Spatial-hash insertion order already follows segment order, so a direct
    // scan produces the same collision priority with substantially less GC.
    const nearby = this.bodyHash.query(head.x, head.y, hitDist);

    for (const item of nearby) {
      if (item.dragon !== bodyDragon) continue;
      const seg = item.seg;
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      if (dx * dx + dy * dy >= hitDistSq) continue;

      const isTailHit = item.index === lastIdx;
      if (isTailHit) {
        const headLen = headDragon.segments.length;
        const bodyLen = bodyDragon.segments.length;

        if (headLen > bodyLen) {
          this._emitDeath(bodyDragon, headDragon, resolveDeath);
        } else if (headLen < bodyLen) {
          const isDrake = headLen >= 10 && headLen <= 14;
          if (isDrake && headDragon.attackActive) {
            this.eventBus.emit('dragon:tailDamage', { victim: bodyDragon, attacker: headDragon });
          } else if (!isDrake && headDragon.attackActive) {
            this.eventBus.emit('collision:tail-cut', { victim: bodyDragon });
          } else {
            this.eventBus.emit('collision:tail-cut', { victim: bodyDragon });
          }
          this._emitRecoil(headDragon, bodyDragon, 0.75);
        } else {
          this._emitRecoil(headDragon, bodyDragon, 0.85);
        }
      }
      return;
    }
  }
}

export default CollisionSystem;
