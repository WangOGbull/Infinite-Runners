import CONFIG from './config.js';
import * as AL from './assetLoader.js';
const AssetLoader = AL.default || AL;

export class DragonManager {
  constructor() {
    this.dragons = [];
    this.nextId = 1;
  }

  clear() {
    this.dragons = [];
  }

  createDragon(type, x, y, teamId = null) {
    const dragon = {
      id: 'dragon_' + (this.nextId++),
      type,
      teamId,
      score: 0,
      collected: 0,
      kills: 0,
      deaths: 0,
      lives: CONFIG.LIVES_PER_ROUND,
      alive: true,
      head: { x, y },
      angle: Math.random() * Math.PI * 2,
      speed: CONFIG.DRAGON_BASE_SPEED,
      boostActive: false,
      segments: [],
      history: [],
      invulnerable: 0,
      immunityTimer: 0,
      isRemote: false,
      playerId: null,
      remoteTarget: null,
      aiTargetAngle: null,
      spawnTime: Date.now()
    };

    this.initDragonSegments(dragon, x, y);
    this.dragons.push(dragon);
    return dragon;
  }

  initDragonSegments(dragon, x, y) {
    dragon.segments = [];
    dragon.history = [];
    const spacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;

    for (let i = 0; i < CONFIG.DRAGON_START_SEGMENTS; i++) {
      dragon.segments.push({
        x: x - Math.cos(dragon.angle) * (i + 1) * spacing,
        y: y - Math.sin(dragon.angle) * (i + 1) * spacing
      });
    }

    for (let i = 0; i < CONFIG.DRAGON_START_SEGMENTS * 10; i++) {
      dragon.history.push({
        x: x - Math.cos(dragon.angle) * i * (spacing / 10),
        y: y - Math.sin(dragon.angle) * i * (spacing / 10)
      });
    }
  }

  // Respawn dragon at a random arena edge, facing inward
  respawnDragon(dragon, arenaManager) {
    const bounds = arenaManager.getInnerBounds();
    const edge = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
    let x, y, angle;

    switch (edge) {
      case 0: // top edge
        x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        y = bounds.minY + 60;
        angle = Math.PI / 2; // face down (inward)
        break;
      case 1: // right edge
        x = bounds.maxX - 60;
        y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
        angle = Math.PI; // face left (inward)
        break;
      case 2: // bottom edge
        x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        y = bounds.maxY - 60;
        angle = -Math.PI / 2; // face up (inward)
        break;
      case 3: // left edge
        x = bounds.minX + 60;
        y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
        angle = 0; // face right (inward)
        break;
    }

    dragon.head.x = x;
    dragon.head.y = y;
    dragon.angle = angle;
    dragon.alive = true;
    dragon.immunityTimer = CONFIG.SPAWN_IMMUNITY_MS;
    dragon.spawnTime = Date.now();

    this.initDragonSegments(dragon, x, y);
  }

  // Shrink dragon back to starting size
  shrinkDragon(dragon) {
    // Reset segments to start size
    const spacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;
    const startSegs = CONFIG.DRAGON_START_SEGMENTS;

    // Keep head position, rebuild segments behind it
    const headX = dragon.head.x;
    const headY = dragon.head.y;
    const angle = dragon.angle;

    dragon.segments = [];
    for (let i = 0; i < startSegs; i++) {
      dragon.segments.push({
        x: headX - Math.cos(angle) * (i + 1) * spacing,
        y: headY - Math.sin(angle) * (i + 1) * spacing
      });
    }

    // Rebuild history
    dragon.history = [];
    for (let i = 0; i < startSegs * 10; i++) {
      dragon.history.push({
        x: headX - Math.cos(angle) * i * (spacing / 10),
        y: headY - Math.sin(angle) * (i + 1) * spacing
      });
    }
  }

  getLivingDragons() {
    return this.dragons.filter(d => d.alive);
  }

  getAllDragons() {
    return this.dragons;
  }

  removeDead() {
    // Don't remove dead dragons anymore - they respawn or are eliminated
    // Just filter for rendering
  }

  update(deltaTime, inputMap, bounds = null) {
    const dtFactor = deltaTime / 16;

    for (const dragon of this.dragons) {
      if (!dragon.alive) continue;

      // Decrement immunity timer
      if (dragon.immunityTimer > 0) {
        dragon.immunityTimer -= deltaTime;
        if (dragon.immunityTimer < 0) dragon.immunityTimer = 0;
      }

      // ==================== REMOTE DRAGON ====================
      if (dragon.isRemote) {
        if (dragon.remoteTarget) {
          const lerp = 0.25;
          dragon.head.x += (dragon.remoteTarget.x - dragon.head.x) * lerp;
          dragon.head.y += (dragon.remoteTarget.y - dragon.head.y) * lerp;
        }
        dragon.history.unshift({ x: dragon.head.x, y: dragon.head.y });
        this.placeSegments(dragon);
        this.trimHistory(dragon);
        continue;
      }

      // ==================== LOCAL / AI DRAGON ====================
      const inputAngle = inputMap.get(dragon.id);
      if (inputAngle !== undefined) {
        let diff = inputAngle - dragon.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        dragon.angle += diff * CONFIG.DRAGON_TURN_SPEED * dtFactor;
      }

      let moveSpeed = dragon.speed;
      if (dragon.boostActive) {
        moveSpeed *= CONFIG.DRAGON_BOOST_MULTIPLIER;
      }

      const vx = Math.cos(dragon.angle) * moveSpeed * dtFactor;
      const vy = Math.sin(dragon.angle) * moveSpeed * dtFactor;

      dragon.head.x += vx;
      dragon.head.y += vy;

      // CLAMP to bounds (no death, just clamp)
      if (bounds) {
        const margin = 10;
        if (dragon.head.x < bounds.minX + margin) {
          dragon.head.x = bounds.minX + margin;
          dragon.angle = Math.PI - dragon.angle;
        } else if (dragon.head.x > bounds.maxX - margin) {
          dragon.head.x = bounds.maxX - margin;
          dragon.angle = Math.PI - dragon.angle;
        }
        if (dragon.head.y < bounds.minY + margin) {
          dragon.head.y = bounds.minY + margin;
          dragon.angle = -dragon.angle;
        } else if (dragon.head.y > bounds.maxY - margin) {
          dragon.head.y = bounds.maxY - margin;
          dragon.angle = -dragon.angle;
        }
      }

      dragon.history.unshift({ x: dragon.head.x, y: dragon.head.y });
      this.placeSegments(dragon);
      this.trimHistory(dragon);
    }
  }

