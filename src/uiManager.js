import CONFIG, { DRAGON_IMAGES, DRAGON_POWERS, AI_WAVES, AI_DIFFICULTY_TIERS } from './config.js';

const WALLET_ICON_URLS = {
  phantom: 'https://i.postimg.cc/44mrJ4My/phantom-logo.webp',
  solflare: './Solflare.png'
};

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
    this._minimapDims = null;
    this._minimapDirty = true;
    window.addEventListener("resize", () => { this._minimapDirty = true; });
    this.carouselIndex = 0;
    this.dragonsData = [];
    this.dragonPowers = {};
    this.playerCoins = 1000000;
    this.clearedTiers = {}; // { easy: true, medium: true, hard: true } - persisted, tracks which AI difficulty tiers have been fully cleared at least once
    this._progressReady = null; // promise that resolves once clearedTiers has loaded from Firebase — see initDragonCarousel()
    this.selectedDragonName = null;
    this._modalDragon = null;
    this._connectedWalletType = null;

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
      this._installScreenInvariant();
      console.log("UIManager loaded.");
    } catch (e) {
      console.error("UI Manager Crash:", e);
    }
  }

  _installScreenInvariant() {
    if (this._screenInvariantObserver) return;
    const repair = () => {
      const target = this.screens[this.currentScreen] || this.screens.titleScreen;
      if (!target) return;
      const style = window.getComputedStyle(target);
      const targetVisible = target.classList.contains('active')
        && style.display !== 'none'
        && style.visibility !== 'hidden';
      if (targetVisible) return;

      Object.values(this.screens).forEach(screen => {
        if (screen && screen !== target) screen.classList.remove('active');
      });
      target.classList.add('active');
      target.style.removeProperty('display');
      target.style.removeProperty('visibility');
      target.style.removeProperty('opacity');
      target.setAttribute('aria-hidden', 'false');
      this.currentScreen = target.id || 'titleScreen';
      console.warn('[UI] Recovered a hidden or missing current screen.');
    };
    this._ensureScreenInvariant = repair;
    this._screenInvariantObserver = new MutationObserver(() => queueMicrotask(repair));
    this._screenInvariantObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    queueMicrotask(repair);
  }

  isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

  selectDifficultyTier(tierId) {
    const tier = AI_DIFFICULTY_TIERS.find(t => t.id === tierId);
    if (!tier) return;
    this.selectedMode = 'wave1';
    this.selectedDifficulty = tier.aiDifficulty;
    this.selectedTierId = tier.id;
    this.showScreen('arenaSelectModal');
  }

  showWaveClearedCountdown(wave, onComplete) {
    const overlay = document.getElementById('countdownOverlay');
    const textEl = document.getElementById('countdownText');
    if (!overlay || !textEl) { if (typeof onComplete === 'function') setTimeout(onComplete, 0); return; }

    const waveNum = wave.id.replace('wave', '');
    overlay.classList.add('wave-transition');
    textEl.innerHTML = `
      <div class="wave-cleared-title">WAVE CLEARED</div>
      <div class="wave-divider"></div>
      <div class="wave-next-label">PREPARE FOR WAVE ${waveNum}</div>
      <div class="wave-enemy-count">${wave.players} DRAGONS APPROACHING</div>
      <div class="wave-countdown-number">3</div>
    `;

    overlay.classList.add('active');
    const countEl = textEl.querySelector('.wave-countdown-number');

    let count = 3;
    const restartCountAnimation = () => {
      if (!countEl) return;
      countEl.style.animation = 'none';
      // Restart on the next paint instead of reading offsetHeight, which
      // forced the browser to synchronously recalculate the entire HUD.
      requestAnimationFrame(() => {
        if (countEl.isConnected) countEl.style.animation = '';
      });
    };
    const tick = () => {
      count--;
      if (count > 0) {
        if (countEl) {
          countEl.textContent = count;
          restartCountAnimation();
        }
        setTimeout(tick, 1000);
      } else if (count === 0) {
        if (countEl) {
          countEl.textContent = 'GO!';
          restartCountAnimation();
        }
        setTimeout(tick, 800);
      } else {
        overlay.classList.remove('active', 'wave-transition');
        textEl.innerHTML = '';
        if (typeof onComplete === 'function') onComplete();
      }
    };
    setTimeout(tick, 1500);
  }

  showTierComplete(tier, nextTier) {
    this.markTierCleared(tier.id);
    const screen = document.getElementById('tierCompleteScreen');
    const titleEl = document.getElementById('tierCompleteTitle');
    const rankEl = document.getElementById('tierCompleteRank');
    const subEl = document.getElementById('tierCompleteSub');
    const advanceBtn = document.getElementById('btnTierAdvance');
    const restartBtn = document.getElementById('btnTierRestart');
    const isUltimate = !nextTier;

    if (screen) {
      screen.classList.remove('tier-easy', 'tier-medium', 'tier-hard');
      if (tier.id === 'easy') screen.classList.add('tier-easy');
      else if (tier.id === 'medium') screen.classList.add('tier-medium');
      else if (tier.id === 'hard') screen.classList.add('tier-hard');
    }

    if (titleEl) {
      titleEl.textContent = isUltimate ? 'ULTIMATE VICTORY' : 'VICTORY';
    }
    if (rankEl) {
      const labelEl = rankEl.querySelector('.rank-label');
      const nameEl = rankEl.querySelector('.rank-name');
      if (labelEl) labelEl.textContent = 'Rank Achieved';
      if (nameEl) nameEl.textContent = tier.rank;
    }
    const crestIcon = document.getElementById('tierCrestIcon');
    if (crestIcon) {
      crestIcon.className = 'fa-solid ' + (
        tier.id === 'easy' ? 'fa-fire' :
        tier.id === 'medium' ? 'fa-meteor' :
        'fa-crown'
      );
    }
    if (subEl) {
      subEl.textContent = isUltimate
        ? `Congratulations, dragonrider. You have cleared every wave the arena holds and earned the rank of ${tier.rank}. Your name shall be remembered through every age of dragons to come.`
        : `Congratulations. You have cleared every wave of ${tier.label} and earned the rank of ${tier.rank}. A new age of your legend begins — advance to ${nextTier.label}, or restart ${tier.label} to sharpen your skills.`;
    }
    if (advanceBtn) {
      advanceBtn.style.display = nextTier ? 'flex' : 'none';
      const span = advanceBtn.querySelector('span');
      if (span && nextTier) span.textContent = `ADVANCE TO ${nextTier.label.toUpperCase()}`;
    }
    if (restartBtn) {
      const span = restartBtn.querySelector('span');
      if (span) span.textContent = `RESTART ${tier.label.toUpperCase()}`;
    }
    this._pendingTierId = tier.id;
    this._pendingNextTierId = nextTier ? nextTier.id : null;
    this.showScreen('tierCompleteScreen');
  }

  initScreens() {
    const ids = [
      'titleScreen','dragonSelectScreen','modeSelectScreen','mpMenuScreen',
      'matchmakingTierScreen','matchmakingSearchScreen','opponentFoundScreen',
      'bettingArenaScreen','lobbyScreen','loadingScreen','gameScreen',
      'gameOverScreen','howToPlayScreen','walletModal','walletSelectionModal',
      'mpGameOver','loadingOverlay','dragonDetailModal','tierCompleteScreen',
      'loginScreen','usernameScreen','walletSyncedScreen',
      'leaderboardScreen','profileModal'
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
    
    /* 
      NOTICE: The text and inner HTML for the buttons below have been removed.
      The JS logic still fires, but the CSS in index.html now overlays the PNG.
    */
    diffModal.innerHTML = `
      <div class="difficultyBox">
        <div class="difficultyGrid">
          <img class="difficultyBgImg" src="./assets/select-trial-celestial-v1.jpg" alt="Select Trial" draggable="false" onerror="this.style.display='none'">
          <button class="diffBtn" data-tier="easy"></button>
          <button class="diffBtn" data-tier="medium"></button>
          <button class="diffBtn" data-tier="hard"></button>
        </div>
        <button class="menuBtn" id="btnDiffBack"><i data-lucide="arrow-left"></i> Back</button>
      </div>`;
    document.body.appendChild(diffModal);
    this.screens['difficultyModal'] = diffModal;

    const spectateOverlay = document.createElement('div');
    spectateOverlay.id = 'spectateOverlay';
    spectateOverlay.innerHTML = `
      <div class="spectateBanner">
        <span class="spectateLabel">SPECTATING</span>
        <span class="spectateTargetName" id="spectateTargetName"></span>
        <button id="btnLeaveSpectate">Leave Match</button>
      </div>`;
    document.body.appendChild(spectateOverlay);
    this._spectateOverlay = spectateOverlay;

    const quitConfirm = document.createElement('div');
    quitConfirm.id = 'quitConfirmDialog';
    quitConfirm.innerHTML = `
      <div class="quitConfirmBox">
        <p>Leave match? Progress will be lost.</p>
        <div class="quitConfirmActions">
          <button id="btnQuitCancel">Cancel</button>
          <button id="btnQuitConfirmed">Leave Match</button>
        </div>
      </div>`;
    document.body.appendChild(quitConfirm);
    this._quitConfirmDialog = quitConfirm;

    const mpExitDialog = document.createElement('div');
    mpExitDialog.id = 'mpExitDialog';
    mpExitDialog.className = 'mpExitDialog';
    mpExitDialog.innerHTML = `
      <div class="mpExitBox" role="dialog" aria-modal="false" aria-labelledby="mpExitTitle">
        <h3 id="mpExitTitle">Exit Match</h3>
        <p>If you forfeit, your opponent wins the match and the pot.</p>
        <p id="mpExitError" style="display:none;color:#ff9b9b;"></p>
        <div class="mpExitActions">
          <button id="mpExitCancel" class="mpExitCancel" type="button">Cancel</button>
          <button id="mpExitForfeit" class="mpExitForfeit" type="button">Forfeit</button>
        </div>
      </div>`;
    document.body.appendChild(mpExitDialog);
    this._mpExitDialog = mpExitDialog;

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

  // Called from main.js whenever auth state changes (login success, guest
  // entry, sign out) so this file can read/write real per-account progress
  // instead of per-device localStorage.
  setAccount(uid, db) {
    this._uid = uid;
    this._db = db;
    if (uid && db) {
      // Single source of truth for persisted account progress. This is
      // called every time the auth state resolves (login restore, guest
      // entry, sign out, room rejoin). initDragonCarousel() runs earlier,
      // during loadGameAssets() BEFORE auth is restored, so at that point
      // uid is still unknown and clearedTiers is {} - this fetch (fired
      // once the real uid arrives) is what actually loads the saved
      // clearedTiers/dragonPowers/playerCoins. Without it, powers appear
      // locked after a page refresh even though they were already earned.
      this._progressReady = db.ref('users/' + uid).once('value').then((snap) => {
        const data = snap.val() || {};
        this.dragonPowers = data.dragonPowers || {};
        if (typeof data.playerCoins === 'number') this.playerCoins = data.playerCoins;
        this.clearedTiers = data.clearedTiers || {};
        this.renderCarousel();
        if (this._modalDragon) this.renderSpecialPowers(this._modalDragon);
        this.updateCoinDisplay();
      }).catch(() => {
        this.renderCarousel();
        if (this._modalDragon) this.renderSpecialPowers(this._modalDragon);
        this.updateCoinDisplay();
      });
    } else {
      // Guest / signed out - no persisted progress.
      this.dragonPowers = {};
      this.clearedTiers = {};
      this._progressReady = Promise.resolve();
      this.renderCarousel();
      if (this._modalDragon) this.renderSpecialPowers(this._modalDragon);
      this.updateCoinDisplay();
    }
  }

  initDragonCarousel(dragons) {
    this.dragonsData = dragons;
    this.carouselIndex = 0;
    // Progress fetch is owned by setAccount() (see comments there). At this
    // point auth usually hasn't restored yet, so uid is unknown and
    // _progressReady is either null or an already-resolved placeholder -
    // never the real Firebase load. setAccount() will fire the real load
    // and re-render once the uid arrives, and the _progressReady.then()
    // guards in showDragonModal/showScreen will pick up that promise.
    if (!this._progressReady) this._progressReady = Promise.resolve();
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
    if (nameEl) {
      if (this.userSovereign) {
        nameEl.innerHTML = '<span class="ddmCrown"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffd700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px rgba(255,215,0,0.8));display:inline-block;vertical-align:-2px;margin-right:4px;"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg></span>' + name.toUpperCase();
      } else {
        nameEl.textContent = name.toUpperCase();
      }
    }
    const powers = this.getDragonPowers(key);
    const avgLevel = Math.round((powers.defense + powers.speed + powers.rush + powers.attack) / 4);
    const tierEl = document.getElementById('dsDragonTierNum');
    const levelEl = document.getElementById('dsDragonLevel');
    const clearedCount = Object.values(this.clearedTiers).filter(Boolean).length;
    if (tierEl) tierEl.textContent = clearedCount;
    if (levelEl) levelEl.textContent = clearedCount;
    // XP bar reflects account-level progression, not per-dragon stats.
    // Start = 22, Easy cleared = 89, Medium = 155, Hard = 222 (full).
    // The number is the same for every dragon and persists via clearedTiers.
    const cleared = Object.values(this.clearedTiers).filter(Boolean).length;
    const xpCurrent = 22 + Math.round(cleared * (222 - 22) / 3);
    const xpMax = 222;
    const xpText = document.getElementById('dsXpText');
    const xpFill = document.getElementById('dsXpBarFill');
    const xpStart = document.getElementById('dsXpLevelStart');
    const xpEnd = document.getElementById('dsXpLevelEnd');
    if (xpText) xpText.textContent = `${xpCurrent} / ${xpMax}`;
    if (xpFill) {
      const pct = Math.min(100, (xpCurrent / xpMax) * 100);
      xpFill.style.transition = 'none';
      xpFill.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        xpFill.style.transition = '';
        xpFill.style.width = pct + '%';
      }));
    }
    // Hex badges are tiny — only short numbers fit, not tier names.
    if (xpStart) xpStart.textContent = cleared;
    if (xpEnd) xpEnd.textContent = cleared >= 3 ? cleared : cleared + 1;
    const speedBonusEl = document.getElementById('dsSpeedBonus');
    const speedBonusText = document.getElementById('dsSpeedBonusText');
    if (speedBonusEl && speedBonusText) {
      const cleared = Object.values(this.clearedTiers).filter(Boolean).length;
      if (cleared > 0) {
        speedBonusText.textContent = '+' + (cleared * 5) + '% Speed — ' + cleared + '/3 Powers Earned';
        speedBonusEl.style.display = 'inline-flex';
      } else {
        speedBonusEl.style.display = 'none';
      }
    }
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
    if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
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
    const clearedCount = Object.values(this.clearedTiers).filter(Boolean).length;
    if (tierEl) tierEl.textContent = clearedCount;
    if (levelEl) levelEl.textContent = clearedCount;
    const box = document.getElementById('ddmBox');
    if (box) box.style.setProperty('--neon', color);
    const cleared = Object.values(this.clearedTiers).filter(Boolean).length;
    const xpCurrent = 22 + Math.round(cleared * (222 - 22) / 3);
    const xpMax = 222;
    const xpS = document.getElementById('ddmXpStart');
    const xpE = document.getElementById('ddmXpEnd');
    const xpT = document.getElementById('ddmXpText');
    const xpF = document.getElementById('ddmXpFill');
    // Hex badges are tiny — only short numbers fit, not tier names.
    if (xpS) xpS.textContent = cleared;
    if (xpE) xpE.textContent = cleared >= 3 ? cleared : cleared + 1;
    if (xpT) xpT.textContent = `${xpCurrent} / ${xpMax}`;
    if (xpF) {
      const pct = Math.min(100, (xpCurrent / xpMax) * 100);
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
    this.renderSpecialPowers(dragon);
    this._modalDragon = dragon;
    modal.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    // If Firebase's clearedTiers fetch hadn't finished yet when this modal
    // opened (e.g. right after a page refresh), the powers above may have
    // rendered with stale/empty data. Re-render once it's confirmed ready -
    // a no-op if it was already loaded, a silent correction if not.
    if (this._progressReady) {
      this._progressReady.then(() => {
        if (this._modalDragon === dragon) this.renderSpecialPowers(dragon);
      });
    }
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

  // Special powers are earned by clearing AI difficulty tiers (Select
  // Trial screen), not tied to any one dragon - the same three slots show
  // for whichever dragon is selected, since the speed bonus applies
  // account-wide via getTierSpeedMultiplier().
  renderSpecialPowers(dragon) {
    const powersContainer = document.getElementById('ddmPowers');
    if (!powersContainer) return;
    // Simple "recommended next" hint — first still-locked tier in order,
    // since powers unlock strictly Easy -> Medium -> Hard.
    const firstLocked = AI_DIFFICULTY_TIERS.find(t => !this.clearedTiers[t.id]);
    const firstLockedId = firstLocked ? firstLocked.id : null;
    powersContainer.innerHTML = AI_DIFFICULTY_TIERS.map(tier => {
      const unlocked = !!this.clearedTiers[tier.id];
      const isRecommended = !unlocked && tier.id === firstLockedId;
      return `
        <div class="ddmPowerSlot ${unlocked ? 'unlocked' : 'locked'}${isRecommended ? ' recommended' : ''}">
          <div class="ddmPowerIcon"><i class="fa-solid ${unlocked ? 'fa-check' : 'fa-lock'}"></i></div>
          <div class="ddmPowerInfo">
            <div class="ddmPowerName">${tier.rank}${isRecommended ? ' <span class="ddmRecTag">RECOMMENDED NEXT</span>' : ''}</div>
            <div class="ddmPowerDesc">${unlocked ? '+5% speed — unlocked' : `Clear ${tier.label} to unlock +5% speed`}</div>
          </div>
        </div>`;
    }).join('');
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
    if (this._uid && this._db) {
      this._db.ref('users/' + this._uid).update({
        dragonPowers: this.dragonPowers,
        playerCoins: this.playerCoins
      }).catch(() => {});
    }
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

  // Called once when a tier's final wave is cleared (see showTierComplete).
  // Persists the unlock permanently and, if the dragon detail modal happens
  // to be open, refreshes its special-powers list immediately.
  markTierCleared(tierId) {
    if (!tierId || this.clearedTiers[tierId]) return; // already unlocked, nothing to do
    this.clearedTiers[tierId] = true;
    if (this._uid && this._db) {
      this._db.ref('users/' + this._uid + '/clearedTiers').update({ [tierId]: true }).catch(e => {
        console.error('[Progress] Failed to persist clearedTiers:', e.message);
      });
    }
    if (this._modalDragon) this.renderSpecialPowers(this._modalDragon);
  }

  // Total permanent speed bonus earned from cleared tiers, applied to the
  // local player's dragon at match start. +5% per tier cleared - simple,
  // stacks up to +15% once all three (Easy/Medium/Hard) are cleared.
  getTierSpeedMultiplier() {
    const cleared = Object.values(this.clearedTiers).filter(Boolean).length;
    return 1 + (cleared * 0.05);
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
    // ===== AUTH / LOGIN =====
    const btnGoogleSignIn = document.getElementById('btnGoogleSignIn');
    if (btnGoogleSignIn) btnGoogleSignIn.addEventListener('click', () => {
      this.clearAuthError();
      this.eventBus.emit('auth:googleSignIn');
    });

    this._authMode = 'signin';
    const authTabSignIn = document.getElementById('authTabSignIn');
    const authTabSignUp = document.getElementById('authTabSignUp');
    const submitBtn = document.getElementById('btnAuthSubmit');
    const setAuthMode = (mode) => {
      this._authMode = mode;
      if (authTabSignIn) authTabSignIn.classList.toggle('active', mode === 'signin');
      if (authTabSignUp) authTabSignUp.classList.toggle('active', mode === 'signup');
      if (submitBtn) submitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Sign Up';
      const usernameField = document.getElementById('authUsername');
      if (usernameField) usernameField.style.display = mode === 'signup' ? 'block' : 'none';
      this.clearAuthError();
    };
    if (authTabSignIn) authTabSignIn.addEventListener('click', () => setAuthMode('signin'));
    if (authTabSignUp) authTabSignUp.addEventListener('click', () => setAuthMode('signup'));

    const authForm = document.getElementById('authForm');
    if (authForm) authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.clearAuthError();
      const email = document.getElementById('authEmail')?.value.trim();
      const password = document.getElementById('authPassword')?.value;
      const username = document.getElementById('authUsername')?.value.trim();
      if (!email || !password) return;
      if (this._authMode === 'signup' && !username) {
        this.showAuthError('Please choose a username.');
        return;
      }
      this.eventBus.emit('auth:emailSubmit', { mode: this._authMode, email, password, username });
    });

    const btnContinueGuest = document.getElementById('btnContinueGuest');
    if (btnContinueGuest) btnContinueGuest.addEventListener('click', () => this.eventBus.emit('auth:continueAsGuest'));

    // Password visibility toggle
    const btnTogglePassword = document.getElementById('btnTogglePassword');
    const authPassword = document.getElementById('authPassword');
    if (btnTogglePassword && authPassword) {
      btnTogglePassword.addEventListener('click', () => {
        const isHidden = authPassword.type === 'password';
        authPassword.type = isHidden ? 'text' : 'password';
        btnTogglePassword.innerHTML = isHidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
      });
    }

    const usernameForm = document.getElementById('usernameForm');
    if (usernameForm) usernameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const el = document.getElementById('usernameError');
      if (el) el.textContent = '';
      const username = document.getElementById('usernameInput')?.value.trim();
      if (!username) return;
      this.eventBus.emit('auth:submitUsername', { username });
    });

    // ===== PROFILE ICON / MODAL =====
    const profileIconTitle = document.getElementById('profileIconTitle');
    if (profileIconTitle) profileIconTitle.addEventListener('click', () => this.eventBus.emit('profile:open'));
    const profileIconDragonSelect = document.getElementById('profileIconDragonSelect');
    if (profileIconDragonSelect) profileIconDragonSelect.addEventListener('click', () => this.eventBus.emit('profile:open'));
    const btnProfileClose = document.getElementById('btnProfileClose');
    if (btnProfileClose) btnProfileClose.addEventListener('click', () => this.hideProfileModal());
    const btnLbProfileClose = document.getElementById("btnLbProfileClose");
    const lbProfileModal = document.getElementById("lbProfileModal");
    if (lbProfileModal) lbProfileModal.addEventListener("click", (e) => { if (e.target === lbProfileModal) this._closeLbProfile(); });
    if (btnLbProfileClose) btnLbProfileClose.addEventListener("click", () => this._closeLbProfile());
    const btnProfileSignOut = document.getElementById('btnProfileSignOut');
    if (btnProfileSignOut) btnProfileSignOut.addEventListener('click', () => {
      this.hideProfileModal();
      this.eventBus.emit('auth:signOut');
    });

    const btnPlay = document.getElementById('btnPlayNow');
    if (btnPlay) btnPlay.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    const btnStart = document.getElementById('btnStartGame');
    if (btnStart) btnStart.addEventListener('click', () => this.showScreen('dragonSelectScreen'));
    const btnLeader = document.getElementById('btnLeaderboard');
    if (btnLeader) btnLeader.addEventListener('click', () => this.showScreen('leaderboardScreen'));
    const btnHow = document.getElementById('btnHowToPlay');
    if (btnHow) btnHow.addEventListener('click', () => this.showScreen('howToPlayScreen'));
    const settingsModal = document.getElementById('settingsModal');
    const soundToggle = document.getElementById('soundToggle');
    const soundVolume = document.getElementById('soundVolume');
    const soundVolumeValue = document.getElementById('soundVolumeValue');
    const motionToggle = document.getElementById('motionToggle');
    let soundEnabled = localStorage.getItem('irSoundEnabled') !== 'false';
    const savedVolumeRaw = localStorage.getItem('irMasterVolume');
    const savedVolume = savedVolumeRaw === null ? NaN : Number(savedVolumeRaw);
    let volume = Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 50;
    let reducedMotion = localStorage.getItem('irReducedMotion') === 'true';
    const renderSettings = () => {
      if (soundToggle) {
        soundToggle.textContent = soundEnabled ? 'ON' : 'OFF';
        soundToggle.setAttribute('aria-pressed', String(soundEnabled));
      }
      if (soundVolume) { soundVolume.value = String(volume); soundVolume.disabled = !soundEnabled; }
      if (soundVolumeValue) soundVolumeValue.textContent = `${volume}%`;
      if (motionToggle) {
        motionToggle.textContent = reducedMotion ? 'ON' : 'OFF';
        motionToggle.setAttribute('aria-pressed', String(reducedMotion));
      }
      document.documentElement.classList.toggle('reduced-motion', reducedMotion);
    };
    renderSettings();
    document.getElementById('btnSettings')?.addEventListener('click', () => {
      settingsModal?.classList.add('open');
      settingsModal?.setAttribute('aria-hidden', 'false');
    });
    const closeSettings = () => {
      settingsModal?.classList.remove('open');
      settingsModal?.setAttribute('aria-hidden', 'true');
    };
    document.getElementById('btnSettingsClose')?.addEventListener('click', closeSettings);
    settingsModal?.addEventListener('click', (event) => { if (event.target === settingsModal) closeSettings(); });
    soundToggle?.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      renderSettings();
      this.eventBus.emit('settings:soundEnabled', { enabled: soundEnabled });
    });
    soundVolume?.addEventListener('input', () => {
      volume = Number(soundVolume.value);
      renderSettings();
      this.eventBus.emit('settings:volume', { volume });
    });
    motionToggle?.addEventListener('click', () => {
      reducedMotion = !reducedMotion;
      localStorage.setItem('irReducedMotion', String(reducedMotion));
      renderSettings();
      this.eventBus.emit('settings:reducedMotion', { enabled: reducedMotion });
    });
    document.getElementById('fullscreenToggle')?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (_) {}
    });
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
    if (btn1v1) btn1v1.addEventListener('click', () => this.showScreen('difficultyModal'));
    const btnMp = document.getElementById('btnMpMultiplayer');
    if (btnMp) btnMp.addEventListener('click', () => this.showScreen('mpMenuScreen'));

    document.querySelectorAll('#difficultyModal .diffBtn').forEach(btn => {
      btn.addEventListener('click', () => this.selectDifficultyTier(btn.dataset.tier));
    });
    const btnDiffBack = document.getElementById('btnDiffBack');
    if (btnDiffBack) btnDiffBack.addEventListener('click', () => this.showScreen('modeSelectScreen'));

    document.querySelectorAll('#arenaSelectModal .arenaCard').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedArena = parseInt(btn.dataset.arena);
        this.eventBus.emit('ui:arenaSelected', { mode: this.selectedMode, difficulty: this.selectedDifficulty, tierId: this.selectedTierId, arenaIndex: this.selectedArena });
      });
    });
    const arenaBack = document.getElementById('btnArenaBack');
    if (arenaBack) arenaBack.addEventListener('click', () => this.showScreen(this.selectedTierId ? 'difficultyModal' : 'modeSelectScreen'));
    const mpCreate = document.getElementById('btnMpCreate');
    if (mpCreate) mpCreate.addEventListener('click', () => { this._openModeSelectModal(); });
    const mpmCancel = document.getElementById('mpmCancel');
    if (mpmCancel) mpmCancel.addEventListener('click', () => this._closeModeSelectModal());
    const mpmBackdrop = document.querySelector('#mpModeSelectModal .mpmBackdrop');
    if (mpmBackdrop) mpmBackdrop.addEventListener('click', () => this._closeModeSelectModal());
    document.querySelectorAll('#mpModeSelectModal .mpmCard').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.getAttribute('data-mpmode');
        if (!chosen) return;
        this.selectedMpMode = chosen;
        this._closeModeSelectModal();
        this.eventBus.emit('mp:createRoom', { mode: chosen });
      });
    });
    const mpSearchBattle = document.getElementById('btnMpSearchBattle');
    if (mpSearchBattle) mpSearchBattle.addEventListener('click', () => { this.selectedMpMode = '1v1'; this.showScreen('matchmakingTierScreen'); });

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
          this._openCustomStakeModal();
          return;
        }
        this.selectedTier = tier;
        this._applyTierGlow(tier);
        this.eventBus.emit('lobby:tierSelected', { tier });
      });
    });

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
    const mpExitBtn = document.getElementById('mpExitBtn');
    const mpExitDialog = this._mpExitDialog || document.getElementById('mpExitDialog');
    if (mpExitBtn) mpExitBtn.addEventListener('click', () => {
      const error = document.getElementById('mpExitError');
      if (error) { error.style.display = 'none'; error.textContent = ''; }
      mpExitDialog?.classList.add('active');
    });
    document.getElementById('mpExitCancel')?.addEventListener('click', () => mpExitDialog?.classList.remove('active'));
    document.getElementById('mpExitForfeit')?.addEventListener('click', () => {
      mpExitDialog?.classList.remove('active');
      this.eventBus.emit('mp:forfeitMatch');
    });
    const resumeBtn = document.getElementById('btnResume');
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.eventBus.emit('game:resume'));
    const quitBtn = document.getElementById('btnQuit');
    if (quitBtn) quitBtn.addEventListener('click', () => this.showQuitConfirm());
    const quitCancelBtn = document.getElementById('btnQuitCancel');
    if (quitCancelBtn) quitCancelBtn.addEventListener('click', () => this.hideQuitConfirm());
    const quitConfirmedBtn = document.getElementById('btnQuitConfirmed');
    if (quitConfirmedBtn) quitConfirmedBtn.addEventListener('click', () => {
      this.hideQuitConfirm();
      this.eventBus.emit('game:quit');
      this.showScreen('dragonSelectScreen');
    });
    const playAgain = document.getElementById('btnPlayAgain');
    if (playAgain) playAgain.addEventListener('click', () => this.eventBus.emit('game:restart'));
    const bindMainMenu = (button) => {
      if (!button) return;
      let lastActivation = 0;
      const activate = (event) => {
        const now = Date.now();
        if (now - lastActivation < 700) return;
        lastActivation = now;
        this.eventBus.emit('game:returnToMainMenu');
      };
      // _tap handles pointerdown + ghost-click suppression consistently
      this._tap(button, activate);
    };
    bindMainMenu(document.getElementById('btnMainMenu'));
    bindMainMenu(document.getElementById('btnMpMainMenu'));
    document.getElementById('btnReturnLobby')?.addEventListener('click', () => this.eventBus.emit('game:returnToMultiplayerMenu'));
    const returnToActiveRoomBtn = document.getElementById('btnReturnToActiveRoom');
    if (returnToActiveRoomBtn) {
      returnToActiveRoomBtn.addEventListener('click', () => this.eventBus.emit('ui:returnToActiveRoom'));
    }
    document.getElementById('stakeConfirmCancel')?.addEventListener('click', () => this.eventBus.emit('staking:cancelWait'));

    const btnTierAdvance = document.getElementById('btnTierAdvance');
    if (btnTierAdvance) btnTierAdvance.addEventListener('click', () => {
      if (this._pendingNextTierId) this.eventBus.emit('ui:tierAdvance', { tierId: this._pendingNextTierId });
    });
    const btnTierRestart = document.getElementById('btnTierRestart');
    if (btnTierRestart) btnTierRestart.addEventListener('click', () => {
      if (this._pendingTierId) this.eventBus.emit('ui:tierRestart', { tierId: this._pendingTierId });
    });
    const btnTierMainMenu = document.getElementById('btnTierMainMenu');
    if (btnTierMainMenu) btnTierMainMenu.addEventListener('click', () => { this.eventBus.emit('game:quit'); this.showScreen('dragonSelectScreen'); });

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
    // The second tile in this modal used to be Jupiter, which had NO click
    // handler at all - it rendered but did nothing when tapped. It is now
    // Solflare, wired to the same path as the walletSelectionModal's
    // Solflare button so both entry points behave identically.
    const wOptSolflare = document.getElementById('wOptSolflare');
    if (wOptSolflare) {
      wOptSolflare.addEventListener('click', () => {
        this.eventBus.emit('wallet:selectSolflare');
        const wm = window.game?.walletManager;
        if (wm) wm.connectSolflare();
      });
    }
    document.addEventListener('click', (e) => { if (e.target.closest('#btnWalletDisconnect')) this.eventBus.emit('wallet:disconnectRequest'); });
    const signTest = document.getElementById('btnWalletSignTest');
    if (signTest) signTest.addEventListener('click', () => {
      const resultEl = document.getElementById('wSignResult');
      const walletLabel = this._connectedWalletType === 'solflare' ? 'Solflare' : 'Phantom';
      if (resultEl) resultEl.innerHTML = `Waiting for approval in ${walletLabel}...`;
      this.eventBus.emit('wallet:signTestRequest');
    });

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
    });    this.eventBus.on('wallet:disconnected', () => {
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
      const depositBtn = document.getElementById('lobbyDepositBtn');
      if (depositBtn) depositBtn.disabled = true;
      // Keep the exact lobby mounted while Phantom is open. This overlay is
      // deliberately not a screen, so wallet handoff cannot expose the blank
      // arena loader or destroy the room the player must return to.
      const overlay = document.getElementById('stakeConfirmOverlay');
      const overlayTitle = document.getElementById('stakeConfirmTitle');
      const overlayText = document.getElementById('stakeConfirmText');
      const overlayHint = document.getElementById('stakeConfirmHint');
      const overlaySpinner = document.getElementById('stakeConfirmSpinner');
      const cancel = document.getElementById('stakeConfirmCancel');
      if (this._refundOverlayTimer) clearTimeout(this._refundOverlayTimer);
      if (this._refundOverlayCloseTimer) clearTimeout(this._refundOverlayCloseTimer);
      this._refundOverlayTimer = null;
      this._refundOverlayCloseTimer = null;
      if (overlayTitle) overlayTitle.textContent = 'PHANTOM';
      if (overlayText) overlayText.textContent = label || 'Confirming your stake…';
      if (overlayHint) overlayHint.textContent = 'Approve in Phantom, then return here. Your room is being kept open.';
      if (overlaySpinner) overlaySpinner.style.display = 'block';
      if (cancel) {
        cancel.style.display = 'none';
        clearTimeout(this._stakeCancelTimer);
        this._stakeCancelTimer = setTimeout(() => { cancel.style.display = 'inline-block'; }, 12000);
      }
      if (overlay) overlay.style.display = 'flex';
    });
    this.eventBus.on('staking:refundPending', ({ label } = {}) => {
      const overlay = document.getElementById('stakeConfirmOverlay');
      const title = document.getElementById('stakeConfirmTitle');
      const text = document.getElementById('stakeConfirmText');
      const hint = document.getElementById('stakeConfirmHint');
      const spinner = document.getElementById('stakeConfirmSpinner');
      if (this._refundOverlayTimer) clearTimeout(this._refundOverlayTimer);
      if (this._refundOverlayCloseTimer) clearTimeout(this._refundOverlayCloseTimer);
      if (title) title.textContent = 'REFUND PROCESSING';
      if (text) text.textContent = label || 'Your stake is being returned in full.';
      if (hint) hint.textContent = 'Please wait while the refund is completed.';
      if (spinner) spinner.style.display = 'block';
      if (overlay) overlay.style.display = 'flex';
      this._refundOverlayTimer = setTimeout(() => {
        if (title) title.textContent = 'REFUND SUCCESSFUL';
        if (text) text.textContent = 'Your stake has been returned.';
        if (hint) hint.textContent = 'You can now continue from the Multiplayer menu.';
        if (spinner) spinner.style.display = 'none';
        this._refundOverlayCloseTimer = setTimeout(() => {
          if (overlay) overlay.style.display = 'none';
          this._refundOverlayCloseTimer = null;
        }, 3000);
        this._refundOverlayTimer = null;
      }, 30000);
    });
    this.eventBus.on('staking:confirmed', ({ label }) => {
      const statusText = document.getElementById('depositStatusText');
      if (statusText) { statusText.textContent = label || 'Bet placed!'; statusText.className = 'depositStatusText confirmed'; }
      const baStatus = document.getElementById('baYourStatus');
      if (baStatus) { baStatus.textContent = 'Bet Placed'; baStatus.style.color = '#4ade80'; }
      const overlay = document.getElementById('stakeConfirmOverlay');
      if (this._refundOverlayTimer) clearTimeout(this._refundOverlayTimer);
      if (this._refundOverlayCloseTimer) clearTimeout(this._refundOverlayCloseTimer);
      this._refundOverlayTimer = null;
      this._refundOverlayCloseTimer = null;
      if (overlay) overlay.style.display = 'none';
    });
    this.eventBus.on('staking:error', ({ message }) => {
      const safeMessage = message || 'Stake failed. No deposit was confirmed. Please try again.';
      const statusText = document.getElementById('depositStatusText');
      if (statusText) { statusText.textContent = safeMessage; statusText.className = 'depositStatusText error'; }
      const baStatus = document.getElementById('baYourStatus');
      if (baStatus) { baStatus.textContent = 'Failed — try again'; baStatus.style.color = '#ef4444'; }

      const overlay = document.getElementById('stakeConfirmOverlay');
      if (this._refundOverlayTimer) clearTimeout(this._refundOverlayTimer);
      if (this._refundOverlayCloseTimer) clearTimeout(this._refundOverlayCloseTimer);
      this._refundOverlayTimer = null;
      this._refundOverlayCloseTimer = null;
      if (overlay) overlay.style.display = 'none';

      // Always restore the retry control
      const depositBtn = document.getElementById('lobbyDepositBtn');
      const depositLabel = document.getElementById('depositBtnLabel');
      if (depositBtn) {
        depositBtn.disabled = false;
        depositBtn.style.display = 'flex';
      }
      if (depositLabel) depositLabel.textContent = 'TRY STAKE AGAIN';

      let toast = document.getElementById('stakingErrorToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'stakingErrorToast';
        Object.assign(toast.style, {
          position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
          zIndex: '10000', maxWidth: 'min(420px, calc(100vw - 32px))',
          padding: '13px 18px', border: '1px solid #ef4444', borderRadius: '10px',
          background: 'rgba(22, 7, 10, 0.96)', color: '#ffd5d5', textAlign: 'center',
          fontFamily: 'Rajdhani, sans-serif', fontWeight: '700', letterSpacing: '.4px',
          boxShadow: '0 8px 30px rgba(239,68,68,.28)'
        });
        document.body.appendChild(toast);
      }
      toast.textContent = safeMessage;
      toast.style.display = 'block';
      clearTimeout(this._stakingErrorToastTimer);
      this._stakingErrorToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 6000);
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
    const lbClose = document.getElementById('btnLeaderboardClose');
    if (lbClose) lbClose.addEventListener('click', () => this.showScreen('titleScreen'));
    document.querySelectorAll('.htpTab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.htpTab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.htpPanel').forEach(p => p.classList.remove('active'));
        document.getElementById('htp' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1))?.classList.add('active');
      });
    });
  }

  updateLobby(players = [], maxPlayers = 4, roomCode = '', isHost = false, mode = null) {
    try {
      const codeEl = document.getElementById('roomCodeDisplay');
      if (codeEl && roomCode) codeEl.textContent = roomCode;
      const countEl = document.getElementById('lobbyPlayerCount');
      if (countEl) countEl.textContent = `${players.length} / ${maxPlayers}`;

      const inferredMode = (maxPlayers <= 2) ? '1v1' : 'FFA';
      const roomMode = mode || inferredMode;
      const isFFA = roomMode !== '1v1';
      const isAutoMatch = !!document.getElementById('lobbyScreen')?.classList.contains('matchedLobby');
      const cap = isFFA ? maxPlayers : 2;

      const slotsEl = document.getElementById('lobbySlots');
      if (slotsEl && Array.isArray(players)) {
        const host = players.find(p => p.isHost) || players[0] || null;
        const others = players.filter(p => p !== host);

        const portrait = (p) => {
          const key = (p && p.dragon || '').toLowerCase();
          const url = key && DRAGON_IMAGES[key];
          return url
            ? `<img src="${url}" alt="${key}">`
            : `<div class="lobbyPlayerIcon">🐉</div>`;
        };

        const kickChip = (p) => {
          if (isAutoMatch) return '';
          if (!isHost) return '';
          if (!p || p.isHost) return '';
          if (p.deposited) return '';
          const pid = p.id || p.playerId || '';
          return `<button class="kickBtn" data-kick-id="${pid}" title="Kick unstaked player">Kick</button>`;
        };

        const depositChip = (p) => {
          if (!p) return '';
          if (p.deposited) return '<span class="depositBadge confirmed">STAKED</span>';
          if (p.tier || p.dragon) return '<span class="depositBadge pending">WAITING</span>';
          return '';
        };

        const roleLabel = (roleClass, i) => {
          if (isAutoMatch) return '<i data-lucide="shield" class="roleIcon roleShield"></i> AUTO MATCH PLAYER';
          if (roleClass === 'role-host') return '<i data-lucide="crown" class="roleIcon roleCrown"></i> ROOM LEADER';
          if (roleClass === 'role-opponent') return '<i data-lucide="shield" class="roleIcon roleShield"></i> CONTENDER';
          return `<i data-lucide="shield" class="roleIcon roleShield"></i> CHALLENGER ${i}`;
        };

        const filledRow = (p, roleClass, roleIdx) => `
          <div class="lobbyPlayerCard ${roleClass}">
            ${portrait(p)}
            <div class="lobbyPlayerBody">
              <div class="lobbyPlayerName">${p.sovereign ? '<span class="sovereignBadge"><i class="fa-solid fa-crown"></i></span>' : ''}${(p.name || (roleClass === 'role-host' ? 'HOST' : 'CHALLENGER')).toUpperCase()}${p.isLocal ? ' (YOU)' : ''}</div>
              <div class="lobbyPlayerDragon">${(p.dragon || '').toUpperCase()}</div>
              <div class="lobbyPlayerRole">${roleLabel(roleClass, roleIdx)}</div>
            </div>
            <div class="lobbyPlayerRight">
              ${depositChip(p)}
              ${kickChip(p)}
            </div>
          </div>`;

        const emptyRow = (roleClass, roleIdx) => {
          if (roleClass === 'role-opponent' && !isFFA) {
            return `
              <div class="lobbyPlayerCard opponent role-opponent empty waiting">
                <div class="lobbyPlayerIcon empty"></div>
                <div class="lobbyPlayerBody">
                  <div class="lobbyPlayerName joining">Opponent joining<span class="joinDots"><span>.</span><span>.</span><span>.</span></span></div>
                </div>
              </div>`;
          }
          return `
            <div class="lobbyPlayerCard ${roleClass} empty">
              <div class="lobbyPlayerIcon empty"></div>
              <div class="lobbyPlayerBody">
                <div class="lobbyPlayerName joining">Waiting for challenger<span class="joinDots"><span>.</span><span>.</span><span>.</span></span></div>
                <div class="lobbyPlayerRole">${roleLabel(roleClass, roleIdx)}</div>
              </div>
            </div>`;
        };

        let html = '';
        html += host ? filledRow(host, 'role-host', 0) : emptyRow('role-host', 0);

        if (!isFFA) {
          const opp = others[0];
          html += opp ? filledRow({ ...opp, isLocal: opp.isLocal }, 'role-opponent', 1) : emptyRow('role-opponent', 1);
        } else {
          const roleClasses = ['role-opponent', 'role-ffa2', 'role-ffa3'];
          for (let i = 0; i < 3; i++) {
            const p = others[i];
            const rc = roleClasses[i];
            html += p ? filledRow(p, rc, i + 1) : emptyRow(rc, i + 1);
          }
        }

        slotsEl.innerHTML = html;
      }

      const slotsRoot = document.getElementById('lobbySlots');
      if (slotsRoot && !this._kickBound) {
        this._kickBound = true;
        slotsRoot.addEventListener('click', (e) => {
          const btn = e.target && e.target.closest && e.target.closest('.kickBtn');
          if (!btn) return;
          e.preventDefault(); e.stopPropagation();
          const pid = btn.getAttribute('data-kick-id');
          if (pid) this.eventBus.emit('lobby:kickPlayer', { playerId: pid });
        }, true);
      }

      const startBtn = document.getElementById('lobbyStartBtn');
      const waitingText = document.getElementById('lobbyWaitingText');
      if (startBtn) startBtn.style.display = (!isAutoMatch && isHost && this._stakingBothDeposited) ? 'flex' : 'none';
      if (waitingText) waitingText.style.display = isAutoMatch ? 'block' : (isHost ? 'none' : 'block');
      if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
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
    const {
      isHost, tier, hostDeposited, opponentDeposited, canDeposit,
      myDeposited: myDepositedFromMain,
      allPlayersDeposited: allDepositedFromMain,
      mode,
    } = state;
    const myDeposited = (myDepositedFromMain !== undefined)
      ? !!myDepositedFromMain
      : (isHost ? !!hostDeposited : !!opponentDeposited);
    const allPlayersDeposited = (allDepositedFromMain !== undefined)
      ? !!allDepositedFromMain
      : !!(hostDeposited && opponentDeposited);
    this._stakingBothDeposited = allPlayersDeposited;
    const depositBtn = document.getElementById('lobbyDepositBtn');
    const label = document.getElementById('depositBtnLabel');
    const statusText = document.getElementById('depositStatusText');
    const startBtn = document.getElementById('lobbyStartBtn');
    const waitingText = document.getElementById('lobbyWaitingText');
    const isAutoMatch = !!document.getElementById('lobbyScreen')?.classList.contains('matchedLobby');
    if (depositBtn) {
      depositBtn.style.display = (tier && !myDeposited) ? 'flex' : 'none';
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
      startBtn.style.display = (!isAutoMatch && allPlayersDeposited && isHost) ? 'flex' : 'none';
      startBtn.disabled = !allPlayersDeposited;
    }
    if (waitingText) {
      waitingText.style.display = isAutoMatch ? 'block' : ((allPlayersDeposited && !isHost) ? 'block' : (isHost ? 'none' : waitingText.style.display));
      if (allPlayersDeposited) waitingText.textContent = isAutoMatch
        ? 'Both stakes confirmed — automatic start pending…'
        : (!isHost ? 'All stakes locked — waiting for host to start...' : waitingText.textContent);
    }
    if (statusText) {
      if (allPlayersDeposited) { statusText.textContent = 'All players staked - ready!'; statusText.className = 'depositStatusText confirmed'; }
      else if (myDeposited) { statusText.textContent = 'Waiting for other players to stake...'; statusText.className = 'depositStatusText pending'; }
      else { statusText.textContent = ''; statusText.className = 'depositStatusText'; }
    }
    document.querySelectorAll('#tierBtns .tierBtn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tier === tier);
      btn.disabled = isHost ? !!hostDeposited : true;
    });
  }

  resetLobbyState() {
    this._stakingBothDeposited = false;
    this.selectedTier = null;
    this._applyTierGlow(null);
    this.setMatchedLobbyMode(false, null);
    const depositBtn = document.getElementById('lobbyDepositBtn');
    const label = document.getElementById('depositBtnLabel');
    const statusText = document.getElementById('depositStatusText');
    const startBtn = document.getElementById('lobbyStartBtn');
    const waitingText = document.getElementById('lobbyWaitingText');
    if (depositBtn) {
      depositBtn.disabled = false;
      depositBtn.style.display = 'none';
      depositBtn.style.pointerEvents = '';
      depositBtn.removeAttribute('aria-disabled');
    }
    if (label) label.textContent = 'Place Bet';
    if (statusText) {
      statusText.textContent = '';
      statusText.className = 'depositStatusText';
    }
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.style.display = 'none';
    }
    if (waitingText) waitingText.style.display = 'none';
    document.querySelectorAll('#tierBtns .tierBtn').forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('active');
    });
  }

  updateAttackMeter(dragon) {
    const btn = document.getElementById('boostBtn');
    if (!btn) return;
    const charge = dragon ? (dragon.attackCharge || 0) : 0;
    const active = !!(dragon && dragon.attackActive);
    const max = CONFIG.ATTACK_METER_MAX || 20;
    const full = charge >= max;
    const state = `${charge}|${active}`;
    if (state === this._meterState) return;
    this._meterState = state;
    btn.classList.toggle('attack-ready', full && !active);
    btn.classList.toggle('attack-active', active);
  }

  // ===== UPDATED COMBO BANNER =====
  showComboBanner(killer, streak) {
    // Only show if streak >= 3
    if (streak < 3) return;
    const banner = document.getElementById('comboBanner');
    if (!banner) return;
    const neon = (CONFIG.DRAGON_NEON && CONFIG.DRAGON_NEON[killer.type]) || '#ffd700';
    const name = (killer.type || 'dragon').toUpperCase();

    banner.innerHTML =
      `<div class="combo-title" style="color:${neon};text-shadow:0 0 18px ${neon},0 0 46px ${neon};">${streak}x COMBO!</div>` +
      `<div class="combo-sub">${name} &middot; ${streak} KILLS IN 4 SECONDS</div>`;

    banner.classList.remove('combo-show');
    void banner.offsetWidth;
    banner.classList.add('combo-show');
  }

  // ==================== STONE AGE BAR ====================
  showStoneAgeBar() {
    const bar = document.getElementById('stoneAgeBar');
    if (bar) bar.style.display = 'block';
  }

  hideStoneAgeBar() {
    const bar = document.getElementById('stoneAgeBar');
    if (bar) bar.style.display = 'none';
  }

  updateStoneAgeBar(segments, maxSegments = 50) {
    const fill = document.getElementById('stoneAgeBarFill');
    const number = document.getElementById('stoneAgeBarNumber');
    if (!fill || !number) return;

    const pct = Math.min(100, (segments / maxSegments) * 100);
    fill.style.width = pct + '%';
    number.textContent = segments;

    // Update milestone highlights
    const milestones = document.querySelectorAll('#stoneAgeMilestones .milestone');
    milestones.forEach(el => {
      const seg = parseInt(el.dataset.seg);
      el.classList.toggle('active', segments >= seg);
      el.classList.toggle('reached', segments >= seg);
    });
  }

  // ==================== GROWTH POPUP ====================
  showGrowthPopup(stage, text, color) {
    const popup = document.getElementById('growthPopup');
    const stageEl = document.getElementById('growthPopupStage');
    const textEl = document.getElementById('growthPopupText');
    if (!popup || !stageEl || !textEl) return;

    stageEl.textContent = stage;
    stageEl.style.color = color;
    stageEl.style.textShadow = `0 0 14px ${color}99, 0 0 28px ${color}44`;
    textEl.textContent = text;
    textEl.style.color = 'rgba(255, 255, 255, 0.55)';

    popup.classList.remove('show');
    void popup.offsetWidth;
    popup.classList.add('show');

    clearTimeout(this._growthPopupTimer);
    this._growthPopupTimer = setTimeout(() => {
      popup.classList.remove('show');
    }, 2500);
  }

  // ==================== KILL FEED ====================
  showKillFeed(killerName, victimName, killerColor) {
    const feed = document.getElementById('killFeed');
    const content = document.getElementById('killFeedContent');
    if (!feed || !content) return;

    // Cancel victim name with X mark
    content.innerHTML = `
      <span class="kill-killer" style="color:${killerColor}">${killerName}</span>
      <span class="kill-icon">🐉</span>
      <span class="kill-victim">
        <span class="kill-victim-name">${victimName}</span>
        <span class="kill-xmark">✕</span>
      </span>
    `;

    feed.classList.remove('show');
    void feed.offsetWidth;
    feed.classList.add('show');

    // Auto-hide after 2.5 seconds
    clearTimeout(this._killFeedTimer);
    this._killFeedTimer = setTimeout(() => {
      feed.classList.remove('show');
    }, 2500);
  }

  updateHUD(score, timeStr, localDragon, waveNum = null) {
    // In AI wave mode, the score counter was always stuck at 0 and told
    // the player nothing useful - repurposed to show the current wave
    // number instead ("Wave 1", "Wave 2"...). Non-wave modes (waveNum
    // null) keep showing the real score as before.
    const hudKey = waveNum !== null ? `wave:${waveNum}` : `score:${score}`;
    if (hudKey !== this._hudScore) {
      this._hudScore = hudKey;
      const scoreEl = document.getElementById('scoreVal');
      if (scoreEl) {
        scoreEl.textContent = waveNum !== null ? `Wave ${waveNum}` : (score !== undefined ? score : '');
      }
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
        const flameSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#ff6b35" style="display:inline-block;vertical-align:middle;"><path d="M12 2C9 6 6 8 6 13a6 6 0 0 0 12 0c0-2-1-4-2-5 0 1-1 2-2 2 1-3-1-6-2-8z"/></svg>';
        livesHud.innerHTML = lives > 0
          ? Array.from({ length: lives }).map(() => flameSvg).join('')
          : '<span style="color:#ff6b6b;font-size:11px;">No lives</span>';
      }
    }
  }

  renderMinimap(canvas, camera, arenaManager, dragons, foods) {
    if (!canvas || !arenaManager) return;
    const ctx = this._minimapCtx || (this._minimapCtx = canvas.getContext('2d'));
    // Cache dimensions — reading clientWidth/Height forces reflow every frame.
    // Only re-read when the window resizes (flagged by _minimapDirty).
    if (this._minimapDirty || !this._minimapDims) {
      const w = canvas.clientWidth || 90;
      const h = canvas.clientHeight || 90;
      const parent = canvas.parentElement;
      this._minimapDims = {
        w, h,
        parentW: parent ? parent.clientWidth : w * (camera ? camera.zoom : 1),
        parentH: parent ? parent.clientHeight : h * (camera ? camera.zoom : 1)
      };
      this._minimapDirty = false;
    }
    const w = this._minimapDims.w;
    const h = this._minimapDims.h;
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

    // ── Cache gradients per canvas-size to avoid recreating every frame ──
    if (!this._minimapCache || this._minimapCache.w !== w || this._minimapCache.h !== h) {
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      bg.addColorStop(0, 'rgba(10,20,36,0.92)');
      bg.addColorStop(1, 'rgba(4,9,18,0.96)');
      const ring = ctx.createLinearGradient(0, 0, 0, h);
      ring.addColorStop(0, '#f0d9a0');
      ring.addColorStop(0.5, '#a97f45');
      ring.addColorStop(1, '#6e5226');
      this._minimapCache = { w, h, bg, ring };
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = this._minimapCache.bg;
    ctx.fillRect(0, 0, w, h);

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

    if (camera) {
      const viewW = this._minimapDims.parentW / camera.zoom;
      const viewH = this._minimapDims.parentH / camera.zoom;
      const topLeft = toMini(camera.x - viewW / 2, camera.y - viewH / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(topLeft.x, topLeft.y, viewW * scaleX, viewH * scaleY);
    }

    // ── Batch food rendering: single fillStyle, no per-item state changes ──
    ctx.fillStyle = 'rgba(72,224,255,0.35)';
    for (let i = 0, len = (foods || []).length; i < len; i++) {
      const p = toMini(foods[i].x, foods[i].y);
      ctx.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5);
    }

    // ── Draw dragons WITHOUT shadowBlur (which is extremely expensive) ──
    // Instead, use a brighter color + pre-drawn glow circle for local player.
    for (let i = 0, len = (dragons || []).length; i < len; i++) {
      const d = dragons[i];
      if (!d.alive) continue;
      const p = toMini(d.head.x, d.head.y);
      const isLocal = d === this._localDragonRef || d.isLocalPlayer;
      if (isLocal) {
        // ── Local player: dragon-colored arrow ──
        const navColor = (CONFIG.DRAGON_NEON && CONFIG.DRAGON_NEON[d.type]) || '#7ef0ff';
        ctx.fillStyle = navColor + '38';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = navColor;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(d.angle || 0);
        ctx.beginPath();
        ctx.moveTo(4, 0); ctx.lineTo(-3, 2.6); ctx.lineTo(-3, -2.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (d.isRemote) {
        // ── MP remote players: red dots (keep as-is) ──
        ctx.fillStyle = 'rgba(255,107,107,0.18)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // ── AI enemies: cyan dots (original color, so players can
        // distinguish themselves from AI on the minimap) ──
        ctx.fillStyle = 'rgba(72,224,255,0.18)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#48e0ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // ── Ring border (uses cached gradient) ──
    ctx.lineWidth = 2;
    ctx.strokeStyle = this._minimapCache.ring;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }

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

  showForfeitDefeat(message = 'You lost your connection to the arena. The match went to your opponent.') {
    if (this._forfeitDefeatShown) return;
    this._forfeitDefeatShown = true;
    const titleEl = document.getElementById('goTitle');
    const subEl = document.getElementById('goSubtitle');
    if (titleEl) { titleEl.textContent = 'MATCH ENDED'; titleEl.style.color = '#ff6e6e'; }
    if (subEl) {
      subEl.textContent = message;
      subEl.style.color = '#e0a3a3';
      subEl.style.display = 'block';
    }
    const playAgain = document.getElementById('btnPlayAgain');
    if (playAgain) playAgain.style.display = 'none';
    const stakeBox = document.getElementById('goStakeBox');
    if (stakeBox) stakeBox.style.display = 'none';
    this.showScreen('gameOverScreen');
  }

  resetForfeitState() {
    this._forfeitDefeatShown = false;
    const dialog = this._mpExitDialog || document.getElementById('mpExitDialog');
    if (dialog) dialog.classList.remove('active');
    const error = document.getElementById('mpExitError');
    if (error) { error.style.display = 'none'; error.textContent = ''; }
  }

  showForfeitError(message) {
    const dialog = this._mpExitDialog || document.getElementById('mpExitDialog');
    const error = document.getElementById('mpExitError');
    if (error) { error.textContent = message; error.style.display = 'block'; }
    if (dialog) dialog.classList.add('active');
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
  }

  hidePauseOverlay() { const el = document.getElementById('pauseOverlay'); if (el) el.classList.remove('active'); }

  // Shown when the local player is eliminated but the match continues -
  // lets them watch whoever killed them (or another survivor) instead of
  // staring at a frozen screen, with a way to leave the match entirely.
  showSpectateOverlay(targetDragon, onLeave) {
    const overlay = this._spectateOverlay || document.getElementById('spectateOverlay');
    if (!overlay) return;
    const nameEl = document.getElementById('spectateTargetName');
    if (nameEl) {
      const label = (targetDragon && targetDragon.type) ? targetDragon.type : 'Survivor';
      nameEl.textContent = `Watching ${label}`;
    }
    const leaveBtn = document.getElementById('btnLeaveSpectate');
    if (leaveBtn) {
      // Direct assignment (not addEventListener) so re-showing on a
      // re-target never stacks duplicate handlers.
      leaveBtn.onclick = () => { if (typeof onLeave === 'function') onLeave(); };
    }
    overlay.classList.add('active');
  }

  hideSpectateOverlay() {
    const overlay = this._spectateOverlay || document.getElementById('spectateOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  showQuitConfirm() {
    const dialog = this._quitConfirmDialog || document.getElementById('quitConfirmDialog');
    if (dialog) dialog.classList.add('active');
  }

  showAuthError(message) {
    const el = document.getElementById('authError');
    if (el) el.textContent = message || '';
  }

  clearAuthError() {
    const el = document.getElementById('authError');
    if (el) el.textContent = '';
  }

  showUsernameError(message) {
    const el = document.getElementById('usernameError');
    if (el) el.textContent = message || '';
  }

  showProfileStats(stats) {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    const nameEl = document.getElementById('profileModalUsername');
    const rankEl = document.getElementById('profileModalRank');
    const killsEl = document.getElementById('profileStatKills');
    const aiMatchesEl = document.getElementById('profileStatAIMatches');
    const aiKillsEl = document.getElementById('profileStatAIKills');
    const mpMatchesEl = document.getElementById('profileStatMPMatches');
    const mpWinsEl = document.getElementById('profileStatMPWins');
    const playedEl = document.getElementById('profileStatPlayed');
    const timePlayedEl = document.getElementById('profileStatTimePlayed');
    const bestTierEl = document.getElementById('profileStatBestTier');
    const statRankEl = document.getElementById('profileStatRank');
    const sovereignEl = document.getElementById('profileStatSovereign');

    if (nameEl) {
      const isSov = !!(stats && stats.sovereignRank);
      if (isSov) {
        nameEl.innerHTML = '<span class="profileCrown"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffd700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px rgba(255,215,0,0.8));display:inline-block;vertical-align:-3px;margin-right:4px;"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg></span>' + ((stats && stats.username) || 'Player');
      } else {
        nameEl.textContent = (stats && stats.username) || 'Player';
      }
    }
    if (rankEl) rankEl.textContent = (stats && stats.rank) || 'Wingling';
    if (killsEl) killsEl.textContent = (stats && stats.dragonKills) || 0;
    if (aiMatchesEl) aiMatchesEl.textContent = (stats && stats.aiMatchesPlayed) || 0;
    if (aiKillsEl) aiKillsEl.textContent = (stats && stats.aiKills) || 0;
    if (mpMatchesEl) mpMatchesEl.textContent = (stats && stats.mpMatchesPlayed) || 0;
    if (mpWinsEl) mpWinsEl.textContent = (stats && stats.multiplayerWins) || 0;
    if (playedEl) playedEl.textContent = (stats && stats.matchesPlayed) || 0;
    if (timePlayedEl) {
      const ms = (stats && stats.timePlayedMs) || 0;
      const totalMinutes = Math.floor(ms / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      timePlayedEl.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
    if (bestTierEl) {
      const tierLabels = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
      bestTierEl.textContent = (stats && tierLabels[stats.highestTierCleared]) || '-';
    }
    if (statRankEl) statRankEl.textContent = (stats && stats.rank) || 'Wingling';
    if (sovereignEl) {
      const isSovereign = !!(stats && stats.sovereignRank);
      sovereignEl.textContent = isSovereign ? 'YES' : 'No';
      if (isSovereign) sovereignEl.classList.add('sovereign-yes');
      else sovereignEl.classList.remove('sovereign-yes');
    }
    // Swap crest icon to glowing crown when sovereign
    const crestEl = document.getElementById('profileModalCrest');
    if (crestEl) {
      const isSov = !!(stats && stats.sovereignRank);
      if (isSov) {
        crestEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffd700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(255,215,0,0.7));"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg>';
        crestEl.style.borderColor = '#ffd700';
        crestEl.style.color = '#ffd700';
        crestEl.style.boxShadow = '0 0 25px rgba(255, 215, 0, 0.5)';
      } else {
        crestEl.innerHTML = '<i class="fa-solid fa-dragon"></i>';
        crestEl.style.borderColor = '';
        crestEl.style.color = '';
        crestEl.style.boxShadow = '';
      }
    }
    modal.classList.add('active');
  }

  hideProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.classList.remove('active');
  }

  showJoinToast(username) {
    let toast = document.getElementById('joinToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'joinToast';
      toast.className = 'joinToast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid fa-dragon"></i> <span>${username}</span> Joined`;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(this._joinToastTimer);
    this._joinToastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  showLoginDrop(username, isGuest) {
    const banner = document.getElementById('loginDropBanner');
    const nameEl = document.getElementById('loginDropName');
    if (!banner || !nameEl) return;
    if (isGuest || !username) {
      banner.style.display = 'none';
      return;
    }
    nameEl.textContent = username;
    // Reset animation by removing and re-adding the element
    banner.style.display = 'block';
    banner.style.animation = 'none';
    banner.offsetHeight; // force reflow
    banner.style.animation = 'loginDropIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards, loginDropHold 2.4s 0.6s linear forwards, loginDropOut 0.4s 3s ease forwards';
    // Auto-hide after animation completes (3.4s total)
    setTimeout(() => {
      if (banner) banner.style.display = 'none';
    }, 3400);
  }

  hideQuitConfirm() {
    const dialog = this._quitConfirmDialog || document.getElementById('quitConfirmDialog');
    if (dialog) dialog.classList.remove('active');
  }

  showStakeBreakdown({
    pending = false, draw = false, won = false,
    delayed = false, error = false, errorStatus = null, errorMessage = null, roomCode = null,
    stakeText = null, potText = null, feeText = null, payoutText = null,
    feePct = 5, signature = null, cluster = 'devnet'
  } = {}) {
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

    if (delayed) {
      title.textContent = 'SETTLEMENT DELAYED';
      rows.innerHTML = `
        <div class="goStakeRow pending"><span>The on-chain payout is taking longer than expected.</span></div>
        <div class="goStakeRow pending"><span>Your funds are safe. This match will be resolved shortly.</span></div>
        ${roomCode ? `<div class="goStakeRow"><span>Room code (for support)</span><span class="val">${roomCode}</span></div>` : ''}`;
      tx.style.display = 'none';
      return;
    }

    if (error) {
      title.textContent = 'SETTLEMENT NEEDS REVIEW';
      const friendly = ({
        error_payout_failed:            'The winner payout transaction failed on-chain.',
        error_refund_failed:            'The refund transaction failed on-chain.',
        error_missing_data:             'Some room data was missing when settlement ran.',
        error_unknown_tier:             'The stake tier on this room could not be resolved.',
        error_winner_not_found:         'The winner\u2019s wallet was not found on the room record.',
        error_insufficient_stakes:      'Not enough valid stakes were locked on-chain to settle.',
        error_hot_wallet_short:         'Not enough funds in the Treasury hot wallet to complete the payout.',
        error_deposit_verification_failed: 'One or more stakes could not be verified on-chain, so the match was blocked.',
      })[errorStatus] || 'Settlement did not complete on-chain.';
      rows.innerHTML = `
        <div class="goStakeRow pending"><span>${friendly}</span></div>
        <div class="goStakeRow pending"><span>Your funds are safe in the Treasury hot wallet and will be resolved manually.</span></div>
        ${roomCode ? `<div class="goStakeRow"><span>Room code (for support)</span><span class="val">${roomCode}</span></div>` : ''}
        ${errorStatus ? `<div class="goStakeRow"><span>Reason</span><span class="val">${errorStatus}</span></div>` : ''}`;
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

    title.textContent = won ? 'ROARS OF VICTORY' : 'MATCH SETTLEMENT';
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

  // Called when a wallet connects in an ISOLATED session (Solflare/Phantom's
  // own in-app browser) and syncs back to this account via the link-code
  // bridge (see main.js _watchWalletLinkSync). This tab's walletManager
  // never actually connected anything itself - just reflect the now-synced
  // address in the UI the same way a real connection would display.
  showWalletSynced(address) {
    this.setWalletModalState('connected');
    this.updateWalletDisplay(address, null, 'synced');
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

  showActiveRoomModal(roomCode) {
    const modal = document.getElementById('activeRoomModal');
    const code = document.getElementById('activeRoomCode');
    if (code) code.textContent = roomCode || '';
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  hideActiveRoomModal() {
    const modal = document.getElementById('activeRoomModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

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
  _openModeSelectModal() {
    const m = document.getElementById('mpModeSelectModal');
    if (m) m.classList.add('open');
    if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
  }
  _closeModeSelectModal() {
    const m = document.getElementById('mpModeSelectModal');
    if (m) m.classList.remove('open');
  }

  showFFACountdown(seconds = 60) {
    const widget = document.getElementById('ffaCountdownWidget');
    const legacy = document.getElementById('ffaStartCountdown');
    this._ffaCdTotal = seconds;
    if (widget) {
      widget.style.display = 'flex';
      const num = document.getElementById('ffaCdSeconds');
      const fill = document.getElementById('ffaCdFill');
      if (num) num.textContent = seconds;
      if (fill) fill.style.width = '100%';
    } else if (legacy) {
      legacy.style.display = 'block';
      const num = document.getElementById('ffaCdSeconds');
      const fill = document.getElementById('ffaCdFill');
      if (num) num.textContent = seconds;
      if (fill) fill.style.width = '100%';
    }
  }
  updateFFACountdown(seconds) {
    const num = document.getElementById('ffaCdSeconds');
    const fill = document.getElementById('ffaCdFill');
    const total = this._ffaCdTotal || 60;
    if (num) num.textContent = Math.max(0, seconds);
    if (fill) fill.style.width = `${Math.max(0, (seconds / total) * 100)}%`;
  }
  hideFFACountdown() {
    const widget = document.getElementById('ffaCountdownWidget');
    const legacy = document.getElementById('ffaStartCountdown');
    if (widget) widget.style.display = 'none';
    if (legacy) legacy.style.display = 'none';
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

  _updateScrollHint(screenEl) {
    if (!screenEl || screenEl.id !== 'lobbyScreen') return;
    let hint = document.getElementById('lobbyScrollHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'lobbyScrollHint';
      hint.innerHTML = '<i data-lucide="chevrons-down"></i>';
      hint.addEventListener('click', () => { try { screenEl.scrollBy({ top: screenEl.clientHeight * 0.7, behavior: 'smooth' }); } catch (_) {} });
      screenEl.appendChild(hint);
      if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
      if (!this._lobbyScrollBound) {
        this._lobbyScrollBound = true;
        screenEl.addEventListener('scroll', () => {
          const nearBottom = screenEl.scrollTop + screenEl.clientHeight >= screenEl.scrollHeight - 40;
          const h = document.getElementById('lobbyScrollHint');
          if (h) h.style.opacity = nearBottom ? '0' : '1';
        });
      }
    }
    const canScroll = screenEl.scrollHeight > screenEl.clientHeight + 40;
    hint.style.display = canScroll ? 'flex' : 'none';
    hint.style.opacity = '1';
  }

  async _loadLeaderboard() {
    const list = document.getElementById('lbList');
    if (!list) return;
    list.innerHTML = '<div class="lbLoading">Loading rankings...</div>';
    if (!this._db) {
      list.innerHTML = '<div class="lbLoading">Sign in to view the leaderboard.</div>';
      return;
    }
    try {
      const snap = await this._db.ref('users').once('value');
      const users = snap.val() || {};
      // Use entries (not values) so we keep each record's UID — that's how
      // we reliably know which row is the signed-in player, instead of
      // guessing off the username string (which can collide/confuse if two
      // accounts have similar names).
      const rows = Object.entries(users)
        .filter(([uid, u]) => u && u.username)
        .map(([uid, u]) => ({
          uid,
          name: u.username,
          kills: u.dragonKills || 0,
          wins: u.multiplayerWins || 0,
          matches: u.matchesPlayed || 0,
          sovereign: !!u.sovereignRank,
          isYou: !!this._uid && uid === this._uid,
        }))
        .sort((a, b) => (b.kills + b.wins * 5) - (a.kills + a.wins * 5))
        .slice(0, 50);

      if (rows.length === 0) {
        list.innerHTML = '<div class="lbLoading">No players yet — be the first!</div>';
        return;
      }
      list.innerHTML = rows.map((r, i) => {
        const nameHtml = r.sovereign
          ? '<span class="sovereignBadge"><i class="fa-solid fa-crown"></i></span><span class="sovereignName">' + r.name + '</span>'
          : '<span>' + r.name + '</span>';
        const youTag = r.isYou ? '<span class="lbYouTag">YOU</span>' : '';
        const rowClass = 'lbRow' + (r.sovereign ? ' isSovereign' : '') + (r.isYou ? ' isYou' : '');
        return '<div class="' + rowClass + '" data-uid="' + r.uid + '">'
          + '<div class="lbRank">' + (i + 1) + '</div>'
          + '<div class="lbName">' + nameHtml + youTag + '</div>'
          + '<div class="lbStats">'
          + '<span><i class="fa-solid fa-skull"></i>' + r.kills + '</span>'
          + '<span><i class="fa-solid fa-trophy"></i>' + r.wins + '</span>'
          + '<span><i class="fa-solid fa-gamepad"></i>' + r.matches + '</span>'
          + '</div></div>';
      }).join('');
      if (typeof lucide !== 'undefined') {
      if (this._lucidePending) cancelAnimationFrame(this._lucidePending);
      this._lucidePending = requestAnimationFrame(() => { this._lucidePending = null; lucide.createIcons(); });
    }
      // Attach click handlers to leaderboard rows for MP profile modal
      list.querySelectorAll(".lbRow[data-uid]").forEach(row => {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => this._showLbProfile(row.dataset.uid));
      });
    } catch (e) {
      list.innerHTML = '<div class="lbLoading">Could not load leaderboard.</div>';
    }
  }

  async _showLbProfile(uid) {
    if (!this._db || !uid) return;
    const modal = document.getElementById('lbProfileModal');
    if (!modal) return;
    // Show modal with loading state
    modal.style.display = 'flex';
    document.getElementById('lbProfileName').textContent = 'Loading...';
    document.getElementById('lbProfileRank').textContent = '';
    document.getElementById('lbProfilePlayed').textContent = '-';
    document.getElementById('lbProfileWon').textContent = '-';
    document.getElementById('lbProfileLost').textContent = '-';
    try {
      const snap = await this._db.ref('users/' + uid).once('value');
      const u = snap.val() || {};
      const name = u.username || 'Unknown Player';
      const played = u.mpMatchesPlayed || 0;
      const won = u.multiplayerWins || 0;
      const lost = Math.max(0, played - won);
      const isSovereign = !!u.sovereignRank;
      // Determine rank name
      let rankName = 'Wingling';
      if (isSovereign) rankName = 'Infinite Sovereign';
      else if (u.highestTierCleared) {
        const tierNames = ['Wingling','Emberborn','Stormcrest','Frostfang','Voidwalker','Infinite Sovereign'];
        const idx = Math.min(u.highestTierCleared, tierNames.length - 1);
        rankName = tierNames[idx] || 'Wingling';
      }
      // Name with crown if sovereign
      const nameEl = document.getElementById('lbProfileName');
      nameEl.innerHTML = isSovereign
        ? '<span style="color:#ffd700;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:2px;"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg>' + name + '</span>'
        : name;
      document.getElementById('lbProfileRank').textContent = rankName;
      document.getElementById('lbProfilePlayed').textContent = played;
      document.getElementById('lbProfileWon').textContent = won;
      document.getElementById('lbProfileLost').textContent = lost;
    } catch (e) {
      document.getElementById('lbProfileName').textContent = 'Failed to load';
    }
  }

  _closeLbProfile() {
    const modal = document.getElementById('lbProfileModal');
    if (modal) modal.style.display = 'none';
  }


  showScreen(screenId) {
    const requested = this.screens[screenId];
    const safeTarget = requested || this.screens.titleScreen;
    if (!safeTarget) {
      console.error(`[UI] Cannot show missing screen: ${screenId}`);
      return;
    }
    if (!requested) {
      console.error(`[UI] Missing screen ${screenId}; returning to title screen.`);
      screenId = 'titleScreen';
    }
    // Close any open modal overlays when switching screens
    const lbProfile = document.getElementById('lbProfileModal');
    if (lbProfile) lbProfile.style.display = 'none';
    const profile = document.getElementById('profileModal');
    if (profile) profile.classList.remove('active');
    const exitDialog = this._mpExitDialog || document.getElementById('mpExitDialog');
    if (exitDialog) exitDialog.classList.remove('active');
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.classList.remove('active');
    Object.values(this.screens).forEach(s => { if (s) s.classList.remove('active'); });
    safeTarget.classList.add('active');
    this.currentScreen = screenId;
    this.eventBus.emit('ui:screenChanged', { screenId });
    if (typeof lucide !== 'undefined') {
      if (this._lucidePending) cancelAnimationFrame(this._lucidePending);
      this._lucidePending = requestAnimationFrame(() => { this._lucidePending = null; lucide.createIcons(); });
    }
    const _shown = this.screens[screenId];
    if (_shown) {
      try { _shown.scrollTop = 0; } catch (_) {}
      setTimeout(() => { try { _shown.scrollTop = 0; } catch (_) {} this._updateScrollHint(_shown); }, 60);
    }
    this._lastScreenSwitch = Date.now();
    if (screenId === 'leaderboardScreen') this._loadLeaderboard();
    if (screenId === 'dragonSelectScreen') {
      // Re-render carousel so newly-cleared tiers show as unlocked
      // immediately without needing a page refresh.
      if (this._progressReady) {
        this._progressReady.then(() => this.renderCarousel()).catch(() => this.renderCarousel());
      } else {
        this.renderCarousel();
      }
    }
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

  showOpponentFound({ tier, yourName, yourDragon, opponentName, opponentDragon } = {}) {
    const amounts = { Small: 10000, Medium: 100000, High: 1000000 };
    const disp = document.getElementById('oppFoundTierDisplay');
    if (disp) disp.textContent = `${Number(amounts[tier] || 0).toLocaleString()} INFINITE EACH`;
    const yourNameEl = document.getElementById('oppFoundYourName');
    if (yourNameEl) yourNameEl.textContent = yourName || 'You';
    this._setOpponentFoundPortrait('oppFoundYourDragon', yourDragon);
    this.updateOpponentFoundRival({ name: opponentName, dragon: opponentDragon });
    this.showScreen('opponentFoundScreen');
    if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
  }

  updateOpponentFoundRival({ name, dragon } = {}) {
    const nameEl = document.getElementById('oppFoundOpponentName');
    if (nameEl) nameEl.textContent = name || 'Opponent';
    this._setOpponentFoundPortrait('oppFoundOpponentDragon', dragon);
  }

  _setOpponentFoundPortrait(id, dragon) {
    const img = document.getElementById(id);
    if (!img) return;
    const source = DRAGON_IMAGES[String(dragon || '').toLowerCase()];
    if (source) {
      img.src = source;
      img.style.display = 'block';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }

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
    if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
  }

  updateAutoMatchHud({ enabled = false, ready = 0, total = 2, deadlineAt = 0, startAt = 0 } = {}) {
    clearInterval(this._autoMatchHudTimer);
    const hud = document.getElementById('autoMatchReadyHud');
    const count = document.getElementById('autoMatchReadyCount');
    const time = document.getElementById('autoMatchDeadlineText');
    const waiting = document.getElementById('lobbyWaitingText');
    if (!hud) return;
    hud.style.display = enabled ? 'grid' : 'none';
    if (!enabled) return;
    this._autoMatchHudTimer = setInterval(() => {
      this.updateAutoMatchHud({ enabled, ready, total, deadlineAt, startAt });
    }, 1000);
    const now = Date.now();
    const inStartCountdown = Number(startAt) > now;
    const remainingMs = inStartCountdown ? Number(startAt) - now : Math.max(0, Number(deadlineAt || 0) - now);
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    if (count) count.textContent = `${ready}/${total}`;
    if (time) time.textContent = inStartCountdown
      ? `MATCH STARTS IN ${seconds}`
      : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    hud.classList.toggle('countdown', inStartCountdown);
    if (waiting) {
      waiting.style.display = 'block';
      waiting.textContent = inStartCountdown ? 'Both stakes confirmed — preparing arena…' : 'Waiting for both players to stake…';
    }
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
