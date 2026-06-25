import CONFIG from './config.js';

class GrowthSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  grow(dragon, amount = CONFIG.DRAGON_SEGMENTS_PER_FOOD) {
    if (!dragon || !dragon.alive) return;

    const spacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;

    for (let i = 0; i < amount; i++) {
      if (dragon.segments.length >= CONFIG.DRAGON_MAX_SEGMENTS) break;

      const tailSeg = dragon.segments[dragon.segments.length - 1];
      const beforeTail = dragon.segments.length > 1
        ? dragon.segments[dragon.segments.length - 2]
        : dragon.head;

      const angle = Math.atan2(tailSeg.y - beforeTail.y, tailSeg.x - beforeTail.x);

      dragon.segments.push({
        x: tailSeg.x + Math.cos(angle) * spacing,
        y: tailSeg.y + Math.sin(angle) * spacing
      });
    }

    this.eventBus.emit('dragon:grow', { dragon, amount });
  }

  onEat(dragon, food) {
    this.grow(dragon, food.value || CONFIG.DRAGON_SEGMENTS_PER_FOOD);
    this.eventBus.emit('food:eaten', { dragon, food });
  }

  onCollisionTailCut(victim, percentage = 0.2) {
    if (!victim || !victim.alive) return;

    const removeCount = Math.floor((victim.segments.length - CONFIG.DRAGON_START_SEGMENTS) * percentage);
    if (removeCount > 0) {
      for (let i = 0; i < removeCount; i++) {
        if (victim.segments.length <= CONFIG.DRAGON_START_SEGMENTS) break;
        victim.segments.pop();
      }
      this.eventBus.emit('dragon:cut', { victim, removeCount });
    }
  }
}

export default GrowthSystem;
