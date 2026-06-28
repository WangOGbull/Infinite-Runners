import CONFIG from './config.js';

export default class UIManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.screens = {};
    this.currentScreen = null;
    this.countdownOverlay = null;
    this.countdownInterval = null;
  }

  showScreen(screenId) {
    if (this.currentScreen) {
      const el = document.getElementById(this.currentScreen);
      if (el) el.style.display = 'none';
    }
    const el = document.getElementById(screenId);
    if (el) {
      el.style.display = 'flex';
      this.currentScreen = screenId;
    }
  }

  buildDragonSelect(dragons) {
    const container = document.getElementById('dragonSelectGrid');
    if (!container) return;
    container.innerHTML = '';

    for (const dragon of dragons) {
      const card = document.createElement('div');
      card.className = 'dragon-card';
      card.dataset.name = dragon.name;

      const img = document.createElement('img');
      img.src = dragon.head?.src || '';
      img.alt = dragon.name;
      img.className = 'dragon-card-img';

      const nameLabel = document.createElement('div');
      nameLabel.className = 'dragon-card-name';
      nameLabel.textContent = dragon.name.toUpperCase();

      card.appendChild(img);
      card.appendChild(nameLabel);

      card.addEventListener('click', () => {
        document.querySelectorAll('.dragon-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.eventBus.emit('ui:dragonSelected', { name: dragon.name });
      });

      container.appendChild(card);
    }
  }

  updateHUD(score, timeStr) {
    const scoreEl = document.getElementById('scoreDisplay');
    const timerEl = document.getElementById('timerDisplay');
    if (scoreEl) scoreEl.textContent = score;
    if (timerEl) timerEl.textContent = timeStr;
  }

  showPauseOverlay(show) {
    const overlay = document.getElementById('pauseOverlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
  }

  updateGameOver(stats) {
    const timeEl = document.getElementById('goTime');
    const collectedEl = document.getElementById('goCollected');
    const killsEl = document.getElementById('goKills');
    if (timeEl) timeEl.textContent = stats.time || '0:00';
    if (collectedEl) collectedEl.textContent = stats.collected || 0;
    if (killsEl) killsEl.textContent = stats.kills || 0;
  }

  // ==================== DRAGON AGE COUNTDOWN ====================
  showCountdown(seconds, onComplete) {
    // Hide game canvas and HUD during countdown
    const gameCanvas = document.getElementById('gameCanvas');
    const hud = document.getElementById('gameHUD');
    const minimap = document.getElementById('minimapContainer');

    if (gameCanvas) gameCanvas.style.visibility = 'hidden';
    if (hud) hud.style.visibility = 'hidden';
    if (minimap) minimap.style.visibility = 'hidden';

    // Create or reuse countdown overlay
    let overlay = document.getElementById('countdownOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'countdownOverlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: radial-gradient(ellipse at center, rgba(20,10,5,0.95) 0%, rgba(0,0,0,0.98) 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        pointer-events: none;
      `;
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    overlay.innerHTML = '';

    // Arena title
    const title = document.createElement('div');
    title.textContent = 'DRAGONS ARENA';
    title.style.cssText = `
      font-family: 'Cinzel', 'Georgia', serif;
      font-size: 18px;
      color: #c9a84c;
      letter-spacing: 8px;
      text-transform: uppercase;
      margin-bottom: 40px;
      text-shadow: 0 0 20px rgba(201,168,76,0.4);
      opacity: 0;
      animation: fadeInUp 0.8s ease forwards;
    `;
    overlay.appendChild(title);

    // Big number container
    const numberContainer = document.createElement('div');
    numberContainer.id = 'countdownNumber';
    numberContainer.style.cssText = `
      font-family: 'Cinzel', 'Georgia', serif;
      font-size: 140px;
      font-weight: 700;
      color: #e8d5a3;
      text-shadow:
        0 0 30px rgba(232,213,163,0.6),
        0 0 60px rgba(201,168,76,0.3),
        0 0 100px rgba(139,69,19,0.2);
      line-height: 1;
      min-height: 160px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    overlay.appendChild(numberContainer);

    // Subtitle
    const subtitle = document.createElement('div');
    subtitle.id = 'countdownSubtitle';
    subtitle.style.cssText = `
      font-family: 'Cinzel', 'Georgia', serif;
      font-size: 14px;
      color: #8b7355;
      letter-spacing: 6px;
      text-transform: uppercase;
      margin-top: 30px;
      opacity: 0;
    `;
    overlay.appendChild(subtitle);

    // Add keyframe animation
    if (!document.getElementById('countdownStyles')) {
      const style = document.createElement('style');
      style.id = 'countdownStyles';
      style.textContent = `
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes countdownPulse {
          0% { transform: scale(0.5); opacity: 0; }
          20% { transform: scale(1.1); opacity: 1; }
          40% { transform: scale(0.95); }
          60% { transform: scale(1.02); }
          80% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes countdownGo {
          0% { transform: scale(0.3); opacity: 0; }
          30% { transform: scale(1.2); opacity: 1; }
          50% { transform: scale(1); }
          80% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(2); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    let count = seconds;

    const updateNumber = () => {
      const numEl = document.getElementById('countdownNumber');
      const subEl = document.getElementById('countdownSubtitle');
      if (!numEl) return;

      if (count > 0) {
        numEl.textContent = count;
        numEl.style.animation = 'none';
        numEl.offsetHeight; // force reflow
        numEl.style.animation = 'countdownPulse 1s ease forwards';

        if (subEl) {
          subEl.textContent = 'PREPARE FOR BATTLE';
          subEl.style.animation = 'none';
          subEl.offsetHeight;
          subEl.style.animation = 'fadeInUp 0.5s ease forwards';
        }
      } else {
        numEl.textContent = 'FIGHT!';
        numEl.style.color = '#ff4444';
        numEl.style.textShadow = '0 0 40px rgba(255,68,68,0.8), 0 0 80px rgba(139,0,0,0.4)';
        numEl.style.animation = 'none';
        numEl.offsetHeight;
        numEl.style.animation = 'countdownGo 0.8s ease forwards';

        if (subEl) {
          subEl.textContent = '';
        }
      }
    };

    updateNumber();

    this.countdownInterval = setInterval(() => {
      count--;
      if (count >= 0) {
        updateNumber();
      }
      if (count < 0) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;

        // Fade out overlay
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';

        setTimeout(() => {
          overlay.style.display = 'none';
          overlay.style.opacity = '1';

          // Show game canvas and HUD
          if (gameCanvas) gameCanvas.style.visibility = 'visible';
          if (hud) hud.style.visibility = 'visible';
          if (minimap) minimap.style.visibility = 'visible';

          if (onComplete) onComplete();
        }, 500);
      }
    }, 1000);
  }

  // ==================== MINIMAP ====================
  renderMinimap(canvas, camera, arenaManager, dragons, foods) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const bounds = arenaManager.getBounds();
    const arenaW = bounds.maxX - bounds.minX;
    const arenaH = bounds.maxY - bounds.minY;
    const scaleX = w / arenaW;
    const scaleY = h / arenaH;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (w - arenaW * scale) / 2;
    const offsetY = (h - arenaH * scale) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(offsetX, offsetY, arenaW * scale, arenaH * scale);

    ctx.strokeStyle = 'rgba(201,168,76,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, arenaW * scale, arenaH * scale);

    for (const food of foods) {
      const fx = offsetX + (food.x - bounds.minX) * scale;
      const fy = offsetY + (food.y - bounds.minY) * scale;
      ctx.fillStyle = food.color || '#00ff88';
      ctx.beginPath();
      ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const dragon of dragons) {
      if (!dragon.alive) continue;
      const dx = offsetX + (dragon.head.x - bounds.minX) * scale;
      const dy = offsetY + (dragon.head.y - bounds.minY) * scale;

      const isLocal = dragon === window.game?.localDragon;
      ctx.fillStyle = isLocal ? '#ff4444' : '#4488ff';
      ctx.beginPath();
      ctx.arc(dx, dy, 3, 0, Math.PI * 2);
      ctx.fill();

      if (isLocal) {
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(dx, dy, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Camera view box
    if (camera) {
      const viewW = (window.innerWidth / camera.zoom) * scale;
      const viewH = (window.innerHeight / camera.zoom) * scale;
      const vx = offsetX + (camera.x - bounds.minX - viewW / 2) * scale;
      const vy = offsetY + (camera.y - bounds.minY - viewH / 2) * scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx, vy, viewW, viewH);
    }
  }

  // ==================== LOBBY ====================
  updateLobby(players, maxPlayers, roomCode, isHost) {
    const codeEl = document.getElementById('lobbyRoomCode');
    const listEl = document.getElementById('lobbyPlayerList');
    const startBtn = document.getElementById('lobbyStartBtn');

    if (codeEl) codeEl.textContent = roomCode;
    if (startBtn) startBtn.style.display = isHost ? 'block' : 'none';

    if (listEl) {
      listEl.innerHTML = '';
      for (let i = 0; i < maxPlayers; i++) {
        const player = players[i];
        const slot = document.createElement('div');
        slot.className = 'lobby-slot';

        if (player) {
          slot.innerHTML = `
            <span class="lobby-name">${player.name || 'Player'}</span>
            <span class="lobby-dragon">${player.dragon || 'ignis'}</span>
            ${player.isLocal ? '<span class="lobby-tag">YOU</span>' : ''}
          `;
          slot.classList.add('filled');
        } else {
          slot.innerHTML = '<span class="lobby-waiting">Waiting...</span>';
          slot.classList.add('empty');
        }
        listEl.appendChild(slot);
      }
    }
  }

  updateLobbyArena(arenaIndex, isHost) {
    const display = document.getElementById('lobbyArenaDisplay');
    if (display) {
      display.textContent = 'Arena ' + (arenaIndex + 1);
    }
    const prevBtn = document.getElementById('lobbyArenaPrev');
    const nextBtn = document.getElementById('lobbyArenaNext');
    if (prevBtn) prevBtn.style.display = isHost ? 'inline-block' : 'none';
    if (nextBtn) nextBtn.style.display = isHost ? 'inline-block' : 'none';
  }
}
