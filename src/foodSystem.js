import CONFIG from './config.js';

class FoodSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foods = new Map();
    this.nextId = 1;
    this.arenaBounds = null;
  }

  init(arenaBounds) {
    this.arenaBounds = arenaBounds;
    this.foods.clear();
    this.nextId = 1;

    const area = (arenaBounds.maxX - arenaBounds.minX) * (arenaBounds.maxY - arenaBounds.minY);
    const maxFood = Math.floor(area * CONFIG.FOOD_DENSITY);

    for (let i = 0; i < maxFood; i++) {
      this.spawnFood();
    }
  }

  spawnFood() {
    if (!this.arenaBounds) return;

    const id = `food_${this.nextId++}`;
    const isBonus = Math.random() < CONFIG.FOOD_BONUS_CHANCE;
    const type = isBonus ? 'bonus' : 'normal';

    const food = {
      id,
      x: this.arenaBounds.minX + Math.random() * (this.arenaBounds.maxX - this.arenaBounds.minX),
      y: this.arenaBounds.minY + Math.random() * (this.arenaBounds.maxY - this.arenaBounds.minY),
      type,
      value: isBonus ? CONFIG.FOOD_BONUS_POINTS / 10 : CONFIG.FOOD_NORMAL_POINTS / 10,
      radius: isBonus ? 12 * CONFIG.FOOD_BONUS_SCALE : 8,
      scale: 1,
      pulseDir: 1,
      color: isBonus ? '#ffd700' : '#00b4d8'
    };

    this.foods.set(id, food);
    return food;
  }

  removeFood(id) {
    if (this.foods.has(id)) {
      this.foods.delete(id);
      // Respawn after delay
      setTimeout(() => this.spawnFood(), CONFIG.FOOD_RESPAWN_DELAY);
    }
  }

  update(deltaTime) {
    // Pulse animation for bonus food
    for (const food of this.foods.values()) {
      if (food.type === 'bonus') {
        food.scale += 0.02 * food.pulseDir;
        if (food.scale > 1.3 || food.scale < 0.9) {
          food.pulseDir *= -1;
        }
      }
    }
  }

  getFoodInRadius(x, y, radius) {
    const result = [];
    for (const food of this.foods.values()) {
      const dx = food.x - x;
      const dy = food.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius + food.radius) {
        result.push(food);
      }
    }
    return result;
  }

  render(ctx, camera) {
    for (const food of this.foods.values()) {
      if (!camera.isInView(food.x, food.y, 50)) continue;

      const pos = camera.worldToScreen(food.x, food.y);
      const scale = camera.zoom * (food.type === 'bonus' ? food.scale : 1);
      const radius = food.radius * scale;

      // Glow
      ctx.shadowColor = food.color;
      ctx.shadowBlur = 15 * scale;

      // Circle body
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = food.color;
      ctx.fill();

      // Infinity symbol
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = `${radius}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CONFIG.FOOD_SYMBOL, pos.x, pos.y + 2);
    }
    ctx.shadowBlur = 0;
  }

  getFoods() {
    return Array.from(this.foods.values());
  }
}

export default FoodSystem;
