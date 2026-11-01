const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const ex={name:'侧平举',repMin:12,repMax:18,rir:3,perSide:true};
const section={id:'main',mode:'rounds',rounds:3,exercises:[ex]};
function context(){
  const growth={xp:0,levelIndex:1,upgradeStreak:0,hardStreak:0,history:[]};
  const ctx={WORKOUT_TARGET_MS:40*60*1000,sessionState:{active:{day:'push',variant:'A',startedAt:Date.now()}},performanceState:{sessions:{}},
    growthState:{dayXp:{push:0}},HomeProgression:require('./home-progression'),clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),exerciseSlug:n=>n,
    levelSnapshot:()=>null,levelConfig:()=>({levels:[{},{},{}]}),ensureGrowthEntry:()=>growth,
    getSectionsForVariant:()=>[section],adaptiveAdvice:()=>({mode:'normal'}),persistGrowth:()=>{},
    persistPerformance:()=>{},HomePlan:require('./home-plan')};
  vm.createContext(ctx);
  for(const name of ['recordedNumber','defaultRir','rirBounds','rirAllowsProgress','confirmStrengthRir','exerciseTargetRir','rirLabel','nextRoundAdvice','parseRepRange',
    'performanceSessionId','ensurePerformanceSession','performanceEntryKey','activePerformanceEntry',
    'savePerformanceEntry','latestFinalizedPerformance','baseRoundTargets','performanceAnalysis',
    'activePerformanceRows','targetForRound','finishSuggestion','processGrowthAfterSession',
    'roundHistoryHtml','latestRoundHistoryHtml','nextRoundPreviewText','repLogHtml']){
    const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);
    assert.ok(start>=0&&end>start,name);vm.runInContext(source.slice(start,end),ctx);
  }
  return {ctx,growth};
}
function record(ctx,rows,finalized=false){
  const session=ctx.ensurePerformanceSession();
  rows.forEach((row,i)=>{session.values[`main::${i+1}::侧平举`]={reps:13,...row};});
  session.finalized=finalized;return session;
}
test('unrecorded numbers remain unknown, and explicit zero is valid',()=>{
  const {ctx}=context();
  for(const value of [undefined,null,'',' ',NaN])assert.equal(ctx.recordedNumber(value),null);
  assert.equal(ctx.recordedNumber(0),0);assert.equal(ctx.recordedNumber('0'),0);
  assert.equal(ctx.exerciseTargetRir({rir:0}),0);assert.equal(ctx.exerciseTargetRir({}),2);
});
test('each round freezes its band load alongside level and setup revision',()=>{
  const {ctx}=context(),entry={levelIndex:1,xp:23,setupNote:'红带',history:[]},P=ctx.HomeProgression;
  ctx.levelSnapshot=()=>({index:1,current:{name:'中阻力侧平举'},entry});
  P.setBandLoad(entry,1,{min:15,max:15,unit:'kg',mode:'resistance'});
  ctx.savePerformanceEntry('main',1,ex.name,{reps:12,rir:null});
  const first=ctx.activePerformanceEntry('main',1,ex.name);
  P.setBandLoad(entry,1,{min:20,max:25,unit:'lb',mode:'resistance'});
  ctx.savePerformanceEntry('main',2,ex.name,{reps:10,rir:2});
  assert.equal(P.bandLabel(first.bandLoad),'阻力 15 kg');assert.equal(P.bandLabel(ctx.activePerformanceEntry('main',2,ex.name).bandLoad),'阻力 20–25 lb');
  assert.equal(P.sameSetup(first,entry,1),false);assert.equal(first.levelName,'中阻力侧平举');assert.equal(entry.xp,23);
  assert.match(ctx.roundHistoryHtml(section,ex,2),/阻力 15 kg/);
});
test('omitted RIR keeps the actual count through all three rounds',()=>{
  const {ctx}=context();record(ctx,[{rir:null}]);
  assert.equal(ctx.targetForRound('push','A',section,ex,2).target,13);
  ctx.savePerformanceEntry('main',2,ex.name,{reps:13,rir:null});
  assert.equal(ctx.targetForRound('push','A',section,ex,3).target,13);
  assert.match(ctx.nextRoundPreviewText(13,null,{max:18},3),/13次.*未记录/);
  assert.equal(ctx.finishSuggestion('push'),null);
});
test('meeting lateral raise RIR 3 holds the count in both preview and live target',()=>{
  const {ctx}=context();record(ctx,[{rir:3}]);
  assert.equal(ctx.targetForRound('push','A',section,ex,2).target,13);
  assert.match(ctx.nextRoundPreviewText(13,3,{max:18},3),/13次.*维持/);
  assert.equal(ctx.nextRoundAdvice(13,3,{max:18},2).target,14);
});
test('explicit failure retains the safety reduction and failure prompt',()=>{
  const {ctx}=context();record(ctx,[{reps:16,rir:0},{reps:14,rir:0}]);
  assert.equal(ctx.targetForRound('push','A',section,ex,3).target,12);
  assert.ok(ctx.finishSuggestion('push'));
});
test('time suggestions begin at 40 minutes while explicit failure remains independent of elapsed time',()=>{
  const {ctx}=context();
  for(const minutes of [26,30,35,39.99]){ctx.sessionState.active.startedAt=Date.now()-minutes*60000;assert.equal(ctx.finishSuggestion('push'),null);}
  ctx.sessionState.active.startedAt=Date.now()-40*60000;assert.match(ctx.finishSuggestion('push').reason,/40分钟/);
  const start=source.indexOf('  function workoutTimeAssessment('),end=source.indexOf('\n  function ',start+1);
  vm.runInContext(source.slice(start,end),ctx);
  assert.doesNotMatch(ctx.workoutTimeAssessment(35*60000),/超过|不足|20–30/);
  assert.match(ctx.workoutTimeAssessment(41*60000),/保留必要休息/);
});
test('historical missing RIR is retained without upgrading or treating it as failure',()=>{
  const {ctx,growth}=context();const session=record(ctx,[{rir:null},{rir:null},{rir:null}],true);
  const analysis=ctx.performanceAnalysis('push','A',section,ex);
  assert.equal(analysis.mode,'hold');assert.deepEqual(Array.from(analysis.targets),[13,13,13]);
  assert.equal(analysis.rows[0].rir,null);
  assert.match(ctx.roundHistoryHtml(section,ex,3),/RIR 未记录/);
  assert.match(ctx.latestRoundHistoryHtml(section,ex,3),/RIR 未记录/);
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'normal');
  assert.equal(growth.levelIndex,1);assert.equal(growth.hardStreak,0);assert.equal(growth.upgradeStreak,0);
});
test('historical targets compare against each action own RIR',()=>{
  const {ctx}=context();record(ctx,[{rir:3},{rir:3},{rir:3}],true);
  assert.deepEqual(Array.from(ctx.performanceAnalysis('push','A',section,ex).targets),[13,13,13]);
  assert.deepEqual(Array.from(ctx.performanceAnalysis('push','A',section,{...ex,rir:2}).targets),[14,14,14]);
});
test('unfinished appended rounds do not become finalized calibration rows',()=>{
  const {ctx}=context();const session=record(ctx,[{rir:3},{rir:3},{rir:3},{rir:0}],true);
  session.roundProgress={main:{completed:3,target:4}};
  const rows=ctx.latestFinalizedPerformance('push','A','main',ex.name).rows;
  assert.equal(rows.length,3);assert.equal(rows.at(-1).rir,3);
});
test('no RIR and low reps do not accumulate an automatic downgrade',()=>{
  const {ctx,growth}=context();const session=record(ctx,[{reps:6,rir:null},{reps:6,rir:''}],true);
  growth.hardStreak=1;ctx.processGrowthAfterSession(ctx.sessionState.active,session,'normal');
  assert.equal(growth.levelIndex,1);assert.equal(growth.hardStreak,0);
  assert.equal(ctx.performanceAnalysis('push','A',section,ex).mode,'hold');
});
test('explicit full rounds still permit an upgrade after two qualifying sessions',()=>{
  const {ctx,growth}=context();const session=record(ctx,Array.from({length:3},()=>({reps:18,rir:3})),true);
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'normal');assert.equal(growth.levelIndex,1);
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'normal');assert.equal(growth.levelIndex,2);
});
test('suggested reps are prefilled without saving them or selecting RIR; edits and clearing survive rendering',()=>{
  const {ctx}=context();const html=ctx.repLogHtml('push','A',section,ex,1,false);
  assert.match(html,/value="15" placeholder="填写" data-reps-input/);
  assert.equal(Object.keys(ctx.ensurePerformanceSession().values).length,0);
  assert.doesNotMatch(html,/class="rir-button active"/);assert.match(html,/rir-default active/);
  ctx.savePerformanceEntry('main',1,ex.name,{reps:13,rir:null});
  const saved=ctx.repLogHtml('push','A',section,ex,1,false);
  assert.match(saved,/value="13"/);assert.doesNotMatch(saved,/class="rir-button active"/);
  assert.match(ctx.repLogHtml('push','A',section,ex,2,false),/value="13" placeholder="填写"/);
  ctx.savePerformanceEntry('main',1,ex.name,{reps:0});
  assert.match(ctx.repLogHtml('push','A',section,ex,1,false),/value="0" placeholder="填写"/);
  ctx.savePerformanceEntry('main',1,ex.name,{reps:null});
  assert.match(ctx.repLogHtml('push','A',section,ex,1,false),/value="" placeholder="填写"/);
  assert.equal(ctx.activePerformanceRows('main',ex.name).length,0);
});

