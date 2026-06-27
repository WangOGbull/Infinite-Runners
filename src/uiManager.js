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
      'titleScreen', 'dragonSelectScreen', 'modeSelectScreen',
      'mpMenuScreen', 'lobbyScreen', 'loadingScreen', 'gameScreen',
      'gameOverScreen', 'howToPlayScreen', 'walletModal',
      'mpGameOver', 'loadingOverlay'
    ];
    screenIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) this.screens[id] = el;
    });
  }

  createDynamicModals() {
    // Difficulty modal
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

    // Arena select modal
    const arenaModal = document.createElement('div');
    arenaModal.id = 'arenaSelectModal';
    arenaModal.className = 'screen';
    arenaModal.innerHTML = `
      <div class="arenaSelectInner">
        <h2>Select Arena</h2>
        <div class="arenaGrid">
          <div class="arenaCard" data-arena="0">
            <div class="arenaPreview" style="background-image:url(https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_stone.png)"></div>
            <div class="arenaName">Stone Castle</div>
          </div>
          <div class="arenaCard" data-arena="1">
            <div class="arenaPreview" style="background-image:url(https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_grass.png)"></div>
            <div class="arenaName">Grass Field</div>
          </div>
          <div class="arenaCard" data-arena="2">
            <div class="arenaPreview" style="background-image:url(https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_purple.png)"></div>
            <div class="arenaName">Purple Magic</div>
          </div>
          <div class="arenaCard" data-arena="3">
            <div class="arenaPreview" style="background-image:url(https://raw.githubusercontent.com/WangOGbull/Infinite-Runners/main/arenas/arena_fire.png)"></div>
            <div class="arenaName">Fire Arena</div>
          </div>
        </div>
        <button id="btnArenaBack"><i data-lucide="arrow-left"></i> Back</button>
      </div>
    `;
    document.body.appendChild(arenaModal);
    this.screens['arenaSelectModal'] = arenaModal;

    // MP mode select
    const mpModeSelect = document.createElement('div');
    mpModeSelect.id = 'mpModeSelect';
    mpModeSelect.className = 'screen';
    mpModeSelect.innerHTML = `
      <div class="mpModeBox">
        <h2>Multiplayer Mode</h2>
        <div class="mpModeGrid">
          <div class="modeCard" data-mpmode="FFA">
            <div class="mIcon"><i data-lucide="globe"></i></div>
            <div class="mLabel">Free For All</div>
            <div class="mDesc">Every dragon for itself.</div>
          </div>
          <div class="modeCard" data-mpmode="2v2">
            <div class="mIcon"><i data-lucide="users"></i></div>
            <div class="mLabel">2v2 Teams</div>
            <div class="mDesc">Team up and fight together.</div>
          </div>
        </div>
        <button class="menuBtn" id="btnMpModeBack"><i data-lucide="arrow-left"></i> Back</button>
      </div>
    `;
    document.body.appendChild(mpModeSelect);
    this.screens['mpModeSelect'] = mpModeSelect;
  }

  buildModeSelect() {
    // Mode select is already in HTML
  }

  buildDragonSelect(dragons) {
    const list = document.getElementById('dragonList');
    if (!list) return;
    list.innerHTML = '';

    dragons.forEach((d, i) => {
      const card = document.createElement('div');
      card.className = 'dragonCard';
      const dc = d.color || '#888888';
      card.style.setProperty('--dc', dc);
      card.style.setProperty('--dim', dc + '15');

      const headUrl = typeof d.head === 'string' ? d.head : (d.head?.src || '');
      const statsHtml = (d.stats || []).map(s => `
        <div class="dStat">
          <label>${s.name}</label>
          <div class="dBar"><div style="width:${s.value}%"></div></div>
          <span class="dVal">${s.value}</span>
        </div>
      `).join('');

      card.innerHTML = `
        <div class="dImg"><img src="${headUrl}" alt="${d.name}" loading="lazy"></div>
        <div class="dInfo">
          <div class="dName">${d.name}</div>
          <div class="dSpecial">${d.special || ''}</div>
          <div class="dStats">${statsHtml}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        this.selectedDragon = d.name;
        this.eventBus.emit('ui:dragonSelected', { name: d.name });
        this.showScreen('modeSelectScreen');
      });

      list.appendChild(card);
    });
  }

  initLucide() {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  initParticles() {
    const canvas = document.getElementById('pCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5,
        dx: (Math.random() - 0.5) * 0.3,
        dy: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.5 + 0.1
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 180, 216, ${p.alpha})`;
        ctx.fill();
      });
      requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }

  bindEvents() {
    // Title screen buttons
    document.getElementById('btnPlayNow')?.addEventListener('click', () => {
      this.showScreen('dragonSelectScreen');
    });
    document.getElementById('btnStartGame')?.addEventListener('click', () => {
      this.showScreen('dragonSelectScreen');
    });
    document.getElementById('btnLeaderboard')?.addEventListener('click', () => {
      this.showScreen('loadingScreen');
      setTimeout(() => this.showScreen('titleScreen'), 1000);
    });
    document.getElementById('btnHowToPlay')?.addEventListener('click', () => {
      this.showScreen('howToPlayScreen');
    });

    // Dragon select back
    document.getElementById('btnDsBack')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });

    // Mode select
    document.getElementById('btnModeBack')?.addEventListener('click', () => {
      this.showScreen('dragonSelectScreen');
    });

    document.getElementById('btn1v1AI')?.addEventListener('click', () => {
      this.selectedMode = '1v1';
      this.showScreen('difficultyModal');
    });

    document.getElementById('btn2v2')?.addEventListener('click', () => {
      this.selectedMode = '2v2';
      this.showScreen('difficultyModal');
    });

    document.getElementById('btn4v4')?.addEventListener('click', () => {
      this.selectedMode = '4v4';
      this.showScreen('difficultyModal');
    });

    document.getElementById('btnFFA')?.addEventListener('click', () => {
      this.selectedMode = 'FFA';
      this.showScreen('difficultyModal');
    });

    document.getElementById('btnMpMultiplayer')?.addEventListener('click', () => {
      this.showScreen('mpMenuScreen');
    });

    // Difficulty modal
    document.querySelectorAll('#difficultyModal .diffBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDifficulty = btn.dataset.diff;
        this.showScreen('arenaSelectModal');
      });
    });

    document.getElementById('btnDiffBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });

    // Arena select
    document.querySelectorAll('#arenaSelectModal .arenaCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedArena = parseInt(btn.dataset.arena);
        this.eventBus.emit('ui:arenaSelected', {
          mode: this.selectedMode,
          difficulty: this.selectedDifficulty,
          arenaIndex: this.selectedArena
        });
      });
    });

    document.getElementById('btnArenaBack')?.addEventListener('click', () => {
      this.showScreen('difficultyModal');
    });

    // MP menu
    document.getElementById('btnMpCreate')?.addEventListener('click', () => {
      this.showScreen('mpModeSelect');
    });

    document.getElementById('btnMpJoin')?.addEventListener('click', () => {
      const input = document.getElementById('mpRoomInput');
      const code = input?.value.trim();
      if (code && code.length === 6) {
        this.eventBus.emit('mp:joinRoom', { code });
      } else {
        const err = document.getElementById('mpJoinError');
        if (err) err.textContent = 'Enter a valid 6-digit code';
      }
    });

    document.getElementById('btnMpBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });

    // MP mode select
    document.querySelectorAll('#mpModeSelect .modeCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMpMode = btn.dataset.mpmode;
        this.eventBus.emit('mp:createRoom', { mode: this.selectedMpMode });
      });
    });

    document.getElementById('btnMpModeBack')?.addEventListener('click', () => {
      this.showScreen('mpMenuScreen');
    });

    // Lobby
    document.getElementById('lobbyStartBtn')?.addEventListener('click', () => {
      this.eventBus.emit('mp:startGame');
    });

    document.getElementById('btnLeaveRoom')?.addEventListener('click', () => {
      this.eventBus.emit('mp:leaveRoom');
      this.showScreen('titleScreen');
    });

    // Lobby arena selector
    document.querySelectorAll('#lobbyArenaThumbs .arenaThumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const arenaIndex = parseInt(btn.dataset.arena);
        this.eventBus.emit('lobby:arenaSelected', { arenaIndex });
      });
    });

    // Game controls
    document.getElementById('pauseBtn')?.addEventListener('click', () => {
      this.eventBus.emit('game:pause');
    });
    document.getElementById('btnResume')?.addEventListener('click', () => {
      this.eventBus.emit('game:resume');
    });
    document.getElementById('btnQuit')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });
    document.getElementById('btnChangeDragon')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('dragonSelectScreen');
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

    // HTP tabs
    document.querySelectorAll('.htpTab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.htpTab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.htpPanel').forEach(p => p.classList.remove('active'));
        document.getElementById('htp' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1))?.classList.add('active');
      });
    });

    // Wallet
    document.getElementById('walletBtn')?.addEventListener('click', () => {
      this.showScreen('walletModal');
    });
    document.getElementById('btnWalletClose')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });
    document.querySelectorAll('.wOpt').forEach(opt => {
      opt.addEventListener('click', () => {
        this.eventBus.emit('wallet:connect', { wallet: opt.dataset.w });
        this.showScreen('titleScreen');
      });
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.currentScreen === 'gameScreen') {
          this.eventBus.emit('game:pause');
        }
      }
    });
  }

  showScreen(screenId) {
    Object.values(this.screens).forEach(s => {
      if (s) s.classList.remove('active');
    });
    if (this.screens[screenId]) {
      this.screens[screenId].classList.add('active');
      this.currentScreen = screenId;
    }
    if (typeof lucide !== 'undefined') {
      setTimeout(() => lucide.createIcons(), 50);
    }
  }

  updateLobby(players, maxPlayers, roomCode, isHost) {
    this.isHost = isHost;
    this.roomCode = roomCode;

    const codeDisplay = document.getElementById('roomCodeDisplay');
    if (codeDisplay) codeDisplay.textContent = roomCode;

    const modeDisplay = document.getElementById('lobbyGameMode');
    if (modeDisplay) modeDisplay.textContent = this.selectedMpMode || 'FFA';

    const countDisplay = document.getElementById('lobbyPlayerCount');
    if (countDisplay) countDisplay.textContent = players.length + ' / ' + maxPlayers;

    const slots = document.getElementById('lobbySlots');
    if (slots) {
      slots.innerHTML = '';
      for (let i = 0; i < maxPlayers; i++) {
        const player = players[i];
        const slot = document.createElement('div');
        slot.className = 'lobbySlot';
        if (player) {
          slot.innerHTML = `
            <div class="lobbyPlayerCard ${player.isLocal ? 'local' : ''}">
              <div class="lobbyPlayerIcon">🐉</div>
              <div class="lobbyPlayerInfo">
                <div class="lobbyPlayerName">${player.name || 'Player'}</div>
                <div class="lobbyPlayerDragon">${player.dragon || 'Unknown'}</div>
              </div>
            </div>
          `;
        } else {
          slot.innerHTML = `
            <div class="lobbyPlayerCard empty">
              <span>Waiting...</span>
            </div>
          `;
        }
        slots.appendChild(slot);
      }
    }

    const startBtn = document.getElementById('lobbyStartBtn');
    const waitingText = document.getElementById('lobbyWaitingText');
    const modeSelector = document.getElementById('modeSelectorHost');
    const arenaSelector = document.getElementById('lobbyArenaSelector');

    if (isHost) {
      if (startBtn) startBtn.style.display = 'flex';
      if (waitingText) waitingText.style.display = 'none';
      if (modeSelector) modeSelector.style.display = 'flex';
      if (arenaSelector) arenaSelector.style.display = 'flex';
    } else {
      if (startBtn) startBtn.style.display = 'none';
      if (waitingText) waitingText.style.display = 'block';
      if (modeSelector) modeSelector.style.display = 'none';
      if (arenaSelector) arenaSelector.style.display = 'flex';
    }
  }

  updateLobbyArena(arenaIndex, isHost) {
    document.querySelectorAll('#lobbyArenaThumbs .arenaThumb').forEach((btn, idx) => {
      btn.classList.toggle('active', idx === arenaIndex);
      if (!isHost) {
        btn.disabled = true;
      } else {
        btn.disabled = false;
      }
    });
  }

  showCountdown(seconds, callback) {
    const overlay = document.getElementById('countdownOverlay');
    const text = document.getElementById('countdownText');
    if (!overlay || !text) {
      if (callback) callback();
      return;
    }

    overlay.classList.add('active');
    let count = seconds;
    text.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        text.textContent = count;
      } else {
        clearInterval(interval);
        overlay.classList.remove('active');
        if (callback) callback();
      }
    }, 1000);
  }

  showPauseOverlay(show) {
    const overlay = document.getElementById('pauseOverlay');
    if (overlay) {
      overlay.classList.toggle('active', show);
    }
  }

  updateHUD(score, time) {
    const scoreVal = document.getElementById('scoreVal');
    const timerDisplay = document.getElementById('timerDisplay');
    if (scoreVal) scoreVal.textContent = score;
    if (timerDisplay) timerDisplay.textContent = time;
  }

  updateGameOver(stats) {
    const goTime = document.getElementById('goTime');
    const goCollect = document.getElementById('goCollect');
    const goKills = document.getElementById('goKills');
    if (goTime) goTime.textContent = stats.time;
    if (goCollect) goCollect.textContent = stats.collected;
    if (goKills) goKills.textContent = stats.kills;
  }

  renderMinimap(canvas, camera, arena, dragons, foods) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const bounds = arena.getBounds();
    const scaleX = w / (bounds.maxX - bounds.minX);
    const scaleY = h / (bounds.maxY - bounds.minY);
    const scale = Math.min(scaleX, scaleY);

    // Draw arena boundary
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    // Draw dragons
    dragons.forEach(dragon => {
      const x = (dragon.head.x - bounds.minX) * scale;
      const y = (dragon.head.y - bounds.minY) * scale;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = dragon === window.game?.localDragon ? '#00b4d8' : '#ff4d4d';
      ctx.fill();
    });

    // Draw foods
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    foods.forEach(food => {
      const x = (food.x - bounds.minX) * scale;
      const y = (food.y - bounds.minY) * scale;
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    });
  }
}

export default UIManager;
