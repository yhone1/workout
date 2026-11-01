const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('./home-plan');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function harness(saved,mode='threeDay'){
  const plans=M.compile(M.defaults(mode),M.catalog([])),entries={};
  const ctx={plans,HomePlan:M,HomeProgression:require('./home-progression'),doneState:saved?.doneState||{},pendingWorkoutEnd:null,
    sessionState:{active:saved?.active||{day:'push',variant:'A',startedAt:123,planSnapshot:M.clone(plans.push),roundFlow:{added:{},released:[]}}},
    performanceState:saved?.performanceState||{sessions:{}},growthState:{dayXp:{push:0}},
    homePlanState:{active:M.defaults(mode)},legacyPlans:plans,
    getVariant:()=>ctx.sessionState.active?.variant||'A',persistSession:()=>{},persistPerformance:()=>{},persistGrowth:()=>{},
    levelSnapshot:()=>null,levelConfig:()=>({levels:[{},{},{}]}),
    ensureGrowthEntry:name=>entries[name]||(entries[name]={xp:0,levelIndex:1,upgradeStreak:0,hardStreak:0,history:[]}),
    adaptiveAdvice:()=>({mode:'normal'}),localDateKey:value=>new Date(Number(value)).toISOString().slice(0,10)};
  vm.createContext(ctx);
  for(const name of ['activeHomeSchedule','planForDay','homeRecordKey','sectionKey','roundKey','singleKey','exerciseSlug','recordedNumber','defaultRir','rirBounds','rirAllowsProgress','confirmStrengthRir','exerciseTargetRir','parseRepRange',
    'performanceSessionId','ensurePerformanceSession','performanceEntryKey','savePerformanceEntry','activePerformanceEntry',
    'ensureRoundFlow','getSectionsForVariant','getSections','completedRounds','workoutRoundSummary','persistRoundProgress',
    'addWorkoutRound','advanceWorkoutSection','activePhase','roundProgressText','processGrowthAfterSession','roundSectionChoiceHtml',
    'rirLabel','previousRoundSession','previousRoundHistoryHtml']){
    const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);
    assert.ok(start>=0&&end>start,name);vm.runInContext(source.slice(start,end),ctx);
  }
  for(const ex of ctx.getSections('push').find(s=>s.id==='warmup').exercises)ctx.doneState[ctx.singleKey('push','A','warmup',ex.id)]=true;
  const finishRound=(id,rir=null)=>{
    const section=ctx.getSections('push').find(s=>s.id===id),round=ctx.completedRounds('push','A',section)+1;
    for(const ex of M.exercisesForRound(section,round))ctx.savePerformanceEntry(id,round,ex.name,{reps:ex.repMax,rir});
    ctx.doneState[ctx.roundKey('push','A',id,round)]=true;ctx.persistRoundProgress();
  };
  return {ctx,entries,finishRound};
}
test('four-day unequal support sets and extra rounds record actual volume and survive refresh',()=>{
  const {ctx,finishRound}=harness(undefined,'fourDay');
  for(let i=0;i<3;i++)finishRound('main');ctx.advanceWorkoutSection('push','main');
  for(let i=0;i<3;i++)finishRound('support');
  assert.equal(ctx.workoutRoundSummary().support.sets,5);
  assert.equal(ctx.activePerformanceEntry('support',3,'弹力带过顶臂屈伸'),null);
  assert.equal(ctx.addWorkoutRound('push','support'),true);finishRound('support');
  assert.equal(ctx.workoutRoundSummary().support.sets,7);assert.equal(ctx.workoutRoundSummary().support.addedCompleted,1);
  const saved=JSON.parse(JSON.stringify({active:ctx.sessionState.active,doneState:ctx.doneState,performanceState:ctx.performanceState}));
  const reloaded=harness(saved,'fourDay');assert.equal(reloaded.ctx.workoutRoundSummary().support.sets,7);
  assert.ok(Object.keys(saved.doneState).every(key=>key.includes('::fourDay')));
  assert.notEqual(ctx.sectionKey('push','A','main'),harness().ctx.sectionKey('push','A','main'));
});