test('qualifying sessions propose an equipment transition without silently changing the level',()=>{
  const {ctx,growth}=context();ctx.levelConfig=()=>({levels:[{},{},{requiresSetup:true}]});
  const session=record(ctx,Array.from({length:3},()=>({reps:18,rir:3,levelIndex:1})),true);
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');
  const changes=ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');
  assert.equal(growth.levelIndex,1);assert.equal(growth.upgradeStreak,2);assert.match(changes[0],/确认/);
});

test('changed resistance resets historical targets and mismatched rows cannot upgrade or downgrade',()=>{
  const {ctx,growth}=context();growth.setupRevision=2;growth.upgradeStreak=1;
  ctx.levelSnapshot=()=>({index:1,current:{name:'加阻侧平举'},entry:growth});
  const session=record(ctx,Array.from({length:3},()=>({reps:18,rir:3,levelIndex:1,setupRevision:1})),true);
  assert.equal(ctx.performanceAnalysis('push','A',section,ex).mode,'new');
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');
  assert.equal(growth.levelIndex,1);assert.equal(growth.upgradeStreak,0);
  growth.hardStreak=1;session.values['main::1::侧平举']={reps:5,rir:0,levelIndex:1,setupRevision:1};
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');assert.equal(growth.levelIndex,1);assert.equal(growth.hardStreak,0);
});

