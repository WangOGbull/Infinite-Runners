/* UI only: financial state must come from an authenticated backend. */
(() => {
  const launch = document.getElementById('btnCashWallet');
  if (!launch) return;
  const wallet = document.createElement('dialog');
  wallet.className = 'irCash';
  wallet.setAttribute('aria-labelledby', 'irCashTitle');
  wallet.innerHTML = `
    <header><div><span class="irCashEyebrow">INFINITE RUNNERS</span><h2 id="irCashTitle">Cash Wallet</h2></div><button type="button" data-close aria-label="Close cash wallet">×</button></header>
    <div class="irCashBody">
      <p class="irCashNotice">Cash payments are coming soon. Your connected Phantom wallet and staking balance remain separate.</p>
      <section class="irCashBalance" aria-label="Cash balance"><span>AVAILABLE CASH</span><strong>$0.00 <small>USD</small></strong><p>USDC-backed balance</p><div class="irCashBreakdown"><span>In matches <b>$0.00</b></span><span>Withdrawable <b>$0.00</b></span></div></section>
      <nav class="irCashTabs" aria-label="Wallet actions"><button type="button" data-tab="deposit" aria-pressed="true">Add Cash</button><button type="button" data-tab="withdraw" aria-pressed="false">Withdraw</button><button type="button" data-tab="buy" aria-pressed="false">BUY INFINITE</button></nav>
      <section data-panel="deposit"><h3>Add cash to your arena</h3><label for="irCashDeposit">Amount (USD)</label><div class="irCashInput"><span>$</span><input id="irCashDeposit" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00"></div><div class="irCashPresets">${[5,10,25,50].map(n => `<button type="button" data-amount="${n}">$${n}</button>`).join('')}</div><p>Payment methods, fees and the final credited amount will appear before you pay.</p><button class="irCashPrimary" type="button" disabled>Payments coming soon</button><p class="irCashFootnote">Your permanent deposit address will be assigned securely when the wallet service is enabled. Existing registered players will receive one too.</p></section>
      <section data-panel="withdraw" hidden><h3>Withdraw your balance</h3><label for="irCashWithdraw">Amount (USD)</label><div class="irCashInput"><span>$</span><input id="irCashWithdraw" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00"></div><label for="irCashMethod">Receive funds through</label><select id="irCashMethod"><option value="crypto">USDC wallet</option><option value="fiat">Bank / card</option></select><div id="irCashDestination"><label for="irCashAddress">Receiving wallet address</label><input id="irCashAddress" type="text" placeholder="Enter your receiving address" autocomplete="off" spellcheck="false"><p>Supported networks and address verification will be shown before withdrawal.</p></div><p id="irCashFiat" hidden>Available bank and card payout methods depend on your location and payment provider.</p><button class="irCashPrimary" type="button" disabled>Withdrawals coming soon</button></section>
      <section data-panel="buy" hidden><h3>BUY INFINITE</h3><p>Purchase INFINITE into your in-game balance.</p><label for="irCashBuy">Spend (USD)</label><div class="irCashInput"><span>$</span><input id="irCashBuy" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00"></div><div class="irCashQuote"><span>You receive <b>Quote unavailable</b></span><span>Fees <b>Shown with quote</b></span><span>INFINITE balance <b>Not connected</b></span></div><p>USDC cash and INFINITE tokens are separate balances. Token pricing and withdrawal terms will be shown before purchase.</p><button class="irCashPrimary" type="button" disabled>Purchases coming soon</button></section>
      <section class="irCashHistory"><h3>Transaction history</h3><div>No cash transactions yet.<p>Your deposits, match settlements and withdrawals will appear here.</p></div></section>
    </div>`;
  document.body.append(wallet);
  let selected = 'deposit';
  const show = name => {
    selected = name;
    wallet.querySelectorAll('[data-panel]').forEach(el => el.hidden = el.dataset.panel !== name);
    wallet.querySelectorAll('[data-tab]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.tab === name)));
  };
  let opener = launch;
  const openWallet = button => {
    opener = button;
    if (!wallet.open) { show(selected); wallet.showModal(); }
  };
  launch.addEventListener('click', () => openWallet(launch));
  // These controls open the preview without changing tiers, stakes or rooms.
  ['matchmakingTierScreen', 'lobbyScreen', 'bettingArenaScreen'].forEach(id => {
    const screen = document.getElementById(id);
    if (!screen) return;
    const entry = document.createElement('div');
    entry.className = 'irCashStakeAccess';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'irCashStakeLaunch';
    button.textContent = 'Cash Wallet / BUY INFINITE';
    button.addEventListener('click', () => openWallet(button));
    const note = document.createElement('p');
    note.textContent = 'Cash match entry coming soon. Current stakes use your connected token wallet.';
    entry.append(button, note);
    const stake = screen.querySelector('#lobbyDepositBtn, #baPlaceBetBtn');
    if (stake) stake.before(entry);
    else screen.append(entry);
  });
  wallet.querySelector('[data-close]').addEventListener('click', () => wallet.close());
  wallet.addEventListener('close', () => opener.focus());
  wallet.addEventListener('click', event => {
    event.stopPropagation();
    const button = event.target.closest('button');
    if (button?.dataset.tab) show(button.dataset.tab);
    if (button?.dataset.amount) wallet.querySelector('#irCashDeposit').value = button.dataset.amount;
    if (event.target === wallet) {
      const rect = wallet.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) wallet.close();
    }
  });
  wallet.querySelector('#irCashMethod').addEventListener('change', event => {
    const fiat = event.target.value === 'fiat';
    wallet.querySelector('#irCashDestination').hidden = fiat;
    wallet.querySelector('#irCashFiat').hidden = !fiat;
  });
})();
