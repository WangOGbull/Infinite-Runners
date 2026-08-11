import CONFIG from './config.js';

class CollisionSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  checkAll(dragonManager, foodSystem, arenaManager) {
    const dragons = dragonManager.getLivingDragons();
    const foods = foodSystem.getFoods();

    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      if (dragon.immunityTimer > 0) continue;
      const head = dragon.head;
      for (let i = foods.length - 1; i >= 0; i--) {
        const food = foods[i];
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitDist = (dragon.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) + (food.radius || CONFIG.FOOD_RADIUS);
        if (dist < hitDist) {
          foodSystem.removeFood(food.id);
          this.eventBus.emit('collision:eat', { dragon, food });
        }
      }
    }

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
    const dist = Math.sqrt(dx * dx + dy * dy);
    const headHitDist = (d1.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) +
                        (d2.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS);

    if (dist < headHitDist) {
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
    const lastIdx = bodyDragon.segments.length - 1;

    for (let i = 1; i < bodyDragon.segments.length; i++) {
      const seg = bodyDragon.segments[i];
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitDist = headRadius + bodyRadius;

      if (dist < hitDist) {
        const isTailHit = (i === lastIdx);

        if (isTailHit) {
          // ===== HEAD vs TAIL =====
          const headLen = headDragon.segments.length;
          const bodyLen = bodyDragon.segments.length;

          if (headLen > bodyLen) {
            // Bigger attacks Smaller's tail → Smaller dies
            if (!bodyDragon.isRemote) this.eventBus.emit('dragon:death', { dragon: bodyDragon, killer: headDragon });
          } else if (headLen < bodyLen) {
            // Smaller attacks Bigger's tail
            // --- ONLY Drake (10-14) can do 30% damage ---
            const isDrake = headLen >= 10 && headLen <= 14;
            
            if (isDrake && headDragon.attackActive) {
              // Drake with Attack charged → 30% damage
              if (!bodyDragon.isRemote) this.eventBus.emit('dragon:tailDamage', { victim: bodyDragon, attacker: headDragon });
            } else if (!isDrake && headDragon.attackActive) {
              // Hatchling with Attack → minor nibble (20%)
              if (!bodyDragon.isRemote) this.eventBus.emit('collision:tail-cut', { victim: bodyDragon });
            } else {
              // No Attack → minor nibble (20%)
              if (!bodyDragon.isRemote) this.eventBus.emit('collision:tail-cut', { victim: bodyDragon });
            }
          } else {
            // Equal size → both recoil
            if (!headDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: headDragon, reason: 'equal_tail', other: bodyDragon });
            if (!bodyDragon.isRemote) this.eventBus.emit('dragon:shrink', { dragon: bodyDragon, reason: 'equal_tail', other: headDragon });
          }
        } else {
          // ===== HEAD vs BODY (non-tail) =====
          // DO NOTHING
          return;
        }
        return;
      }
    }
  }
}

export default CollisionSystem;
