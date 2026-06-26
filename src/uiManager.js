class UIManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.screens = {};
    this.currentScreen = 'title';
    this.selectedDragon = null;
    this.selectedMode = 'FFA';
    this.isHost = false;
    this.roomCode = '';
    this.selectedDifficulty = 'advanced';
    this.selectedMpMode = 'FFA';
    this.selectedArena = 0;

    this.initScreens();
    this.createDynamicModals();
    this.buildModeSelect();
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

  createDynamicModals() {
    if (!document.getElementById('difficultyModal')) {
      const diffModal = document.createElement('div');
      diffModal.id = 'difficultyModal';
      diffModal.className = 'screen';
      diffModal.innerHTML = `
        <div class="difficultyBox">
          <h2>Select Difficulty</h2>
          <div class="difficultyGrid">
            <button class="diffBtn" data-diff="beginner">Beginner</button>
            <button class="diffBtn" data-diff="easy">Easy</button>
            <button class="diffBtn" data-diff="advanced">Advanced</button>
            <button class="diffBtn" data-diff="master">Master</button>
            <button class="diffBtn" data-diff="legendary">Legendary</button>
          </div>
          <button class="menuBtn" id="btnDiffBack"><i data-lucide="arrow-left"></i> Back</button>
        </div>
      `;
      document.body.appendChild(diffModal);
      this.screens['difficultyModal'] = diffModal;
    }

    if (!document.getElementById('mpModeSelect')) {
      const mpMode = document.createElement('div');
      mpMode.id = 'mpModeSelect';
      mpMode.className = 'screen';
      mpMode.innerHTML = `
        <div class="mpModeBox">
          <h2>Select Mode</h2>
          <div class="mpModeGrid">
            <button class="modeCard" data-mpmode="1v1">
              <div class="mIcon">⚔️</div>
              <div class="mLabel">1v1</div>
              <div class="mDesc">One on one battle</div>
            </button>
            <button class="modeCard" data-mpmode="2v2">
              <div class="mIcon">🛡️</div>
              <div class="mLabel">2v2</div>
              <div class="mDesc">Team battle</div>
            </button>
            <button class="modeCard" data-mpmode="FFA">
              <div class="mIcon">🔥</div>
              <div class="mLabel">FFA</div>
              <div class="mDesc">Free For All</div>
            </button>
          </div>
          <button class="menuBtn" id="btnMpModeBack"><i data-lucide="arrow-left"></i> Back</button>
        </div>
      `;
      document.body.appendChild(mpMode);
      this.screens['mpModeSelect'] = mpMode;
    }

    if (!document.getElementById('arenaSelectModal')) {
      const arenaModal = document.createElement('div');
      arenaModal.id = 'arenaSelectModal';
      arenaModal.className = 'screen';
      arenaModal.innerHTML = `
        <div class="arenaSelectBox">
          <h2>Select Arena</h2>
          <div class="arenaGrid">
            <button class="arenaCard" data-arena="0">
              <div class="arenaPreview" style="background:#8B9DC3"></div>
              <div class="arenaName">Stone Castle</div>
            </button>
            <button class="arenaCard" data-arena="1">
              <div class="arenaPreview" style="background:#4CAF50"></div>
              <div class="arenaName">Grass Field</div>
            </button>
            <button class="arenaCard" data-arena="2">
              <div class="arenaPreview" style="background:#9C27B0"></div>
              <div class="arenaName">Purple Magic</div>
            </button>
            <button class="arenaCard" data-arena="3">
              <div class="arenaPreview" style="background:#FF5722"></div>
              <div class="arenaName">Fire Arena</div>
            </button>
          </div>
          <button class="menuBtn" id="btnArenaBack"><i data-lucide="arrow-left"></i> Back</button>
        </div>
      `;
      document.body.appendChild(arenaModal);
      this.screens['arenaSelectModal'] = arenaModal;
    }
  }

  buildModeSelect() {
    const container = document.querySelector('.modeCards');
    if (!container) return;
    container.innerHTML = '';

    const cards = [
      { id: 'btn1v1AI', icon: '⚔️', label: '1v1 VS AI', desc: 'Battle against AI dragon' },
      { id: 'btnMpMultiplayer', icon: '🌐', label: 'Multiplayer', desc: 'Online battles' }
    ];

    cards.forEach(c => {
      const card = document.createElement('button');
      card.className = 'modeCard';
      card.id = c.id;
      card.innerHTML = `
        <div class="mIcon">${c.icon}</div>
        <div class="mLabel">${c.label}</div>
        <div class="mDesc">${c.desc}</div>
      `;
      container.appendChild(card);
    });
  }

  initLucide() {
    if (window.lucide) {
      window.lucide.createIcons();
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
      if (s) {
        s.classList.remove('active', 'slide-out-left', 'slide-in-right');
        s.style.display = '';
      }
    });
    if (this.screens[screenId]) {
      this.screens[screenId].classList.add('active');
      this.currentScreen = screenId;
      this.refreshIcons();
    }
  }

  transitionToScreen(fromId, toId, delay = 500) {
    return new Promise(resolve => {
      const from = this.screens[fromId];
      const to = this.screens[toId];

      if (!from || !to) {
        this.showScreen(toId);
        resolve();
        return;
      }

      to.style.display = 'flex';
      to.classList.add('slide-in-right');
      void to.offsetWidth;

      from.classList.add('slide-out-left');
      to.classList.add('active');
      to.classList.remove('slide-in-right');

      setTimeout(() => {
        from.classList.remove('active', 'slide-out-left');
        from.style.display = '';
        to.style.display = '';
        this.currentScreen = toId;
        resolve();
      }, delay);
    });
  }

  async transitionToLoadingThenEmit(mode, difficulty, arenaIndex) {
    const loadingScreen = this.screens['loadingScreen'];
    if (loadingScreen) {
      let loadText = loadingScreen.querySelector('.loadingText');
      if (!loadText) {
        loadText = document.createElement('div');
        loadText.className = 'loadingText';
        loadText.textContent = 'Loading...';
        loadingScreen.appendChild(loadText);
      }
      setTimeout(() => loadText.classList.add('visible'), 100);
    }

    await this.transitionToScreen('arenaSelectModal', 'loadingScreen', 600);

    setTimeout(() => {
      this.eventBus.emit('ui:arenaSelected', { mode, difficulty, arenaIndex });
    }, 1200);
  }

  bindEvents() {
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

    document.getElementById('btnDsBack')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });

    document.getElementById('btnModeBack')?.addEventListener('click', () => {
      this.showScreen('dragonSelectScreen');
    });

    // Only 2 mode cards now
    document.getElementById('btn1v1AI')?.addEventListener('click', () => {
      this.showScreen('difficultyModal');
    });

    document.getElementById('btnMpMultiplayer')?.addEventListener('click', () => {
      this.showScreen('mpModeSelect');
    });

    // Difficulty modal
    document.querySelectorAll('#difficultyModal .diffBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDifficulty = btn.dataset.diff;
        this.selectedMode = '1v1AI';
        this.showScreen('arenaSelectModal');
      });
    });

    document.getElementById('btnDiffBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });

    // Arena selection
    document.querySelectorAll('#arenaSelectModal .arenaCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedArena = parseInt(btn.dataset.arena);
        this.transitionToLoadingThenEmit(this.selectedMode, this.selectedDifficulty, this.selectedArena);
      });
    });

    document.getElementById('btnArenaBack')?.addEventListener('click', () => {
      this.showScreen('difficultyModal');
    });

    // MP Mode selection
    document.querySelectorAll('#mpModeSelect .modeCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMpMode = btn.dataset.mpmode;
        this.showScreen('mpMenuScreen');
      });
    });

    document.getElementById('btnMpModeBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });

    // Multiplayer menu
    document.getElementById('btnMpBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });
    document.getElementById('btnMpCreate')?.addEventListener('click', () => {
      this.isHost = true;
      this.eventBus.emit('mp:createRoom', { mode: this.selectedMpMode });
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

    ctx.strokeStyle = 'rgba(0,180,216,0.3)';
    ctx.strokeRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0,180,216,0.5)';
    for (const food of foods) {
      const mx = (food.x - bounds.minX) * scaleX;
      const my = (food.y - bounds.minY) * scaleY;
      ctx.fillRect(mx - 1, my - 1, 2, 2);
    }

    for (const dragon of dragons) {
      if (dragon.state !== 'alive') continue;
      const mx = (dragon.head.x - bounds.minX) * scaleX;
      const my = (dragon.head.y - bounds.minY) * scaleY;
      ctx.fillStyle = dragon.id === 'local' ? '#c77dff' : '#ff4d4d';
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const viewW = w / camera.zoom;
    const viewH = h / camera.zoom;
    const vx = (camera.x - bounds.minX - (w / camera.zoom) / 2) * scaleX;
    const vy = (camera.y - bounds.minY - (h / camera.zoom) / 2) * scaleY;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.strokeRect(vx, vy, w / camera.zoom * scaleX, h / camera.zoom * scaleY);
  }
}

export default UIManager;
