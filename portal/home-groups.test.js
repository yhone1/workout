const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('./home-plan'),catalog=M.catalog([]),source=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
test('legacy migration preserves actions, doses, IDs, independent schedules and frozen histories',()=>{
  const old=M.defaults(),snapshot=M.compile(old,catalog),frozen=JSON.stringify(snapshot);
  const state={schema:1,revision:4,active:old,draft:M.clone(old),programs:{fourDay:M.defaults('fourDay')},drafts:{threeDay:M.clone(old)},custom:[]};
  const doses=M.summary(old,catalog).map(x=>x.sets);assert.equal(M.migrateGroups(state),true);
  assert.equal(state.revision,5);assert.deepEqual(M.summary(state.active,catalog).map(x=>x.sets),doses);
  const groups=state.active.days.pull.A.groups;assert.deepEqual(groups.map(x=>x.id),['warmup','main','support','challenge']);
  assert.equal(groups[0].exercises[0].seconds,180);assert.equal(groups[1].rounds,3);assert.equal(groups[1].restSeconds,120);
  assert.equal(groups.at(-1).optional,true);assert.deepEqual(groups.at(-1).exercises[0].interval.actions,old.days.pull.A.tabata.actions);
  assert.equal(state.programs.fourDay.days.push.A.groups.length,3);assert.equal(M.migrateGroups(state),false);
  assert.equal(JSON.stringify(snapshot),frozen);assert.deepEqual(M.read(JSON.stringify(state),[]),state);
});
test('groups can mix timers, intervals and strength actions, reorder by stable ID and repeat actions across groups',()=>{
  const p=M.groupDefaults(),groups=p.days.pull.A.groups;
  groups.splice(1,0,{id:'group-extra',rounds:2,restSeconds:150,exercises:[M.newExercise('prepare',catalog),M.newExercise('tabata',catalog),M.newExercise('pull',catalog)]});
  assert.deepEqual(M.validate(p,catalog),[]);
  let compiled=M.compile(p,catalog).pull.A;assert.equal(compiled[1].label,'第二组');assert.equal(compiled[1].exercises[0].timer,180);
  assert.equal(compiled[1].exercises[1].intervalPlan.rounds,6);assert.equal(compiled[1].exercises[2].repMax,12);
  [groups[1],groups[2]]=[groups[2],groups[1]];compiled=M.compile(p,catalog).pull.A;
  assert.equal(compiled[2].id,'group-extra');assert.equal(compiled[2].label,'第三组');
  assert.ok(compiled.every(s=>s.mode==='rounds'&&s.grouped));
});
test('empty groups, invalid timers, duplicate IDs, duplicate actions in a group and empty rounds are rejected',()=>{
  for(const mutate of [g=>g.splice(0),g=>g[0].exercises.splice(0),g=>g[0].exercises[0].seconds=0,g=>g[1].id=g[0].id,g=>g[1].exercises.push(M.clone(g[1].exercises[0])),g=>g[1].exercises.forEach(x=>x.sets=1),g=>g[0].id='finish']){
    const p=M.groupDefaults();mutate(p.days.push.A.groups);assert.ok(M.validate(p,catalog).length);assert.throws(()=>M.compile(p,catalog));
  }
});
test('time estimates include mixed timed actions and every round-end rest while counting only strength sets',()=>{
  const p=M.groupDefaults();p.days.push.A.groups=[{id:'group-test',rounds:2,restSeconds:30,exercises:[{exerciseId:'prepare',seconds:60,cue:''}]}];
  assert.equal(M.summary(p,catalog)[0].minutes,3);assert.equal(M.summary(p,catalog)[0].sets,0);
  assert.equal(M.compile(p,catalog).push.A[0].restSeconds,30);
});
function runtime(mode='threeDay'){
  const plan=M.groupDefaults(mode);plan.days.pull.A.groups=[
    {id:'group-mixed',rounds:2,restSeconds:90,exercises:[M.newExercise('prepare',catalog),M.newExercise('pull',catalog)]},
    {id:'group-interval',rounds:1,restSeconds:60,exercises:[M.newExercise('tabata',catalog)]},
    {id:'group-final',rounds:1,restSeconds:0,exercises:[M.newExercise('row',catalog)]}
  ];
  const plans=M.compile(plan,catalog),growth={levelIndex:1,upgradeStreak:0,hardStreak:0,xp:0,history:[]};
  const ctx={HomePlan:M,HomeTabata:require('./tabata'),HomeProgression:require('./home-progression'),plans,legacyPlans:plans,homePlanState:{active:plan},
    sessionState:{active:{day:'pull',variant:'A',startedAt:123,planSnapshot:plans.pull,roundFlow:{added:{},released:[]}}},doneState:{},performanceState:{sessions:{}},pendingWorkoutEnd:null,
    getVariant:()=> 'A',persistSession:()=>{},persistPerformance:()=>{},persistGrowth:()=>{},persistDone:()=>{},renderDay:()=>{},showToast:()=>{},
    levelSnapshot:()=>null,levelConfig:()=>({levels:[{},{},{}]}),ensureGrowthEntry:()=>growth,adaptiveAdvice:()=>({mode:'normal'}),growthState:{dayXp:{}},
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),restSeconds:90};
  vm.createContext(ctx);
  for(const name of ['activeHomeSchedule','planForDay','homeRecordKey','sectionKey','roundKey','singleKey','exerciseSlug','recordedNumber','defaultRir','rirBounds','rirAllowsProgress','confirmStrengthRir','exerciseTargetRir','parseRepRange','performanceSessionId','ensurePerformanceSession','performanceEntryKey','savePerformanceEntry','activePerformanceEntry','ensureRoundFlow','getSectionsForVariant','getSections','completedRounds','workoutRoundSummary','persistRoundProgress','activePhase','addWorkoutRound','advanceWorkoutSection','roundProgressText','smartRestSeconds','previousTabataActions','tabataInterval','completeTimedGroupAction','processGrowthAfterSession']){
    const a=source.indexOf(`  function ${name}(`),b=source.indexOf('\n  function ',a+1);assert.ok(a>=0&&b>a,name);vm.runInContext(source.slice(a,b),ctx);
  }
  const complete=id=>{const section=ctx.getSections('pull').find(x=>x.id===id),round=ctx.completedRounds('pull','A',section)+1;
    for(const ex of M.exercisesForRound(section,round)){if(ex.timer)assert.equal(ctx.completeTimedGroupAction('pull',id,round,ex.name,123),true);else ctx.savePerformanceEntry(id,round,ex.name,{reps:ex.repMax,rir:3});}
    ctx.doneState[ctx.roundKey('pull','A',id,round)]=true;ctx.persistRoundProgress();
  };
  return {ctx,complete,plan,growth};
}
test('arbitrary mixed groups hold, append, restore on refresh and count timed actions without inventing reps',()=>{
  const {ctx,complete}=runtime();complete('group-mixed');complete('group-mixed');
  assert.equal(ctx.activePhase('pull'),'group-mixed');assert.equal(ctx.addWorkoutRound('pull','group-mixed'),true);complete('group-mixed');
  const record=ctx.ensurePerformanceSession();assert.equal(record.roundProgress['group-mixed'].sets,3);assert.equal(record.roundProgress['group-mixed'].addedCompleted,1);
  const timed=ctx.activePerformanceEntry('group-mixed',3,'热身活动');assert.equal(timed.completed,true);assert.equal(timed.reps,null);
  const reload=runtime().ctx;reload.doneState=JSON.parse(JSON.stringify(ctx.doneState));reload.sessionState=JSON.parse(JSON.stringify(ctx.sessionState));reload.performanceState=JSON.parse(JSON.stringify(ctx.performanceState));
  assert.equal(reload.getSections('pull')[0].rounds,3);assert.equal(reload.activePhase('pull'),'group-mixed');
  assert.equal(ctx.advanceWorkoutSection('pull','group-mixed'),true);complete('group-interval');
  assert.equal(ctx.activePhase('pull'),'group-interval','interval completion cannot end the whole workout');
  ctx.advanceWorkoutSection('pull','group-interval');complete('group-final');ctx.advanceWorkoutSection('pull','group-final');assert.equal(ctx.activePhase('pull'),'finish');
  assert.match(ctx.roundProgressText(record.roundProgress),/第一组3轮/);assert.equal(ctx.smartRestSeconds('pull',ctx.getSections('pull')[2]),0);
});
test('stale timers and timers from other groups or days cannot write to the active workout',()=>{
  const {ctx}=runtime(),name='热身活动';
  for(const args of [['pull','group-mixed',1,name,122],['push','group-mixed',1,name,123],['pull','group-interval',1,'Tabata / 间歇',123],['pull','group-mixed',2,name,123]])assert.equal(ctx.completeTimedGroupAction(...args),false);
  assert.deepEqual(Object.keys(ctx.performanceState.sessions),[]);
});
test('random interval completion freezes the actual actions and added rounds reuse the same pair',()=>{
  const {ctx,complete}=runtime();complete('group-mixed');complete('group-mixed');ctx.advanceWorkoutSection('pull','group-mixed');complete('group-interval');
  const section=ctx.getSections('pull').find(s=>s.id==='group-interval'),ex=section.exercises[0];
  const first=ctx.activePerformanceEntry(section.id,1,ex.name),actions=JSON.stringify(first.intervalPlan.actions);
  assert.equal(first.intervalPlan.actions.length,2);assert.equal(first.reps,null);assert.equal(first.rir,null);
  assert.equal(ctx.sessionState.active.tabataChoices[section.id+'::tabata'].locked,true);
  ctx.addWorkoutRound('pull',section.id);complete(section.id);
  assert.equal(JSON.stringify(ctx.activePerformanceEntry(section.id,2,ex.name).intervalPlan.actions),actions);
  const reload=runtime().ctx;reload.doneState=JSON.parse(JSON.stringify(ctx.doneState));reload.sessionState=JSON.parse(JSON.stringify(ctx.sessionState));reload.performanceState=JSON.parse(JSON.stringify(ctx.performanceState));
  assert.equal(JSON.stringify(reload.tabataInterval('pull',section,ex,true).actions),actions);
});
test('previous random avoidance uses completed Tabata, excluding unfinished timers and interval warmups',()=>{
  const {ctx}=runtime(),key='challenge::1::'+ctx.exerciseSlug('Tabata / 间歇');
  ctx.performanceState.sessions={
    1:{finalized:true,endedAt:1,values:{[key]:{completed:true,intervalPlan:{actions:['原地快走','侧向踏步']}}}},
    2:{finalized:true,endedAt:2,values:{['warmup::1::'+ctx.exerciseSlug('热身活动')]:{completed:true,intervalPlan:{actions:['肩绕环','拉开']}}}},
    3:{finalized:true,endedAt:3,values:{[key]:{completed:false,intervalPlan:{actions:['未完成甲','未完成乙']}}}}
  };
  assert.deepEqual(Array.from(ctx.previousTabataActions()),['原地快走','侧向踏步']);
});
test('four-day grouped execution keeps schedule-isolated keys and retains unequal action doses',()=>{
  const {ctx,complete}=runtime('fourDay');complete('group-mixed');complete('group-mixed');
  assert.equal(ctx.activeHomeSchedule(),'fourDay');assert.ok(Object.keys(ctx.doneState).every(k=>k.includes('::fourDay')));
  const p=M.groupDefaults('fourDay'),s=M.compile(p,catalog).push.A.find(x=>x.id==='support');
  assert.deepEqual([1,2,3].map(round=>M.exercisesForRound(s,round).length),[2,2,1]);
});
test('the same exercise in multiple groups grants one progression observation per training session',()=>{
  const {ctx,plan,growth}=runtime(),ex=M.newExercise('pull',catalog);
  const compiled=M.compile(plan,catalog).pull;compiled.A=[1,2].map(i=>({id:'group-'+i,label:M.groupName(i-1),mode:'rounds',rounds:1,required:1,grouped:true,exercises:[{...ex,name:'引体向上 / 弹力带辅助'}]}));ctx.sessionState.active.planSnapshot=compiled;
  const record=ctx.ensurePerformanceSession();record.roundProgress={};
  for(const section of compiled.A){ctx.savePerformanceEntry(section.id,1,section.exercises[0].name,{reps:12,rir:3,levelIndex:1});record.values[ctx.performanceEntryKey(section.id,1,section.exercises[0].name)].levelIndex=1;record.roundProgress[section.id]={completed:1};}
  ctx.processGrowthAfterSession(ctx.sessionState.active,record,'right');assert.equal(growth.upgradeStreak,1);assert.equal(growth.levelIndex,1);
});

