import CONFIG, { DRAGON_IMAGES, DRAGON_POWERS, AI_WAVES } from './config.js';

const WALLET_ICON_URLS = {
  phantom: 'https://i.postimg.cc/44mrJ4My/phantom-logo.webp',
  solflare: './Solflare.png'
};

const WAVE_PROGRESS_KEY = 'aiWaveProgress';

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
    this._connectedWalletType = null;

    // FIX: clear stale room data on every fresh load so old "resume room"
    // banners don't appear after a new deploy.
    try {
      localStorage.removeItem('currentRoom');
      localStorage.removeItem('roomCode');
      localStorage.removeItem('resumeRoomCode');
    } catch (_) {}

    try {
      this.initScreens();
      this.createDynamicModals();
      this.buildModeSelect();
      this.initLucide();
      this.initParticles();
      this.bindEvents();
      console.log("UIManager loaded.");
    } catch (e) {
      console.error("UI Manager Crash:", e);
    }
  }

  isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

  _getUnlockedWaveIndex() {
    try {
      const raw = localStorage.getItem(WAVE_PROGRESS_KEY);
      const idx = raw !== null ? parseInt(raw, 10) : 0;
      if (!Number.isFinite(idx)) return 0;
      return Math.max(0, Math.min(idx, AI_WAVES.length - 1));
    } catch (_) {
      return 0;
    }
  }

  unlockNextWave(clearedWaveId) {
    const clearedIndex = AI_WAVES.findIndex(w => w.id === clearedWaveId);
    if (clearedIndex === -1) return null;
    const current = this._getUnlockedWaveIndex();
    if (clearedIndex !== current) return null;
    if (current >= AI_WAVES.length - 1) return null;
    try { localStorage.setItem(WAVE_PROGRESS_KEY, String(current + 1)); } catch (_) {}
    return AI_WAVES[current + 1];
  }

  enterWaveMode() {
    const wave = AI_WAVES[this._getUnlockedWaveIndex()];
    this.selectedMode = wave.id;
    this.selectedDifficulty = (CONFIG.WAVE_DIFFICULTY && CONFIG.WAVE_DIFFICULTY[wave.id]) || 'advanced';
    this.showWaveIntro(wave);
  }

  showWaveIntro(wave) {
    const modal = this.screens['difficultyModal'];
    if (!modal) { this.showScreen('arenaSelectModal'); return; }
    modal.innerHTML = `
      <div class="difficultyBox" style="text-align:center;">
        <div style="font-family:'Rajdhani',sans-serif;font-size:12px;letter-spacing:4px;color:rgba(255,255,255,0.45);margin-bottom:10px;">ENTERING</div>
        <h2 style="margin-bottom:8px;">${wave.name}</h2>
        <div style="font-family:'Rajdhani',sans-serif;font-size:13px;letter-spacing:1px;color:#48cae4;">${wave.players} Dragons Await</div>
      </div>`;
    this.showScreen('difficultyModal');
    setTimeout(() => {
      if (this.currentScreen === 'difficultyModal') this.showScreen('arenaSelectModal');
    }, 1500);
  }

  initScreens() {
    const ids = [
      'titleScreen','dragonSelectScreen','modeSelectScreen','mpMenuScreen',
      'matchmakingTierScreen','matchmakingSearchScreen','opponentFoundScreen',
      'bettingArenaScreen','lobbyScreen','loadingScreen','gameScreen',
      'gameOverScreen','howToPlayScreen','walletModal','walletSelectionModal',
      'mpGameOver','loadingOverlay','dragonDetailModal'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) this.screens[id] = el;
    });
  }

  createDynamicModals() {
    const diffModal = document.createElement('div');
    diffModal.id = 'difficultyModal';
    diffModal.className = 'screen';
    diffModal.innerHTML = `<div class="difficultyBox"></div>`;
    document.body.appendChild(diffModal);
    this.screens['difficultyModal'] = diffModal;

    const arenaModal = document.createElement('div');
    arenaModal.id = 'arenaSelectModal';
    arenaModal.className = 'screen';
    arenaModal.innerHTML = `
      <div class="arenaSelectInner">
        <h2>Select Arena</h2>
        <div class="arenaGrid">
          <div class="arenaCard" data-arena="0"><div class="arenaPreview" style="background-image:url(/arenas/arena_stone.png)"></div><div class="arenaName">Stone Castle</div></div>
          <div class="arenaCard" data-arena="1"><div class="arenaPreview" style="background-image:url(/arenas/arena_grass.png)"></div><div class="arenaName">Grass Field</div></div>
          <div class="arenaCard" data-arena="2"><div class="arenaPreview" style="background-image:url(/arenas/arena_purple.png)"></div><div class="arenaName">Purple Magic</div></div>
          <div class="arenaCard" data-arena="3"><div class="arenaPreview" style="background-image:url(/arenas/arena_fire.png)"></div><div class="arenaName">Fire Arena</div></div>
        </div>
        <button id="btnArenaBack"><i data-lucide="arrow-left"></i> Back</button>
      </div>`;
    document.body.appendChild(arenaModal);
    this.screens['arenaSelectModal'] = arenaModal;

    const mpModeSelect = document.createElement('div');
    mpModeSelect.id = 'mpModeSelect';
    mpModeSelect.className = 'screen';
    mpModeSelect.innerHTML = `
      <div class="mpModeBox">
        <h2>Multiplayer Mode</h2>
        <div class="mpModeGrid">
          <div class="modeCard" data-mpmode="1v1"><div class="mIcon"><i data-lucide="swords"></i></div><div class="mLabel">1v1 Duel</div><div class="mDesc">One on one battle.</div></div>
          <div class="modeCard" data-mpmode="2v2"><div class="mIcon"><i data-lucide="users"></i></div><div class="mLabel">2v2 Teams</div><div class="mDesc">Team up and fight together.</div></div>
          <div class="modeCard" data-mpmode="FFA"><div class="mIcon"><i data-lucide="globe"></i></div><div class="mLabel">Free For All</div><div class="mDesc">Every dragon for itself.</div></div>
        </div>
        <button class="menuBtn" id="btnMpModeBack"><i data-lucide="arrow-left"></i> Back</button>
      </div>`;
    document.body.appendChild(mpModeSelect);
    this.screens['mpModeSelect'] = mpModeSelect;
  }

  buildModeSelect() {}

  _tap(el, fn) {
    if (!el) return;
    // Fire on pointerdown for snappy mobile response, BUT swallow the
    // click/touch that the browser synthesizes from the same physical tap.
    // Without this, a pointerdown that switches screens leaves the finger
    // still down; the trailing click then lands on whatever element is now
    // under that finger on the NEXT screen and fires it too - which is why
    // tapping "Enter Match" flashed mode-select and bounced straight back
    // to dragon-select. One physical tap must trigger exactly one action.
    let swallow = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      swallow = true;
      setTimeout(() => { swallow = false; }, 700);
      fn(e);
    });
    const eat = (e) => { if (swallow) { e.preventDefault(); e.stopPropagation(); } };
    el.addEventListener('click', eat, true);
    el.addEventListener('touchend', eat, true);
  }

  initDragonCarousel(dragons) {
    this.dragonsData = dragons;
    this.carouselIndex = 0;
    try { const saved = localStorage.getItem('dragonPowers'); if (saved) this.dragonPowers = JSON.parse(saved); }
    catch (e) { this.dragonPowers = {}; }
    try { const savedCoins = localStorage.getItem('playerCoins'); if (savedCoins) this.playerCoins = parseInt(savedCoins); }
    catch (e) {}
    this.renderCarousel();
    this.updateCoinDisplay();
  }

  renderCarousel() {
    const d = this.dragonsData[this.carouselIndex];
    if (!d) return;
    const name = (typeof d === 'string' ? d : (d.name || d.type)) || 'Unknown';
    const key = name.toLowerCase();
    const color = d.color || (DRAGON_POWERS[key] && DRAGON_POWERS[key].color) || '#00b4d8';
    const screen = document.getElementById('dragonSelectScreen');
    if (screen) screen.style.setProperty('--neon', color);
    const imgEl = document.getElementById('dsDragonImg');
    const newHeadUrl = DRAGON_IMAGES[key];
    if (imgEl) {
      imgEl.src = newHeadUrl || (typeof d.head === 'string' ? d.head : (d.head && d.head.src ? d.head.src : ''));
    }
    const imgWrap = document.getElementById('dsDragonImgWrap');
    if (imgWrap) {
      imgWrap.style.cursor = 'pointer';
      imgWrap.onclick = (e) => { e.stopPropagation(); const currentD = this.dragonsData[this.carouselIndex]; if (currentD) this.showDragonModal(currentD); };
    }
    const nameEl = document.getElementById('dsDragonName');
    if (nameEl) nameEl.textContent = name.toUpperCase();
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
    if (xpFill) {
      const pct = Math.min(100, (xpCurrent / 5200) * 100);
      xpFill.style.transition = 'none';
      xpFill.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        xpFill.style.transition = '';
        xpFill.style.width = pct + '%';
      }));
    }
    if (xpStart) xpStart.textContent = avgLevel;
    if (xpEnd) xpEnd.textContent = avgLevel + 1;
    this.renderPowersGrid(key, color);
    const badge = document.getElementById('dsSelectBadge');
    const isSelected = this.selectedDragonName === name;
    if (badge) { badge.textContent = isSelected ? 'SELECTED' : 'NOT SELECTED'; badge.classList.toggle('selected', isSelected); }
    const leftArrow = document.getElementById('dsArrowLeft');
    const rightArrow = document.getElementById('dsArrowRight');
    const ageBtn = document.getElementById('dsDragonAgeBtn');
    const selectBtn = document.getElementById('dsSelectBtn');
    if (isSelected) {
      if (selectBtn) selectBtn.style.display = 'none';
      if (ageBtn) ageBtn.style.display = 'flex';
    } else {
      if (selectBtn) selectBtn.style.display = 'flex';
      if (ageBtn) ageBtn.style.display = 'none';
    }
    if (leftArrow) leftArrow.style.display = 'flex';
    if (rightArrow) rightArrow.style.display = 'flex';
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
    if (img) img.src = DRAGON_IMAGES[key] || dragon.head || '';
    const nameEl = document.getElementById('ddmName');
    if (nameEl) nameEl.textContent = name.toUpperCase();
    const tierEl = document.getElementById('ddmTierNum');
    const levelEl = document.getElementById('ddmDragonLevel');
    if (tierEl) tierEl.textContent = avgLevel;
    if (levelEl) levelEl.textContent = avgLevel;
    const box = document.getElementById('ddmBox');
    if (box) box.style.setProperty('--neon', color);
    const xpCurrent = (avgLevel - 1) * 5200 + Math.floor(Math.random() * 2000);
    const xpS = document.getElementById('ddmXpStart');
    const xpE = document.getElementById('ddmXpEnd');
    const xpT = document.getElementById('ddmXpText');
    const xpF = document.getElementById('ddmXpFill');
    if (xpS) xpS.textContent = avgLevel;
    if (xpE) xpE.textContent = avgLevel + 1;
    if (xpT) xpT.textContent = `${xpCurrent.toLocaleString()} / 5,200`;
    if (xpF) {
      const pct = Math.min(100, (xpCurrent / 5200) * 100);
      xpF.style.transition = 'none';
      xpF.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        xpF.style.transition = '';
        xpF.style.width = pct + '%';
      }));
    }
    const statsContainer = document.getElementById('ddmStats');
    if (statsContainer) {
      const stats = [
        { label: 'Defense', value: powers.defense, max: 10, icon: 'fa-shield-halved', c: '#38bdf8' },
        { label: 'Speed', value: powers.speed, max: 10, icon: 'fa-feather', c: '#a855f7' },
        { label: 'Rush', value: powers.rush, max: 10, icon: 'fa-bolt', c: '#4ade80' },
        { label: 'Attack', value: powers.attack, max: 10, icon: 'fa-khanda', c: '#ef4444' }
      ];
      statsContainer.innerHTML = stats.map(s => `
        <div class="ddmStatRow" style="--stat:${s.c}">
          <span class="ddmStatIcon"><i class="fa-solid ${s.icon}"></i></span>
          <span class="ddmStatLabel">${s.label}</span>
          <div class="ddmStatBarWrap"><div class="ddmStatBar" data-w="${(s.value / s.max) * 100}" style="background:linear-gradient(90deg, ${s.c}, ${s.c}90); box-shadow:0 0 10px ${s.c}80;"></div></div>
          <span class="ddmStatValue" style="color:${s.c}">${s.value}</span>
        </div>`).join('');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        statsContainer.querySelectorAll('.ddmStatBar').forEach(b => { b.style.width = b.dataset.w + '%'; });
      }));
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
          <div class="ddmPowerIcon"><i class="fa-solid fa-lock"></i></div>
          <div class="ddmPowerInfo"><div class="ddmPowerName">${p.name}</div><div class="ddmPowerDesc">${p.desc}</div></div>
        </div>`).join('');
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
      const defaults = { aegis: { defense: 3, speed: 2, rush: 2, attack: 2 }, ignis: { defense: 1, speed: 4, rush: 3, attack: 3 }, infinite: { defense: 2, speed: 2, rush: 1, attack: 4 }, magnetron: { defense: 4, speed: 1, rush: 2, attack: 2 } };
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
    const icons = { defense: 'fa-shield-halved', speed: 'fa-feather', rush: 'fa-bolt', attack: 'fa-khanda' };
    const maxLevel = 10;
    let html = '';
    Object.keys(labels).forEach(stat => {
      const level = powers[stat] || 1;
      const cost = costs[stat];
      const canAfford = this.playerCoins >= cost;
      const isMaxed = level >= maxLevel;
      const barPct = (level / maxLevel) * 100;
      html += `
        <div class="dsPowerCard stat-${stat}" id="powerCard-${stat}">
          <div class="dsPowerHead"><span class="dsPowerIcon"><i class="fa-solid ${icons[stat]}"></i></span><div class="dsPowerName">${labels[stat]}</div></div>
          <div class="dsPowerLevelRow">
            <span class="dsPowerLevel">${level}</span>
            <div class="dsPowerBar"><div class="dsPowerBarFill" data-w="${barPct}"></div></div>
          </div>
          <button class="dsUpgradeBtn ${isMaxed ? 'maxed' : ''}" data-stat="${stat}" data-cost="${cost}" data-dragon="${dragonKey}" ${isMaxed || !canAfford ? 'disabled' : ''}>
            <span>${isMaxed ? '<i class="fa-solid fa-check"></i> MAX' : `<i class="fa-solid fa-arrow-up"></i> ${cost.toLocaleString()}`}</span>
          </button>
        </div>`;
    });
    grid.innerHTML = html;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      grid.querySelectorAll('.dsPowerBarFill').forEach(f => { f.style.width = f.dataset.w + '%'; });
    }));
    grid.querySelectorAll('.dsUpgradeBtn').forEach(btn => {
      this._tap(btn, (e) => {
        e.stopPropagation();
        this.upgradePower(btn.dataset.dragon, btn.dataset.stat, parseInt(btn.dataset.cost));
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
    if (card) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 500); }
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
      this._tap(dot, () => { this.carouselIndex = i; this.renderCarousel(); });
      dots.appendChild(dot);
    });
  }

  carouselPrev() { this.carouselIndex = (this.carouselIndex - 1 + this.dragonsData.length) % this.dragonsData.length; this.renderCarousel(); }
  carouselNext() { this.carouselIndex = (this.carouselIndex + 1) % this.dragonsData.length; this.renderCarousel(); }

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

  goToBattleMode() { this.showScreen('modeSelectScreen'); }
  buildDragonSelect(dragons) { this.initDragonCarousel(dragons); }
  initLucide() { if (typeof lucide !== 'undefined') lucide.createIcons(); }

  initParticles() {
    const canvas = document.getElementById('pCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const particles = [];
    for (let i = 0; i < 60; i++) {
      particles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, r: Math.random() * 2 + 0.5, dx: (Math.random() - 0.5) * 0.3, dy: (Math.random() - 0.5) * 0.3, alpha: Math.random() * 0.5 + 0.1 });
    }
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 180, 216, ${p.alpha})`; ctx.fill();
      });
      requestAnimationFrame(animate);
    };
    animate();
    window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });
  }

  bindEvents() {
    const btnPlay = document.getElementById('btnPlayNow');
    if (btnPlay) btnPlay.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    const btnStart = document.getElementById('btnStartGame');
    if (btnStart) btnStart.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    const btnLeader = document.getElementById('btnLeaderboard');
    if (btnLeader) btnLeader.addEventListener('click', () => { this.showScreen('loadingScreen'); setTimeout(() => this.showScreen('titleScreen'), 1000); });
    const btnHow = document.getElementById('btnHowToPlay');
    if (btnHow) btnHow.addEventListener('click', () => this.showScreen('howToPlayScreen'));
    const btnBack = document.getElementById('btnDsBack');
    if (btnBack) btnBack.addEventListener('click', () => this.showScreen('titleScreen'));
    const nextBtn = document.getElementById('dsNextBtn');
    this._tap(nextBtn, () => this.goToBattleMode());
    const ageBtn = document.getElementById('dsDragonAgeBtn');
    this._tap(ageBtn, () => this.goToBattleMode());
    const arrowLeft = document.getElementById('dsArrowLeft');
    this._tap(arrowLeft, () => this.carouselPrev());
    const arrowRight = document.getElementById('dsArrowRight');
    this._tap(arrowRight, () => this.carouselNext());
    const selectBtn = document.getElementById('dsSelectBtn');
    this._tap(selectBtn, () => { const d = this.dragonsData[this.carouselIndex]; if (d) this.showDragonModal(d); });
    const modalSelect = document.getElementById('btnDdmSelect');
    this._tap(modalSelect, () => this.selectCurrentDragon());
    const modalClose = document.getElementById('btnDdmClose');
    if (modalClose) modalClose.addEventListener('click', () => this.hideDragonModal());
    const modeBack = document.getElementById('btnModeBack');
    if (modeBack) modeBack.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    const btn1v1 = document.getElementById('btn1v1AI');
    if (btn1v1) btn1v1.addEventListener('click', () => this.enterWaveMode());
    const btnMp = document.getElementById('btnMpMultiplayer');
    if (btnMp) btnMp.addEventListener('click', () => this.showScreen('mpMenuScreen'));

    document.querySelectorAll('#arenaSelectModal .arenaCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedArena = parseInt(btn.dataset.arena);
        this.eventBus.emit('ui:arenaSelected', { mode: this.selectedMode, difficulty: this.selectedDifficulty, arenaIndex: this.selectedArena });
      });
    });
    const arenaBack = document.getElementById('btnArenaBack');
    if (arenaBack) arenaBack.addEventListener('click', () => this.showScreen('modeSelectScreen'));
    const mpCreate = document.getElementById('btnMpCreate');
    if (mpCreate) mpCreate.addEventListener('click', () => { this.selectedMpMode = 'FFA'; this.eventBus.emit('mp:createRoom', { mode: 'FFA' }); });
    const mpSearchBattle = document.getElementById('btnMpSearchBattle');
    if (mpSearchBattle) mpSearchBattle.addEventListener('click', () => { this.selectedMpMode = 'FFA'; this.showScreen('matchmakingTierScreen'); });

    document.querySelectorAll('.daTierBtn').forEach(btn => {
      btn.addEventListener('click', () => { this.eventBus.emit('ui:searchBattleTierSelected', { tier: btn.dataset.tier }); });
    });
    const btnMmTierBack = document.getElementById('btnMmTierBack');
    if (btnMmTierBack) btnMmTierBack.addEventListener('click', () => this.showScreen('mpMenuScreen'));
    const btnCancelSearch = document.getElementById('btnCancelSearch');
    if (btnCancelSearch) btnCancelSearch.addEventListener('click', () => this.eventBus.emit('ui:cancelSearch'));
    const btnProceedMatch = document.getElementById('btnProceedMatch');
    if (btnProceedMatch) btnProceedMatch.addEventListener('click', () => this.eventBus.emit('matchmaking:proceed'));
    const btnCancelOpp = document.getElementById('btnCancelOppFound');
    if (btnCancelOpp) btnCancelOpp.addEventListener('click', () => this.eventBus.emit('matchmaking:cancelOpponentFound'));
    const mpJoin = document.getElementById('btnMpJoin');
    if (mpJoin) mpJoin.addEventListener('click', () => {
      const input = document.getElementById('mpRoomInput');
      const code = input?.value.trim();
      if (code && code.length === 6) { this.eventBus.emit('mp:joinRoom', { code }); }
      else { const err = document.getElementById('mpJoinError'); if (err) err.textContent = 'Enter a valid 6-digit code'; }
    });
    const mpBack = document.getElementById('btnMpBack');
    if (mpBack) mpBack.addEventListener('click', () => this.showScreen('modeSelectScreen'));
    document.querySelectorAll('#mpModeSelect .modeCard').forEach(btn => {
      btn.addEventListener('click', () => { this.selectedMpMode = btn.dataset.mpmode; this.eventBus.emit('mp:createRoom', { mode: this.selectedMpMode }); });
    });
    const mpModeBack = document.getElementById('btnMpModeBack');
    if (mpModeBack) mpModeBack.addEventListener('click', () => this.showScreen('mpMenuScreen'));
    const startBtn = document.getElementById('lobbyStartBtn');
    if (startBtn) startBtn.addEventListener('click', () => this.eventBus.emit('mp:startGame'));
    const leaveBtn = document.getElementById('btnLeaveRoom');
    if (leaveBtn) leaveBtn.addEventListener('click', () => { this.eventBus.emit('mp:leaveRoom'); });
    const lobbyBackBtn = document.getElementById('btnLobbyBack');
    if (lobbyBackBtn) lobbyBackBtn.addEventListener('click', () => { this.eventBus.emit('mp:leaveRoom'); });
    document.querySelectorAll('#lobbyArenaThumbs .arenaThumb').forEach(btn => {
      btn.addEventListener('click', () => { this.eventBus.emit('lobby:arenaSelected', { arenaIndex: parseInt(btn.dataset.arena) }); });
    });
    document.querySelectorAll('#tierBtns .tierBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const tier = btn.dataset.tier;
        if (tier === 'Custom') {
          // Custom opens a small modal (doesn't disturb the layout). The
          // tier is only committed when the player Confirms a valid amount.
          this._openCustomStakeModal();
          return;
        }
        this.selectedTier = tier;
        this._applyTierGlow(tier);
        this.eventBus.emit('lobby:tierSelected', { tier });
      });
    });

    // ---- Custom stake modal wiring ----
    const csmInput = document.getElementById('csmInput');
    const csmConfirm = document.getElementById('csmConfirm');
    const csmCancel = document.getElementById('csmCancel');
    const csmHint = document.getElementById('csmHint');
    if (csmInput) {
      csmInput.addEventListener('input', () => {
        const n = Math.floor(Number(csmInput.value));
        let ok = false;
        if (!Number.isFinite(n) || csmInput.value === '') { csmHint.textContent = 'Min 1,000 • Max 10,000,000'; csmHint.style.color = '#8fa3c4'; }
        else if (n < 1000) { csmHint.textContent = 'Minimum is 1,000 INFINITE'; csmHint.style.color = '#ff8080'; }
        else if (n > 10000000) { csmHint.textContent = 'Maximum is 10,000,000 INFINITE'; csmHint.style.color = '#ff8080'; }
        else { csmHint.textContent = `Stake: ${n.toLocaleString()} INFINITE`; csmHint.style.color = '#4ade80'; ok = true; }
        if (csmConfirm) csmConfirm.disabled = !ok;
      });
    }
    if (csmConfirm) csmConfirm.addEventListener('click', () => {
      const n = Math.floor(Number(csmInput.value));
      if (!Number.isFinite(n) || n < 1000 || n > 10000000) return;
      this.selectedTier = 'Custom';
      this._applyTierGlow('Custom');
      this._closeCustomStakeModal();
      this.eventBus.emit('lobby:tierSelected', { tier: 'Custom', customAmount: n });
    });
    if (csmCancel) csmCancel.addEventListener('click', () => this._closeCustomStakeModal());
    const depositBtn = document.getElementById('lobbyDepositBtn');
    if (depositBtn) depositBtn.addEventListener('click', () => this.eventBus.emit('lobby:depositRequested'));
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.eventBus.emit('game:pause'));
    const resumeBtn = document.getElementById('btnResume');
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.eventBus.emit('game:resume'));
    const quitBtn = document.getElementById('btnQuit');
    if (quitBtn) quitBtn.addEventListener('click', () => { this.eventBus.emit('game:quit'); this.showScreen('titleScreen'); });
    const changeDragon = document.getElementById('btnChangeDragon');
    if (changeDragon) changeDragon.addEventListener('click', () => { this.eventBus.emit('game:quit'); this.showScreen('dragonSelectScreen'); });
    const playAgain = document.getElementById('btnPlayAgain');
    if (playAgain) playAgain.addEventListener('click', () => this.eventBus.emit('game:restart'));
    const mainMenu = document.getElementById('btnMainMenu');
    if (mainMenu) mainMenu.addEventListener('click', () => { this.eventBus.emit('game:quit'); this.returnToMenuWithProcessing('titleScreen', 'Wrapping up the match…'); });
    const resumeRoomBtn = document.getElementById('btnResumeRoom');
    if (resumeRoomBtn) resumeRoomBtn.addEventListener('click', () => this.eventBus.emit('ui:resumeRoom'));

    const walletBtn = document.getElementById('walletBtn');
    if (walletBtn) walletBtn.addEventListener('click', () => {
      if (walletBtn.classList.contains('connected')) {
        this.setWalletModalState('connected');
        this.showScreen('walletModal');
      } else {
        this.showScreen('walletSelectionModal');
      }
    });
    const walletClose = document.getElementById('btnWalletClose');
    if (walletClose) walletClose.addEventListener('click', () => this.showScreen('titleScreen'));
    const wOpt = document.getElementById('wOptPhantom');
    if (wOpt) wOpt.addEventListener('click', () => this.eventBus.emit('wallet:connectRequest'));
    document.addEventListener('click', (e) => { if (e.target.closest('#btnWalletDisconnect')) this.eventBus.emit('wallet:disconnectRequest'); });
    const signTest = document.getElementById('btnWalletSignTest');
    if (signTest) signTest.addEventListener('click', () => {
      const resultEl = document.getElementById('wSignResult');
      const walletLabel = this._connectedWalletType === 'solflare' ? 'Solflare' : 'Phantom';
      if (resultEl) resultEl.innerHTML = `Waiting for approval in ${walletLabel}...`;
      this.eventBus.emit('wallet:signTestRequest');
    });

    // FIX: wallet selection buttons now use _tap (pointerdown) for instant
    // mobile response instead of delayed click events. Also calls window.game
    // directly as fallback so no main.js changes needed.
    // FIX: _tap uses pointerdown + preventDefault() which breaks on mobile
    // for modal buttons (OS suppresses the activation). Wallet buttons
    // use standard click + passive touchstart for instant mobile response.
    const btnSelectPhantom = document.getElementById('btnSelectPhantom');
    if (btnSelectPhantom) {
      const onPhantom = () => {
        console.log('[UI] Phantom selected');
        this.eventBus.emit('wallet:selectPhantom');
        const wm = window.game?.walletManager;
        if (wm) wm.connect();
      };
      btnSelectPhantom.addEventListener('click', onPhantom);
      btnSelectPhantom.addEventListener('touchstart', onPhantom, { passive: true });
    }
    const btnSelectSolflare = document.getElementById('btnSelectSolflare');
    if (btnSelectSolflare) {
      const onSolflare = () => {
        console.log('[UI] Solflare selected');
        this.eventBus.emit('wallet:selectSolflare');
        const wm = window.game?.walletManager;
        if (wm) wm.connectSolflare();
      };
      btnSelectSolflare.addEventListener('click', onSolflare);
      btnSelectSolflare.addEventListener('touchstart', onSolflare, { passive: true });
    }
    const btnWalletSelBack = document.getElementById('btnWalletSelBack');
    if (btnWalletSelBack) btnWalletSelBack.addEventListener('click', () => this.showScreen('titleScreen'));

    const baPlaceBet = document.getElementById('baPlaceBetBtn');
    if (baPlaceBet) baPlaceBet.addEventListener('click', () => this.eventBus.emit('betting:depositRequested'));
    const baStart = document.getElementById('baStartBtn');
    if (baStart) baStart.addEventListener('click', () => this.eventBus.emit('betting:startGame'));
    const baCancel = document.getElementById('baCancelBetting');
    if (baCancel) baCancel.addEventListener('click', () => this.eventBus.emit('betting:cancel'));

    this.eventBus.on('wallet:connecting', ({ wallet } = {}) => {
      this.setWalletModalState('connecting');
      const label = wallet === 'solflare' ? 'Solflare' : 'Phantom';
      const connectingText = document.getElementById('wConnectingText');
      if (connectingText) connectingText.textContent = `Approve the connection in ${label}...`;
      if (this.currentScreen === 'walletSelectionModal') this.showScreen('walletModal');
    });
    this.eventBus.on('wallet:connected', ({ address, balance, walletType }) => {
      this.setWalletModalState('connected');
      this.updateWalletDisplay(address, balance, walletType);
      if (this.currentScreen === 'walletSelectionModal') this.showScreen('walletModal');
    });
    this.eventBus.on('wallet:disconnected', () => {
      this._connectedWalletType = null;
      this.updateWalletButton(null);
      if (this.currentScreen === 'walletModal') this.showScreen('titleScreen');
      else this.setWalletModalState('disconnected');
    });
    this.eventBus.on('wallet:balanceUpdated', ({ balance }) => {
      const balEl = document.getElementById('wBalanceDisplay');
      if (balEl && balance !== undefined && balance !== null) balEl.textContent = `${balance} SOL`;
    });
    this.eventBus.on('wallet:error', ({ message }) => {
      this.setWalletModalState('disconnected');
      const errEl = document.getElementById('walletError');
      if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
    });
    this.eventBus.on('wallet:signTestResult', (result) => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = `<span class="wSignOk"><i class="fa-solid fa-check-circle"></i> Signature verified</span><div class="wSignHash">${result.signatureHex.slice(0,24)}...</div>`;
    });
    this.eventBus.on('wallet:signTestError', ({ message }) => {
      const resultEl = document.getElementById('wSignResult');
      if (resultEl) resultEl.innerHTML = `<span class="wSignFail"><i class="fa-solid fa-circle-xmark"></i> ${message}</span>`;
    });
    this.eventBus.on('staking:pending', ({ label }) => {
      const statusText = document.getElementById('depositStatusText');
      if (statusText) { statusText.textContent = label || 'Processing your bet...'; statusText.className = 'depositStatusText pending'; }
      const baStatus = document.getElementById('baYourStatus');
      if (baStatus) { baStatus.textContent = 'Placing bet...'; baStatus.style.color = '#eab308'; }
    });
    this.eventBus.on('staking:confirmed', ({ label }) => {
      const statusText = document.getElementById('depositStatusText');
      if (statusText) { statusText.textContent = label || 'Bet placed!'; statusText.className = 'depositStatusText confirmed'; }
      const baStatus = document.getElementById('baYourStatus');
      if (baStatus) { baStatus.textContent = 'Bet Placed'; baStatus.style.color = '#4ade80'; }
    });
    this.eventBus.on('staking:error', ({ message }) => {
      const statusText = document.getElementById('depositStatusText');
      if (statusText) { statusText.textContent = message || 'Bet failed.'; statusText.className = 'depositStatusText error'; }
      const baStatus = document.getElementById('baYourStatus');
      if (baStatus) { baStatus.textContent = 'Failed'; baStatus.style.color = '#ef4444'; }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.currentScreen === 'gameScreen') this.eventBus.emit('game:pause');
        else if (document.getElementById('dragonDetailModal')?.classList.contains('active')) this.hideDragonModal();
      }
      if (e.key === 'Tab') { e.preventDefault(); this.toggleScoreboard(); }
    });
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

  updateLobby(players = [], maxPlayers = 4, roomCode = '', isHost = false) {
    try {
      const coinEl = document.getElementById('lobbyCoinAmount');
      if (coinEl) coinEl.textContent = this.playerCoins.toLocaleString();
      const codeEl = document.getElementById('roomCodeDisplay');
      if (codeEl && roomCode) codeEl.textContent = roomCode;
      const countEl = document.getElementById('lobbyPlayerCount');
      if (countEl) countEl.textContent = `${players.length} / ${maxPlayers}`;
      const slotsEl = document.getElementById('lobbySlots');
      if (slotsEl && Array.isArray(players)) {
        // Always render exactly two rows: Host (crown banner) and Opponent
        // (shield banner). The host is whoever's isHost; the opponent is the
        // other player if present, otherwise a "joining…" placeholder.
        const host = players.find(p => p.isHost) || players[0];
        const opp = players.find(p => !p.isHost && p !== host);

        const portrait = (p) => {
          const key = (p && p.dragon || '').toLowerCase();
          const url = key && DRAGON_IMAGES[key];
          return url
            ? `<img src="${url}" alt="${key}">`
            : `<div class="lobbyPlayerIcon">🐉</div>`;
        };

        const hostRow = host ? `
          <div class="lobbyPlayerCard local">
            ${portrait(host)}
            <div class="lobbyPlayerName">HOST${host.isLocal ? ' (YOU)' : ''}</div>
            <div class="lobbyPlayerDragon">${(host.dragon || '').toUpperCase()}</div>
            <div class="lobbyPlayerRole"><span class="roleCrown">&#128081;</span> ROOM LEADER</div>
            ${host.deposited ? '<span class="depositBadge confirmed"><span class="material-icons">check_circle</span></span>' : ''}
          </div>` : '';

        const oppRow = opp ? `
          <div class="lobbyPlayerCard opponent">
            ${portrait(opp)}
            <div class="lobbyPlayerName">OPPONENT${opp.isLocal ? ' (YOU)' : ''}</div>
            <div class="lobbyPlayerDragon">${(opp.dragon || '').toUpperCase()}</div>
            <div class="lobbyPlayerRole"><span class="roleShield">&#128737;</span> CONTENDER</div>
            ${opp.deposited ? '<span class="depositBadge confirmed"><span class="material-icons">check_circle</span></span>' : ''}
          </div>` : `
          <div class="lobbyPlayerCard opponent waiting">
            <div class="lobbyPlayerIcon empty"></div>
            <div class="lobbyPlayerName joining">Opponent joining<span class="joinDots"><span>.</span><span>.</span><span>.</span></span></div>
          </div>`;

        slotsEl.innerHTML = hostRow + oppRow;
      }
      const startBtn = document.getElementById('lobbyStartBtn');
      const waitingText = document.getElementById('lobbyWaitingText');
      if (startBtn) startBtn.style.display = (isHost && this._stakingBothDeposited) ? 'flex' : 'none';
      if (waitingText) waitingText.style.display = isHost ? 'none' : 'block';
      if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
    } catch (e) { console.warn('updateLobby error:', e); }
  }

  updateLobbyArena(arenaIndex, isHost) {
    document.querySelectorAll('#lobbyArenaThumbs .arenaThumb').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.arena) === arenaIndex);
      btn.disabled = !isHost;
    });
  }

  updateTierAmounts(tiers) {
    if (!tiers) return;
    const map = {};
    if (Array.isArray(tiers)) { tiers.forEach(t => { if (t && t.tier) map[t.tier] = t.amount ?? t.label ?? t.display; }); }
    else if (typeof tiers === 'object') Object.assign(map, tiers);
    ['Small','Medium','High'].forEach(tier => {
      const btn = document.getElementById('tier' + tier);
      if (!btn) return;
      const amtEl = btn.querySelector('.tierAmt');
      if (amtEl && map[tier] !== undefined) amtEl.textContent = map[tier];
      const mmAmt = document.getElementById('tierAmt' + tier);
      if (mmAmt && map[tier] !== undefined) mmAmt.textContent = map[tier];
    });
  }

  updateStakingUI(state = {}) {
    const { isHost, tier, hostDeposited, opponentDeposited, canDeposit } = state;
    const myDeposited = isHost ? hostDeposited : opponentDeposited;
    const bothStaked = !!(hostDeposited && opponentDeposited);
    // Remembered so updateLobby (which re-runs on every room snapshot)
    // never re-shows Start before both stakes are locked.
    this._stakingBothDeposited = bothStaked;
    const depositBtn = document.getElementById('lobbyDepositBtn');
    const label = document.getElementById('depositBtnLabel');
    const statusText = document.getElementById('depositStatusText');
    const startBtn = document.getElementById('lobbyStartBtn');
    const waitingText = document.getElementById('lobbyWaitingText');
    // ONE morphing button slot: Place Bet occupies it from the moment a
    // tier exists, and only once BOTH players have staked successfully
    // does it swap out for Start Game (host) / "host is starting" (guest).
    if (depositBtn) {
      depositBtn.style.display = (tier && !bothStaked) ? 'flex' : 'none';
      depositBtn.disabled = !!myDeposited;
    }
    if (label) {
      label.textContent = myDeposited
        ? 'Bet Placed'
        : (!canDeposit
          ? 'Connect Wallet to Stake'
          : (isHost ? 'Place Bet & Open Room' : 'Place Bet to Join'));
    }
    if (startBtn) {
      startBtn.style.display = (bothStaked && isHost) ? 'flex' : 'none';
      startBtn.disabled = !bothStaked;
    }
    if (waitingText) {
      waitingText.style.display = (bothStaked && !isHost) ? 'block' : (isHost ? 'none' : waitingText.style.display);
      if (bothStaked && !isHost) waitingText.textContent = 'Both stakes locked — waiting for host to start...';
    }
    if (statusText) {
      if (bothStaked) { statusText.textContent = 'Both players staked - ready!'; statusText.className = 'depositStatusText confirmed'; }
      else if (myDeposited) { statusText.textContent = 'Waiting for opponent to stake...'; statusText.className = 'depositStatusText pending'; }
      else { statusText.textContent = ''; statusText.className = 'depositStatusText'; }
    }
    document.querySelectorAll('#tierBtns .tierBtn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tier === tier);
      btn.disabled = isHost ? !!hostDeposited : true;
    });
  }

  updateAttackMeter(dragon) {
    const btn = document.getElementById('boostBtn');
    if (!btn) return;
    const charge = dragon ? (dragon.attackCharge || 0) : 0;
    const active = !!(dragon && dragon.attackActive);
    const max = CONFIG.ATTACK_METER_MAX || 20;
    const full = charge >= max;
    const neon = (dragon && CONFIG.DRAGON_NEON) ? (CONFIG.DRAGON_NEON[dragon.type] || '#ffd700') : '#ffd700';
    const state = `${charge}|${active}|${neon}`;
    if (state === this._meterState) return;
    this._meterState = state;
    const pct = Math.round((charge / max) * 100);
    btn.style.setProperty('--fill', pct + '%');
    btn.style.setProperty('--neon', neon);
    btn.classList.toggle('attack-ready', full && !active);
    btn.classList.toggle('attack-active', active);
    const label = btn.querySelector('span');
    if (label) label.textContent = active ? 'ATTACK!' : 'ATTACK';
  }

  showComboBanner(killer, streak) {
    const banner = document.getElementById('comboBanner');
    if (!banner) return;
    const neon = (CONFIG.DRAGON_NEON && CONFIG.DRAGON_NEON[killer.type]) || '#ffd700';
    const name = (killer.type || 'dragon').toUpperCase();
    let title;
    if (streak === 3) title = 'TRIPLE KILL';
    else if (streak === 7) title = 'RAMPAGE';
    else if (streak === 15) title = 'DRAGONSLAYER';
    else title = `LEGENDARY x${streak}`;
    banner.innerHTML =
      `<div class="combo-title" style="color:${neon};text-shadow:0 0 18px ${neon},0 0 46px ${neon};">${title}</div>` +
      `<div class="combo-sub">${name} &middot; ${streak} KILL STREAK</div>`;
    banner.classList.remove('combo-show');
    void banner.offsetWidth;
    banner.classList.add('combo-show');
  }

  updateHUD(score, timeStr, localDragon) {
    if (score !== this._hudScore) {
      this._hudScore = score;
      const scoreEl = document.getElementById('scoreVal');
      if (scoreEl && score !== undefined) scoreEl.textContent = score;
    }
    if (timeStr !== this._hudTime) {
      this._hudTime = timeStr;
      const timerEl = document.getElementById('timerDisplay');
      if (timerEl && timeStr) timerEl.textContent = timeStr;
    }
    const lives = localDragon ? (localDragon.lives || 0) : null;
    if (lives !== this._hudLives) {
      this._hudLives = lives;
      const livesHud = document.getElementById('livesHud');
      if (livesHud && localDragon) {
        livesHud.style.display = 'flex';
        livesHud.innerHTML = lives > 0
          ? Array.from({ length: lives }).map(() => '<i data-lucide="flame" style="color:#ff6b35;width:16px;height:16px;"></i>').join('')
          : '<span style="color:#ff6b6b;font-size:11px;">No lives</span>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  }

  renderMinimap(canvas, camera, arenaManager, dragons, foods) {
    if (!canvas || !arenaManager) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth || 90;
    const h = canvas.clientHeight || 90;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const bounds = arenaManager.getBounds();
    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    if (!worldW || !worldH) return;
    const scaleX = w / worldW;
    const scaleY = h / worldH;
    const toMini = (wx, wy) => ({ x: (wx - bounds.minX) * scaleX, y: (wy - bounds.minY) * scaleY });

    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2;

    // --- Clip everything to a circular scope ---
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.clip();

    // Dark radar backdrop with a faint radial vignette
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, 'rgba(10,20,36,0.92)');
    bg.addColorStop(1, 'rgba(4,9,18,0.96)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Concentric range rings + crosshair
    ctx.strokeStyle = 'rgba(72,224,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R - 2) * (i / 2.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, 2); ctx.lineTo(cx, h - 2);
    ctx.moveTo(2, cy); ctx.lineTo(w - 2, cy);
    ctx.stroke();

    // Viewport rectangle (what the camera currently sees)
    if (camera) {
      const viewW = (canvas.parentElement ? canvas.parentElement.clientWidth : w * camera.zoom) / camera.zoom;
      const viewH = (canvas.parentElement ? canvas.parentElement.clientHeight : h * camera.zoom) / camera.zoom;
      const topLeft = toMini(camera.x - viewW / 2, camera.y - viewH / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(topLeft.x, topLeft.y, viewW * scaleX, viewH * scaleY);
    }

    // Food: faint infinity-blue motes
    ctx.fillStyle = 'rgba(72,224,255,0.35)';
    (foods || []).forEach(f => { const p = toMini(f.x, f.y); ctx.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5); });

    // Dragons: local = cyan directional arrowhead with glow; enemies = red blips
    (dragons || []).forEach(d => {
      if (!d.alive) return;
      const p = toMini(d.head.x, d.head.y);
      const isLocal = d === this._localDragonRef || d.isLocalPlayer;
      if (isLocal || (!d.isRemote && !d.isAI)) {
        // player blip: glowing cyan with a heading triangle
        ctx.save();
        ctx.shadowColor = '#48e0ff';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#7ef0ff';
        const a = d.angle || 0;
        ctx.translate(p.x, p.y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(4, 0); ctx.lineTo(-3, 2.6); ctx.lineTo(-3, -2.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.shadowColor = '#ff5a5a';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.fillStyle = '#ff6b6b';
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    ctx.restore(); // end circular clip

    // --- Gold frame ring (drawn on top, unclipped) ---
    ctx.lineWidth = 2;
    const ring = ctx.createLinearGradient(0, 0, 0, h);
    ring.addColorStop(0, '#f0d9a0');
    ring.addColorStop(0.5, '#a97f45');
    ring.addColorStop(1, '#6e5226');
    ctx.strokeStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    // subtle inner bevel
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Called from main.js so the minimap can distinguish the local dragon
  // reliably regardless of the isRemote/isAI flags on other dragons.
  setLocalDragonRef(d) { this._localDragonRef = d; }

  updateGameOver(stats = {}) {
    const map = { goTime: stats.time, goCollect: stats.collected, goKills: stats.kills, goDeaths: stats.deaths, goLives: stats.lives };
    Object.entries(map).forEach(([id, val]) => { const el = document.getElementById(id); if (el && val !== undefined) el.textContent = val; });
  }

  showMatchStats(stats = [], winner) {
    const titleEl = document.getElementById('goTitle');
    if (!titleEl) return;
    const localStat = Array.isArray(stats) ? stats.find(s => s.isLocal) : null;
    const localWon = winner && localStat && winner.id === localStat.id;
    if (!winner) { titleEl.textContent = 'DRAW'; titleEl.style.color = '#48cae4'; }
    else if (localWon) { titleEl.textContent = 'VICTORY!'; titleEl.style.color = '#4ade80'; }
    else { titleEl.textContent = 'DEFEATED'; titleEl.style.color = '#ff4d4d'; }
  }

  // Winner's forfeit screen: opponent quit or dropped. Shown on top of the
  // normal settlement panel (they still get their full payout).
  showForfeitVictory() {
    const titleEl = document.getElementById('goTitle');
    const subEl = document.getElementById('goSubtitle');
    if (titleEl) { titleEl.textContent = 'VICTORY!'; titleEl.style.color = '#4ade80'; }
    if (subEl) {
      subEl.textContent = 'Your opponent left the arena — the pot is yours.';
      subEl.style.color = '#8ee9b0';
      subEl.style.display = 'block';
    }
    this.showScreen('gameOverScreen');
  }

  // Quitter's forfeit screen: THIS player lost their connection to the
  // arena. Only Main Menu is offered (no Play Again on a forfeited stake).
  // Best-effort - only renders if this client is still alive to show it.
  showForfeitDefeat() {
    if (this._forfeitDefeatShown) return; // don't stack if fired twice
    this._forfeitDefeatShown = true;
    const titleEl = document.getElementById('goTitle');
    const subEl = document.getElementById('goSubtitle');
    if (titleEl) { titleEl.textContent = 'MATCH ENDED'; titleEl.style.color = '#ff6e6e'; }
    if (subEl) {
      subEl.textContent = 'You lost your connection to the arena. The match went to your opponent.';
      subEl.style.color = '#e0a3a3';
      subEl.style.display = 'block';
    }
    // Forfeited stake - no rematch shortcut, just the way out.
    const playAgain = document.getElementById('btnPlayAgain');
    if (playAgain) playAgain.style.display = 'none';
    const stakeBox = document.getElementById('goStakeBox');
    if (stakeBox) stakeBox.style.display = 'none';
    this.showScreen('gameOverScreen');
  }

  showCountdown(seconds, onComplete) {
    const overlay = document.getElementById('countdownOverlay');
    const textEl = document.getElementById('countdownText');
    let count = typeof seconds === 'number' ? seconds : 3;
    if (!overlay || !textEl) { if (typeof onComplete === 'function') onComplete(); return; }
    overlay.classList.add('active');
    textEl.textContent = count;
    const tick = () => {
      count--;
      if (count > 0) { textEl.textContent = count; setTimeout(tick, 1000); }
      else if (count === 0) { textEl.textContent = 'GO!'; setTimeout(tick, 700); }
      else { overlay.classList.remove('active'); if (typeof onComplete === 'function') onComplete(); }
    };
    setTimeout(tick, 1000);
  }

  hideCountdown() { const overlay = document.getElementById('countdownOverlay'); if (overlay) overlay.classList.remove('active'); }

  showPauseOverlay(visible = true, isMultiplayer = false) {
    const el = document.getElementById('pauseOverlay');
    if (el) el.classList.toggle('active', !!visible);
    const changeDragonBtn = document.getElementById('btnChangeDragon');
    if (changeDragonBtn) changeDragonBtn.style.display = isMultiplayer ? 'none' : 'flex';
  }

  hidePauseOverlay() { const el = document.getElementById('pauseOverlay'); if (el) el.classList.remove('active'); }

  showStakeBreakdown({ pending = false, draw = false, won = false, stakeText = null, potText = null, feeText = null, payoutText = null, feePct = 2.5, signature = null, cluster = 'devnet' } = {}) {
    const box = document.getElementById('goStakeBox');
    if (!box) return;
    const title = document.getElementById('goStakeTitle');
    const rows = document.getElementById('goStakeRows');
    const tx = document.getElementById('goStakeTx');
    box.style.display = 'block';

    if (pending) {
      title.textContent = 'SETTLING ON-CHAIN…';
      rows.innerHTML = `<div class="goStakeRow pending"><span>The Treasury is weighing the stakes…</span></div>`;
      tx.style.display = 'none';
      return;
    }

    if (draw) {
      title.textContent = 'MATCH DRAWN';
      rows.innerHTML = `<div class="goStakeRow"><span>Result</span><span class="val">Draw</span></div>
        <div class="goStakeRow pending"><span>Stakes return via Treasury multisig dispute resolution.</span></div>`;
      tx.style.display = 'none';
      return;
    }

    title.textContent = won ? 'SPOILS OF VICTORY' : 'MATCH SETTLEMENT';
    const row = (label, val, cls = '') => val ? `<div class="goStakeRow ${cls}"><span>${label}</span><span class="val">${val}</span></div>` : '';
    rows.innerHTML =
      row('Your Stake', stakeText) +
      row('Opponent Stake', stakeText) +
      row('Total Pot', potText) +
      row(`Treasury Fee (${feePct}%)`, feeText, 'fee') +
      row(won ? 'YOU RECEIVE' : 'WINNER RECEIVES', payoutText, 'payout');

    if (signature) {
      tx.href = `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
      tx.textContent = `View payout transaction (tx ${String(signature).slice(0, 8)}…)`;
      tx.style.display = 'block';
    } else {
      tx.style.display = 'none';
    }
  }

  setWalletModalState(state) {
    const views = {
      disconnected: document.getElementById('walletDisconnectedView'),
      connecting: document.getElementById('walletConnectingView'),
      connected: document.getElementById('walletConnectedView')
    };
    Object.entries(views).forEach(([key, el]) => { if (el) el.style.display = key === state ? 'block' : 'none'; });
    const errEl = document.getElementById('walletError');
    if (errEl && state !== 'disconnected') errEl.style.display = 'none';
  }

  updateWalletDisplay(address, balance, walletType) {
    if (walletType) this._connectedWalletType = walletType;
    const addrEl = document.getElementById('wAddressDisplay');
    if (addrEl && address) addrEl.textContent = address.length > 12 ? `${address.slice(0,6)}...${address.slice(-4)}` : address;
    const balEl = document.getElementById('wBalanceDisplay');
    if (balEl) balEl.textContent = (balance !== undefined && balance !== null) ? `${balance} SOL` : 'Balance unavailable';
    const iconEl = document.getElementById('wWalletIcon');
    if (iconEl) {
      const isSolflare = this._connectedWalletType === 'solflare';
      iconEl.src = isSolflare ? WALLET_ICON_URLS.solflare : WALLET_ICON_URLS.phantom;
      iconEl.alt = isSolflare ? 'Solflare' : 'Phantom';
    }
    this.updateWalletButton(address);
  }

  updateWalletButton(address) {
    const btn = document.getElementById('walletBtn');
    if (!btn) return;
    const label = btn.querySelector('span');
    if (address) { btn.classList.add('connected'); if (label) label.textContent = `${address.slice(0,4)}...${address.slice(-4)}`; }
    else { btn.classList.remove('connected'); if (label) label.textContent = 'Connect Wallet'; }
  }

  toggleScoreboard() {
    const el = document.getElementById('scoreboardOverlay');
    if (!el) return;
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
  }

  showResumeRoomBanner(roomCode) {
    const banner = document.getElementById('resumeRoomBanner');
    const codeSpan = document.getElementById('resumeRoomCode');
    if (codeSpan) codeSpan.textContent = roomCode;
    if (banner) banner.style.display = 'block';
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

  hideResumeRoomBanner() { const banner = document.getElementById('resumeRoomBanner'); if (banner) banner.style.display = 'none'; }

  // Shows the loading screen with a message for ~5s before routing to the
  // destination, so leaving/forfeiting feels like real processing (refund
  // being issued, match wrapping up) rather than an abrupt jump to menu.
  // Validates the custom stake input and emits the tier only when the
  // amount is within Wang's 1,000-10,000,000 bounds. Updates the hint text
  // to guide the player; the Place Bet path re-validates before any tx.
  _emitCustomTier(rawValue) {
    const hint = document.getElementById('customStakeHint');
    const n = Math.floor(Number(rawValue));
    if (!Number.isFinite(n) || n < 1000) {
      if (hint) { hint.textContent = 'Minimum 1,000 INFINITE'; hint.style.color = '#ff8080'; }
      return;
    }
    if (n > 10000000) {
      if (hint) { hint.textContent = 'Maximum 10,000,000 INFINITE'; hint.style.color = '#ff8080'; }
      return;
    }
    if (hint) { hint.textContent = `Stake: ${n.toLocaleString()} INFINITE`; hint.style.color = '#4ade80'; }
    this.eventBus.emit('lobby:tierSelected', { tier: 'Custom', customAmount: n });
  }

  _openCustomStakeModal() {
    const m = document.getElementById('customStakeModal');
    const input = document.getElementById('csmInput');
    const confirm = document.getElementById('csmConfirm');
    const hint = document.getElementById('csmHint');
    if (input) input.value = '';
    if (confirm) confirm.disabled = true;
    if (hint) { hint.textContent = 'Min 1,000 • Max 10,000,000'; hint.style.color = '#8fa3c4'; }
    if (m) m.classList.add('open');
    if (input) setTimeout(() => input.focus(), 50);
  }
  _closeCustomStakeModal() {
    const m = document.getElementById('customStakeModal');
    if (m) m.classList.remove('open');
  }
  _applyTierGlow(tier) {
    document.querySelectorAll('#tierBtns .tierBtn').forEach(b => {
      b.classList.toggle('active', b.dataset.tier === tier);
      b.classList.remove('glow-small','glow-medium','glow-high','glow-custom');
    });
    const map = { Small: 'glow-small', Medium: 'glow-medium', High: 'glow-high', Custom: 'glow-custom' };
    const el = document.querySelector(`#tierBtns .tierBtn[data-tier="${tier}"]`);
    if (el && map[tier]) el.classList.add(map[tier]);
  }

  returnToMenuWithProcessing(destination = 'titleScreen', message = 'Processing…') {
    const loading = document.getElementById('loadingScreen');
    const msgEl = document.getElementById('loadingMessage') || document.getElementById('loadingText');
    if (msgEl) msgEl.textContent = message;
    this.showScreen('loadingScreen');
    clearTimeout(this._processingTimer);
    this._processingTimer = setTimeout(() => {
      this.showScreen(destination);
    }, 5000);
  }

  // Shows a glowing down-arrow hint on the lobby when there's more content
  // below the fold (Opponent frame + Leave Room), and hides it once the
  // player scrolls near the bottom.
  _updateScrollHint(screenEl) {
    if (!screenEl || screenEl.id !== 'lobbyScreen') return;
    let hint = document.getElementById('lobbyScrollHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'lobbyScrollHint';
      hint.innerHTML = '<i data-lucide="chevrons-down"></i>';
      hint.addEventListener('click', () => { try { screenEl.scrollBy({ top: screenEl.clientHeight * 0.7, behavior: 'smooth' }); } catch (_) {} });
      screenEl.appendChild(hint);
      if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 20);
      if (!this._lobbyScrollBound) {
        this._lobbyScrollBound = true;
        screenEl.addEventListener('scroll', () => {
          const nearBottom = screenEl.scrollTop + screenEl.clientHeight >= screenEl.scrollHeight - 40;
          const h = document.getElementById('lobbyScrollHint');
          if (h) h.style.opacity = nearBottom ? '0' : '1';
        });
      }
    }
    // Only show if there's actually more to scroll.
    const canScroll = screenEl.scrollHeight > screenEl.clientHeight + 40;
    hint.style.display = canScroll ? 'flex' : 'none';
    hint.style.opacity = '1';
  }

  showScreen(screenId) {    Object.values(this.screens).forEach(s => { if (s) s.classList.remove('active'); });
    if (this.screens[screenId]) { this.screens[screenId].classList.add('active'); this.currentScreen = screenId; }
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 50);
    // Reveal every screen from the TOP. For the lobby this is essential:
    // the room-code plaque is the first element, and if the screen opened
    // mid-scroll the code sat above the viewport. Also refresh the scroll
    // hint arrow for scrollable screens.
    const _shown = this.screens[screenId];
    if (_shown) {
      try { _shown.scrollTop = 0; } catch (_) {}
      setTimeout(() => { try { _shown.scrollTop = 0; } catch (_) {} this._updateScrollHint(_shown); }, 60);
    }
    // Mark the switch time and, once, install a capture-phase guard that
    // swallows any click/touch landing on the freshly-shown screen within
    // a short window. This is the safety net for the ghost-tap bounce:
    // even for cards bound with plain 'click' (not _tap), a tap that
    // triggered this transition can't immediately fire an element on the
    // new screen under the still-down finger.
    this._lastScreenSwitch = Date.now();
    if (!this._ghostTapGuardInstalled) {
      this._ghostTapGuardInstalled = true;
      const guard = (e) => {
        if (this._lastScreenSwitch && Date.now() - this._lastScreenSwitch < 350) {
          e.preventDefault(); e.stopPropagation();
        }
      };
      document.addEventListener('click', guard, true);
      document.addEventListener('touchend', guard, true);
    }
  }

  // Step 1 of the matched flow: "Opponent Found" with Proceed + Cancel.
  // Nothing is staked yet - purely confirm-to-continue.
  showOpponentFound(tier) {
    const tierName = (tier === 'Small' ? 'Low' : (tier || 'Unknown'));
    const disp = document.getElementById('oppFoundTierDisplay');
    if (disp) disp.textContent = `${tierName} Stake`;
    this.showScreen('opponentFoundScreen');
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 30);
  }

  // Puts the shared lobby into MATCHED mode: shows lobby-bg, hides the
  // room-code plaque and the mode/tier/arena pickers (pre-decided by
  // matchmaking). Off = normal Create Room lobby with everything visible.
  setMatchedLobbyMode(on, tier) {
    const lobby = document.getElementById('lobbyScreen');
    if (lobby) lobby.classList.toggle('matchedLobby', !!on);
    const rcRow = document.querySelector('#lobbyScreen .roomCodeRow');
    if (rcRow) rcRow.style.display = on ? 'none' : '';
    const meta = document.querySelector('#lobbyScreen .lobbyMeta');
    if (meta) meta.style.display = on ? 'none' : '';
    const setDisp = (id, hide) => { const el = document.getElementById(id); if (el) el.style.display = hide ? 'none' : ''; };
    setDisp('modeSelectorHost', on);
    setDisp('lobbyTierSelector', on);
    setDisp('lobbyArenaSelector', on);
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 30);
  }

  hideOpponentFoundModal() {
    const screen = document.getElementById('opponentFoundScreen');
    if (screen) screen.classList.remove('active');
  }

  showLobbyCountdown(seconds) {
    const el = document.getElementById('lobbyCountdown');
    const numEl = document.getElementById('lobbyCountdownNum');
    const fillEl = document.getElementById('lobbyCountdownFill');
    if (el) el.style.display = 'block';
    if (numEl) numEl.textContent = seconds;
    if (fillEl) fillEl.style.width = '100%';
  }
  updateLobbyCountdown(seconds) {
    const numEl = document.getElementById('lobbyCountdownNum');
    const fillEl = document.getElementById('lobbyCountdownFill');
    if (numEl) numEl.textContent = seconds;
    if (fillEl) fillEl.style.width = `${(seconds / 10) * 100}%`;
  }
  hideLobbyCountdown() { const el = document.getElementById('lobbyCountdown'); if (el) el.style.display = 'none'; }

  showBettingArena({ roomCode, tier, isHost, yourDragon }) {
    this.showScreen('bettingArenaScreen');
    const rcEl = document.getElementById('baRoomCode');
    if (rcEl) rcEl.textContent = roomCode || '------';
    const tierEl = document.getElementById('baStakeValue');
    if (tierEl) tierEl.textContent = tier ? `${tier} Stake` : '-- INFINITE';
    const yourDragonEl = document.getElementById('baYourDragon');
    if (yourDragonEl) yourDragonEl.textContent = yourDragon || '???';
    const oppDragonEl = document.getElementById('baOppDragon');
    if (oppDragonEl) oppDragonEl.textContent = '???';
    const oppStatus = document.getElementById('baOppStatus');
    if (oppStatus) { oppStatus.textContent = 'Waiting...'; oppStatus.style.color = '#8b93a6'; }
    const yourStatus = document.getElementById('baYourStatus');
    if (yourStatus) { yourStatus.textContent = 'Not staked'; yourStatus.style.color = '#8b93a6'; }
    const startBtn = document.getElementById('baStartBtn');
    if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.4'; }
    const countdown = document.getElementById('baCountdown');
    if (countdown) countdown.style.display = 'none';
  }

  updateBettingArena({ players, roomMax, hostDeposited, opponentDeposited, tier, isHost }) {
    const playerList = players || [];
    const host = playerList.find(p => p.isHost);
    const opponent = playerList.find(p => !p.isHost);
    const yourStatus = document.getElementById('baYourStatus');
    const oppStatus = document.getElementById('baOppStatus');
    const oppDragon = document.getElementById('baOppDragon');
    const startBtn = document.getElementById('baStartBtn');

    if (host) {
      if (yourStatus) {
        if (isHost) {
          yourStatus.textContent = hostDeposited ? 'Bet Placed' : 'Not staked';
          yourStatus.style.color = hostDeposited ? '#4ade80' : '#8b93a6';
        } else {
          const you = playerList.find(p => p.isLocal);
          const youDeposited = you ? you.deposited : opponentDeposited;
          yourStatus.textContent = youDeposited ? 'Bet Placed' : 'Not staked';
          yourStatus.style.color = youDeposited ? '#4ade80' : '#8b93a6';
        }
      }
    }
    if (opponent) {
      if (oppDragon) oppDragon.textContent = opponent.dragon || '???';
      if (oppStatus) {
        oppStatus.textContent = opponent.deposited ? 'Bet Placed' : 'Not staked';
        oppStatus.style.color = opponent.deposited ? '#4ade80' : '#8b93a6';
      }
    }
    if (startBtn) {
      const bothStaked = hostDeposited && opponentDeposited;
      startBtn.disabled = !bothStaked;
      startBtn.style.opacity = bothStaked ? '1' : '0.4';
    }
  }

  showBettingCountdown(seconds) {
    const el = document.getElementById('baCountdown');
    const numEl = document.getElementById('baCountdownNum');
    const fillEl = document.getElementById('baCountdownFill');
    if (el) el.style.display = 'block';
    if (numEl) numEl.textContent = seconds;
    if (fillEl) fillEl.style.width = '100%';
  }

  updateBettingCountdown(seconds) {
    const numEl = document.getElementById('baCountdownNum');
    const fillEl = document.getElementById('baCountdownFill');
    if (numEl) numEl.textContent = seconds;
    if (fillEl) fillEl.style.width = `${(seconds / 10) * 100}%`;
  }

  hideBettingArena() {
    const el = document.getElementById('bettingArenaScreen');
    if (el) el.classList.remove('active');
  }
}

export default UIManager;
