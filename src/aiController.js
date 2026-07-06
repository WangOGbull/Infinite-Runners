import CONFIG from './config.js';

class AIController {
  constructor(arenaManager, foodSystem, difficulty = 'advanced') {
    this.arena = arenaManager;
    this.food = foodSystem;
    this.difficulty = difficulty;

    this.difficultySettings = {
      beginner: { randomness: 1.0, targetFood: 0.9, wallMargin: 400, speedMult: 0.6, aggression: 0.0, huntRange: 300, fleeRange: 200 },
      easy: { randomness: 0.6, targetFood: 0.8, wallMargin: 300, speedMult: 0.8, aggression: 0.15, huntRange: 400, fleeRange: 250 },
      advanced: { randomness: 0.3, targetFood: 0.6, wallMargin: 220, speedMult: 1.0, aggression: 0.4, huntRange: 500, fleeRange: 300 },
      master: { randomness: 0.12, targetFood: 0.4, wallMargin: 170, speedMult: 1.2, aggression: 0.7, huntRange: 600, fleeRange: 350 },
      legendary: { randomness: 0.03, targetFood: 0.2, wallMargin: 120, speedMult: 1.4, aggression: 0.95, huntRange: 800, fleeRange: 400 }
    };
  }

  getSpeedMult() {
    return this.difficultySettings[this.difficulty]?.speedMult || 1.0;
  }

  getInputAngle(dragon, allDragons) {
    const head = dragon.head;
    const settings = this.difficultySettings[this.difficulty] || this.difficultySettings.advanced;

    let targetAngle = dragon.angle;
    let bestTarget = null;

    // 1. AGGRESSION: Hunt smaller dragons
    if (Math.random() < settings.aggression && allDragons) {
      let bestScore = -Infinity;

      for (const other of allDragons) {
        if (other === dragon || !other.alive) continue;
        const dx = other.head.x - head.x;
        const dy = other.head.y - head.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > settings.huntRange) continue;

        // Prefer smaller/weaker targets
        const sizeDiff = other.segments.length - dragon.segments.length;
        if (sizeDiff >= 0) continue; // Only hunt smaller dragons

        const angleToTarget = Math.atan2(dy, dx);
        let angleDiff = angleToTarget - dragon.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const score = (1000 / (dist + 1)) - Math.abs(angleDiff) * 100 - sizeDiff * 50;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = other;
        }
      }

      if (bestTarget) {
        // Aim for their tail to cut it
        const tailIdx = Math.max(0, bestTarget.segments.length - 3);
        const tail = bestTarget.segments[tailIdx];
        targetAngle = Math.atan2(tail.y - head.y, tail.x - head.x);
      }
    }

    // 2. FLEE: Run from bigger dragons (only if not hunting)
    if (!bestTarget && allDragons) {
      for (const other of allDragons) {
        if (other === dragon || !other.alive) continue;
        const dx = other.head.x - head.x;
        const dy = other.head.y - head.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > settings.fleeRange) continue;

        if (other.segments.length > dragon.segments.length * 1.2) {
          // Bigger dragon nearby - flee!
          targetAngle = Math.atan2(-dy, -dx);
          break;
        }
      }
    }

    // 3. FOOD: Seek food if not hunting/fleeing
    if (!bestTarget && targetAngle === dragon.angle) {
      const foods = this.food.getFoods();
      let bestFood = null;
      let bestScore = -Infinity;

      for (const food of foods) {
        const dx = food.x - head.x;
        const dy = food.y - head.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 15) continue;

        const foodAngle = Math.atan2(dy, dx);
        let angleDiff = foodAngle - dragon.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (Math.abs(angleDiff) > Math.PI / 2) continue;

        const score = 800 / (dist + 1) - Math.abs(angleDiff) * 30;
        if (score > bestScore) {
          bestScore = score;
          bestFood = food;
        }
      }

      if (bestFood && Math.random() < settings.targetFood) {
        targetAngle = Math.atan2(bestFood.y - head.y, bestFood.x - head.x);
      }
    }

    // 4. WALL AVOIDANCE
    const bounds = this.arena.getInnerBounds();
    const margin = settings.wallMargin;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const nearWall = head.x < bounds.minX + margin ||
                     head.x > bounds.maxX - margin ||
                     head.y < bounds.minY + margin ||
                     head.y > bounds.maxY - margin;

    if (nearWall) {
      targetAngle = Math.atan2(centerY - head.y, centerX - head.x);
    }

    // 5. SMOOTH TURNING + RANDOMNESS
    if (dragon.aiTargetAngle !== null && dragon.aiTargetAngle !== undefined) {
      let diff = targetAngle - dragon.aiTargetAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      targetAngle = dragon.aiTargetAngle + diff * 0.3;
    }
    dragon.aiTargetAngle = targetAngle;

    targetAngle += (Math.random() - 0.5) * settings.randomness;
    return targetAngle;
  }
}

export default AIController;