test('new set entries snapshot exact setup; unilateral variants show per-side targets',()=>{
  const {ctx,growth}=context();Object.assign(growth,{setupNote:'蓝带，握持35cm',setupRevision:2});
  ctx.levelSnapshot=()=>({index:1,current:{name:'偏单侧辅助划船',perSide:true},entry:growth});
  ctx.savePerformanceEntry('main',1,ex.name,{reps:12,rir:null});
  const entry=ctx.activePerformanceEntry('main',1,ex.name);
  assert.equal(entry.setupNote,'蓝带，握持35cm');assert.equal(entry.setupRevision,2);
  assert.equal(ctx.parseRepRange({...ex,perSide:false}).perSide,true);assert.equal(entry.rir,null);
});

test('confirming a strength set saves the default range without inventing a precise RIR',()=>{
  const {ctx}=context();ctx.savePerformanceEntry('main',1,ex.name,{reps:13});
  assert.equal(ctx.activePerformanceEntry('main',1,ex.name).rirSource,undefined,'typing alone is not confirmation');
  ctx.confirmStrengthRir('main',1,ex.name);
  const row=ctx.activePerformanceEntry('main',1,ex.name);
  assert.equal(row.rir,null);assert.equal(row.rirSource,'default');assert.deepEqual(Array.from(row.rirRange),[1,2]);
  assert.equal(ctx.rirLabel(row),'1–2（默认）');assert.equal(ctx.rirLabel(null),'未记录');
  const before=JSON.stringify(row);ctx.confirmStrengthRir('main',1,ex.name);assert.equal(JSON.stringify(row),before);
  ctx.performanceState=JSON.parse(JSON.stringify(ctx.performanceState));
  assert.equal(ctx.rirLabel(ctx.activePerformanceEntry('main',1,ex.name)),'1–2（默认）');
  assert.match(ctx.roundHistoryHtml(section,ex,1),/RIR 1–2（默认）/);
  assert.match(ctx.latestRoundHistoryHtml(section,ex,1),/RIR 1–2（默认）/);
});

