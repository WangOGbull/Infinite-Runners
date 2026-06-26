import CONFIG from './config.js';

class FoodSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foods = new Map();
    this.nextId = 1;
    this.arenaBounds = null;
    this.innerBounds = null;

    this.colors = [
      '#00e5ff',
      '#ff6b35',
      '#b967ff',
      '#00ff9d'
    ];
  }

  init(arenaBounds, innerBounds) {
    this.arenaBounds = arenaBounds;
    this.innerBounds = innerBounds || arenaBounds;
    this.foods.clear();
    this.nextId = 1;

    const area = (this.innerBounds.maxX - this.innerBounds.minX) * (this.innerBounds.maxY - this.innerBounds.minY);
    const foodCount = Math.floor(area * CONFIG.FOOD_DENSITY);

    for (let i = 0; i < foodCount; i++) {
      this.spawnFood();
    }
  }

  spawnFood() {
    if (!this.innerBounds) return;

    const id = `food_${this.nextId++}`;
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    const bonus = Math.random() < CONFIG.FOOD_BONUS_CHANCE;

    const food = {
      id,
      x: this.innerBounds.minX + Math.random() * (this.innerBounds.maxX - this.innerBounds.minX),
      y: this.innerBounds.minY + Math.random() * (this.innerBounds.maxY - this.innerBounds.minY),
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
    if (!this.innerBounds) return;

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
      if (!camera.isInView(food.x, food.y, 60)) continue;

      const size = food.radius * (1 + Math.sin(food.pulse) * 0.15);
      const drawSize = size * 8;

      ctx.save();

      // Dark background circle for contrast
      ctx.beginPath();
      ctx.arc(food.x, food.y, drawSize * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fill();

      // Glow
      ctx.shadowColor = food.color;
      ctx.shadowBlur = 30;
      ctx.fillStyle = food.color;
      ctx.font = `bold ${drawSize}px Arial`;
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
