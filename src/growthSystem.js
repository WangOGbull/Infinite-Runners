import CONFIG from './config.js';

class GrowthSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  grow(dragon, amount = 1) {
    if (!dragon || !dragon.alive) return;

    // --- CHANGE 1: Define base and fat spacing ---
    const baseSpacing = CONFIG.DRAGON_SEGMENT_SPACING * 35;
    const fatSpacing = baseSpacing * 2; // Double size when fat

    for (let i = 0; i < amount; i++) {
      if (dragon.segments.length >= CONFIG.DRAGON_MAX_SEGMENTS) break;

      // --- CHANGE 2: Check length and choose spacing ---
      // If current length is 25 or more, use fat spacing, otherwise use base
      const spacing = dragon.segments.length >= 25 ? fatSpacing : baseSpacing;

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
    if (!dragon || !dragon.alive) return;
    if (!dragon.growthProgress) dragon.growthProgress = 0;
    dragon.growthProgress += (food.value || 1);
    // 5 food = 1 segment
    while (dragon.growthProgress >= 5) {
      this.grow(dragon, 1);
      dragon.growthProgress -= 5;
    }
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

  onTailHit({ attacker, defender }) {
    if (!attacker || !defender || !attacker.alive || !defender.alive) return;

    // Attacker loses 2 segments
    let attackerLost = 0;
    for (let i = 0; i < 2; i++) {
      if (attacker.segments.length <= CONFIG.DRAGON_START_SEGMENTS) break;
      attacker.segments.pop();
      attackerLost++;
    }
    if (attackerLost > 0) {
      this.eventBus.emit('dragon:cut', { victim: attacker, removeCount: attackerLost });
    }

    // Defender gains 1 segment (up to the shared max)
    if (defender.segments.length < CONFIG.DRAGON_MAX_SEGMENTS) {
      this.grow(defender, 1);
    }
  }
}

export default GrowthSystem;
