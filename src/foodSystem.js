import CONFIG from './config.js';

class FoodSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.foods = new Map();
    this.nextId = 1;
    this.arenaBounds = null;
    this.innerBounds = null;
    this.maxFood = 250;

    // Cached array — rebuilt only when food changes, not every frame
    this._cachedFoods = null;
    this._foodDirty = true;

    // Pre-rendered neon glow sprites — one per color, drawn once at startup
    // instead of calling shadowBlur 250 times per frame
    this._sprites = {};
    this._spriteSize = 64;

    this.colors = [
      '#00e5ff',
      '#ff6b35',
      '#b967ff',
      '#00ff9d'
    ];
  }

  /**
   * Pre-render a glowing ∞ symbol to an offscreen canvas.
   * The sprite includes: dark contrast circle + neon glow + ∞ symbol.
   * At runtime we just drawImage() — ~50x faster than shadowBlur per item.
   */
  _buildSprites() {
    for (const color of this.colors) {
      const s = this._spriteSize;
      const cv = document.createElement('canvas');
      cv.width = s;
      cv.height = s;
      const cx = cv.getContext('2d');

      const cxCenter = s / 2;
      const cyCenter = s / 2;
      const drawSize = s * 0.45; // symbol font size within sprite

      // Dark background circle for contrast
      cx.beginPath();
      cx.arc(cxCenter, cyCenter, drawSize * 0.95, 0, Math.PI * 2);
      cx.fillStyle = 'rgba(0,0,0,0.45)';
      cx.fill();

      // Neon glow via shadowBlur — done ONCE here, never per-frame
      cx.save();
      cx.shadowColor = color;
      cx.shadowBlur = 18;
      cx.fillStyle = color;
      cx.font = `bold ${drawSize}px Arial`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText('\u221E', cxCenter, cyCenter);

      // Second pass for stronger glow
      cx.shadowBlur = 10;
      cx.fillText('\u221E', cxCenter, cyCenter);
      cx.restore();

      // Crisp white-hot core on top (no shadow)
      cx.fillStyle = '#ffffff';
      cx.globalAlpha = 0.25;
      cx.font = `bold ${drawSize}px Arial`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText('\u221E', cxCenter, cyCenter);
      cx.globalAlpha = 1.0;

      this._sprites[color] = cv;
    }
  }

  init(arenaBounds, innerBounds) {
    this.arenaBounds = arenaBounds;
    this.innerBounds = innerBounds || arenaBounds;
    this.foods.clear();
    this.nextId = 1;
    this._foodDirty = true;

    // Build sprites on first init
    if (!this._sprites || Object.keys(this._sprites).length === 0) {
      this._buildSprites();
    }

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
      // Doubled value: was /10, now /5 — halves food count while keeping
      // same charge rate (20 food = full sprint/attack charge)
      value: bonus ? CONFIG.FOOD_BONUS_POINTS / 5 : CONFIG.FOOD_NORMAL_POINTS / 5,
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
      value: bonus ? CONFIG.FOOD_BONUS_POINTS / 5 : CONFIG.FOOD_NORMAL_POINTS / 5,
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
    // PRE-RENDERED SPRITE RENDER: drawImage per food item instead of
    // shadowBlur + fillText per item. ~50x faster on mobile.
    // The neon glow is baked into the sprite at init time.
    const halfSprite = this._spriteSize / 2;

    for (const food of this.foods.values()) {
      if (!camera.isInView(food.x, food.y, 60)) continue;

      const sprite = this._sprites[food.color];
      if (!sprite) continue;

      // Pulse the scale slightly for a living feel
      const pulse = 1 + Math.sin(food.pulse) * 0.12;
      const drawSize = food.radius * 8 * pulse;

      ctx.drawImage(
        sprite,
        food.x - drawSize / 2,
        food.y - drawSize / 2,
        drawSize,
        drawSize
      );
    }
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
