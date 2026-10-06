const fs=require('fs'),vm=require('vm'),assert=require('assert');
const read=()=>({style:{},classList:{add(){},remove(){}},textContent:''});const nodes={freeMatchStatus:read(),btnFreeFindOpponent:read()};
const document={getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],addEventListener(){}};
let src=fs.readFileSync('src/main.js','utf8');src=src.slice(src.indexOf('class Game {'),src.lastIndexOf("window.addEventListener('DOMContentLoaded'"));
const Game=vm.runInNewContext(src+';Game',{document,console,CONFIG:{MAX_PLAYERS:{'1v1':2}},firebase:{database:{ServerValue:{TIMESTAMP:1}}},setTimeout,clearTimeout,setInterval,clearInterval,Map,Set,Date,Promise});
const flush=()=>new Promise(r=>setImmediate(r));
function game(){const g=Object.create(Game.prototype);g.uiManager={setAccount(){},setFreeMatchStatus(message,action,disabled){g.status={message,action,disabled};},showScreen(s){g.screen=s;},setMatchedLobbyMode(){},updateLobbyArena(){},resetLobbyState(){}};g.effectsSystem={startSearchSound(){g.sound=true;},stopSearchSound(){g.sound=false;},playOpponentFoundSound(){g.found=true;}};g.eventBus={on(k,fn){this.callbacks[k]=fn;},emit(k,v){return this.callbacks[k]?.(v);},callbacks:{}};return g;}
(async()=>{
 let g=game();g.db={};g.auth={currentUser:null,signInAnonymously:async()=>({user:{uid:'guest123',isAnonymous:true}})};await g._ensureFreeIdentity();assert.equal(g.authUid,'guest123');assert.equal(g.isGuest,true);
 g.auth.currentUser={uid:'real',isAnonymous:false};await assert.rejects(()=>g._ensureFreeIdentity());
 g=game();g.setupEventListeners();g._releaseStaleRoomForMatchmaking=async()=>{};g._ensureFreeIdentity=async()=>{};let searches=0,cancels=0;
 g.matchmaking={async startSearch(tier){assert.equal(tier,'Free');searches++;g.eventBus.emit('matchmaking:matched',{tier:'Free',matchId:'m',roomCode:'123456',roomReady:false});},async cancelSearch(){cancels++;}};
 await g.eventBus.emit('ui:freeSearch');assert.equal(searches,1);assert.equal(cancels,0);assert.equal(g.status.action,'PREPARING');
 g._pendingMatch=null;g._freeSearching=true;await g.eventBus.emit('ui:freeSearch');assert.equal(cancels,1);assert.equal(g.sound,false);
 g=game();g.authUid='guest123';g.isGuest=true;g.selectedDragon='infinite';g._stopFFACountdown=()=>{};g._ensurePresence=()=>{};g._persistLastRoom=()=>{};g._attachRoomListener=()=>{};
 const room={status:'waiting',freeMatch:true,mode:'1v1',tier:null,matchId:'m',arenaIndex:0,players:{guest123:{authUid:'guest123'},guest456:{authUid:'guest456'}}};let ack=false,assets=false;
 const ref={once:async()=>({exists:()=>true,val:()=>room}),child:path=>({set:async value=>{assert(assets,'must preload before readiness');assert.equal(path,'players/guest123/freeReadyMatchId');assert.equal(value,'m');ack=true;}})};
 g.db={ref:()=>ref};g._ensureGameAssetsReady=async(dragon,arena)=>{assert.equal(arena,0);assets=true;};await g.joinRoom('123456');assert.equal(g.screen,'freeMatchScreen');assert.equal(g.localPlayerId,'guest123');assert(ack);assert(g._freeMatch);
 g=game();g._freeMatch=true;g.roomRef={child(){throw Error('free must not watch wallet settlement');}};g._watchSettlement();
 console.log('PASS: anonymous guests stay guests, real accounts are not converted, real free search handler submits Free and retains paired matches, cancellation stops sound, free room join skips paid UI and acknowledges only after Stone Castle preload, free wallet settlement listener is skipped.');
})().catch(e=>{console.error(e);process.exit(1)});