  placeSegments(dragon) {
    const spacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;

    for (let i = 0; i < dragon.segments.length; i++) {
      const targetDist = (i + 1) * spacing;
      let accumulated = 0;
      let placed = false;

      for (let h = 0; h < dragon.history.length - 1; h++) {
        const p1 = dragon.history[h];
        const p2 = dragon.history[h + 1];
        const segDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);

        if (accumulated + segDist >= targetDist) {
          const t = (targetDist - accumulated) / segDist;
          dragon.segments[i].x = p1.x + (p2.x - p1.x) * t;
          dragon.segments[i].y = p1.y + (p2.y - p1.y) * t;
          placed = true;
          break;
        }
        accumulated += segDist;
      }

      if (!placed && dragon.history.length > 0) {
        const last = dragon.history[dragon.history.length - 1];
        dragon.segments[i].x = last.x;
        dragon.segments[i].y = last.y;
      }
    }
  }

  trimHistory(dragon) {
    const spacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;
    const maxNeeded = dragon.segments.length * spacing * 3;
    let totalDist = 0;
    let trimIdx = dragon.history.length;

    for (let h = 0; h < dragon.history.length - 1; h++) {
      const p1 = dragon.history[h];
      const p2 = dragon.history[h + 1];
      totalDist += Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (totalDist > maxNeeded) {
        trimIdx = h + 1;
        break;
      }
    }

    if (trimIdx < dragon.history.length) {
      dragon.history.length = trimIdx;
    }
  }

  render(ctx, camera) {
    for (const dragon of this.dragons) {
      if (!dragon.alive) continue;
      this.renderDragon(ctx, dragon);
    }
  }

  renderDragon(ctx, dragon) {
    const assets = AssetLoader.getDragonByName(dragon.type);
    if (!assets) return;

    const baseScale = CONFIG.DRAGON_DISPLAY_SCALE;
    const segCount = dragon.segments.length;

    for (let i = segCount - 1; i >= 0; i--) {
      const seg = dragon.segments[i];
      const isTail = (i === segCount - 1);

      // Progressive body taper: full width at the neck, narrowing toward
      // the tail - matches the full-body reference art. The tail sprite
      // keeps its own scale (the artwork is already pointed).
      const taper = segCount > 1
        ? 1 - (i / (segCount - 1)) * (1 - CONFIG.DRAGON_TAIL_TAPER_SCALE)
        : 1;

      let partImg = assets.body;
      let partScale = baseScale * (assets.display?.body?.scale || 1) * taper;

      if (isTail && assets.tail) {
        partImg = assets.tail;
        partScale = baseScale * (assets.display?.tail?.scale || 1);
      }

      if (!partImg || !partImg.complete || partImg.naturalWidth === 0) continue;

      ctx.save();
      ctx.translate(seg.x, seg.y);

      let angle = dragon.angle;
      if (i < segCount - 1) {
        const next = dragon.segments[i + 1];
        angle = Math.atan2(next.y - seg.y, next.x - seg.x);
      } else if (i > 0) {
        const prev = dragon.segments[i - 1];
        angle = Math.atan2(seg.y - prev.y, seg.x - prev.x);
      }
      ctx.rotate(angle);

      // Flash effect during immunity
      if (dragon.immunityTimer > 0) {
        const flash = Math.sin(Date.now() / 50) > 0;
        ctx.globalAlpha = flash ? 0.5 : 1.0;
      }

      const w = partImg.naturalWidth * partScale;
      const h = partImg.naturalHeight * partScale;
      ctx.drawImage(partImg, -w / 2, -h / 2, w, h);

      ctx.restore();
    }

    if (!assets.head || !assets.head.complete || assets.head.naturalWidth === 0) return;

    ctx.save();
    ctx.translate(dragon.head.x, dragon.head.y);
    // New front-facing heads point DOWN toward the camera in the image,
    // so the sprite is offset by -90 degrees (was +90 for the old
    // back-facing heads). This makes the dragon move stomach-first.
    ctx.rotate(dragon.angle - Math.PI / 2);

    // Flash effect during immunity
    if (dragon.immunityTimer > 0) {
      const flash = Math.sin(Date.now() / 50) > 0;
      ctx.globalAlpha = flash ? 0.5 : 1.0;
    }

    const headScale = (baseScale * (assets.display?.head?.scale || 1)) * 1.5;
    const w = assets.head.naturalWidth * headScale;
    const h = assets.head.naturalHeight * headScale;
    ctx.drawImage(assets.head, -w / 2, -h / 2, w, h);

    ctx.restore();
  }
}
