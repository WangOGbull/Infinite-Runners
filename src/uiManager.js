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

    this.carouselIndex = 0;
    this.dragonsData = [];
    this.dragonPowers = {};
    this.playerCoins = 1000000;
    this.selectedDragonName = null;
    this._modalDragon = null;

    try {
        this.initScreens();
        this.createDynamicModals();
        this.buildModeSelect();
        this.initLucide();
        this.initParticles();
        this.bindEvents();
        console.log("✅ UIManager loaded successfully.");
    } catch (e) {
        console.error("🚨 UI Manager Crash:", e);
    }
  }

  isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  initScreens() {
    const screenIds = [
      'titleScreen', 'dragonSelectScreen', 'modeSelectScreen',
      'mpMenuScreen', 'lobbyScreen', 'loadingScreen', 'gameScreen',
      'gameOverScreen', 'howToPlayScreen', 'walletModal',
      'mpGameOver', 'loadingOverlay', 'dragonDetailModal'
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

    // Give the whole stage a soft radial glow matching this dragon's color
    // (adds depth / per-dragon identity instead of one flat gradient for every dragon)
    const stage = document.querySelector('.dsDragonStage');
    if (stage) {
      stage.style.background = `radial-gradient(ellipse at 50% 62%, ${color}22, transparent 65%)`;
    }

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

    const nameEl = document.getElementById('dsDragonName');
    if (nameEl) {
      nameEl.textContent = name.toUpperCase();
      nameEl.style.color = color;
      nameEl.style.textShadow = `0 0 20px ${color}40`;
    }

    const powers = this.getDragonPowers(key);
    const avgLevel = Math.round((powers.defense + powers.speed + powers.rush + powers.attack) / 4);
    const tierEl = document.getElementById('dsDragonTierNum');
    const levelEl = document.getElementById('dsDragonLevel');
    if (tierEl) tierEl.textContent = avgLevel;
    if (levelEl) levelEl.textContent = avgLevel;

    const xpCurrent = (avgLevel - 1) * 5200 + Math.floor(Math.random() * 2000);
    const xpText = document.getElementById('dsXpText');
    const xpFill = document.getElementById('dsXpBarFill');
    const xpStart = document.getElementById('dsXpLevelStart');
    const xpEnd = document.getElementById('dsXpLevelEnd');
    if (xpText) xpText.textContent = `${xpCurrent.toLocaleString()} / 5,200`;
    if (xpFill) xpFill.style.width = `${(xpCurrent / 5200) * 100}%`;
    if (xpStart) xpStart.textContent = avgLevel;
    if (xpEnd) xpEnd.textContent = avgLevel + 1;

    this.renderPowersGrid(key, color);

    const badge = document.getElementById('dsSelectBadge');
    const isSelected = this.selectedDragonName === name;
    if (badge) {
      badge.textContent = isSelected ? 'SELECTED' : 'NOT SELECTED';
      badge.classList.toggle('selected', isSelected);
    }

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

    if (selectBtn) {
      selectBtn.textContent = 'SELECT';
      selectBtn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
      selectBtn.style.boxShadow = '0 4px 20px rgba(34,197,94,0.3)';
      selectBtn.style.color = '#fff';
    }

    this.renderNavDots();
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

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
    // === TITLE SCREEN BUTTONS ===
    const btnPlay = document.getElementById('btnPlayNow');
    if (btnPlay) btnPlay.addEventListener('click', () => this.showScreen('dragonSelectScreen'));

    const btnStart = document.getElementById('btnStartGame');
    if (btnStart) btnStart.addEventListener('click', () => this.showScreen('dragonSelectScreen'));

    const btnLeader = document.getElementById('btnLeaderboard');
    if (btnLeader) btnLeader.addEventListener('click', () => {
      this.showScreen('loadingScreen');
      setTimeout(() => this.showScreen('titleScreen'), 1000);
    });

    const btnHow = document.getElementById('btnHowToPlay');
    if (btnHow) btnHow.addEventListener('click', () => this.showScreen('howToPlayScreen'));

    // === DRAGON SELECT EVENTS ===
    const btnBack = document.getElementById('btnDsBack');
    if (btnBack) btnBack.addEventListener('click', () => this.showScreen('titleScreen'));

    const nextBtn = document.getElementById('dsNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => this.goToBattleMode());

    const ageBtn = document.getElementById('dsDragonAgeBtn');
    if (ageBtn) ageBtn.addEventListener('click', () => this.goToBattleMode());

    const arrowLeft = document.getElementById('dsArrowLeft');
    if (arrowLeft) arrowLeft.addEventListener('click', () => this.carouselPrev());

    const arrowRight = document.getElementById('dsArrowRight');
    if (arrowRight) arrowRight.addEventListener('click', () => this.carouselNext());

    const selectBtn = document.getElementById('dsSelectBtn');
    if (selectBtn) selectBtn.addEventListener('click', () => {
      const d = this.dragonsData[this.carouselIndex];
      if (d) this.showDragonModal(d);
    });

    const modalSelect = document.getElementById('btnDdmSelect');
    if (modalSelect) modalSelect.addEventListener('click', () => this.selectCurrentDragon());

    const modalClose = document.getElementById('btnDdmClose');
    if (modalClose) modalClose.addEventListener('click', () => this.hideDragonModal());

    // === MODE SCREEN EVENTS ===
    const modeBack = document.getElementById('btnModeBack');
    if (modeBack) modeBack.addEventListener('click', () => this.showScreen('dragonSelectScreen'));

    const btn1v1 = document.getElementById('btn1v1AI');
    if (btn1v1) btn1v1.addEventListener('click', () => {
      this.selectedMode = '1v1AI';
      this.showScreen('difficultyModal');
    });

    const btnMp = document.getElementById('btnMpMultiplayer');
    if (btnMp) btnMp.addEventListener('click', () => this.showScreen('mpMenuScreen'));

    document.querySelectorAll('#difficultyModal .diffBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDifficulty = btn.dataset.diff;
        this.showScreen('arenaSelectModal');
      });
    });

    const diffBack = document.getElementById('btnDiffBack');
    if (diffBack) diffBack.addEventListener('click', () => this.showScreen('modeSelectScreen'));

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

    const arenaBack = document.getElementById('btnArenaBack');
    if (arenaBack) arenaBack.addEventListener('click', () => this.showScreen('difficultyModal'));

    // === MULTIPLAYER EVENTS ===
    const mpCreate = document.getElementById('btnMpCreate');
    if (mpCreate) mpCreate.addEventListener('click', () => this.showScreen('mpModeSelect'));

    const mpJoin = document.getElementById('btnMpJoin');
    if (mpJoin) mpJoin.addEventListener('click', () => {
      const input = document.getElementById('mpRoomInput');
      const code = input?.value.trim();
      if (code && code.length === 6) {
        this.eventBus.emit('mp:joinRoom', { code });
      } else {
        const err = document.getElementById('mpJoinError');
        if (err) err.textContent = 'Enter a valid 6-digit code';
      }
    });

    const mpBack = document.getElementById('btnMpBack');
    if (mpBack) mpBack.addEventListener('click', () => this.showScreen('modeSelectScreen'));

    document.querySelectorAll('#mpModeSelect .modeCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMpMode = btn.dataset.mpmode;
        this.eventBus.emit('mp:createRoom', { mode: this.selectedMpMode });
      });
    });

    const mpModeBack = document.getElementById('btnMpModeBack');
    if (mpModeBack) mpModeBack.addEventListener('click', () => this.showScreen('mpMenuScreen'));

    const startBtn = document.getElementById('lobbyStartBtn');
    if (startBtn) startBtn.addEventListener('click', () => this.eventBus.emit('mp:startGame'));

    const leaveBtn = document.getElementById('btnLeaveRoom');
    if (leaveBtn) leaveBtn.addEventListener('click', () => {
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

    const depositBtn = document.getElementById('lobbyDepositBtn');
    if (depositBtn) depositBtn.addEventListener('click', () => this.eventBus.emit('lobby:depositRequested'));

    // === GAME EVENTS ===
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.eventBus.emit('game:pause'));

    const resumeBtn = document.getElementById('btnResume');
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.eventBus.emit('game:resume'));

    const quitBtn = document.getElementById('btnQuit');
    if (quitBtn) quitBtn.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });

    const changeDragon = document.getElementById('btnChangeDragon');
    if (changeDragon) changeDragon.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('dragonSelectScreen');
    });

    const playAgain = document.getElementById('btnPlayAgain');
    if (playAgain) playAgain.addEventListener('click', () => this.eventBus.emit('game:restart'));

    const mainMenu = document.getElementById('btnMainMenu');
    if (mainMenu) mainMenu.addEventListener('click', () => {
      this.eventBus.emit('game:quit');
      this.showScreen('titleScreen');
    });

    // === WALLET EVENTS ===
    const walletBtn = document.getElementById('walletBtn');
    if (walletBtn) walletBtn.addEventListener('click', () => this.showScreen('walletModal'));

    const walletClose = document.getElementById('btnWalletClose');
    if (walletClose) walletClose.addEventListener('click', () => this.showScreen('titleScreen'));

    const wOpt = document.getElementById('wOptPhantom');
    if (wOpt) wOpt.addEventListener('click', () => this.eventBus.emit('wallet:connectRequest'));

    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnWalletDisconnect')) this.eventBus.emit('wallet:disconnectRequest');
    });

    const signTest = document.getElementById('btnWalletSignTest');
    if (signTest) signTest.addEventListener('click', () => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = 'Waiting for approval in Phantom...';
      this.eventBus.emit('wallet:signTestRequest');
    });

    // === EVENT BUS LISTENERS ===
    this.eventBus.on('wallet:connecting', () => this.setWalletModalState('connecting'));
    this.eventBus.on('wallet:connected', ({ address, balance }) => {
      this.setWalletModalState('connected');
      this.updateWalletDisplay(address, balance);
    });
    this.eventBus.on('wallet:disconnected', () => {
      this.setWalletModalState('disconnected');
      this.updateWalletButton(null);
    });
    this.eventBus.on('wallet:error', ({ message }) => {
      this.setWalletModalState('disconnected');
      const errEl = document.getElementById('walletError');
      if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
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

    // === KEYBOARD ===
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

    // === OTHER ===
    const htpClose = document.getElementById('btnHtpClose');
    if (htpClose) htpClose.addEventListener('click', () => this.showScreen('titleScreen'));

    const gotIt = document.getElementById('btnGotIt');
    if (gotIt) gotIt.addEventListener('click', () => this.showScreen('titleScreen'));

    document.querySelectorAll('.htpTab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.htpTab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.htpPanel').forEach(p => p.classList.remove('active'));
        document.getElementById('htp' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1))?.classList.add('active');
      });
    });
  }

  setWalletModalState(state) {
    const views = {
      disconnected: document.getElementById('walletDisconnectedView'),
      connecting: document.getElementById('walletConnectingView'),
      connected: document.getElementById('walletConnectedView')
    };
    Object.entries(views).forEach(([key, el]) => {
      if (el) el.style.display = key === state ? 'block' : 'none';
    });
    const errEl = document.getElementById('walletError');
    if (errEl && state !== 'disconnected') errEl.style.display = 'none';
  }

  updateWalletDisplay(address, balance) {
    const addrEl = document.getElementById('wAddressDisplay');
    if (addrEl && address) {
      addrEl.textContent = address.length > 12
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address;
    }
    const balEl = document.getElementById('wBalanceDisplay');
    if (balEl) balEl.textContent = (balance !== undefined && balance !== null) ? `${balance} SOL` : 'Balance unavailable';
    this.updateWalletButton(address);
  }

  updateWalletButton(address) {
    const btn = document.getElementById('walletBtn');
    if (!btn) return;
    const label = btn.querySelector('span');
    if (address) {
      btn.classList.add('connected');
      if (label) label.textContent = `${address.slice(0, 4)}...${address.slice(-4)}`;
    } else {
      btn.classList.remove('connected');
      if (label) label.textContent = 'Connect Wallet';
    }
  }

  toggleScoreboard() {
    const el = document.getElementById('scoreboardOverlay');
    if (!el) return;
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
  }

  showScreen(screenId) {
    Object.values(this.screens).forEach(s => {
      if (s) s.classList.remove('active');
    });
    if (this.screens[screenId]) {
      this.screens[screenId].classList.add('active');
      this.currentScreen = screenId;
    }
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 50);
  }
}

export default UIManager;
