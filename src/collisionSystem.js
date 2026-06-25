import CONFIG from './config.js';

class CollisionSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  checkAll(dragonManager, foodSystem, arenaManager) {
    const dragons = dragonManager.getLivingDragons();

    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      const head = dragon.head;

      // 1. Head vs Food
      const eaten = foodSystem.getFoodInRadius(head.x, head.y, CONFIG.DRAGON_HEAD_HITBOX_RADIUS);
      for (const food of eaten) {
        dragon.collected = (dragon.collected || 0) + 1;
        dragon.score = (dragon.score || 0) + (food.value || 1) * 10;
        this.eventBus.emit('collision:eat', { dragon, food });
        foodSystem.removeFood(food.id);
      }

      // 2. Head vs Other Dragons
      for (const other of dragons) {
        if (other === dragon || !other.alive) continue;

        // Head-to-head collision
        const hdx = head.x - other.head.x;
        const hdy = head.y - other.head.y;
        const hdist = Math.sqrt(hdx * hdx + hdy * hdy);

        if (hdist < CONFIG.DRAGON_HEAD_HITBOX_RADIUS * 1.8) {
          const myLen = dragon.segments.length;
          const otherLen = other.segments.length;

          if (myLen > otherLen) {
            other.alive = false;
            this.eventBus.emit('dragon:death', { dragon: other, killer: dragon });
            dragon.kills = (dragon.kills || 0) + 1;
          } else if (myLen < otherLen) {
            dragon.alive = false;
            this.eventBus.emit('dragon:death', { dragon, killer: other });
            other.kills = (other.kills || 0) + 1;
          } else {
            dragon.alive = false;
            other.alive = false;
            this.eventBus.emit('dragon:death', { dragon, killer: null });
            this.eventBus.emit('dragon:death', { dragon: other, killer: null });
          }
          break;
        }

        // Head vs other dragon's body/tail segments
        for (let i = 0; i < other.segments.length; i++) {
          const seg = other.segments[i];
          const dx = head.x - seg.x;
          const dy = head.y - seg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONFIG.DRAGON_COLLISION_RADIUS) {
            if (i === other.segments.length - 1) {
              // Hit tail
              this.eventBus.emit('collision:tail', { attacker: dragon, victim: other });
            } else {
              // Hit body - attacker dies
              dragon.alive = false;
              this.eventBus.emit('dragon:death', { dragon, killer: other });
              other.kills = (other.kills || 0) + 1;
            }
            break;
          }
        }

        if (!dragon.alive) break;
      }

      if (!dragon.alive) continue;

      // 3. Head vs Boundary
      if (!arenaManager.isInside(head.x, head.y)) {
        this.eventBus.emit('collision:wall', { dragon });
        dragon.alive = false;
        this.eventBus.emit('dragon:death', { dragon, killer: null });
      }
    }
  }
}

export default CollisionSystem;