test('manual RIR including zero overrides default and can be returned to the range',()=>{
  const {ctx}=context();
  for(const rir of [0,1,2,3]){
    ctx.savePerformanceEntry('main',1,ex.name,{reps:13,...ctx.defaultRir()});
    ctx.savePerformanceEntry('main',1,ex.name,{rir});ctx.confirmStrengthRir('main',1,ex.name);
    const row=ctx.activePerformanceEntry('main',1,ex.name);
    assert.equal(row.rir,rir);assert.equal(row.rirSource,'manual');assert.equal(row.rirRange,undefined);
    assert.equal(ctx.rirLabel(row),rir===3?'3+':String(rir));
  }
  ctx.savePerformanceEntry('main',1,ex.name,ctx.defaultRir());
  assert.equal(ctx.rirLabel(ctx.activePerformanceEntry('main',1,ex.name)),'1–2（默认）');
  assert.equal(ctx.rirBounds({rir:null,rirSource:'default',rirRange:[0,3]}),null,'invalid range is not accepted');
});

test('default range never creeps reps upward or triggers an explicit-failure warning',()=>{
  const {ctx}=context();
  for(let round=1;round<=3;round++){
    ctx.savePerformanceEntry('main',round,ex.name,{reps:13});ctx.confirmStrengthRir('main',round,ex.name);
    assert.equal(ctx.targetForRound('push','A',section,{...ex,rir:2},round+1).target,13);
  }
  assert.match(ctx.nextRoundPreviewText(13,ctx.defaultRir(),{max:18},2),/13次.*默认RIR 1–2.*维持/);
  assert.equal(ctx.finishSuggestion('push'),null);
});

test('two full default-RIR sessions progress normally while target RIR 3 still requires explicit 3+',()=>{
  const {ctx,growth}=context(),normal={...ex,rir:2};
  ctx.getSectionsForVariant=()=>[{...section,exercises:[normal]}];
  let previousId;
  for(let run=0;run<2;run++){
    if(previousId)ctx.sessionState.active.startedAt++;
    const session=record(ctx,Array.from({length:3},()=>({reps:18,...ctx.defaultRir()})),true);
    if(previousId)assert.notEqual(ctx.performanceSessionId(session.startedAt),previousId);
    previousId=ctx.performanceSessionId(session.startedAt);
    assert.equal(ctx.performanceAnalysis('push','A',section,normal).mode,'progress');
    ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');
    assert.equal(growth.levelIndex,run===0?1:2);
  }
  const other=context();const session=record(other.ctx,Array.from({length:3},()=>({reps:18,...other.ctx.defaultRir()})),true);
  assert.equal(other.ctx.performanceAnalysis('push','A',section,ex).mode,'hold');
  other.ctx.processGrowthAfterSession(other.ctx.sessionState.active,session,'right');assert.equal(other.growth.upgradeStreak,0);
  assert.equal(ctx.rirAllowsProgress({rir:1},2),true,'manual 1 and default 1–2 use the same minimum');
});

test('default RIR preserves fatigue, setup-transition and incomplete-round guards',()=>{
  const {ctx,growth}=context();ctx.getSectionsForVariant=()=>[{...section,exercises:[{...ex,rir:2}]}];
  let session=record(ctx,[{reps:18,...ctx.defaultRir()},{reps:12,...ctx.defaultRir()},{reps:12,...ctx.defaultRir()}],true);
  assert.equal(ctx.performanceAnalysis('push','A',section,{...ex,rir:2}).mode,'fatigue');
  session=record(ctx,Array.from({length:3},()=>({reps:18,...ctx.defaultRir()})),true);
  session.roundProgress={main:{completed:2}};
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');assert.equal(growth.upgradeStreak,0);
  session.roundProgress.main.completed=3;ctx.levelConfig=()=>({levels:[{},{},{requiresSetup:true}]});
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'hard');assert.equal(growth.upgradeStreak,0);
  ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');
  const changes=ctx.processGrowthAfterSession(ctx.sessionState.active,session,'right');
  assert.equal(growth.levelIndex,1);assert.equal(growth.upgradeStreak,2);assert.match(changes[0],/确认/);
});

