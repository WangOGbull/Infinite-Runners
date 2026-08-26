class AutoMatchSearchingVisual {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d', { alpha: true });
    this.stage = canvas?.closest('.daSearchArtStage');
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.frame = 0;
    this.particles = Array.from({ length: 34 }, (_, i) => ({
      seed: i * 19.73,
      radius: 0.12 + (i % 9) * 0.043,
      speed: 0.12 + (i % 7) * 0.017,
      size: 0.8 + (i % 5) * 0.55
    }));
    this.resize = this.resize.bind(this);
    this.draw = this.draw.bind(this);
    if (!this.ctx || !this.stage) return;
    new ResizeObserver(this.resize).observe(this.stage);
    this.resize();
    this.frame = requestAnimationFrame(this.draw);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  ring(cx, cy, radius, width, rotation, direction, time, runeCount) {
    const ctx = this.ctx;
    const angle = rotation + time * direction;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(177, 47, 255, .9)';
    ctx.shadowBlur = radius * .075;
    const metal = ctx.createLinearGradient(-radius, -radius, radius, radius);
    metal.addColorStop(0, '#17131c');
    metal.addColorStop(.22, '#a88757');
    metal.addColorStop(.38, '#241a2d');
    metal.addColorStop(.65, '#d0a86f');
    metal.addColorStop(1, '#120f17');
    ctx.strokeStyle = metal;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = radius * .11;
    ctx.strokeStyle = 'rgba(151, 43, 255, .9)';
    ctx.lineWidth = Math.max(2, width * .28);
    ctx.setLineDash([radius * .11, radius * .045]);
    ctx.lineDashOffset = -time * radius * .2 * direction;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.max(7, radius * .075)}px Georgia`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < runeCount; i++) {
      const a = (i / runeCount) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -radius);
      ctx.rotate(Math.PI / 2);
      const pulse = .55 + .45 * Math.sin(time * 2.6 + i * 1.7);
      ctx.fillStyle = `rgba(216, 137, 255, ${pulse})`;
      ctx.shadowBlur = 7 + pulse * 8;
      ctx.fillText(i % 3 === 0 ? 'ᚱ' : i % 3 === 1 ? 'ᛉ' : 'ᚨ', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  infinity(cx, cy, size, time) {
    const ctx = this.ctx;
    const floatY = Math.sin(time * 1.05) * size * .025;
    const tilt = Math.sin(time * .72) * .045;
    ctx.save();
    ctx.translate(cx, cy + floatY);
    ctx.rotate(tilt);
    ctx.scale(1, .78 + Math.sin(time * .9) * .018);
    ctx.lineCap = 'round';
    const gradient = ctx.createLinearGradient(-size, -size * .3, size, size * .3);
    const shift = (.5 + Math.sin(time * 1.4) * .22);
    gradient.addColorStop(0, '#17141b');
    gradient.addColorStop(Math.max(.05, shift - .22), '#6e573e');
    gradient.addColorStop(shift, '#f0d69b');
    gradient.addColorStop(Math.min(.95, shift + .2), '#3c263f');
    gradient.addColorStop(1, '#0d0b10');
    ctx.shadowColor = 'rgba(151, 34, 255, .95)';
    ctx.shadowBlur = size * .16;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = size * .19;
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const d = 1 + Math.sin(a) ** 2;
      const x = size * .57 * Math.cos(a) / d;
      const y = size * .42 * Math.sin(a) * Math.cos(a) / d;
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = size * .07;
    ctx.strokeStyle = 'rgba(170, 56, 255, .72)';
    ctx.lineWidth = size * .075;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 239, 197, .72)';
    ctx.lineWidth = Math.max(1.5, size * .014);
    ctx.stroke();
    ctx.restore();
  }

  draw(now) {
    const ctx = this.ctx;
    const t = now * .001;
    const w = this.width;
    const h = this.height;
    if (w && h) {
      ctx.clearRect(0, 0, w, h);
      const cx = w * .5;
      const cy = h * .505;
      const r = Math.min(w, h) * .445;
      const veil = ctx.createRadialGradient(cx, cy, r * .12, cx, cy, r * 1.13);
      veil.addColorStop(0, 'rgba(7, 3, 12, .99)');
      veil.addColorStop(.72, 'rgba(7, 4, 13, .985)');
      veil.addColorStop(.91, 'rgba(9, 5, 15, .88)');
      veil.addColorStop(1, 'rgba(9, 5, 15, 0)');
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);
      for (const p of this.particles) {
        const a = p.seed + t * p.speed;
        const pr = r * p.radius * (1 + .08 * Math.sin(t + p.seed));
        const x = cx + Math.cos(a) * pr;
        const y = cy + Math.sin(a * 1.17) * pr * .82;
        const alpha = .16 + .48 * (.5 + .5 * Math.sin(t * 2 + p.seed));
        ctx.fillStyle = `rgba(188, 82, 255, ${alpha})`;
        ctx.shadowColor = '#9b35ff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      this.ring(cx, cy, r * .93, r * .095, 0, .10, t, 18);
      this.ring(cx, cy, r * .72, r * .082, .4, -.14, t, 14);
      this.ring(cx, cy, r * .52, r * .068, -.2, .19, t, 10);
      this.infinity(cx, cy, r * 1.08, t);
      const pulse = .12 + .07 * Math.sin(t * 2.3);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * .78);
      glow.addColorStop(0, `rgba(180, 59, 255, ${pulse})`);
      glow.addColorStop(1, 'rgba(90, 20, 170, 0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.frame = requestAnimationFrame(this.draw);
  }
}

const canvas = document.getElementById('autoMatchSearchCanvas');
if (canvas) new AutoMatchSearchingVisual(canvas);

