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

  // Attack meter (gun-magazine model): eating loads the magazine.
  // Returns true when it JUST became full.
  addAttackCharge(dragon, amount = 1) {
    if (!dragon || !dragon.alive) return false;

    const wasFull =
      (dragon.attackCharge || 0) >= CONFIG.ATTACK_METER_MAX;

    dragon.attackCharge = Math.min(
      CONFIG.ATTACK_METER_MAX,
      (dragon.attackCharge || 0) + amount
    );

    return (
      !wasFull &&
      dragon.attackCharge >= CONFIG.ATTACK_METER_MAX
    );
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

      attackCharge: 0,
      attackActive: false,
      attackHeld: false,

      killStreak: 0,

      segments: [],
      history: [],

      invulnerable: 0,
      immunityTimer: 0,

      isRemote: false,
      playerId: null,
      remoteTarget: null,
      aiTargetAngle: null,

      spawnTime: Date.now(),

      // ============================================================
      // COLLISION RECOIL
      // ============================================================
      // Collision no longer changes dragon size.
      // Instead, the collision system gives the dragon a temporary
      // physical push through these velocity values.
      collisionRecoilX: 0,
      collisionRecoilY: 0
    };

    this.initDragonSegments(dragon, x, y);

    this.dragons.push(dragon);

    return dragon;
  }

  initDragonSegments(dragon, x, y) {
    dragon.segments = [];
    dragon.history = [];

    const spacing =
      CONFIG.DRAGON_SEGMENT_SPACING * 35;

    for (
      let i = 0;
      i < CONFIG.DRAGON_START_SEGMENTS;
      i++
    ) {
      dragon.segments.push({
        x:
          x -
          Math.cos(dragon.angle) *
            (i + 1) *
            spacing,

        y:
          y -
          Math.sin(dragon.angle) *
            (i + 1) *
            spacing
      });
    }

    for (
      let i = 0;
      i < CONFIG.DRAGON_START_SEGMENTS * 10;
      i++
    ) {
      dragon.history.push({
        x:
          x -
          Math.cos(dragon.angle) *
            i *
            (spacing / 10),

        y:
          y -
          Math.sin(dragon.angle) *
            i *
            (spacing / 10)
      });
    }
  }

  // Respawn dragon at a random arena edge, facing inward
  respawnDragon(dragon, arenaManager) {
    const bounds =
      arenaManager.getInnerBounds();

    const edge =
      Math.floor(Math.random() * 4);

    let x;
    let y;
    let angle;

    switch (edge) {
      case 0:
        // top edge
        x =
          bounds.minX +
          Math.random() *
            (bounds.maxX - bounds.minX);

        y = bounds.minY + 60;

        angle = Math.PI / 2;

        break;

      case 1:
        // right edge
        x = bounds.maxX - 60;

        y =
          bounds.minY +
          Math.random() *
            (bounds.maxY - bounds.minY);

        angle = Math.PI;

        break;

      case 2:
        // bottom edge
        x =
          bounds.minX +
          Math.random() *
            (bounds.maxX - bounds.minX);

        y = bounds.maxY - 60;

        angle = -Math.PI / 2;

        break;

      case 3:
        // left edge
        x = bounds.minX + 60;

        y =
          bounds.minY +
          Math.random() *
            (bounds.maxY - bounds.minY);

        angle = 0;

        break;
    }

    dragon.head.x = x;
    dragon.head.y = y;

    dragon.angle = angle;

    dragon.alive = true;

    dragon.attackActive = false;
    dragon.attackHeld = false;
    dragon.attackCharge = 0;
    dragon.boostActive = false;

    dragon.immunityTimer =
      CONFIG.SPAWN_IMMUNITY_MS;

    dragon.spawnTime = Date.now();

    // Clear any previous collision recoil.
    dragon.collisionRecoilX = 0;
    dragon.collisionRecoilY = 0;

    this.initDragonSegments(
      dragon,
      x,
      y
    );
  }

  // ================================================================
  // COLLISION RECOIL
  // ================================================================
  //
  // Called by the game event system when collisionSystem emits:
  //
  // collision:recoil
  //
  // This DOES NOT change dragon size or segment count.
  // It simply gives the dragon a temporary physical push.
  //
  applyCollisionRecoil(
    dragon,
    directionX,
    directionY,
    force = 1
  ) {
    if (!dragon || !dragon.alive) return;

    let dx =
      Number.isFinite(directionX)
        ? directionX
        : 0;

    let dy =
      Number.isFinite(directionY)
        ? directionY
        : 0;

    const length =
      Math.sqrt(dx * dx + dy * dy);

    if (length <= 0.0001) return;

    dx /= length;
    dy /= length;

    // Recoil strength.
    //
    // This is deliberately independent from:
    // - dragon size
    // - segment count
    // - Attack boost
    // - Sprint
    //
    // It is purely physical collision response.
    const recoilStrength =
      5.5 * Math.max(0.5, force);

    dragon.collisionRecoilX +=
      dx * recoilStrength;

    dragon.collisionRecoilY +=
      dy * recoilStrength;

    // Prevent extremely large accumulated recoil
    // when multiple collision events happen close together.
    const maxRecoil = 12;

    const currentLength =
      Math.sqrt(
        dragon.collisionRecoilX *
          dragon.collisionRecoilX +
        dragon.collisionRecoilY *
          dragon.collisionRecoilY
      );

    if (currentLength > maxRecoil) {
      const scale =
        maxRecoil / currentLength;

      dragon.collisionRecoilX *= scale;
      dragon.collisionRecoilY *= scale;
    }
  }

  // Shrink dragon back to starting size.
  //
  // IMPORTANT:
  // CollisionSystem no longer calls this method.
  //
  // It remains here because other game systems may still use
  // shrinkDragon() intentionally in the future.
  shrinkDragon(dragon) {
    // Reset segments to start size
    const spacing =
      CONFIG.DRAGON_SEGMENT_SPACING * 35;

    const startSegs =
      CONFIG.DRAGON_START_SEGMENTS;

    // Keep head position, rebuild segments behind it
    const headX = dragon.head.x;
    const headY = dragon.head.y;
    const angle = dragon.angle;

    dragon.segments = [];

    for (
      let i = 0;
      i < startSegs;
      i++
    ) {
      dragon.segments.push({
        x:
          headX -
          Math.cos(angle) *
            (i + 1) *
            spacing,

        y:
          headY -
          Math.sin(angle) *
            (i + 1) *
            spacing
      });
    }

    // Rebuild history
    dragon.history = [];

    for (
      let i = 0;
      i < startSegs * 10;
      i++
    ) {
      dragon.history.push({
        x:
          headX -
          Math.cos(angle) *
            i *
            (spacing / 10),

        y:
          headY -
          Math.sin(angle) *
            (i + 1) *
            spacing
      });
    }
  }

  getLivingDragons() {
    return this.dragons.filter(
      d => d.alive
    );
  }

  getAllDragons() {
    return this.dragons;
  }

  removeDead() {
    // Don't remove dead dragons anymore -
    // they respawn or are eliminated.
    // Just filter for rendering.
  }

  update(
    deltaTime,
    inputMap,
    bounds = null
  ) {
    const dtFactor =
      deltaTime / 16;

    for (const dragon of this.dragons) {
      if (!dragon.alive) continue;

      // ============================================================
      // ATTACK
      // ============================================================
      //
      // Attack remains the gun-magazine model.
      //
      // IMPORTANT:
      // Attack speed is now exactly 20% of the current
      // Attack-boosted speed.
      //
      // Example:
      //
      // Previous effective multiplier = 1.1x
      // New effective multiplier      = 0.22x
      //
      // This does NOT affect Sprint.
      //
      if (!dragon.isRemote) {
        const wantsAttack =
          !!dragon.attackHeld &&
          (dragon.attackCharge || 0) > 0;

        if (wantsAttack) {
          dragon.attackActive = true;


          const drain =
            (CONFIG.ATTACK_METER_MAX /
              CONFIG.ATTACK_DURATION_MS) *
            deltaTime;

          dragon.attackCharge =
            Math.max(
              0,
              dragon.attackCharge - drain
            );

          if (dragon.attackCharge <= 0) {
            // Magazine dry.
            dragon.attackHeld = false;
            dragon.attackActive = false;

          }
        } else if (dragon.attackActive) {
          dragon.attackActive = false;

        }
      }

      // ============================================================
      // IMMUNITY
      // ============================================================
      if (dragon.immunityTimer > 0) {
        dragon.immunityTimer -= deltaTime;

        if (dragon.immunityTimer < 0) {
          dragon.immunityTimer = 0;
        }
      }

      // ============================================================
      // REMOTE DRAGON
      // ============================================================
      if (dragon.isRemote) {
        if (dragon.remoteTarget) {
          const lerp = 0.25;

          dragon.head.x +=
            (dragon.remoteTarget.x -
              dragon.head.x) *
            lerp;

          dragon.head.y +=
            (dragon.remoteTarget.y -
              dragon.head.y) *
            lerp;
        }

        // Apply collision recoil to remote dragons too.
        dragon.head.x +=
          dragon.collisionRecoilX *
          dtFactor;

        dragon.head.y +=
          dragon.collisionRecoilY *
          dtFactor;

        // Recoil fades smoothly.
        const recoilDamping =
          Math.pow(
            0.78,
            dtFactor
          );

        dragon.collisionRecoilX *=
          recoilDamping;

        dragon.collisionRecoilY *=
          recoilDamping;

        if (
          Math.abs(dragon.collisionRecoilX) <
          0.01
        ) {
          dragon.collisionRecoilX = 0;
        }

        if (
          Math.abs(dragon.collisionRecoilY) <
          0.01
        ) {
          dragon.collisionRecoilY = 0;
        }

        dragon.history.unshift({
          x: dragon.head.x,
          y: dragon.head.y
        });

        this.placeSegments(dragon);
        this.trimHistory(dragon);

        continue;
      }

      // ============================================================
      // LOCAL / AI DRAGON
      // ============================================================
      const inputAngle =
        inputMap.get(dragon.id);

      if (inputAngle !== undefined) {
        let diff =
          inputAngle -
          dragon.angle;

        while (diff > Math.PI) {
          diff -= Math.PI * 2;
        }

        while (diff < -Math.PI) {
          diff += Math.PI * 2;
        }

        dragon.angle +=
          diff *
          CONFIG.DRAGON_TURN_SPEED *
          dtFactor;
      }

      // ============================================================
      // NORMAL MOVEMENT
      // ============================================================
      let moveSpeed =
        dragon.speed;

      // Attack gives +30% speed boost
      if (dragon.attackActive) {
        moveSpeed *= 1.30;
      }


      const vx =
        Math.cos(dragon.angle) *
        moveSpeed *
        dtFactor;

      const vy =
        Math.sin(dragon.angle) *
        moveSpeed *
        dtFactor;

      dragon.head.x += vx;
      dragon.head.y += vy;

      // ============================================================
      // COLLISION RECOIL
      // ============================================================
      //
      // Recoil is added to the head position.
      //
      // The existing history/segment system then naturally follows
      // the head, so we do NOT manually resize, rebuild, or move
      // individual body segments here.
      //
      dragon.head.x +=
        dragon.collisionRecoilX *
        dtFactor;

      dragon.head.y +=
        dragon.collisionRecoilY *
        dtFactor;

      // Smooth recoil damping.
      const recoilDamping =
        Math.pow(
          0.78,
          dtFactor
        );

      dragon.collisionRecoilX *=
        recoilDamping;

      dragon.collisionRecoilY *=
        recoilDamping;

      if (
        Math.abs(dragon.collisionRecoilX) <
        0.01
      ) {
        dragon.collisionRecoilX = 0;
      }

      if (
        Math.abs(dragon.collisionRecoilY) <
        0.01
      ) {
        dragon.collisionRecoilY = 0;
      }

      // ============================================================
      // BOUNDS
      // ============================================================
      if (bounds) {
        const margin = 10;

        if (
          dragon.head.x <
          bounds.minX + margin
        ) {
          dragon.head.x =
            bounds.minX + margin;

          dragon.angle =
            Math.PI -
            dragon.angle;

          // Stop outward recoil at the wall.
          if (
            dragon.collisionRecoilX < 0
          ) {
            dragon.collisionRecoilX = 0;
          }
        }

        else if (
          dragon.head.x >
          bounds.maxX - margin
        ) {
          dragon.head.x =
            bounds.maxX - margin;

          dragon.angle =
            Math.PI -
            dragon.angle;

          // Stop outward recoil at the wall.
          if (
            dragon.collisionRecoilX > 0
          ) {
            dragon.collisionRecoilX = 0;
          }
        }

        if (
          dragon.head.y <
          bounds.minY + margin
        ) {
          dragon.head.y =
            bounds.minY + margin;

          dragon.angle =
            -dragon.angle;

          // Stop outward recoil at the wall.
          if (
            dragon.collisionRecoilY < 0
          ) {
            dragon.collisionRecoilY = 0;
          }
        }

        else if (
          dragon.head.y >
          bounds.maxY - margin
        ) {
          dragon.head.y =
            bounds.maxY - margin;

          dragon.angle =
            -dragon.angle;

          // Stop outward recoil at the wall.
          if (
            dragon.collisionRecoilY > 0
          ) {
            dragon.collisionRecoilY = 0;
          }
        }
      }

      // ============================================================
      // HISTORY + SEGMENTS
      // ============================================================
      //
      // Keep the original body-following system untouched.
      //
      dragon.history.unshift({
        x: dragon.head.x,
        y: dragon.head.y
      });

      this.placeSegments(dragon);
      this.trimHistory(dragon);
    }
  }

  placeSegments(dragon) {
    const spacing =
      CONFIG.DRAGON_SEGMENT_SPACING *
      35;

    for (
      let i = 0;
      i < dragon.segments.length;
      i++
    ) {
      const targetDist =
        (i + 1) * spacing;

      let accumulated = 0;
      let placed = false;

      for (
        let h = 0;
        h < dragon.history.length - 1;
        h++
      ) {
        const p1 =
          dragon.history[h];

        const p2 =
          dragon.history[h + 1];

        const segDist =
          Math.hypot(
            p1.x - p2.x,
            p1.y - p2.y
          );

        if (
          accumulated + segDist >=
          targetDist
        ) {
          const t =
            (targetDist -
              accumulated) /
            segDist;

          dragon.segments[i].x =
            p1.x +
            (p2.x - p1.x) *
              t;

          dragon.segments[i].y =
            p1.y +
            (p2.y - p1.y) *
              t;

          placed = true;

          break;
        }

        accumulated += segDist;
      }

      if (
        !placed &&
        dragon.history.length > 0
      ) {
        const last =
          dragon.history[
            dragon.history.length - 1
          ];

        dragon.segments[i].x =
          last.x;

        dragon.segments[i].y =
          last.y;
      }
    }
  }

  trimHistory(dragon) {
    const spacing =
      CONFIG.DRAGON_SEGMENT_SPACING *
      35;

    const maxNeeded =
      dragon.segments.length *
      spacing *
      3;

    let totalDist = 0;
    let trimIdx =
      dragon.history.length;

    for (
      let h = 0;
      h < dragon.history.length - 1;
      h++
    ) {
      const p1 =
        dragon.history[h];

      const p2 =
        dragon.history[h + 1];

      totalDist +=
        Math.hypot(
          p1.x - p2.x,
          p1.y - p2.y
        );

      if (
        totalDist >
        maxNeeded
      ) {
        trimIdx = h + 1;
        break;
      }
    }

    if (
      trimIdx <
      dragon.history.length
    ) {
      dragon.history.length =
        trimIdx;
    }
  }

  render(ctx, camera) {
    for (const dragon of this.dragons) {
      if (!dragon.alive) continue;

      // Skip dragons nowhere near the camera.
      // Margin accounts for the dragon's full body length.
      const spacing =
        CONFIG.DRAGON_SEGMENT_SPACING *
        35;

      const bodyLength =
        (dragon.segments
          ? dragon.segments.length
          : 0) *
        spacing;

      const margin =
        200 + bodyLength;

      if (
        camera &&
        !camera.isInView(
          dragon.head.x,
          dragon.head.y,
          margin
        )
      ) {
        continue;
      }

      this.renderDragon(
        ctx,
        dragon
      );
    }
  }

  renderDragon(ctx, dragon) {
    const assets =
      AssetLoader.getDragonByName(
        dragon.type
      );

    if (!assets) return;

    const baseScale =
      CONFIG.DRAGON_DISPLAY_SCALE;

    const segCount =
      dragon.segments.length;

    for (
      let i = segCount - 1;
      i >= 0;
      i--
    ) {
      const seg =
        dragon.segments[i];

      const isTail =
        i === segCount - 1;

      // Progressive body taper.
      const taper =
        segCount > 1
          ? 1 -
            (i /
              (segCount - 1)) *
              (1 -
                CONFIG.DRAGON_TAIL_TAPER_SCALE)
          : 1;

      let partImg =
        assets.body;

      let partScale =
        baseScale *
        (assets.display?.body?.scale || 1) *
        taper;

      if (
        isTail &&
        assets.tail
      ) {
        partImg =
          assets.tail;

        partScale =
          baseScale *
          (assets.display?.tail?.scale || 1);
      }

      if (
        !partImg ||
        !partImg.complete ||
        partImg.naturalWidth === 0
      ) {
        continue;
      }

      ctx.save();

      ctx.translate(
        seg.x,
        seg.y
      );

      let angle =
        dragon.angle;

      if (
        i <
        segCount - 1
      ) {
        const next =
          dragon.segments[
            i + 1
          ];

        angle =
          Math.atan2(
            next.y - seg.y,
            next.x - seg.x
          );
      }

      else if (i > 0) {
        const prev =
          dragon.segments[
            i - 1
          ];

        angle =
          Math.atan2(
            seg.y - prev.y,
            seg.x - prev.x
          );
      }

      ctx.rotate(angle);

      // Flash effect during immunity
      if (
        dragon.immunityTimer > 0
      ) {
        const flash =
          Math.sin(
            Date.now() / 50
          ) > 0;

        ctx.globalAlpha =
          flash
            ? 0.5
            : 1.0;
      }

      const w =
        partImg.naturalWidth *
        partScale;

      const h =
        partImg.naturalHeight *
        partScale;

      ctx.drawImage(
        partImg,
        -w / 2,
        -h / 2,
        w,
        h
      );

      ctx.restore();
    }

    // ================================================================
    // ATTACK-MODE HEAD
    // ================================================================
    //
    // Open mouth while attacking.
    // Closed mouth otherwise.
    //
    const useOpen =
      !!(
        dragon.attackActive &&
        assets.headOpen &&
        assets.headOpen.complete &&
        assets.headOpen.naturalWidth > 0
      );

    const headImg =
      useOpen
        ? assets.headOpen
        : assets.head;

    if (
      !headImg ||
      !headImg.complete ||
      headImg.naturalWidth === 0
    ) {
      return;
    }

    ctx.save();

    ctx.translate(
      dragon.head.x,
      dragon.head.y
    );

    // Front-facing heads point DOWN toward the camera.
    ctx.rotate(
      dragon.angle -
      Math.PI / 2
    );

    // Flash effect during immunity
    if (
      dragon.immunityTimer > 0
    ) {
      const flash =
        Math.sin(
          Date.now() / 50
        ) > 0;

      ctx.globalAlpha =
        flash
          ? 0.5
          : 1.0;
    }

    const frameScale =
      useOpen
        ? (
            assets.display?.headOpen?.scale ||
            assets.display?.head?.scale ||
            1
          )
        : (
            assets.display?.head?.scale ||
            1
          );

    const headScale =
      baseScale *
      frameScale *
      1.5;

    const w =
      headImg.naturalWidth *
      headScale;

    const h =
      headImg.naturalHeight *
      headScale;

    ctx.drawImage(
      headImg,
      -w / 2,
      -h / 2,
      w,
      h
    );

    ctx.restore();

    // ─── Sovereign Crown ──────────────────────────────────────
    // Draw a glowing gold crown above the dragon's head if the
    // player has earned the Infinite Sovereign rank.
    if (dragon.sovereign) {
      this._drawSovereignCrown(ctx, dragon);
    }
  }

  /**
   * Draws a radiant gold crown above the dragon's head.
   * Uses canvas gradients + glow — not a flat 2D icon.
   */
  _drawSovereignCrown(ctx, dragon) {
    const hx = dragon.head.x;
    const hy = dragon.head.y;
    const baseScale = CONFIG.DRAGON_DISPLAY_SCALE;
    const crownR = 14 * baseScale;
    const offsetY = -(38 * baseScale);

    // ── Subtle pulse animation ──
    const pulse = 1 + Math.sin(Date.now() / 600) * 0.08;

    ctx.save();
    ctx.translate(hx, hy + offsetY);
    ctx.scale(pulse, pulse);

    // ── Outer glow halo ──
    const haloR = crownR * 2.4;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
    halo.addColorStop(0, 'rgba(247, 227, 176, 0.5)');
    halo.addColorStop(0.4, 'rgba(247, 227, 176, 0.18)');
    halo.addColorStop(1, 'rgba(247, 227, 176, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fill();

    // ── Gold gradient ──
    const grad = ctx.createLinearGradient(0, -crownR * 1.2, 0, crownR * 0.7);
    grad.addColorStop(0, '#fff8dc');
    grad.addColorStop(0.3, '#f7e3b0');
    grad.addColorStop(0.6, '#e8c860');
    grad.addColorStop(0.85, '#d4af37');
    grad.addColorStop(1, '#b8860b');

    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(255, 250, 220, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.shadowColor = 'rgba(247, 227, 176, 0.8)';
    ctx.shadowBlur = 12;

    // ── Crown path (classic 5-spike crown, proper geometry) ──
    const bandW = crownR * 1.6;
    const bandH = crownR * 0.32;
    const bandY = crownR * 0.35;
    const spikes = 5;
    const spikeW = bandW / spikes;
    const midSpikeH = -crownR * 0.65;  // center spike is tallest
    const sideSpikeH = -crownR * 0.45; // side spikes slightly shorter

    ctx.beginPath();
    // Start at bottom-left of band
    ctx.moveTo(-bandW / 2, bandY + bandH);

    // Left side up to band top
    ctx.lineTo(-bandW / 2, bandY);

    // Draw 5 crown spikes: up to peak, down to valley
    for (let i = 0; i < spikes; i++) {
      const xL = -bandW / 2 + i * spikeW;
      const xC = xL + spikeW / 2;
      const xR = xL + spikeW;
      // Middle spike (index 2) is tallest, outer ones shorter
      const peakY = (i === 2) ? midSpikeH : sideSpikeH;
      // Valley between spikes sits at band top level
      ctx.lineTo(xC, peakY);
      ctx.lineTo(xR, bandY);
    }

    // Right side down
    ctx.lineTo(bandW / 2, bandY + bandH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // ── Gem on center spike ──
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    const gemY = midSpikeH + crownR * 0.08;
    ctx.beginPath();
    ctx.arc(0, gemY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fffacd';
    ctx.fill();

    // ── Small gems on side spikes ──
    ctx.shadowBlur = 4;
    for (let i = 0; i < spikes; i++) {
      if (i === 2) continue;
      const xC = -bandW / 2 + i * spikeW + spikeW / 2;
      const peakY = sideSpikeH;
      ctx.beginPath();
      ctx.arc(xC, peakY + crownR * 0.08, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe4b5';
      ctx.fill();
    }

    // ── Crown base band highlight ──
    ctx.shadowBlur = 0;
    const bandGrad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    bandGrad.addColorStop(0, 'rgba(255, 248, 220, 0.4)');
    bandGrad.addColorStop(1, 'rgba(184, 134, 11, 0.6)');
    ctx.fillStyle = bandGrad;
    ctx.beginPath();
    ctx.roundRect(-bandW / 2, bandY, bandW, bandH, 2);
    ctx.fill();

    ctx.restore();
  }
}

export default DragonManager;
