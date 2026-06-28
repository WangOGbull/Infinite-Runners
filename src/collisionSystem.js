import CONFIG from './config.js';

class CollisionSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  checkAll(dragonManager, foodSystem, arenaManager) {
    const dragons = dragonManager.getLivingDragons();
    const foods = foodSystem.getFoods();

    // Food collisions
    for (const dragon of dragons) {
      const head = dragon.head;
      for (let i = foods.length - 1; i >= 0; i--) {
        const food = foods[i];
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitDist = (dragon.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) + (food.radius || CONFIG.FOOD_RADIUS);
        if (dist < hitDist) {
          foodSystem.removeFood(i);
          this.eventBus.emit('collision:eat', { dragon, food });
        }
      }
    }

    // Dragon collisions — HEAD vs HEAD only
    for (let i = 0; i < dragons.length; i++) {
      for (let j = i + 1; j < dragons.length; j++) {
        this.checkHeadCollision(dragons[i], dragons[j]);
      }
    }
  }

  checkHeadCollision(d1, d2) {
    const dx = d1.head.x - d2.head.x;
    const dy = d1.head.y - d2.head.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hitDist = (d1.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS) + 
                    (d2.headRadius || CONFIG.DRAGON_HEAD_HITBOX_RADIUS);

    if (dist < hitDist) {
      const len1 = d1.segments ? d1.segments.length : 0;
      const len2 = d2.segments ? d2.segments.length : 0;

      if (len1 < len2) {
        this.eventBus.emit('dragon:death', { dragon: d1, killer: d2 });
      } else if (len2 < len1) {
        this.eventBus.emit('dragon:death', { dragon: d2, killer: d1 });
      } else {
        this.eventBus.emit('dragon:death', { dragon: d1, killer: d2 });
        this.eventBus.emit('dragon:death', { dragon: d2, killer: d1 });
      }
    }
    // Head vs Body = intentionally ignored — no effect
  }
}

export default CollisionSystem;
