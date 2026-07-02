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

  isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
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

    const mpModeSelect = document.createElement('div');
    mpModeSelect.id = 'mpModeSelect';
    mpModeSelect.className = 'screen';
    mpModeSelect.innerHTML = `
      <div class="mpModeBox">
        <h2>Multiplayer Mode</h2>
        <div class="mpModeGrid">
          <div class="modeCard" data-mpmode="1v1">
            <div class="mIcon"><i data-lucide="swords"></i></div>
            <div class="mLabel">1v1 Duel</div>
            <div class="mDesc">One on one battle.</div>
          </div>
          <div class="modeCard" data-mpmode="2v2">
            <div class="mIcon"><i data-lucide="users"></i></div>
            <div class="mLabel">2v2 Teams</div>
            <div class="mDesc">Team up and fight together.</div>
          </div>
          <div class="modeCard" data-mpmode="FFA">
            <div class="mIcon"><i data-lucide="globe"></i></div>
            <div class="mLabel">Free For All</div>
            <div class="mDesc">Every dragon for itself.</div>
          </div>
        </div>
        <button class="menuBtn" id="btnMpModeBack"><i data-lucide="arrow-left"></i> Back</button>
      </div>
    `;
    document.body.appendChild(mpModeSelect);
    this.screens['mpModeSelect'] = mpModeSelect;
  }

  buildModeSelect() {}

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

    document.getElementById('btnDsBack')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });

    document.getElementById('btnModeBack')?.addEventListener('click', () => {
      this.showScreen('dragonSelectScreen');
    });

    document.getElementById('btn1v1AI')?.addEventListener('click', () => {
      this.selectedMode = '1v1AI';
      this.showScreen('difficultyModal');
    });

    document.getElementById('btnMpMultiplayer')?.addEventListener('click', () => {
      this.showScreen('mpMenuScreen');
    });

    document.querySelectorAll('#difficultyModal .diffBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDifficulty = btn.dataset.diff;
        this.showScreen('arenaSelectModal');
      });
    });

    document.getElementById('btnDiffBack')?.addEventListener('click', () => {
      this.showScreen('modeSelectScreen');
    });

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

    document.querySelectorAll('#mpModeSelect .modeCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMpMode = btn.dataset.mpmode;
        this.eventBus.emit('mp:createRoom', { mode: this.selectedMpMode });
      });
    });

    document.getElementById('btnMpModeBack')?.addEventListener('click', () => {
      this.showScreen('mpMenuScreen');
    });

    document.getElementById('lobbyStartBtn')?.addEventListener('click', () => {
      this.eventBus.emit('mp:startGame');
    });

    document.getElementById('btnLeaveRoom')?.addEventListener('click', () => {
      this.eventBus.emit('mp:leaveRoom');
      this.showScreen('titleScreen');
    });

    document.querySelectorAll('#lobbyArenaThumbs .arenaThumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const arenaIndex = parseInt(btn.dataset.arena);
        this.eventBus.emit('lobby:arenaSelected', { arenaIndex });
      });
    });

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

    document.getElementById('btnPlayAgain')?.addEventListener('click', () => {
      this.eventBus.emit('game:restart');
    });
    document.getElementById('btnMainMenu')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });

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
        document.getElementById('htp' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1))?.classList.add('active');
      });
    });

    document.getElementById('walletBtn')?.addEventListener('click', () => {
      this.showScreen('walletModal');
    });
    document.getElementById('btnWalletClose')?.addEventListener('click', () => {
      this.showScreen('titleScreen');
    });

    document.getElementById('wOptPhantom')?.addEventListener('click', () => {
      this.eventBus.emit('wallet:connectRequest');
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnWalletDisconnect')) {
        this.eventBus.emit('wallet:disconnectRequest');
      }
    });

    document.getElementById('btnWalletSignTest')?.addEventListener('click', () => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = 'Waiting for approval in Phantom...';
      this.eventBus.emit('wallet:signTestRequest');
    });

    this.eventBus.on('wallet:connecting', () => this.setWalletModalState('connecting'));

    this.eventBus.on('wallet:connected', ({ address, balance }) => {
      this.setWalletModalState('connected');
      this.updateWalletDisplay(address, balance);
    });

    this.eventBus.on('wallet:disconnected', () => {
      this.setWalletModalState('disconnected');
      this.updateWalletButton(null);
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = '';
      const balEl = document.getElementById('wBalanceDisplay');
      if (balEl) balEl.innerHTML = '';
    });

    this.eventBus.on('wallet:error', ({ message }) => {
      this.setWalletModalState('disconnected');
      const errEl = document.getElementById('walletError');
      if (errEl) {
        errEl.textContent = message;
        errEl.style.display = 'block';
      }
    });

    this.eventBus.on('wallet:scanResult', ({ sol, infinite }) => {
      const balEl = document.getElementById('wBalanceDisplay');
      if (balEl) {
        balEl.innerHTML = `<i class="fa-solid fa-check" style="color:#4ade80;"></i> SOL: ${sol.toFixed(4)} | Infinite: ${infinite}`;
      }
    });

    this.eventBus.on('wallet:signTestResult', (result) => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) {
        resultEl.innerHTML = `<span class="wSignOk"><i class="fa-solid fa-check-circle"></i> Signature verified</span><div class="wSignHash">${result.signatureHex.slice(0, 24)}...</div>`;
      }
    });

    this.eventBus.on('wallet:signTestError', ({ message }) => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = `<span class="wSignFail"><i class="fa-solid fa-circle-xmark"></i> ${message}</span>`;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.currentScreen === 'gameScreen') {
          this.eventBus.emit('game:pause');
        }
      }
    });

    // ==========================================
    // MOBILE PHANTOM RETURN HANDLER (FIXED)
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('phantomReconnect') === '1') {
      const cleanUrl = window.location.href.split('?')[0];
      window.history.replaceState({}, document.title, cleanUrl);

      // Poll for Phantom provider injection (up to 6 seconds)
      let attempts = 0;
      const maxAttempts = 20;
      const checkProvider = setInterval(() => {
        attempts++;
        const provider = window?.phantom?.solana || window?.solana;
        if (provider?.isPhantom) {
          clearInterval(checkProvider);
          this.eventBus.emit('wallet:connectIfPending');
        } else if (attempts >= maxAttempts) {
          clearInterval(checkProvider);
          console.warn('[UIManager] Phantom provider not detected after redirect');
        }
      }, 300);
    }
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

  setWalletModalState(state) {
    const disconnected = document.getElementById('walletDisconnectedView');
    const connecting = document.getElementById('walletConnectingView');
    const connected = document.getElementById('walletConnectedView');
    const errEl = document.getElementById('walletError');
    if (errEl) errEl.style.display = 'none';

    if (disconnected) disconnected.style.display = state === 'disconnected' ? 'block' : 'none';
    if (connecting) connecting.style.display = state === 'connecting' ? 'block' : 'none';
    if (connected) connected.style.display = state === 'connected' ? 'block' : 'none';

    if (typeof lucide !== 'undefined') {
      setTimeout(() => lucide.createIcons(), 0);
    }
  }

  updateWalletDisplay(address, balance) {
    const addrEl = document.getElementById('wAddressDisplay');
    const balEl = document.getElementById('wBalanceDisplay');
    const shortAddr = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '-';

    if (addrEl) {
      addrEl.innerHTML = `
        ${shortAddr}
        <button id="btnWalletRefreshInline" style="margin-left:10px; padding:4px 8px; background:#2a2a3a; border:1px solid #444; border-radius:4px; color:#fff; cursor:pointer;">
          <i class="fa-solid fa-magnifying-glass"></i> Scan
        </button>
      `;

      setTimeout(() => {
        document.getElementById('btnWalletRefreshInline')?.addEventListener('click', () => {
          this.eventBus.emit('wallet:scanRequest');
        });
      }, 0);
    }

    if (balEl) balEl.textContent = 'Click Scan to load balance';

    this.updateWalletButton(shortAddr);
  }

  updateWalletButton(shortAddr) {
    const btn = document.getElementById('walletBtn');
    if (!btn) return;
    const span = btn.querySelector('span');
    if (shortAddr) {
      btn.classList.add('connected');
      if (span) span.textContent = shortAddr;
    } else {
      btn.classList.remove('connected');
      if (span) span.textContent = 'Connect Wallet';
    }
  }

  updateLobbyArena(arenaIndex, isHost) {
    document.querySelectorAll('#lobbyArenaThumbs .arenaThumb').forEach((btn, idx) => {
      btn.classList.toggle('active', idx === arenaIndex);
      btn.disabled = !isHost;
    });
  }

  showCountdown(seconds, callback) {
    const gameCanvas = document.getElementById('gameCanvas');
    const hud = document.getElementById('gameHud');
    const minimap = document.getElementById('minimapCanvas');

    if (gameCanvas) gameCanvas.style.visibility = 'hidden';
    if (hud) hud.style.visibility = 'hidden';
    if (minimap) minimap.style.visibility = 'hidden';

    let overlay = document.getElementById('countdownOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'countdownOverlay';
      document.body.appendChild(overlay);
    }

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
    overlay.innerHTML = '';

    const title = document.createElement('div');
    title.textContent = 'DRAGONS ARENA';
    title.style.cssText = `
      font-family: 'Cinzel Decorative', 'Georgia', serif;
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

    const numberContainer = document.createElement('div');
    numberContainer.id = 'countdownNumber';
    numberContainer.style.cssText = `
      font-family: 'Cinzel Decorative', 'Georgia', serif;
      font-size: 140px;
      font-weight: 700;
      color: #e8d5a3;
      text-shadow: 0 0 30px rgba(232,213,163,0.6), 0 0 60px rgba(201,168,76,0.3), 0 0 100px rgba(139,69,19,0.2);
      line-height: 1;
      min-height: 160px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    overlay.appendChild(numberContainer);

    const subtitle = document.createElement('div');
    subtitle.id = 'countdownSubtitle';
    subtitle.style.cssText = `
      font-family: 'Cinzel Decorative', 'Georgia', serif;
      font-size: 14px;
      color: #8b7355;
      letter-spacing: 6px;
      text-transform: uppercase;
      margin-top: 30px;
      opacity: 0;
    `;
    overlay.appendChild(subtitle);

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
        numEl.offsetHeight;
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
        if (subEl) subEl.textContent = '';
      }
    };

    updateNumber();

    const interval = setInterval(() => {
      count--;
      if (count >= 0) {
        updateNumber();
      }
      if (count < 0) {
        clearInterval(interval);
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.style.display = 'none';
          overlay.style.opacity = '1';
          if (gameCanvas) gameCanvas.style.visibility = 'visible';
          if (hud) hud.style.visibility = 'visible';
          if (minimap) minimap.style.visibility = 'visible';
          if (callback) callback();
        }, 500);
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
    const timerDisplay = document.getElementById('timerDisplay');
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

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    dragons.forEach(dragon => {
      if (!dragon.alive) return;
      const x = (dragon.head.x - bounds.minX) * scale;
      const y = (dragon.head.y - bounds.minY) * scale;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = dragon === window.game?.localDragon ? '#00b4d8' : '#ff4d4d';
      ctx.fill();
    });

    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    foods.forEach(food => {
      const x = (food.x - bounds.minX) * scale;
      const y = (food.y - bounds.minY) * scale;
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    });
  }
}

export default UIManager;
