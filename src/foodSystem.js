import CONFIG from './config.js';

class FoodSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foods = new Map();
    this.nextId = 1;
    this.arenaBounds = null;

    this.colors = [
      '#00e5ff',
      '#ff6b35',
      '#b967ff',
      '#00ff9d'
    ];
  }

  init(arenaBounds) {
    this.arenaBounds = arenaBounds;
    this.foods.clear();
    this.nextId = 1;

    const area = (arenaBounds.maxX - arenaBounds.minX) * (arenaBounds.maxY - arenaBounds.minY);
    const foodCount = Math.floor(area * CONFIG.FOOD_DENSITY);

    for (let i = 0; i < foodCount; i++) {
      this.spawnFood();
    }
  }

  spawnFood() {
    if (!this.arenaBounds) return;

    const id = `food_${this.nextId++}`;
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    const bonus = Math.random() < CONFIG.FOOD_BONUS_CHANCE;

    const food = {
      id,
      x: this.arenaBounds.minX + Math.random() * (this.arenaBounds.maxX - this.arenaBounds.minX),
      y: this.arenaBounds.minY + Math.random() * (this.arenaBounds.maxY - this.arenaBounds.minY),
      radius: bonus ? CONFIG.FOOD_BONUS_SCALE * CONFIG.FOOD_RADIUS : CONFIG.FOOD_RADIUS,
      color,
      value: bonus ? CONFIG.FOOD_BONUS_POINTS / 10 : CONFIG.FOOD_NORMAL_POINTS / 10,
      bonus,
      pulse: Math.random() * Math.PI * 2
    };

    this.foods.set(id, food);
    return food;
  }

  spawnFoodAt(x, y, bonus = false) {
    if (!this.arenaBounds) return;

    const id = `food_${this.nextId++}`;
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];

    const food = {
      id,
      x,
      y,
      radius: bonus ? CONFIG.FOOD_BONUS_SCALE * CONFIG.FOOD_RADIUS : CONFIG.FOOD_RADIUS,
      color,
      value: bonus ? CONFIG.FOOD_BONUS_POINTS / 10 : CONFIG.FOOD_NORMAL_POINTS / 10,
      bonus,
      pulse: Math.random() * Math.PI * 2
    };

    this.foods.set(id, food);
    return food;
  }

  removeFood(id) {
    if (!this.foods.has(id)) return;
    this.foods.delete(id);
    this.spawnFood();
  }

  update(deltaTime) {
    for (const food of this.foods.values()) {
      food.pulse += 0.05;
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

      const size = food.radius * (1 + Math.sin(food.pulse) * 0.15);

      ctx.save();
      ctx.shadowColor = food.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = food.color;
      ctx.font = `bold ${size * 5}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('∞', food.x, food.y);
      ctx.restore();
    }
  }

  getFoods() {
    return Array.from(this.foods.values());
  }
}

export default FoodSystem;
