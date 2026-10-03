/* UI only: no balances, prices, payment sessions or stakes are inferred. */
(() => {
  const launch = document.getElementById('btnCashWallet');
  if (!launch) return;
  const field = (id,label) => `<label for="${id}">${label}</label><div class="irCashInput"><span aria-hidden="true">$</span><input id="${id}" data-cash-amount type="text" inputmode="decimal" maxlength="12" placeholder="0.00" autocomplete="off" spellcheck="false" aria-describedby="${id}Help"></div><p id="${id}Help" class="irCashFieldHelp">USD · enter up to two decimal places.</p>`;
  const art = `<svg class="irCashCoinArt" viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="32"/><circle cx="40" cy="40" r="26"/><path d="M45 27h-8a7 7 0 0 0 0 14h6a7 7 0 0 1 0 14H33M40 21v40"/></svg>`;
  const wallet = document.createElement('dialog');
  wallet.className = 'irCash';
  wallet.setAttribute('aria-labelledby','irCashTitle');
  wallet.innerHTML = `
    <header><button class="irCashBack" type="button" data-back aria-label="Back" hidden>‹</button><div><span class="irCashEyebrow">INFINITE RUNNERS</span><h2 id="irCashTitle" tabindex="-1">Cash Wallet</h2></div><button class="irCashClose" type="button" data-close aria-label="Close">×</button></header>
    <div class="irCashBody">
      <section data-view="home"><div class="irCashBalance"><span>AVAILABLE CASH</span><strong>— <small>USD</small></strong><p>Cash wallet opens when payments launch.</p><div class="irCashBreakdown"><span>In matches <b>—</b></span><span>Withdrawable <b>—</b></span></div></div><div class="irCashActions"><button type="button" data-go="deposit"><span aria-hidden="true">+</span><strong>Add Cash</strong><small>Fund your game balance</small></button><button type="button" data-go="withdraw"><span aria-hidden="true">↗</span><strong>Withdraw</strong><small>Choose where to receive funds</small></button></div><button class="irCashHistoryLink" type="button" data-go="history">Transaction history <span aria-hidden="true">›</span></button><p class="irCashFootnote">Your cash balance is separate from your connected Phantom wallet.</p></section>
      <section data-view="deposit" hidden><div class="irCashFlowIntro"><span>FUND YOUR WALLET</span><h3>Add Cash</h3><p>Choose the amount you want to add.</p></div>${field('irCashDeposit','Deposit amount (USD)')}<div class="irCashPresets">${[5,10,25,50].map(n=>`<button type="button" data-amount="${n}">$${n}</button>`).join('')}</div><div class="irCashSummary"><span>Entered amount</span><output data-total="irCashDeposit">—</output></div><div class="irCashServiceState"><strong>Deposits open soon</strong><p>Available payment methods and the full payment total will appear here before you pay.</p></div><button class="irCashPrimary" type="button" disabled>Deposits not available yet</button></section>
      <section data-view="withdraw" hidden><div class="irCashFlowIntro"><span>RECEIVE YOUR FUNDS</span><h3>Withdraw Cash</h3><p>Select an amount and receiving method.</p></div>${field('irCashWithdraw','Withdrawal amount (USD)')}<label for="irCashMethod">Receive through</label><select id="irCashMethod"><option value="fiat">Bank / card</option><option value="crypto">USDC wallet</option></select><p id="irCashFiat">Supported bank and card payouts will appear based on your location.</p><div id="irCashDestination" hidden><label for="irCashAddress">Receiving wallet address</label><input id="irCashAddress" type="text" placeholder="Your receiving address" autocomplete="off" spellcheck="false"><p>The supported USDC network and address must be confirmed before withdrawal.</p></div><div class="irCashServiceState"><strong>Withdrawals open soon</strong><p>Your available balance, payout fee and receiving amount will be confirmed before you submit.</p></div><button class="irCashPrimary" type="button" disabled>Withdrawals not available yet</button></section>
      <section data-view="buy" hidden><div class="irCashShopHero">${art}<span>TOKEN SHOP</span><h3>BUY INFINITE</h3><p>Purchase tokens into your in-game INFINITE balance.</p></div>${field('irCashBuy','Spend (USD)')}<div class="irCashServiceState"><strong>Token shop opens soon</strong><p>Purchases are not available yet. The INFINITE amount, exchange rate and fees will appear before you pay.</p></div><button class="irCashPrimary" type="button" disabled>Token purchases not available yet</button></section>
      <section data-view="stake" hidden><div class="irCashShopHero">${art}<span>DRAGONS ARENA</span><h3>STAKE CASH</h3><p>Enter a cash match using your in-game balance.</p></div><div class="irCashSummary"><span>Available cash</span><strong>Not active yet</strong></div><div class="irCashRules"><span>WINNER RECEIVES <b>95% of the match pot</b></span><span>TREASURY FEE <b>5% of the match pot</b></span></div><div class="irCashServiceState"><strong>Cash matches open soon</strong><p>Cash entry amounts and the full match pot will appear here when cash matches are enabled.</p></div><button class="irCashPrimary" type="button" disabled>Cash staking not available yet</button><button class="irCashSecondary" type="button" data-go="deposit">Add Cash</button></section>
      <section data-view="history" hidden><div class="irCashFlowIntro"><span>YOUR ACTIVITY</span><h3>Transaction history</h3></div><div class="irCashEmpty"><span aria-hidden="true">◇</span><strong>No cash activity available</strong><p>Your deposits, match settlements and withdrawals will appear here when cash payments launch.</p></div></section>
    </div>`;
  document.body.append(wallet);
  const titles = {home:'Cash Wallet',deposit:'Add Cash',withdraw:'Withdraw Cash',buy:'BUY INFINITE',stake:'STAKE CASH',history:'Activity'};
  let current = 'home', trail = [], opener = launch;
  const show = (view,remember=true) => {
    if (!titles[view]) return;
    if (remember) trail.push(current);
    current = view;
    wallet.querySelectorAll('[data-view]').forEach(el=>{el.hidden=el.dataset.view!==view;});
    wallet.querySelector('#irCashTitle').textContent=titles[view];
    wallet.querySelector('[data-back]').hidden=trail.length===0;
    wallet.querySelector('.irCashBody').scrollTop=0;
    if(wallet.open) wallet.querySelector('#irCashTitle').focus({preventScroll:true});
  };
  const fitViewport=()=>{
    if(!wallet.open) return;
    const v=window.visualViewport;
    wallet.style.setProperty('--irCashViewport',`${v?.height||window.innerHeight}px`);
    wallet.style.setProperty('--irCashViewportTop',`${v?.offsetTop||0}px`);
    const active=document.activeElement;
    if(active?.matches('[data-cash-amount]')) active.scrollIntoView({block:'nearest'});
  };
  const open=(button,view)=>{
    opener=button;trail=[];show(view,false);
    if(!wallet.open) wallet.showModal();
    fitViewport();wallet.querySelector('#irCashTitle').focus({preventScroll:true});
  };
  launch.addEventListener('click',()=>open(launch,'home'));
  const shop=document.getElementById('btnBuyInfinite');
  shop?.addEventListener('click',()=>open(shop,'buy'));
  ['matchmakingTierScreen','lobbyScreen','bettingArenaScreen'].forEach(id=>{
    const screen=document.getElementById(id);if(!screen)return;
    const entry=document.createElement('div');entry.className='irCashStakeAccess';
    const button=document.createElement('button');button.type='button';button.className='irCashStakeLaunch';
    button.innerHTML=`${art}<span class="irCashStakeLabel"><strong>STAKE CASH</strong><small>USD · ARENA ENTRY</small></span><span class="irCashStakeArrow" aria-hidden="true">›</span>`;
    button.addEventListener('click',()=>open(button,'stake'));
    const note=document.createElement('p');note.textContent='Cash matches coming soon';
    entry.append(button,note);
    const stake=screen.querySelector('#lobbyDepositBtn, #baPlaceBetBtn');
    if(stake)stake.before(entry);else screen.append(entry);
  });
  const updateAmount=input=>{
    const value=input.value.trim(),valid=/^\d+(?:[.,]\d{0,2})?$/.test(value);
    input.setAttribute('aria-invalid',String(value!==''&&!valid));
    const total=wallet.querySelector(`[data-total="${input.id}"]`);
    if(total)total.textContent=valid?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value.replace(',','.'))):'—';
  };
  wallet.addEventListener('close',()=>opener.focus());
  wallet.addEventListener('click',event=>{
    event.stopPropagation();const b=event.target.closest('button');
    if(b?.hasAttribute('data-close'))wallet.close();
    else if(b?.hasAttribute('data-back')&&trail.length)show(trail.pop(),false);
    else if(b?.dataset.go)show(b.dataset.go);
    else if(b?.dataset.amount){const input=wallet.querySelector('#irCashDeposit');input.value=b.dataset.amount;updateAmount(input);}
    if(event.target===wallet){const r=wallet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)wallet.close();}
  });
  wallet.addEventListener('input',event=>{if(event.target.matches('[data-cash-amount]'))updateAmount(event.target);});
  wallet.querySelector('#irCashMethod').addEventListener('change',event=>{
    const fiat=event.target.value==='fiat';wallet.querySelector('#irCashDestination').hidden=fiat;wallet.querySelector('#irCashFiat').hidden=!fiat;
  });
  window.visualViewport?.addEventListener('resize',fitViewport);
  window.visualViewport?.addEventListener('scroll',fitViewport);
})();
