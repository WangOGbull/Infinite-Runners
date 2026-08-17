import CONFIG from './config.js';

class FoodSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foods = new Map();
    this.nextId = 1;
    this.arenaBounds = null;
    this.innerBounds = null;
    this.maxFood = 600;

    // Cached array — rebuilt only when food changes, not every frame
    this._cachedFoods = null;
    this._foodDirty = true;

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
    this._foodDirty = true;

    const area = (this.innerBounds.maxX - this.innerBounds.minX) * (this.innerBounds.maxY - this.innerBounds.minY);
    const foodCount = Math.min(Math.floor(area * CONFIG.FOOD_DENSITY), this.maxFood);

    for (let i = 0; i < foodCount; i++) {
      this.spawnFood();
    }
  }

  spawnFood() {
    if (!this.innerBounds) return;
    if (this.foods.size >= this.maxFood) return;

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
    this._foodDirty = true;
    return food;
  }

  spawnFoodAt(x, y, bonus = false) {
    if (!this.innerBounds) return;

    if (this.foods.size >= this.maxFood) {
      const firstKey = this.foods.keys().next().value;
      if (firstKey !== undefined) this.foods.delete(firstKey);
    }

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
    this._foodDirty = true;
    return food;
  }

  removeFood(id) {
    if (!this.foods.has(id)) return;
    this.foods.delete(id);
    this._foodDirty = true;
    this.spawnFood();
  }

  update(deltaTime) {
    for (const food of this.foods.values()) {
      food.pulse += 0.05;
    }
  }

  getFoodInRadius(x, y, radius) {
    const result = [];
    const hitRSq = radius * radius;
    for (const food of this.foods.values()) {
      const dx = food.x - x;
      const dy = food.y - y;
      const distSq = dx * dx + dy * dy;
      const hitR = radius + food.radius;
      if (distSq < hitR * hitR) {
        result.push(food);
      }
    }
    return result;
  }

  render(ctx, camera) {
    // BATCH RENDER: one save/restore for all food, no per-item shadowBlur.
    // shadowBlur=30 per item x 600 items was the #1 GPU killer on mobile.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const food of this.foods.values()) {
      if (!camera.isInView(food.x, food.y, 60)) continue;

      const size = food.radius * (1 + Math.sin(food.pulse) * 0.15);
      const drawSize = size * 8;

      // Dark background circle (no shadow)
      ctx.beginPath();
      ctx.arc(food.x, food.y, drawSize * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fill();

      // Food symbol with glow — use radial gradient as cheap glow replacement
      const grad = ctx.createRadialGradient(food.x, food.y, 0, food.x, food.y, drawSize);
      grad.addColorStop(0, food.color);
      grad.addColorStop(0.5, food.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(food.x, food.y, drawSize * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Infinity symbol on top
      ctx.fillStyle = food.color;
      ctx.font = `bold ${drawSize}px Arial`;
      ctx.fillText('\u221E', food.x, food.y);
    }

    ctx.restore();
  }

  getFoods() {
    // Return cached array — only rebuild when food set changes
    if (this._foodDirty || !this._cachedFoods) {
      this._cachedFoods = Array.from(this.foods.values());
      this._foodDirty = false;
    }
    return this._cachedFoods;
  }
}

export default FoodSystem;
