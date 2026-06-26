import CONFIG from './config.js';

class FoodSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foods = [];
    this.nextId = 1;
    this.bounds = null;
    this.arenaRadius = 0;
  }

  init(bounds, arenaRadius) {
    this.bounds = bounds;
    this.arenaRadius = arenaRadius;
    const area = Math.PI * arenaRadius * arenaRadius;
    const count = Math.floor(area * CONFIG.FOOD_DENSITY);
    for (let i = 0; i < count; i++) {
      this.spawnFood();
    }
  }

  spawnFood() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (this.arenaRadius - 60);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const isBonus = Math.random() < CONFIG.FOOD_BONUS_CHANCE;
    this.foods.push({
      id: this.nextId++,
      x, y,
      value: isBonus ? CONFIG.FOOD_BONUS_POINTS : CONFIG.FOOD_NORMAL_POINTS,
      type: CONFIG.FOOD_TYPES[Math.floor(Math.random() * CONFIG.FOOD_TYPES.length)],
      isBonus,
      scale: isBonus ? CONFIG.FOOD_BONUS_SCALE : 1,
      spawnTime: Date.now()
    });
  }

  spawnFoodAt(x, y, isBonus = false) {
    this.foods.push({
      id: this.nextId++,
      x, y,
      value: isBonus ? CONFIG.FOOD_BONUS_POINTS : CONFIG.FOOD_NORMAL_POINTS,
      type: CONFIG.FOOD_TYPES[Math.floor(Math.random() * CONFIG.FOOD_TYPES.length)],
      isBonus,
      scale: isBonus ? CONFIG.FOOD_BONUS_SCALE : 1,
      spawnTime: Date.now()
    });
  }

  update(deltaTime) {
    const area = Math.PI * this.arenaRadius * this.arenaRadius;
    const targetCount = Math.floor(area * CONFIG.FOOD_DENSITY);
    if (this.foods.length < targetCount) {
      this.spawnFood();
    }
  }

  getFoods() {
    return this.foods;
  }

  getFoodInRadius(x, y, radius) {
    const result = [];
    for (const food of this.foods) {
      const dx = food.x - x;
      const dy = food.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < radius) {
        result.push(food);
      }
    }
    return result;
  }

  removeFood(id) {
    const idx = this.foods.findIndex(f => f.id === id);
    if (idx > -1) this.foods.splice(idx, 1);
  }

  render(ctx, camera) {
    for (const food of this.foods) {
      const screenPos = camera.worldToScreen(food.x, food.y);
      const size = (CONFIG.FOOD_RADIUS * food.scale) / camera.zoom;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, Math.max(size, 2), 0, Math.PI * 2);
      ctx.fillStyle = this.getFoodColor(food.type);
      ctx.fill();
      if (food.isBonus) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  getFoodColor(type) {
    const colors = {
      blue: '#00b4d8',
      red: '#ff4d4d',
      purple: '#9b4dff',
      orange: '#ff9500'
    };
    return colors[type] || '#fff';
  }
}

export default FoodSystem;
