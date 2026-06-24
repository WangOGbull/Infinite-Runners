import CONFIG from './config.js';

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
      alive: true,
      head: { x, y },
      angle: Math.random() * Math.PI * 2,
      speed: CONFIG.DRAGON_BASE_SPEED,
      boostActive: false,
      segments: [],
      history: [],
      invulnerable: 0
    };

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

    this.dragons.push(dragon);
    return dragon;
  }

  getLivingDragons() {
    return this.dragons.filter(d => d.alive);
  }

  getAllDragons() {
    return this.dragons;
  }

  update(deltaTime, inputMap) {
    const dtFactor = deltaTime / 16;

    for (const dragon of this.dragons) {
      if (!dragon.alive) continue;

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

      dragon.history.unshift({ x: dragon.head.x, y: dragon.head.y });

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
  }

  render(ctx, camera) {
    for (const dragon of this.dragons) {
      if (!dragon.alive) continue;
      this.renderDragon(ctx, dragon);
    }
  }

  renderDragon(ctx, dragon) {
    const assets = window.game?.assetLoader?.getDragon?.(dragon.type) ||
                   (typeof AssetLoader !== 'undefined' ? AssetLoader.getDragon(dragon.type) : null);

    const baseScale = CONFIG.DRAGON_DISPLAY_SCALE;

    for (let i = dragon.segments.length - 1; i >= 0; i--) {
      const seg = dragon.segments[i];
      let segScale = baseScale;
      const tailStart = Math.floor(dragon.segments.length * 0.75);
      if (i >= tailStart) {
        const taper = 1 - ((i - tailStart) / (dragon.segments.length - tailStart)) * 0.4;
        segScale *= Math.max(0.5, taper);
      }

      ctx.save();
      ctx.translate(seg.x, seg.y);

      let angle = dragon.angle;
      if (i < dragon.segments.length - 1) {
        const next = dragon.segments[i + 1];
        angle = Math.atan2(next.y - seg.y, next.x - seg.x);
      } else if (dragon.history.length > 5) {
        const h = Math.min(5, dragon.history.length - 1);
        angle = Math.atan2(dragon.history[h].y - seg.y, dragon.history[h].x - seg.x);
      }
      ctx.rotate(angle);

      const img = assets?.body || assets?.image;
      if (img && img.complete && img.naturalWidth > 0) {
        const w = img.naturalWidth * segScale;
        const h = img.naturalHeight * segScale;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = this.getDragonColor(dragon.type);
        ctx.beginPath();
        ctx.arc(0, 0, 20 * segScale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.save();
    ctx.translate(dragon.head.x, dragon.head.y);
    ctx.rotate(dragon.angle);

    const headImg = assets?.head || assets?.image;
    const headScale = baseScale * 1.15;

    if (headImg && headImg.complete && headImg.naturalWidth > 0) {
      const w = headImg.naturalWidth * headScale;
      const h = headImg.naturalHeight * headScale;
      ctx.drawImage(headImg, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 22 * headScale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  getDragonColor(type) {
    const colors = {
      aegis: '#9b4dff',
      ignis: '#ff4d4d',
      infinite: '#00b4d8',
      magnetron: '#ff00aa'
    };
    return colors[type] || '#00b4d8';
  }
}