test('legacy unknown sets and timers are not retroactively assigned default RIR',()=>{
  const {ctx}=context();record(ctx,[{rir:null},{rir:''}],true);
  const before=JSON.stringify(ctx.performanceState);
  ctx.performanceAnalysis('push','A',section,ex);assert.match(ctx.roundHistoryHtml(section,ex,2),/未记录/);
  assert.equal(JSON.stringify(ctx.performanceState),before);
  ctx.savePerformanceEntry('warmup',1,'热身活动',{reps:null,rir:null,timerSeconds:180,completed:true});
  const timed=ctx.activePerformanceEntry('warmup',1,'热身活动');
  assert.equal(timed.rirSource,undefined);assert.equal(timed.rirRange,undefined);
  assert.equal(ctx.rirLabel(timed),'未记录');
});

test('real round-button and RIR handlers save defaults, allow overrides and retain input on error',()=>{
  const {ctx}=context(),listeners=new Map(),input={value:'13'},preview={innerHTML:''};
  const makeButton=dataset=>({dataset,classList:{toggle(){}},addEventListener(type,fn){listeners.set(this,fn);},hasAttribute(name){return name==='data-rir-value'&&this.dataset.rirValue!==undefined;}});
  const complete=makeButton({completeRound:'push::A::main',round:'1'}),fallback=makeButton({sectionId:'main',round:'1',exerciseName:ex.name});
  const zero=makeButton({...fallback.dataset,rirValue:'0'}),three=makeButton({...fallback.dataset,rirValue:'3'});
  const picker={querySelectorAll:()=>[fallback,zero,three]};
  const log={classList:{remove(){},add(){}},dataset:{repMin:'12',repMax:'18',targetRir:'2'},querySelector(selector){return selector==='[data-reps-input]'?input:selector==='[data-next-round-preview]'?preview:null;}};
  for(const b of [fallback,zero,three])b.closest=selector=>selector==='.rep-log'?log:picker;
  const root={querySelectorAll(selector){return selector==='[data-complete-round]'?[complete]:selector==='[data-rir-value]'?[zero,three]:selector==='[data-rir-default]'?[fallback]:[];},querySelector:()=>log};
  let completed=0,renders=0,rests=0,message='';
  Object.assign(ctx,{getSections:()=>[section],getVariant:()=> 'A',isWarmupRound:()=>false,activePhase:()=> 'main',completedRounds:()=>completed,pendingWorkoutEnd:null,CSS:{escape:x=>x},doneState:{},persistDone(){completed++;},persistRoundProgress(){},beep(){},renderDay(){renders++;},startRestTimer(){rests++;},advanceRoundExercise(){},showToast(x){message=x;}});
  for(const name of ['refreshNextRoundPreview','bindPanelEvents']){
    const a=source.indexOf(`  function ${name}(`),b=source.indexOf('\n  function ',a+1);vm.runInContext(source.slice(a,b),ctx);
  }
  ctx.bindPanelEvents(root);
  listeners.get(zero)();assert.equal(ctx.activePerformanceEntry('main',1,ex.name).rir,0);
  listeners.get(fallback)();assert.equal(ctx.rirLabel(ctx.activePerformanceEntry('main',1,ex.name)),'1–2（默认）');
  assert.match(preview.innerHTML,/默认RIR 1–2/);
  listeners.get(three)();assert.equal(ctx.activePerformanceEntry('main',1,ex.name).rir,3);
  listeners.get(fallback)();listeners.get(complete)();
  assert.equal(completed,1);assert.equal(renders,1);assert.equal(rests,1);
  assert.equal(ctx.rirLabel(ctx.activePerformanceEntry('main',1,ex.name)),'1–2（默认）');
  assert.equal(ctx.targetForRound('push','A',section,{...ex,rir:2},2).target,13);
  complete.dataset.round='2';input.value='';listeners.get(complete)();
  assert.match(message,/请先填写/);assert.equal(completed,1);assert.equal(rests,1);
  assert.equal(ctx.activePerformanceEntry('main',2,ex.name),null);
  input.value='12';listeners.get(complete)();assert.equal(completed,2);
  assert.equal(ctx.rirLabel(ctx.activePerformanceEntry('main',2,ex.name)),'1–2（默认）');
});
