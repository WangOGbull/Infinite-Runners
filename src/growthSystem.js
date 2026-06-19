import CONFIG from './config.js';

class GrowthSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  grow(dragon, amount = CONFIG.DRAGON_SEGMENTS_PER_FOOD) {
    if (!dragon || dragon.state !== 'alive') return;

    const before = dragon.length;
    dragon.grow(amount);
    const after = dragon.length;

    if (after > before) {
      this.eventBus.emit('dragon:grow', { dragon, amount: after - before });
    }
  }

  onEat(dragon, food) {
    this.grow(dragon, food.value || CONFIG.DRAGON_SEGMENTS_PER_FOOD);
    this.eventBus.emit('food:eaten', { dragon, food });
  }

  onCollisionTailCut(victim, percentage = 0.2) {
    if (!victim || victim.state !== 'alive') return;
    const removeCount = Math.floor((victim.length - CONFIG.DRAGON_START_SEGMENTS) * percentage);
    if (removeCount > 0) {
      victim.shrink(removeCount);
      this.eventBus.emit('dragon:cut', { victim, removeCount });
    }
  }
}

export default GrowthSystem;
