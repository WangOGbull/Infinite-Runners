// UI Manager - handles all DOM-based UI, screens, and user interactions
class UIManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.screens = {};
    this.currentScreen = 'title';
    this.selectedDragon = null;
    this.selectedMode = 'FFA';
    this.isHost = false;
    this.roomCode = '';

    this.initScreens();
    this.initLucide();
    this.initParticles();
    this.bindEvents();
  }

  initScreens() {
    const screenIds = [
      'titleScreen', 'dragonSelectScreen', 'modeSelectScreen', 'mpMenuScreen',
      'lobbyScreen', 'loadingScreen', 'gameScreen', 'gameOverScreen',
      'howToPlayScreen', 'walletModal', 'mpGameOver'
    ];
    screenIds.forEach(id => {
      this.screens[id] = document.getElementById(id);
    });
  }

  initLucide() {
    if (window.lucide) {
      window.lucide.createIcons();
      // Re-initialize icons when screen changes
      this.lucideReady = true;
    } else {
      setTimeout(() => this.initLucide(), 100);
    }
  }

  refreshIcons() {
    if (window.lucide && this.lucideReady) {
      window.lucide.createIcons();
    }
  }

  showScreen(screenId) {
    Object.values(this.screens).forEach(s => {
      if (s) s.classList.remove('active');
    });
    if (this.screens[screenId]) {
      this.screens[screenId].classList.add('active');
      this.currentScreen = screenId;
      this.refreshIcons();
    }
  }

  bindEvents() {
    // Title screen
    document.getElementById('btnPlayNow')?.addEventListener('click', () => {
      this.eventBus.emit('ui:showDragonSelect');
    });
    document.getElementById('btnStartGame')?.addEventListener('click', () => {
      this.eventBus.emit('ui:showDragonSelect');
    });
    document.getElementById('btnLeaderboard')?.addEventListener('click', () => {
      this.eventBus.emit('ui:showLeaderboard');
    });
    document.getElementById('btnHowToPlay')?.addEventListener('click', () => {
      this.showScreen('howToPlayScreen');
    });
    document.getElementById('walletBtn')?.addEventListener('click', () => {
      this.showScreen('walletModal');
    });

    // Dragon select
    document.getElementById('btnDsBack')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });

    // Mode select
    document.getElementById('btnModeBack')?.addEventListener('click', () => {
      this.showScreen('dragonSelectScreen');
    });

    // Mode cards
    ['btn1v1AI', 'btn2v2', 'btn4v4', 'btnFFA'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          this.selectedMode = btn.dataset.mode;
          this.eventBus.emit('ui:modeSelected', { mode: this.selectedMode });
        });
      }
    });

    document.getElementById('btnMpMultiplayer')?.addEventListener('click', () => {
      this.showScreen('mpMenuScreen');
    });

    // Multiplayer menu
    document.getElementById('btnMpBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });
    document.getElementById('btnMpCreate')?.addEventListener('click', () => {
      this.isHost = true;
      this.eventBus.emit('mp:createRoom');
    });
    document.getElementById('btnMpJoin')?.addEventListener('click', () => {
      const code = document.getElementById('mpRoomInput')?.value.trim();
      if (code && code.length === 6) {
        this.isHost = false;
        this.eventBus.emit('mp:joinRoom', { code });
      } else {
        const err = document.getElementById('mpJoinError');
        if (err) err.textContent = 'Enter a valid 6-digit code';
      }
    });

    // Lobby
    document.getElementById('btnLeaveRoom')?.addEventListener('click', () => {
      this.eventBus.emit('mp:leaveRoom');
      this.showScreen('titleScreen');
    });
    document.getElementById('lobbyStartBtn')?.addEventListener('click', () => {
      this.eventBus.emit('mp:startGame');
    });
    document.getElementById('lobbyModeFfa')?.addEventListener('click', () => {
      this.setLobbyMode('FFA');
    });
    document.getElementById('lobbyMode2v2')?.addEventListener('click', () => {
      this.setLobbyMode('2v2');
    });

    // Game
    document.getElementById('pauseBtn')?.addEventListener('click', () => {
      this.eventBus.emit('game:pause');
    });
    document.getElementById('btnResume')?.addEventListener('click', () => {
      this.eventBus.emit('game:resume');
    });
    document.getElementById('btnChangeDragon')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('dragonSelectScreen');
    });
    document.getElementById('btnQuit')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });

    // Game over
    document.getElementById('btnPlayAgain')?.addEventListener('click', () => {
      this.eventBus.emit('game:restart');
    });
    document.getElementById('btnMainMenu')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });

    // How to play
    document.getElementById('btnHtpClose')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });
    document.getElementById('btnGotIt')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });
    document.querySelectorAll('.htpTab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.htpTab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.htpPanel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById('htp' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
        if (panel) panel.classList.add('active');
      });
    });

    // Wallet modal
    document.getElementById('btnWalletClose')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });
    document.querySelectorAll('.wOpt').forEach(opt => {
      opt.addEventListener('click', () => {
        this.eventBus.emit('wallet:connect', { wallet: opt.dataset.w });
        this.showScreen('titleScreen');
      });
    });

    // MP Game Over
    document.getElementById('btnReturnLobby')?.addEventListener('click', () => {
      this.showScreen('lobbyScreen');
    });
    document.getElementById('btnMpMainMenu')?.addEventListener('click', () => {
      this.eventBus.emit('mp:leaveRoom');
      this.showScreen('titleScreen');
    });
  }

  setLobbyMode(mode) {
    document.getElementById('lobbyModeFfa')?.classList.toggle('active', mode === 'FFA');
    document.getElementById('lobbyMode2v2')?.classList.toggle('active', mode === '2v2');
    document.getElementById('lobbyGameMode').textContent = mode === 'FFA' ? 'Free For All' : '2v2 Teams';
  }

  buildDragonSelect(dragons) {
    const list = document.getElementById('dragonList');
    if (!list) return;
    list.innerHTML = '';

    const colors = {
      aegis: '#9b4dff',
      ignis: '#ff4d4d',
      infinite: '#00b4d8',
      magnetron: '#ff00aa'
    };

    const dims = {
      aegis: 'rgba(155,77,255,0.1)',
      ignis: 'rgba(255,77,77,0.1)',
      infinite: 'rgba(0,180,216,0.1)',
      magnetron: 'rgba(255,0,170,0.1)'
    };

    dragons.forEach(d => {
      const card = document.createElement('div');
      card.className = 'dragonCard';
      card.style.setProperty('--dc', colors[d.name] || '#fff');
      card.style.setProperty('--dim', dims[d.name] || 'rgba(255,255,255,0.05)');
      card.innerHTML = `
        <div class="dImg"><img src="${d.headSrc}" alt="${d.name}"></div>
        <div class="dInfo">
          <div class="dName">${d.name.toUpperCase()}</div>
          <div class="dSpecial">${this.getDragonSpecial(d.name)}</div>
          <div class="dStats">
            <div class="dStat"><label>SPEED</label><div class="dBar"><div style="width:${this.getDragonStat(d.name, 'speed')}"></div></div><div class="dVal">${this.getDragonStat(d.name, 'speed')}</div></div>
            <div class="dStat"><label>POWER</label><div class="dBar"><div style="width:${this.getDragonStat(d.name, 'power')}"></div></div><div class="dVal">${this.getDragonStat(d.name, 'power')}</div></div>
            <div class="dStat"><label>DEFENSE</label><div class="dBar"><div style="width:${this.getDragonStat(d.name, 'defense')}"></div></div><div class="dVal">${this.getDragonStat(d.name, 'defense')}</div></div>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        this.selectedDragon = d.name;
        this.eventBus.emit('ui:dragonSelected', { name: d.name });
        this.showScreen('modeSelectScreen');
      });
      list.appendChild(card);
    });
    this.refreshIcons();
  }

  getDragonSpecial(name) {
    const specials = {
      aegis: 'Balanced Guardian',
      ignis: 'Aggressive Speedster',
      infinite: 'Longest Body Trap',
      magnetron: 'Tanky Survivor'
    };
    return specials[name] || '';
  }

  getDragonStat(name, stat) {
    const stats = {
      aegis: { speed: '70%', power: '70%', defense: '70%' },
      ignis: { speed: '95%', power: '80%', defense: '40%' },
      infinite: { speed: '50%', power: '60%', defense: '80%' },
      magnetron: { speed: '40%', power: '70%', defense: '95%' }
    };
    return stats[name]?.[stat] || '50%';
  }

  updateLobby(players, maxPlayers, code, isHost) {
    document.getElementById('roomCodeDisplay').textContent = code || '------';
    document.getElementById('lobbyPlayerCount').textContent = `${players.length} / ${maxPlayers}`;

    const slots = document.getElementById('lobbySlots');
    if (!slots) return;
    slots.innerHTML = '';

    for (let i = 0; i < maxPlayers; i++) {
      const slot = document.createElement('div');
      slot.className = 'lobbySlot';
      const player = players[i];
      if (player) {
        slot.innerHTML = `
          <div class="lobbyPlayerCard ${player.isLocal ? 'local' : ''}">
            <div class="lobbyPlayerIcon">🐉</div>
            <div class="lobbyPlayerInfo">
              <div class="lobbyPlayerName">${player.name}</div>
              <div class="lobbyPlayerDragon">${player.dragon || 'Unknown'}</div>
            </div>
          </div>
        `;
      } else {
        slot.innerHTML = `<div class="lobbyPlayerCard empty">Waiting...</div>`;
      }
      slots.appendChild(slot);
    }

    const startBtn = document.getElementById('lobbyStartBtn');
    const waitingText = document.getElementById('lobbyWaitingText');
    if (startBtn) startBtn.style.display = isHost ? 'block' : 'none';
    if (waitingText) waitingText.style.display = isHost ? 'none' : 'block';
  }

  updateHUD(score, timeStr) {
    document.getElementById('scoreVal').textContent = score;
    document.getElementById('timerDisplay').textContent = timeStr;
  }

  showPauseOverlay(show) {
    const overlay = document.getElementById('pauseOverlay');
    if (overlay) overlay.classList.toggle('active', show);
  }

  updateGameOver(stats) {
    document.getElementById('goTime').textContent = stats.time;
    document.getElementById('goCollect').textContent = stats.collected;
    document.getElementById('goKills').textContent = stats.kills;
  }

  showCountdown(number, callback) {
    const overlay = document.getElementById('countdownOverlay');
    const text = document.getElementById('countdownText');
    if (!overlay || !text) {
      if (callback) callback();
      return;
    }

    overlay.classList.add('active');
    let count = number;
    text.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        overlay.classList.remove('active');
        if (callback) callback();
      } else {
        text.textContent = count;
      }
    }, 1000);
  }

  initParticles() {
    const canvas = document.getElementById('pCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.5 + 0.2
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 180, 216, ${p.opacity})`;
        ctx.fill();
      }
      requestAnimationFrame(animate);
    };
    animate();
  }

  renderMinimap(canvas, camera, arena, dragons, foods) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const bounds = arena.getBounds();
    const scaleX = w / arena.width;
    const scaleY = h / arena.height;

    // Arena border
    ctx.strokeStyle = 'rgba(0,180,216,0.3)';
    ctx.strokeRect(0, 0, w, h);

    // Food dots
    ctx.fillStyle = 'rgba(0,180,216,0.5)';
    for (const food of foods) {
      const mx = (food.x - bounds.minX) * scaleX;
      const my = (food.y - bounds.minY) * scaleY;
      ctx.fillRect(mx - 1, my - 1, 2, 2);
    }

    // Dragon dots
    for (const dragon of dragons) {
      if (dragon.state !== 'alive') continue;
      const mx = (dragon.head.x - bounds.minX) * scaleX;
      const my = (dragon.head.y - bounds.minY) * scaleY;
      ctx.fillStyle = dragon.id === 'local' ? '#c77dff' : '#ff4d4d';
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera viewport
    const viewW = w / camera.zoom;
    const viewH = h / camera.zoom;
    const vx = (camera.x - bounds.minX - (w / camera.zoom) / 2) * scaleX;
    const vy = (camera.y - bounds.minY - (h / camera.zoom) / 2) * scaleY;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.strokeRect(vx, vy, w / camera.zoom * scaleX, h / camera.zoom * scaleY);
  }
}

export default UIManager;
