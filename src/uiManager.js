import { DRAGON_IMAGES, DRAGON_POWERS } from './config.js';

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
    this.selectedTier = null;
    this.tierAmounts = null;

    // Dragon carousel state
    this.carouselIndex = 0;
    this.dragonsData = [];
    this.dragonPowers = {};
    this.playerCoins = 1000000;
    this.selectedDragonName = null;
    this._modalDragon = null;

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
      'mpGameOver', 'loadingOverlay', 'dragonDetailModal',
      'difficultyModal', 'arenaSelectModal', 'mpModeSelect'
    ];
    screenIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) this.screens[id] = el;
    });
  }

  createDynamicModals() {
    // Lives HUD is already in HTML, just ensuring it works
    const livesHud = document.getElementById('livesHud');
    if (!livesHud) {
      const h = document.createElement('div');
      h.id = 'livesHud';
      h.style.cssText = `position:fixed;top:70px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:6px;z-index:100;background:rgba(0,0,0,0.5);padding:6px 16px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);`;
      document.body.appendChild(h);
    }

    // Scoreboard Overlay
    const sb = document.getElementById('scoreboardOverlay');
    if (!sb) {
      const s = document.createElement('div');
      s.id = 'scoreboardOverlay';
      s.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);display:none;flex-direction:column;background:rgba(7,16,24,0.95);border:1px solid rgba(0,180,216,0.3);border-radius:12px;padding:20px;min-width:300px;max-width:90vw;z-index:200;color:#fff;font-family:'Rajdhani',sans-serif;`;
      s.innerHTML = `
        <h3 style="margin:0 0 12px 0;text-align:center;color:#00b4d8;font-size:18px;letter-spacing:2px;">SCOREBOARD</h3>
        <div id="scoreboardContent"></div>
        <div style="text-align:center;margin-top:12px;font-size:11px;color:#8b93a6;">Press TAB to toggle</div>
      `;
      document.body.appendChild(s);
    }

    // Match Stats Overlay
    const ms = document.getElementById('matchStatsOverlay');
    if (!ms) {
      const m = document.createElement('div');
      m.id = 'matchStatsOverlay';
      m.style.cssText = `position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.92);z-index:300;color:#fff;font-family:'Rajdhani',sans-serif;`;
      m.innerHTML = `
        <div id="winnerCelebration" style="display:none;text-align:center;margin-bottom:30px;">
          <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:8px;">
            <i data-lucide="trophy" style="width:36px;height:36px;color:#ffd700;filter:drop-shadow(0 0 10px rgba(255,215,0,0.6));"></i>
            <div class="victoryTitle" style="font-family:'Cinzel Decorative',serif;font-size:42px;color:#ffd700;text-shadow:0 0 30px rgba(255,215,0,0.5),0 0 60px rgba(201,168,76,0.3);letter-spacing:4px;">VICTORY</div>
            <i data-lucide="trophy" style="width:36px;height:36px;color:#ffd700;filter:drop-shadow(0 0 10px rgba(255,215,0,0.6));"></i>
          </div>
          <div id="winnerName" style="font-size:22px;color:#00b4d8;margin-top:8px;font-family:'Rajdhani',sans-serif;letter-spacing:2px;text-transform:uppercase;font-weight:600;"></div>
          <div style="font-size:13px;color:#8b93a6;margin-top:6px;font-family:'Rajdhani',sans-serif;letter-spacing:1px;">Prize Pool: <span style="color:#ffd700;font-weight:600;">-- INFINITE</span></div>
        </div>
        <div id="matchStatsTable" style="width:90%;max-width:600px;"></div>
        <button id="btnCloseMatchStats" style="margin-top:30px;padding:12px 40px;background:transparent;border:1px solid rgba(0,180,216,0.5);color:#00b4d8;border-radius:8px;cursor:pointer;font-size:14px;text-transform:uppercase;letter-spacing:2px;transition:all 0.2s;">Continue</button>
      `;
      document.body.appendChild(m);
    }
  }

  buildModeSelect() {}

  // ===== DRAGON CAROUSEL SYSTEM =====
  initDragonCarousel(dragons) {
    this.dragonsData = dragons;
    this.carouselIndex = 0;
    try {
      const saved = localStorage.getItem('dragonPowers');
      if (saved) this.dragonPowers = JSON.parse(saved);
    } catch (e) { this.dragonPowers = {}; }
    try {
      const savedCoins = localStorage.getItem('playerCoins');
      if (savedCoins) this.playerCoins = parseInt(savedCoins);
    } catch (e) {}
    this.renderCarousel();
    this.updateCoinDisplay();
  }

  renderCarousel() {
    const d = this.dragonsData[this.carouselIndex];
    if (!d) return;

    const name = (typeof d === 'string' ? d : (d.name || d.type)) || 'Unknown';
    const key = name.toLowerCase();
    const color = d.color || (DRAGON_POWERS[key] && DRAGON_POWERS[key].color) || '#00b4d8';

    // Dragon image
    const imgEl = document.getElementById('dsDragonImg');
    const newHeadUrl = DRAGON_IMAGES[key];
    if (imgEl) {
      imgEl.src = newHeadUrl || (typeof d.head === 'string' ? d.head : (d.head && d.head.src ? d.head.src : ''));
      imgEl.style.filter = `drop-shadow(0 0 30px ${color}25)`;
    }

    const imgWrap = document.getElementById('dsDragonImgWrap');
    if (imgWrap) {
      imgWrap.style.cursor = 'pointer';
      imgWrap.onclick = (e) => {
        e.stopPropagation();
        const currentD = this.dragonsData[this.carouselIndex];
        if (currentD) this.showDragonModal(currentD);
      };
    }

    // Name
    const nameEl = document.getElementById('dsDragonName');
    if (nameEl) {
      nameEl.textContent = name.toUpperCase();
      nameEl.style.color = color;
      nameEl.style.textShadow = `0 0 20px ${color}40`;
    }

    // Tier & Level
    const powers = this.getDragonPowers(key);
    const avgLevel = Math.round((powers.defense + powers.speed + powers.rush + powers.attack) / 4);
    const tierEl = document.getElementById('dsDragonTierNum');
    const levelEl = document.getElementById('dsDragonLevel');
    if (tierEl) tierEl.textContent = avgLevel;
    if (levelEl) levelEl.textContent = avgLevel;

    // XP Bar
    const xpCurrent = (avgLevel - 1) * 5200 + Math.floor(Math.random() * 2000);
    const xpText = document.getElementById('dsXpText');
    const xpFill = document.getElementById('dsXpBarFill');
    const xpStart = document.getElementById('dsXpLevelStart');
    const xpEnd = document.getElementById('dsXpLevelEnd');
    if (xpText) xpText.textContent = `${xpCurrent.toLocaleString()} / 5,200`;
    if (xpFill) xpFill.style.width = `${(xpCurrent / 5200) * 100}%`;
    if (xpStart) xpStart.textContent = avgLevel;
    if (xpEnd) xpEnd.textContent = avgLevel + 1;

    // Powers grid
    this.renderPowersGrid(key, color);

    // Select badge
    const badge = document.getElementById('dsSelectBadge');
    const isSelected = this.selectedDragonName === name;
    if (badge) {
      badge.textContent = isSelected ? 'SELECTED' : 'NOT SELECTED';
      badge.classList.toggle('selected', isSelected);
    }

    // --- NEW LOGIC: Hide Arrows & Select, Show/Hide Dragon Age Button ---
    const leftArrow = document.getElementById('dsArrowLeft');
    const rightArrow = document.getElementById('dsArrowRight');
    const ageBtn = document.getElementById('dsDragonAgeBtn');
    const selectBtn = document.getElementById('dsSelectBtn');

    if (isSelected) {
      if (selectBtn) selectBtn.style.display = 'none';
      if (leftArrow) leftArrow.style.display = 'none';
      if (rightArrow) rightArrow.style.display = 'none';
      if (ageBtn) ageBtn.style.display = 'flex';
    } else {
      if (selectBtn) selectBtn.style.display = 'flex';
      if (leftArrow) leftArrow.style.display = 'flex';
      if (rightArrow) rightArrow.style.display = 'flex';
      if (ageBtn) ageBtn.style.display = 'none';
    }
    // ----------------------------------------------------------

    if (selectBtn) {
      selectBtn.textContent = 'SELECT';
      selectBtn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
      selectBtn.style.boxShadow = '0 4px 20px rgba(34,197,94,0.3)';
      selectBtn.style.color = '#fff';
    }

    // Nav dots
    this.renderNavDots();

    if (typeof lucide !== 'undefined') {
      setTimeout(() => lucide.createIcons(), 0);
    }
  }

  updateSelectButton() {
    // Deprecated but kept for compatibility
    this.renderCarousel();
  }

  // ===== DRAGON DETAIL MODAL =====
  showDragonModal(dragon) {
    const modal = document.getElementById('dragonDetailModal');
    if (!modal) return;

    const name = (typeof dragon === 'string' ? dragon : (dragon.name || dragon.type)) || 'Unknown';
    const key = name.toLowerCase();
    const color = dragon.color || (DRAGON_POWERS[key] && DRAGON_POWERS[key].color) || '#00b4d8';
    const powers = this.getDragonPowers(key);
    const avgLevel = Math.round((powers.defense + powers.speed + powers.rush + powers.attack) / 4);

    const img = document.getElementById('ddmImg');
    if (img) {
      img.src = DRAGON_IMAGES[key] || dragon.head || '';
      img.style.filter = `drop-shadow(0 0 40px ${color}40)`;
    }

    const nameEl = document.getElementById('ddmName');
    if (nameEl) {
      nameEl.textContent = name.toUpperCase();
      nameEl.style.color = color;
      nameEl.style.textShadow = `0 0 20px ${color}40`;
    }

    const tierEl = document.getElementById('ddmTierNum');
    const levelEl = document.getElementById('ddmDragonLevel');
    if (tierEl) tierEl.textContent = avgLevel;
    if (levelEl) levelEl.textContent = avgLevel;

    const box = document.getElementById('ddmBox');
    if (box) {
      box.style.borderColor = color + '60';
      box.style.boxShadow = `0 0 60px ${color}15, inset 0 0 40px ${color}08`;
    }

    const statsContainer = document.getElementById('ddmStats');
    if (statsContainer) {
      const stats = [
        { label: 'Defense', value: powers.defense, max: 10 },
        { label: 'Speed', value: powers.speed, max: 10 },
        { label: 'Rush', value: powers.rush, max: 10 },
        { label: 'Attack', value: powers.attack, max: 10 }
      ];
      statsContainer.innerHTML = stats.map(s => `
        <div class="ddmStatRow">
          <span class="ddmStatLabel">${s.label}</span>
          <div class="ddmStatBarWrap">
            <div class="ddmStatBar" style="width:${(s.value / s.max) * 100}%; background:linear-gradient(90deg, ${color}, ${color}80);"></div>
          </div>
          <span class="ddmStatValue" style="color:${color}">${s.value}</span>
        </div>
      `).join('');
    }

    const powersContainer = document.getElementById('ddmPowers');
    if (powersContainer) {
      const specialPowers = {
        aegis: [{ name: 'Aegis Shield', desc: 'Unlock at Dragon Level 5', unlock: 5 }, { name: 'Iron Fortress', desc: 'Unlock at Dragon Level 10', unlock: 10 }],
        ignis: [{ name: 'Inferno Breath', desc: 'Unlock at Dragon Level 5', unlock: 5 }, { name: 'Phoenix Rebirth', desc: 'Unlock at Dragon Level 10', unlock: 10 }],
        infinite: [{ name: 'Time Warp', desc: 'Unlock at Dragon Level 5', unlock: 5 }, { name: 'Eternal Loop', desc: 'Unlock at Dragon Level 10', unlock: 10 }],
        magnetron: [{ name: 'Magnetic Pull', desc: 'Unlock at Dragon Level 5', unlock: 5 }, { name: 'Gravity Crush', desc: 'Unlock at Dragon Level 10', unlock: 10 }]
      };
      const dragonPowers = specialPowers[key] || specialPowers.aegis;
      powersContainer.innerHTML = dragonPowers.map(p => `
        <div class="ddmPowerSlot locked">
          <div class="ddmPowerIcon"><i data-lucide="lock"></i></div>
          <div class="ddmPowerInfo">
            <div class="ddmPowerName">${p.name}</div>
            <div class="ddmPowerDesc">${p.desc}</div>
          </div>
        </div>
      `).join('');
    }

    this._modalDragon = dragon;
    modal.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  hideDragonModal() {
    const modal = document.getElementById('dragonDetailModal');
    if (modal) modal.classList.remove('active');
    this._modalDragon = null;
  }

  getDragonPowers(dragonKey) {
    if (!this.dragonPowers[dragonKey]) {
      const defaults = {
        aegis: { defense: 3, speed: 2, rush: 2, attack: 2 },
        ignis: { defense: 1, speed: 4, rush: 3, attack: 3 },
        infinite: { defense: 2, speed: 2, rush: 1, attack: 4 },
        magnetron: { defense: 4, speed: 1, rush: 2, attack: 2 }
      };
      this.dragonPowers[dragonKey] = { ...(defaults[dragonKey] || { defense: 2, speed: 2, rush: 2, attack: 2 }) };
    }
    return this.dragonPowers[dragonKey];
  }

  renderPowersGrid(dragonKey, color) {
    const grid = document.getElementById('dsPowersGrid');
    if (!grid) return;

    const powers = this.getDragonPowers(dragonKey);
    const costs = { defense: 500, speed: 600, rush: 800, attack: 1000 };
    const labels = { defense: 'Defense', speed: 'Speed', rush: 'Rush Ability', attack: 'Attack' };
    const maxLevel = 10;

    let html = '';
    Object.keys(labels).forEach(stat => {
      const level = powers[stat] || 1;
      const cost = costs[stat];
      const canAfford = this.playerCoins >= cost;
      const isMaxed = level >= maxLevel;
      const barPct = (level / maxLevel) * 100;

      html += `
        <div class="dsPowerCard" id="powerCard-${stat}">
          <div class="dsPowerName">${labels[stat]}</div>
          <div class="dsPowerLevelRow">
            <span class="dsPowerLevel">${level}</span>
            <div class="dsPowerBar">
              <div class="dsPowerBarFill" style="width:${barPct}%;"></div>
            </div>
            <button class="dsUpgradeBtn ${isMaxed ? 'maxed' : ''}" 
              data-stat="${stat}" data-cost="${cost}" data-dragon="${dragonKey}"
              ${isMaxed || !canAfford ? 'disabled' : ''}>
              ${isMaxed ? '<i data-lucide="check"></i> MAX' : `<i data-lucide="arrow-up"></i> ${cost.toLocaleString()}`}
            </button>
          </div>
        </div>
      `;
    });

    grid.innerHTML = html;

    grid.querySelectorAll('.dsUpgradeBtn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stat = btn.dataset.stat;
        const cost = parseInt(btn.dataset.cost);
        const dKey = btn.dataset.dragon;
        this.upgradePower(dKey, stat, cost);
      });
    });
  }

  upgradePower(dragonKey, stat, cost) {
    if (this.playerCoins < cost) return;
    const powers = this.getDragonPowers(dragonKey);
    if (powers[stat] >= 10) return;

    this.playerCoins -= cost;
    powers[stat] = (powers[stat] || 1) + 1;

    try {
      localStorage.setItem('dragonPowers', JSON.stringify(this.dragonPowers));
      localStorage.setItem('playerCoins', this.playerCoins.toString());
    } catch (e) {}

    const card = document.getElementById(`powerCard-${stat}`);
    if (card) {
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 500);
    }

    this.updateCoinDisplay();
    this.renderCarousel();
    this.eventBus.emit('ui:powerUpgraded', { dragon: dragonKey, stat, level: powers[stat] });
  }

  updateCoinDisplay() {
    const el = document.getElementById('dsCoinAmount');
    if (el) el.textContent = this.playerCoins.toLocaleString();
  }

  renderNavDots() {
    const dots = document.getElementById('dsNavDots');
    if (!dots) return;
    dots.innerHTML = '';
    this.dragonsData.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'dsNavDot' + (i === this.carouselIndex ? ' active' : '');
      dot.addEventListener('click', () => {
        this.carouselIndex = i;
        this.renderCarousel();
      });
      dots.appendChild(dot);
    });
  }

  carouselPrev() {
    this.carouselIndex = (this.carouselIndex - 1 + this.dragonsData.length) % this.dragonsData.length;
    this.renderCarousel();
  }

  carouselNext() {
    this.carouselIndex = (this.carouselIndex + 1) % this.dragonsData.length;
    this.renderCarousel();
  }

  selectCurrentDragon() {
    const d = this._modalDragon || this.dragonsData[this.carouselIndex];
    if (!d) return;

    const dragonName = typeof d === 'string' ? d : (d.name || d.type);
    this.selectedDragon = dragonName;
    this.selectedDragonName = dragonName;

    console.log('[DragonSelect] Selected:', dragonName);

    this.hideDragonModal();

    this.carouselIndex = this.dragonsData.findIndex(dr => {
      const drName = typeof dr === 'string' ? dr : (dr.name || dr.type);
      return drName === dragonName;
    });
    if (this.carouselIndex < 0) this.carouselIndex = 0;

    this.renderCarousel();
    this.eventBus.emit('ui:dragonSelected', { name: this.selectedDragon });
  }

  goToBattleMode() {
    this.showScreen('modeSelectScreen');
  }

  buildDragonSelect(dragons) {
    this.initDragonCarousel(dragons);
  }

  initLucide() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    document.getElementById('btnPlayNow')?.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    document.getElementById('btnStartGame')?.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    document.getElementById('btnLeaderboard')?.addEventListener('click', () => {
      this.showScreen('loadingScreen');
      setTimeout(() => this.showScreen('titleScreen'), 1000);
    });
    document.getElementById('btnHowToPlay')?.addEventListener('click', () => this.showScreen('howToPlayScreen'));

    // === DRAGON SELECT EVENTS ===
    document.getElementById('btnDsBack')?.addEventListener('click', () => this.showScreen('titleScreen'));
    
    // Top Right Next button
    document.getElementById('dsNextBtn')?.addEventListener('click', () => this.goToBattleMode());

    // Dragon Age Button
    document.getElementById('dsDragonAgeBtn')?.addEventListener('click', () => this.goToBattleMode());

    // Arrows
    document.getElementById('dsArrowLeft')?.addEventListener('click', () => this.carouselPrev());
    document.getElementById('dsArrowRight')?.addEventListener('click', () => this.carouselNext());

    // Select Button
    document.getElementById('dsSelectBtn')?.addEventListener('click', () => {
      const d = this.dragonsData[this.carouselIndex];
      if (d) this.showDragonModal(d);
    });

    // Modal events
    document.getElementById('btnDdmSelect')?.addEventListener('click', () => this.selectCurrentDragon());
    document.getElementById('btnDdmClose')?.addEventListener('click', () => this.hideDragonModal());

    // === MODE SCREEN EVENTS ===
    document.getElementById('btnModeBack')?.addEventListener('click', () => this.showScreen('dragonSelectScreen'));

    document.getElementById('btn1v1AI')?.addEventListener('click', () => {
      this.selectedMode = '1v1AI';
      this.showScreen('difficultyModal');
    });

    document.getElementById('btnMpMultiplayer')?.addEventListener('click', () => this.showScreen('mpMenuScreen'));

    document.querySelectorAll('#difficultyModal .diffBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDifficulty = btn.dataset.diff;
        this.showScreen('arenaSelectModal');
      });
    });
    document.getElementById('btnDiffBack')?.addEventListener('click', () => this.showScreen('modeSelectScreen'));

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
    document.getElementById('btnArenaBack')?.addEventListener('click', () => this.showScreen('difficultyModal'));

    // === MULTIPLAYER EVENTS ===
    document.getElementById('btnMpCreate')?.addEventListener('click', () => this.showScreen('mpModeSelect'));
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
    document.getElementById('btnMpBack')?.addEventListener('click', () => this.showScreen('modeSelectScreen'));

    document.querySelectorAll('#mpModeSelect .modeCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMpMode = btn.dataset.mpmode;
        this.eventBus.emit('mp:createRoom', { mode: this.selectedMpMode });
      });
    });
    document.getElementById('btnMpModeBack')?.addEventListener('click', () => this.showScreen('mpMenuScreen'));

    document.getElementById('lobbyStartBtn')?.addEventListener('click', () => this.eventBus.emit('mp:startGame'));
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

    document.querySelectorAll('#tierBtns .tierBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.selectedTier = btn.dataset.tier;
        this.eventBus.emit('lobby:tierSelected', { tier: this.selectedTier });
      });
    });

    document.getElementById('lobbyDepositBtn')?.addEventListener('click', () => this.eventBus.emit('lobby:depositRequested'));

    // === GAME EVENTS ===
    document.getElementById('pauseBtn')?.addEventListener('click', () => this.eventBus.emit('game:pause'));
    document.getElementById('btnResume')?.addEventListener('click', () => this.eventBus.emit('game:resume'));
    document.getElementById('btnQuit')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });
    document.getElementById('btnChangeDragon')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('dragonSelectScreen');
    });

    document.getElementById('btnPlayAgain')?.addEventListener('click', () => this.eventBus.emit('game:restart'));
    document.getElementById('btnMainMenu')?.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });

    // === WALLET EVENTS ===
    document.getElementById('walletBtn')?.addEventListener('click', () => this.showScreen('walletModal'));
    document.getElementById('btnWalletClose')?.addEventListener('click', () => this.showScreen('titleScreen'));
    document.getElementById('wOptPhantom')?.addEventListener('click', () => this.eventBus.emit('wallet:connectRequest'));
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnWalletDisconnect')) this.eventBus.emit('wallet:disconnectRequest');
    });
    document.getElementById('btnWalletSignTest')?.addEventListener('click', () => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = 'Waiting for approval in Phantom...';
      this.eventBus.emit('wallet:signTestRequest');
    });

    // === EVENT BUS WALLET LISTENERS ===
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
      if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
    });
    this.eventBus.on('wallet:scanResult', ({ sol, infinite }) => {
      const balEl = document.getElementById('wBalanceDisplay');
      if (balEl) balEl.innerHTML = `<i class="fa-solid fa-check" style="color:#4ade80;"></i> SOL: ${sol.toFixed(4)} | Infinite: ${infinite}`;
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

    this.eventBus.on('staking:pending', ({ label }) => this.setDepositStatus(label || 'Waiting for wallet approval…', 'pending'));
    this.eventBus.on('staking:error', ({ message }) => this.setDepositStatus(message || 'Staking transaction failed.', 'error'));
    this.eventBus.on('staking:confirmed', ({ label }) => this.setDepositStatus(label || 'Deposit confirmed.', 'confirmed'));

    // === KEYBOARD EVENTS ===
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.currentScreen === 'gameScreen') {
          this.eventBus.emit('game:pause');
        } else if (document.getElementById('dragonDetailModal')?.classList.contains('active')) {
          this.hideDragonModal();
        }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.toggleScoreboard();
      }
    });

    document.getElementById('btnCloseMatchStats')?.addEventListener('click', () => {
      const overlay = document.getElementById('matchStatsOverlay');
      if (overlay) overlay.style.display = 'none';
      if (this.screens['gameOverScreen']) this.screens['gameOverScreen'].classList.remove('active');
      this.showScreen('modeSelectScreen');
    });

    // === OTHER ===
    document.getElementById('btnHtpClose')?.addEventListener('click', () => this.showScreen('titleScreen'));
    document.getElementById('btnGotIt')?.addEventListener('click', () => this.showScreen('titleScreen'));

    document.querySelectorAll('.htpTab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.htpTab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.htpPanel').forEach(p => p.classList.remove('active'));
        document.getElementById('htp' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1))?.classList.add('active');
      });
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

    const livesHud = document.getElementById('livesHud');
    if (livesHud) livesHud.style.display = screenId === 'gameScreen' ? 'flex' : 'none';
  }

  renderLifeOrbs(lives, maxLives = 3, size = 16) {
    let html = '';
    for (let i = 0; i < maxLives; i++) {
      const alive = i < lives;
      const gradient = alive ? 'radial-gradient(circle at 30% 30%, #ff6b35, #c41e3a)' : 'radial-gradient(circle at 30% 30%, #2a2a2a, #111)';
      const glow = alive ? `0 0 ${size * 0.5}px rgba(255,107,53,0.5), inset 0 0 ${size * 0.25}px rgba(255,200,100,0.2)` : 'inset 0 0 2px rgba(255,255,255,0.05)';
      const border = alive ? 'rgba(255,150,100,0.4)' : 'rgba(255,255,255,0.08)';
      html += `<div style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${gradient};box-shadow:${glow};border:1px solid ${border};vertical-align:middle;margin:0 2px;"></div>`;
    }
    return html;
  }

  updateLivesHUD(dragon) {
    const livesHud = document.getElementById('livesHud');
    if (!livesHud || !dragon) return;
    livesHud.innerHTML = '';
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const orbsDiv = document.createElement('div');
    orbsDiv.style.cssText = 'display:flex;align-items:center;gap:4px;';
    orbsDiv.innerHTML = this.renderLifeOrbs(dragon.lives || 0, 3, 16);
    container.appendChild(orbsDiv);
    const label = document.createElement('span');
    label.style.cssText = 'font-size:12px;color:#8b93a6;font-family:"Rajdhani",sans-serif;letter-spacing:2px;text-transform:uppercase;';
    label.textContent = 'LIVES';
    container.appendChild(label);
    livesHud.appendChild(container);
  }

  toggleScoreboard() {
    const overlay = document.getElementById('scoreboardOverlay');
    if (!overlay) return;
    const isVisible = overlay.style.display === 'flex';
    overlay.style.display = isVisible ? 'none' : 'flex';
  }

  updateScoreboard(dragons) {
    const content = document.getElementById('scoreboardContent');
    if (!content) return;
    let html = `
      <div style="display:grid;grid-template-columns:1.5fr 0.8fr 0.8fr 0.8fr 0.8fr;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);font-size:11px;color:#8b93a6;text-transform:uppercase;letter-spacing:1px;">
        <div>Dragon</div><div style="text-align:center;">Kills</div><div style="text-align:center;">Deaths</div><div style="text-align:center;">Lives</div><div style="text-align:center;">Size</div>
      </div>
    `;
    dragons.forEach(d => {
      const isLocal = d === window.game?.localDragon;
      const status = d.alive ? (d.immunityTimer > 0 ? '<span style="color:#ffd700;">⚡</span>' : '') : '<span style="color:#ff4444;">✕</span>';
      const livesOrbs = this.renderLifeOrbs(d.lives || 0, 3, 10);
      html += `
        <div style="display:grid;grid-template-columns:1.5fr 0.8fr 0.8fr 0.8fr 0.8fr;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px;${isLocal ? 'color:#00b4d8;font-weight:600;' : 'color:#c8ccd8;'}">
          <div>${status} ${d.type.toUpperCase()} ${isLocal ? '(YOU)' : ''}</div>
          <div style="text-align:center;">${d.kills || 0}</div>
          <div style="text-align:center;">${d.deaths || 0}</div>
          <div style="text-align:center;">${livesOrbs}</div>
          <div style="text-align:center;">${d.segments?.length || 0}</div>
        </div>
      `;
    });
    content.innerHTML = html;
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
          const badge = player.deposited
            ? '<span class="depositBadge confirmed"><i data-lucide="check-circle"></i> Deposited</span>'
            : '<span class="depositBadge pending"><i data-lucide="clock"></i> Waiting for deposit</span>';
          slot.innerHTML = `
            <div class="lobbyPlayerCard ${player.isLocal ? 'local' : ''}">
              <div class="lobbyPlayerIcon" style="font-size:20px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.2);border-radius:8px;flex-shrink:0;"><i data-lucide="flame" style="width:20px;height:20px;color:#ff6b35;"></i></div>
              <div class="lobbyPlayerInfo">
                <div class="lobbyPlayerName">${player.name || 'Player'}</div>
                <div class="lobbyPlayerDragon">${player.dragon || 'Unknown'}</div>
                ${badge}
              </div>
            </div>
          `;
        } else {
          slot.innerHTML = `<div class="lobbyPlayerCard empty"><span>Waiting...</span></div>`;
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
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

  updateTierAmounts(tiers) {
    this.tierAmounts = tiers;
    ['Small', 'Medium', 'High'].forEach(tier => {
      const amtEl = document.querySelector(`#tier${tier} .tierAmt`);
      if (amtEl && tiers[tier] !== undefined) amtEl.textContent = `${tiers[tier]} INFINITE`;
    });
    const feeEl = document.getElementById('feeDisclosureText');
    if (feeEl && tiers.feePercent !== undefined) feeEl.textContent = `${tiers.feePercent}% platform fee applies to each player's stake.`;
  }

  updateStakingUI({ isHost, tier, locked, hostDeposited, opponentDeposited, canDeposit }) {
    document.querySelectorAll('#tierBtns .tierBtn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tier === tier);
      btn.disabled = !isHost || locked;
    });
    const selectorLabel = document.querySelector('#lobbyTierSelector label');
    if (selectorLabel) selectorLabel.textContent = locked ? `Stake Tier (locked): ${tier || ''}` : 'Stake Tier:';
    const depositBtn = document.getElementById('lobbyDepositBtn');
    const depositLabel = document.getElementById('depositBtnLabel');
    if (depositBtn) {
      const alreadyDeposited = isHost ? hostDeposited : opponentDeposited;
      const showBtn = isHost ? (!hostDeposited && !!tier) : (!!tier && !opponentDeposited);
      depositBtn.style.display = showBtn ? 'flex' : 'none';
      depositBtn.disabled = !canDeposit;
      if (depositLabel) depositLabel.textContent = isHost ? 'Lock Stake & Open Room' : `Deposit ${tier || ''} to Join`;
      if (alreadyDeposited) depositBtn.style.display = 'none';
    }
    const startBtn = document.getElementById('lobbyStartBtn');
    if (startBtn && isHost) {
      const bothIn = hostDeposited && opponentDeposited;
      startBtn.disabled = !bothIn;
      startBtn.style.opacity = bothIn ? '1' : '0.5';
      startBtn.title = bothIn ? '' : 'Waiting for both players to deposit their stake';
    }
  }

  setDepositStatus(text, kind) {
    const el = document.getElementById('depositStatusText');
    if (!el) return;
    el.textContent = text;
    el.className = 'depositStatusText ' + (kind || '');
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
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
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
        document.getElementById('btnWalletRefreshInline')?.addEventListener('click', () => this.eventBus.emit('wallet:scanRequest'));
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
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: radial-gradient(ellipse at center, rgba(20,10,5,0.95) 0%, rgba(0,0,0,0.98) 100%);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 9999; pointer-events: none;
    `;
    overlay.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = 'DRAGONS ARENA';
    title.style.cssText = `font-family: 'Cinzel Decorative', 'Georgia', serif; font-size: 18px; color: #c9a84c; letter-spacing: 8px; text-transform: uppercase; margin-bottom: 40px; text-shadow: 0 0 20px rgba(201,168,76,0.4); opacity: 0; animation: fadeInUp 0.8s ease forwards;`;
    overlay.appendChild(title);
    const numberContainer = document.createElement('div');
    numberContainer.id = 'countdownNumber';
    numberContainer.style.cssText = `font-family: 'Cinzel Decorative', 'Georgia', serif; font-size: 140px; font-weight: 700; color: #e8d5a3; text-shadow: 0 0 30px rgba(232,213,163,0.6), 0 0 60px rgba(201,168,76,0.3), 0 0 100px rgba(139,69,19,0.2); line-height: 1; min-height: 160px; display: flex; align-items: center; justify-content: center;`;
    overlay.appendChild(numberContainer);
    const subtitle = document.createElement('div');
    subtitle.id = 'countdownSubtitle';
    subtitle.style.cssText = `font-family: 'Cinzel Decorative', 'Georgia', serif; font-size: 14px; color: #8b7355; letter-spacing: 6px; text-transform: uppercase; margin-top: 30px; opacity: 0;`;
    overlay.appendChild(subtitle);

    if (!document.getElementById('countdownStyles')) {
      const style = document.createElement('style');
      style.id = 'countdownStyles';
      style.textContent = `
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes countdownPulse { 0% { transform: scale(0.5); opacity: 0; } 20% { transform: scale(1.1); opacity: 1; } 40% { transform: scale(0.95); } 60% { transform: scale(1.02); } 80% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes countdownGo { 0% { transform: scale(0.3); opacity: 0; } 30% { transform: scale(1.2); opacity: 1; } 50% { transform: scale(1); } 80% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }
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
        numEl.style.animation = 'none'; numEl.offsetHeight; numEl.style.animation = 'countdownPulse 1s ease forwards';
        if (subEl) { subEl.textContent = 'PREPARE FOR BATTLE'; subEl.style.animation = 'none'; subEl.offsetHeight; subEl.style.animation = 'fadeInUp 0.5s ease forwards'; }
      } else {
        numEl.textContent = 'FIGHT!';
        numEl.style.color = '#ff4444';
        numEl.style.textShadow = '0 0 40px rgba(255,68,68,0.8), 0 0 80px rgba(139,0,0,0.4)';
        numEl.style.animation = 'none'; numEl.offsetHeight; numEl.style.animation = 'countdownGo 0.8s ease forwards';
        if (subEl) subEl.textContent = '';
      }
    };
    updateNumber();
    const interval = setInterval(() => {
      count--;
      if (count >= 0) updateNumber();
      if (count < 0) {
        clearInterval(interval);
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.style.display = 'none'; overlay.style.opacity = '1';
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
    if (overlay) overlay.classList.toggle('active', show);
  }

  updateHUD(score, time, dragon) {
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) timerDisplay.textContent = time;
    this.updateLivesHUD(dragon);
    const scoreboardOverlay = document.getElementById('scoreboardOverlay');
    if (scoreboardOverlay && scoreboardOverlay.style.display === 'flex') {
      if (window.game && window.game.dragonManager) this.updateScoreboard(window.game.dragonManager.getAllDragons());
    }
  }

  updateGameOver(stats, isWinner = false) {
    const title = document.getElementById('goTitle');
    if (title) {
      title.textContent = isWinner ? 'VICTORY' : 'DEFEATED';
      title.style.color = isWinner ? '#ffd700' : '#ff4444';
      title.style.textShadow = isWinner ? '0 0 30px rgba(255,215,0,0.5), 0 0 60px rgba(201,168,76,0.3)' : '0 0 20px rgba(255,68,68,0.4)';
    }
    const goTime = document.getElementById('goTime');
    const goCollect = document.getElementById('goCollect');
    const goKills = document.getElementById('goKills');
    const goDeaths = document.getElementById('goDeaths');
    const goLives = document.getElementById('goLives');
    if (goTime) goTime.textContent = stats.time || '0:00';
    if (goCollect) goCollect.textContent = stats.collected || 0;
    if (goKills) goKills.textContent = stats.kills || 0;
    if (goDeaths) goDeaths.textContent = stats.deaths || 0;
    if (goLives) goLives.textContent = stats.lives || 0;
  }

  showMatchStats(allStats, winner) {
    const overlay = document.getElementById('matchStatsOverlay');
    const winnerDiv = document.getElementById('winnerCelebration');
    const winnerName = document.getElementById('winnerName');
    const tableDiv = document.getElementById('matchStatsTable');
    if (!overlay) return;
    if (this.screens['gameOverScreen']) this.screens['gameOverScreen'].classList.remove('active');
    if (winnerDiv) {
      if (winner) { winnerDiv.style.display = 'block'; if (winnerName) winnerName.textContent = winner.type ? winner.type.toUpperCase() : 'WINNER'; }
      else { winnerDiv.style.display = 'none'; }
    }
    if (tableDiv) {
      let html = `
        <div style="display:grid;grid-template-columns:1.5fr 0.7fr 0.7fr 1fr 1fr;gap:10px;padding:10px 0;border-bottom:2px solid rgba(0,180,216,0.3);font-size:12px;color:#8b93a6;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
          <div>Dragon</div><div style="text-align:center;">Kills</div><div style="text-align:center;">Deaths</div><div style="text-align:center;">Time Survived</div><div style="text-align:center;">InfiniteCoin</div>
        </div>
      `;
      allStats.forEach(s => {
        const isWinner = winner && s.id === winner.id;
        const timeStr = this.formatTime(s.timeSurvived);
        html += `
          <div style="display:grid;grid-template-columns:1.5fr 0.7fr 0.7fr 1fr 1fr;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px;${isWinner ? 'background:rgba(255,215,0,0.08);color:#ffd700;font-weight:600;' : 'color:#c8ccd8;'}">
            <div style="display:flex;align-items:center;gap:6px;">${isWinner ? '<i data-lucide="crown" style="width:14px;height:14px;color:#ffd700;filter:drop-shadow(0 0 4px rgba(255,215,0,0.6));"></i>' : ''}<span>${s.name.toUpperCase()} ${s.isLocal ? '(YOU)' : ''}</span></div>
            <div style="text-align:center;">${s.kills}</div><div style="text-align:center;">${s.deaths}</div><div style="text-align:center;">${timeStr}</div><div style="text-align:center;color:#ffd700;">${s.infiniteCoin} IFC</div>
          </div>
        `;
      });
      tableDiv.innerHTML = html;
    }
    overlay.style.display = 'flex';
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

  formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return minutes + ':' + seconds.toString().padStart(2, '0');
  }

  renderMinimap(canvas, camera, arena, dragons, foods) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const bounds = arena.getBounds();
    const scaleX = w / (bounds.maxX - bounds.minX);
    const scaleY = h / (bounds.maxY - bounds.minY);
    const scale = Math.min(scaleX, scaleY);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.strokeRect(0, 0, w, h);
    dragons.forEach(dragon => {
      if (!dragon.alive) return;
      const x = (dragon.head.x - bounds.minX) * scale;
      const y = (dragon.head.y - bounds.minY) * scale;
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
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