function loadFunction(ctx,name){
  const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);
  assert.ok(start>=0&&end>start,name);vm.runInContext(source.slice(start,end),ctx);
}
test('group previews show every action despite old completed rounds or unequal action doses',()=>{
  const {ctx}=runtime();ctx.exerciseDisplayName=ex=>ex.name;ctx.exerciseGuides={};ctx.resolveGifUrl=x=>x;
  ctx.previousRoundHistoryHtml=()=>'';ctx.phaseBudget=()=>({support:10});ctx.intensityHtml=()=>'';
  ctx.roundExerciseHtml=()=>'';
  for(const name of ['roundExerciseGroupHtml','isWarmupRound','sectionHtml'])loadFunction(ctx,name);
  const section=ctx.plans.push.A.find(s=>s.id==='support');
  for(let round=1;round<=4;round++)ctx.doneState[ctx.roundKey('push','A','support',round)]=true;
  const before=JSON.stringify(ctx.doneState);
  let html=ctx.sectionHtml('push',section);
  assert.ok(html.includes('弹力带侧平举'));assert.ok(html.includes('弹力带下压'));
  assert.ok(html.includes('is-pending'));assert.equal(JSON.stringify(ctx.doneState),before);
  ctx.sessionState.active.day='push';ctx.sessionState.active.planSnapshot=ctx.plans.push;
  delete ctx.doneState[ctx.roundKey('push','A','support',4)];
  html=ctx.sectionHtml('push',section);
  assert.ok(html.includes('弹力带侧平举'));assert.ok(html.includes('弹力带下压'),'a future group must not preview only its final round');
});
test('only a standalone warmup round supports direct confirmation from the round button',()=>{
  const {ctx}=runtime();loadFunction(ctx,'isWarmupRound');
  const warmup=ctx.plans.push.A.find(s=>s.id==='warmup');
  assert.equal(ctx.isWarmupRound(warmup,1),true);
  assert.equal(ctx.isWarmupRound(ctx.getSections('pull')[0],1),false,'mixed warmup and strength cannot be auto-confirmed');
  assert.equal(ctx.isWarmupRound(ctx.getSections('pull')[1],1),false,'Tabata still needs its own completion');
  assert.equal(ctx.isWarmupRound(ctx.plans.push.A.find(s=>s.id==='main'),1),false);
});
test('time ranges accumulate in decimal minutes without floating point tails',()=>{
  const ctx={phaseBudget:()=>({warmup:3.7,main:9.4,secondary:5.6,support:15.8,challenge:3.2}),getSections:()=>['warmup','main','secondary','support','challenge'].map(id=>({id}))};
  vm.createContext(ctx);loadFunction(ctx,'phaseTimeline');
  const t=ctx.phaseTimeline('push');
  assert.equal(t.main.end,13.1);assert.equal(t.secondary.end,18.7);assert.equal(t.support.end,34.5);assert.equal(t.finish.start,37.7);
});
