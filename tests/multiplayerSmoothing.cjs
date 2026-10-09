const fs=require('fs'),assert=require('assert'),vm=require('vm');
(async()=>{
 const sync=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('src/remoteSync.js','utf8')).toString('base64'));
 const {advanceSendDeadline,getSnapshotDurationMs}=sync;
 for(const fps of [30,60,90,120]){
   let previous=0,sends=0;const interval=50;
   for(let frame=0;frame<fps*10;frame++){
     const now=1000+frame*1000/fps;
     if(previous && now-previous<interval)continue;
     previous=advanceSendDeadline(previous,now,interval);sends++;
   }
   assert(Math.abs(sends-200)<=1,`${fps}fps: ${sends} sends`);
 }
 assert.equal(advanceSendDeadline(1000,1030,50),1000);
 assert.equal(advanceSendDeadline(1000,3017,50),3000,'long stall skips missed deadlines');
 const previous={snapshotT:50000,streamId:'a'};
 for(const arrival of [25,50,180,220])assert.equal(getSnapshotDurationMs(previous,50050,'a',arrival),50);
 assert.equal(getSnapshotDurationMs(previous,50050,'b',120),120,'new stream uses arrival duration');
 assert.equal(getSnapshotDurationMs(previous,49000,'a',120),120,'clock discontinuity falls back');
 assert.equal(getSnapshotDurationMs(previous,50050,'',0),25,'legacy duration bounded');
 assert.equal(getSnapshotDurationMs(previous,51000,'a',800),250,'loss gap bounded');
 const pos={x:1,y:2,seq:2,t:100,streamId:'a'};
 assert(!sync.classifyRemoteSnapshot({seq:2,t:100,streamId:'a'},pos).accepted);
 let source=fs.readFileSync('src/main.js','utf8');
 source=source.slice(source.indexOf('class Game {'),source.lastIndexOf("window.addEventListener('DOMContentLoaded'"));
 let now=1000;const DateMock={now:()=>now};
 const Game=vm.runInNewContext(source+';Game',{Date:DateMock,REMOTE_SYNC:sync.REMOTE_SYNC,advanceSendDeadline,getSnapshotDurationMs,WebSocket:{OPEN:1},CONFIG:{DRAGON_MAX_SEGMENTS:50},console});
 const g=Object.create(Game.prototype);let sends=0;
 Object.assign(g,{positionsRef:{},localPlayerId:'p',localDragon:{head:{x:0,y:0},angle:0,segments:[{}],lives:3,alive:true},_realtimeReady:true,_realtimeSocket:{readyState:1,send:()=>sends++},_syncDiagnostics:{sent:0},_positionSequence:0,_updateConnectionStatusOverlay(){}});
 for(let frame=0;frame<600;frame++){now=1000+frame*1000/60;g.broadcastPosition();}
 assert(Math.abs(sends-200)<=1,'actual broadcast method maintains 20Hz at 60fps');
 g._settlementLocked=true;g.broadcastPosition();assert.equal(g._syncDiagnostics.sent,sends);
 console.log('PASS: 20Hz at 30/60/90/120fps; no catch-up bursts; jitter-independent sender durations; stream/clock/loss fallbacks; stale packet rejection; actual broadcast and settlement guard.');
})().catch(e=>{console.error(e);process.exit(1)});
