import CONFIG from './config.js';

class CollisionSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  checkAll(dragonManager, foodSystem, arenaManager) {
    const dragons = dragonManager.getLivingDragons();
    const bounds = arenaManager.getBounds();

    for (const dragon of dragons) {
      const head = dragon.head;

      // 1. Head vs Food
      const eaten = foodSystem.getFoodInRadius(head.x, head.y, CONFIG.DRAGON_HEAD_HITBOX_RADIUS);
      for (const food of eaten) {
        this.eventBus.emit('collision:eat', { dragon, food });
        foodSystem.removeFood(food.id);
      }

      // 2. Head vs Other Dragons — NO self-collision (Snake Clash rule)
      for (const other of dragons) {
        if (other === dragon || other.state !== 'alive') continue;

        for (let i = 0; i < other.segments.length; i++) {
          const seg = other.segments[i];
          const dx = head.x - seg.x;
          const dy = head.y - seg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONFIG.DRAGON_COLLISION_RADIUS) {
            if (seg.type === 'head') {
              // Head-on: longer wins
              if (dragon.length > other.length) {
                other.state = 'dead';
                this.eventBus.emit('dragon:death', { dragon: other, killer: dragon });
                dragon.kills++;
              } else if (dragon.length < other.length) {
                dragon.state = 'dead';
                this.eventBus.emit('dragon:death', { dragon, killer: other });
                other.kills++;
              } else {
                dragon.state = 'dead';
                other.state = 'dead';
                this.eventBus.emit('dragon:death', { dragon, killer: null });
                this.eventBus.emit('dragon:death', { dragon: other, killer: null });
              }
            } else if (seg.type === 'tail') {
              this.eventBus.emit('collision:tail', { attacker: dragon, victim: other });
            } else {
              // Hit body: attacker dies
              dragon.state = 'dead';
              this.eventBus.emit('dragon:death', { dragon, killer: other });
              other.kills++;
            }
            break;
          }
        }
        if (dragon.state !== 'alive') break;
      }
      if (dragon.state !== 'alive') continue;

      // 3. Head vs Boundary
      if (!arenaManager.isInside(head.x, head.y)) {
        this.eventBus.emit('collision:wall', { dragon });
        dragon.state = 'dead';
        this.eventBus.emit('dragon:death', { dragon, killer: null });
      }
    }
  }
}

export default CollisionSystem;