test('planned final round holds the main section until the user advances',()=>{
  const {ctx,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main');
  assert.equal(ctx.activePhase('push'),'main');
  assert.match(ctx.roundSectionChoiceHtml('push','A',ctx.getSections('push').find(s=>s.id==='main'),3),/第4轮/);
  assert.equal(ctx.advanceWorkoutSection('push','main'),true);assert.equal(ctx.activePhase('push'),'support');
});
test('main can continue past six rounds without changing the default plan or snapshot',()=>{
  const {ctx,finishRound}=harness(),snapshot=JSON.stringify(ctx.sessionState.active.planSnapshot);
  for(let i=0;i<3;i++)finishRound('main');
  for(let i=4;i<=8;i++){
    assert.equal(ctx.addWorkoutRound('push','main'),true);
    assert.equal(ctx.addWorkoutRound('push','main'),false,'a pending round cannot be duplicated');
    assert.equal(ctx.activePhase('push'),'main');finishRound('main');
  }
  const row=ctx.workoutRoundSummary().main;
  assert.equal(row.planned,3);assert.equal(row.target,8);assert.equal(row.completed,8);assert.equal(row.addedCompleted,5);assert.equal(row.sets,16);
  assert.equal(JSON.stringify(ctx.sessionState.active.planSnapshot),snapshot);
  assert.equal(ctx.plans.push.A.find(s=>s.id==='main').rounds,3);
});
test('support also holds and appends independently, and the next section stays pending',()=>{
  const {ctx,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main');ctx.advanceWorkoutSection('push','main');
  for(let i=0;i<2;i++)finishRound('support');
  assert.equal(ctx.activePhase('push'),'support');assert.equal(ctx.addWorkoutRound('push','support'),true);finishRound('support');
  assert.equal(ctx.workoutRoundSummary().support.addedCompleted,1);
  assert.equal(ctx.ensurePerformanceSession().roundProgress.support.completed,3);
  assert.equal(ctx.advanceWorkoutSection('push','support'),true);assert.equal(ctx.activePhase('push'),'challenge');
});
test('refresh restores appended targets, records, and the held section',()=>{
  const {ctx,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main');ctx.addWorkoutRound('push','main');finishRound('main');
  const saved=JSON.parse(JSON.stringify({active:ctx.sessionState.active,doneState:ctx.doneState,performanceState:ctx.performanceState}));
  const next=harness(saved).ctx;assert.equal(next.activePhase('push'),'main');
  assert.equal(next.getSections('push').find(s=>s.id==='main').rounds,4);
  assert.equal(Object.keys(next.ensurePerformanceSession().values).length,8);
  assert.equal(Object.values(next.ensurePerformanceSession().values).at(-1).rir,null);
  assert.equal(next.advanceWorkoutSection('push','main'),true);assert.equal(next.activePhase('push'),'support');
});
test('incomplete extra rounds are not counted as completed training volume',()=>{
  const {ctx,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main');ctx.addWorkoutRound('push','main');
  const row=ctx.workoutRoundSummary().main;assert.equal(row.target,4);assert.equal(row.completed,3);assert.equal(row.addedCompleted,0);assert.equal(row.sets,6);
  assert.equal(ctx.advanceWorkoutSection('push','main'),false);
});
test('legacy sessions retain their already advanced position when first loaded',()=>{
  const {ctx,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main');delete ctx.sessionState.active.roundFlow;
  assert.equal(ctx.activePhase('push'),'support');assert.deepEqual(Array.from(ctx.ensureRoundFlow().released),['main']);
});
test('wrong day, pending feedback and premature advance cannot alter the flow',()=>{
  const {ctx,finishRound}=harness();assert.equal(ctx.advanceWorkoutSection('push','main'),false);assert.equal(ctx.addWorkoutRound('pull','main'),false);
  for(let i=0;i<3;i++)finishRound('main');ctx.pendingWorkoutEnd={};
  assert.equal(ctx.addWorkoutRound('push','main'),false);assert.equal(ctx.advanceWorkoutSection('push','main'),false);
});
test('appended rounds participate in progression rather than being discarded',()=>{
  const {ctx,entries,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main',3);
  ctx.addWorkoutRound('push','main');finishRound('main',0);
  ctx.processGrowthAfterSession(ctx.sessionState.active,ctx.ensurePerformanceSession(),'right');
  const name=ctx.getSections('push').find(s=>s.id==='main').exercises[0].name;
  assert.equal(entries[name].upgradeStreak,0,'failure in the additional round affects progression');
  assert.match(ctx.roundProgressText(ctx.workoutRoundSummary()),/主关卡4轮（追加1轮）/);
});
test('typing into an unfinished extra round does not grant completed-round XP',()=>{
  const {ctx,entries,finishRound}=harness();for(let i=0;i<3;i++)finishRound('main');ctx.addWorkoutRound('push','main');
  const ex=ctx.getSections('push').find(s=>s.id==='main').exercises[0];
  ctx.savePerformanceEntry('main',4,ex.name,{reps:ex.repMax,rir:3});
  ctx.processGrowthAfterSession(ctx.sessionState.active,ctx.ensurePerformanceSession(),'right');
  assert.equal(entries[ex.name].xp,16);assert.equal(entries[ex.name].upgradeStreak,0);
});
test('no-interval plans can finish only after the user releases the support section',()=>{
  const {ctx,finishRound}=harness();ctx.sessionState.active.planSnapshot.A=ctx.sessionState.active.planSnapshot.A.filter(s=>s.id!=='challenge');
  for(let i=0;i<3;i++)finishRound('main');ctx.advanceWorkoutSection('push','main');for(let i=0;i<2;i++)finishRound('support');
  assert.equal(ctx.activePhase('push'),'support');ctx.advanceWorkoutSection('push','support');assert.equal(ctx.activePhase('push'),'finish');
});

function history(ctx,{id=100,variant='A',day='push',completed=5,planned=3,target=6,endedAt=id+1}={}){
  const snapshot=M.clone(ctx.plans.push),ex=snapshot[variant].find(s=>s.id==='main').exercises[0];
  const record={day,variant,startedAt:id,endedAt,finalized:true,planSnapshot:snapshot,
    roundProgress:{main:{planned,target,completed,addedCompleted:Math.max(0,completed-planned)},support:{planned:2,target:3,completed:3,addedCompleted:1}},values:{}};
  for(let round=1;round<=target;round++)record.values[ctx.performanceEntryKey('main',round,ex.name)]={reps:10,rir:null};
  return record;
}

test('new training displays the previous same-day same-variant extra volume and every completed round',()=>{
  const {ctx}=harness(),record=history(ctx);ctx.performanceState.sessions[100]=record;
  ctx.sessionState.days={'1970-01-01':{push:{sessions:[{...record,values:undefined}]}}};
  // Actual calendar records omit values; the performance record supplies their details.
  delete ctx.sessionState.days['1970-01-01'].push.sessions[0].values;
  const before=JSON.stringify({session:ctx.sessionState,performance:ctx.performanceState,done:ctx.doneState});
  const section=ctx.getSections('push').find(s=>s.id==='main'),html=ctx.previousRoundHistoryHtml('push','A',section);
  assert.match(html,/完成5轮（加练2轮）/);assert.match(html,/第5轮（加练）：10次 · RIR 未记录/);
  assert.doesNotMatch(html,/第6轮/);assert.equal(ctx.getSections('push').find(s=>s.id==='main').rounds,3);
  assert.deepEqual(Object.keys(ctx.ensureRoundFlow().added),[]);
  assert.equal(JSON.stringify({session:ctx.sessionState,performance:ctx.performanceState,done:ctx.doneState}),before);
});

test('history excludes different days, other variants, unfinished, current and later sessions',()=>{
  const {ctx}=harness();
  for(const config of [{id:100},{id:102,variant:'B'},{id:104,day:'pull'},{id:125},{id:123}]){
    const record=history(ctx,config);ctx.performanceState.sessions[record.startedAt]=record;
  }
  ctx.performanceState.sessions[106]={...history(ctx,{id:106}),finalized:false};
  assert.equal(ctx.previousRoundSession('push','A','main').startedAt,100);
  assert.equal(ctx.previousRoundSession('push','B','main').startedAt,102);
});

test('latest same-variant session replaces older extra volume and support history is independent',()=>{
  const {ctx}=harness();ctx.performanceState.sessions[90]=history(ctx,{id:90});
  ctx.performanceState.sessions[100]=history(ctx,{id:100,completed:3,target:3});
  const main=ctx.previousRoundHistoryHtml('push','A',ctx.getSections('push').find(s=>s.id==='main'));
  const support=ctx.previousRoundHistoryHtml('push','A',ctx.getSections('push').find(s=>s.id==='support'));
  assert.match(main,/完成3轮/);assert.doesNotMatch(main,/加练2轮/);assert.match(support,/完成3轮（加练1轮）/);
});

test('calendar volume survives performance pruning and absent legacy volume stays hidden',()=>{
  const {ctx}=harness(),record=history(ctx);delete record.values;
  ctx.sessionState.days={'1970-01-01':{push:{sessions:[record]}}};
  const section=ctx.getSections('push').find(s=>s.id==='main');
  const html=ctx.previousRoundHistoryHtml('push','A',section);
  assert.match(html,/完成5轮（加练2轮）/);assert.match(html,/暂无可展示的逐轮次数记录/);
  delete record.roundProgress;assert.equal(ctx.previousRoundHistoryHtml('push','A',section),'');
});

test('historical action labels are escaped before rendering',()=>{
  const {ctx}=harness(),record=history(ctx),ex=record.planSnapshot.A.find(s=>s.id==='main').exercises[0];
  ex.displayName='<img src=x onerror=alert(1)>';ctx.performanceState.sessions[100]=record;
  const html=ctx.previousRoundHistoryHtml('push','A',ctx.getSections('push').find(s=>s.id==='main'));
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});
test('chosen Tabata actions remain visible from session history after detailed performance is pruned',()=>{
  const {ctx}=harness(),section={id:'challenge',mode:'rounds',rounds:1,exercises:[{id:'tabata',name:'Tabata / 间歇',timer:180}]};
  const record={day:'push',variant:'A',homeSchedule:'threeDay',startedAt:100,endedAt:101,roundProgress:{challenge:{planned:1,completed:1}},planSnapshot:{A:[section]},tabataChoices:{'challenge::tabata':{actions:['原地快走','<动作>'],locked:true}}};
  ctx.sessionState.active=null;ctx.sessionState.days={'1970-01-01':{push:{sessions:[record]}}};
  const html=ctx.previousRoundHistoryHtml('push','A',section);assert.match(html,/原地快走＋&lt;动作&gt;/);assert.doesNotMatch(html,/<动作>/);
});
