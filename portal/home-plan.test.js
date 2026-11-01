const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const M=require('./home-plan');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'home-exercise-catalog.js'),'utf8'),ctx);
const extras=JSON.parse(JSON.stringify(ctx.window.HOME_EXTRA_EXERCISES)),catalog=M.catalog(extras);

test('four-day template preserves agreed exercises, exact set counts and optional conditioning',()=>{
  const p=M.defaults('fourDay');assert.deepEqual(M.validate(p,catalog),[]);
  assert.deepEqual(M.dayKeys(p),['push','pull']);
  assert.deepEqual(M.summary(p,catalog).map(row=>row.sets),[11,11,10,10]);
  assert.ok(Object.values(p.days).flatMap(Object.values).every(day=>day.tabataEnabled===false));
  assert.deepEqual(p.days.push.A.main.exercises.map(ex=>ex.exerciseId),['feet-push','lunge']);
  assert.deepEqual(p.days.push.B.main.exercises.map(ex=>ex.exerciseId),['band-push','split']);
  assert.deepEqual(p.days.pull.A.main.exercises.map(ex=>ex.exerciseId),['pull','rdl']);
  assert.deepEqual(p.days.pull.B.main.exercises.map(ex=>ex.exerciseId),['row','rdl']);
  assert.equal(M.compile(p,catalog).push.schedule,'fourDay');
  assert.deepEqual([1,2,3].map(round=>M.exercisesForRound(p.days.push.A.support,round).length),[2,2,1]);
});

test('weekly scheduling follows Monday Tuesday Thursday Friday and retains the old cycle',()=>{
  assert.deepEqual(Array.from({length:7},(_,i)=>M.weeklySlot(new Date(2026,9,19+i))),[
    {day:'push',variant:'A'},{day:'pull',variant:'A'},{day:'rest',variant:'B'},
    {day:'push',variant:'B'},{day:'pull',variant:'B'},{day:'rest',variant:'A'},{day:'rest',variant:'A'}]);
  assert.equal(M.schedule(M.defaults()),'threeDay');assert.equal(M.summary(M.defaults(),catalog).length,6);
});

test('saved programs and independent drafts retain customized doses on reload',()=>{
  const three=M.defaults(),four=M.defaults('fourDay');three.days.legs.A.main.rounds=5;four.days.pull.B.main.restSeconds=150;
  const draft=M.clone(three);draft.days.push.A.main.exercises[0].repMin=10;
  const state={schema:1,active:four,draft,custom:[],programs:{threeDay:three,fourDay:four},drafts:{threeDay:draft}};
  assert.deepEqual(M.read(JSON.stringify(state),extras),state);
  const malformed=M.clone(state);malformed.programs.fourDay.days.pull.B.main.exercises[0].exerciseId='missing';
  malformed.active=M.defaults('fourDay');const read=M.read(JSON.stringify(malformed),extras);
  assert.equal(read.programs.fourDay,undefined);assert.equal(read.programs.threeDay.days.legs.A.main.rounds,5);
});

test('per-exercise doses reject empty rounds and sets beyond the stage budget',()=>{
  const p=M.defaults('fourDay');p.days.push.A.support.exercises[1].sets=4;
  assert.match(M.validate(p,catalog).join(','),/动作组数/);
  p.days.push.A.support.exercises.forEach(ex=>ex.sets=1);
  assert.match(M.validate(p,catalog).join(','),/全部轮次/);
});
test('personal template uses home equipment, all six variants have the intended dose',()=>{
  const p=M.defaults();assert.deepEqual(M.validate(p,catalog),[]);
  const s=M.summary(p,catalog);assert.deepEqual(s.map(x=>x.sets),[10,10,12,10,10,10]);
  assert.ok(s.every(x=>x.minutes<=30));assert.ok(s.every(x=>x.tabataMinutes===3));
  const refs=Object.values(p.days).flatMap(d=>Object.values(d).flatMap(v=>['main','support'].flatMap(k=>v[k].exercises)));
  assert.ok(refs.every(x=>M.HOME_CATALOG.some(c=>c.id===x.exerciseId)));
  assert.equal(p.days.push.A.main.exercises[0].exerciseId,'feet-push');assert.equal(p.days.push.B.main.exercises[0].exerciseId,'push');
  assert.equal(p.days.pull.A.main.restSeconds,120);assert.equal(p.days.legs.A.support.exercises.at(-1).exerciseId,'wheel');
  assert.deepEqual(p.days.push.B.support.exercises.map(x=>x.exerciseId),['fly','overhead']);
  assert.deepEqual(p.days.pull.B.support.exercises.map(x=>x.exerciseId),['pulldown','hammer']);
  assert.equal(p.days.push.A.support.exercises[0].exerciseId,'press');
  assert.equal(p.days.pull.A.support.exercises[1].exerciseId,'face');
  for(const variant of ['A','B']){
    assert.ok(!p.days.legs[variant].support.exercises.some(ex=>ex.exerciseId==='lateral'));
    assert.equal(M.setCount(p.days.push[variant].main,p.days.push[variant].main.exercises.find(ex=>ex.exerciseId==='lateral')),3);
  }
});

function oldLegTemplate(){
  const plan=M.defaults();for(const v of ['A','B'])plan.days.legs[v].support.exercises.unshift({exerciseId:'lateral',repMin:12,repMax:18,perSide:true,rir:3,cue:''});return plan;
}

test('saved three-day plans and drafts lose only default leg lateral raises once; histories and four-day plans survive',()=>{
  const old=oldLegTemplate(),four=M.defaults('fourDay');old.days.legs.A.main.rounds=4;
  const state={schema:1,revision:7,active:M.clone(old),draft:M.clone(old),custom:[],programs:{threeDay:M.clone(old),fourDay:four},drafts:{threeDay:M.clone(old),fourDay:M.clone(four)}};
  const frozen={active:{planSnapshot:M.compile(old,catalog)},history:[{planSnapshot:M.compile(old,catalog)}]},beforeFrozen=JSON.stringify(frozen),beforeFour=JSON.stringify([state.programs.fourDay,state.drafts.fourDay]);
  assert.equal(M.migrateLegLateralToPushOnly(state),true);
  for(const plan of [state.active,state.draft,state.programs.threeDay,state.drafts.threeDay]){
    assert.deepEqual(plan.days.legs.A.support.exercises.map(ex=>ex.exerciseId),['calf','wheel']);
    assert.deepEqual(plan.days.legs.B.support.exercises.map(ex=>ex.exerciseId),['bent-calf','pallof']);
    assert.equal(plan.days.legs.A.main.rounds,4);assert.deepEqual(M.validate(plan,catalog),[]);
    assert.deepEqual(plan.days.push,old.days.push);
  }
  assert.equal(state.revision,8);assert.equal(JSON.stringify(frozen),beforeFrozen);assert.equal(JSON.stringify([state.programs.fourDay,state.drafts.fourDay]),beforeFour);
  assert.equal(M.migrateLegLateralToPushOnly(state),false);
  const saved=M.read(JSON.stringify(state),extras);assert.equal(M.migrateLegLateralToPushOnly(saved),false);
  saved.active=oldLegTemplate();const manual=JSON.stringify(saved.active);M.migrateLegLateralToPushOnly(saved);assert.equal(JSON.stringify(saved.active),manual);
});

test('migration updates stored three-day plan when four-day is active, preserving customized lateral prescriptions',()=>{
  const state={schema:1,revision:1,active:M.defaults('fourDay'),programs:{threeDay:oldLegTemplate()},draft:oldLegTemplate(),custom:[]};
  const before=JSON.stringify(state.active);state.draft.days.legs.A.support.exercises[0].cue='我自选的补量';
  state.draft.days.legs.B.support.exercises[0].repMax=20;
  const draft=JSON.stringify(state.draft);M.migrateLegLateralToPushOnly(state);
  assert.equal(JSON.stringify(state.active),before);assert.equal(JSON.stringify(state.draft),draft);
  assert.equal(state.programs.threeDay.days.legs.A.support.exercises.length,2);
});

function oldTemplate(){
  const p=M.defaults(),fly=p.days.push.B.support.exercises[0];
  p.days.push.B.support.exercises[0]={exerciseId:'press',repMin:8,repMax:12,perSide:false,rir:2,cue:''};
  p.days.pull.B.support.exercises.splice(1,0,fly);
  return p;
}

test('saved old B template migrates once, preserving other edits and frozen training history',()=>{
  const active=oldTemplate();active.days.legs.A.main.rounds=4;
  const draft=M.clone(active);draft.days.push.A.main.restSeconds=150;
  const state={schema:1,revision:7,active,draft,custom:[]},snapshot=M.clone(active),history={planSnapshot:M.clone(active)};
  const frozen=JSON.stringify({snapshot,history});
  assert.equal(M.migrateRearDeltToPushB(state),true);
  for(const p of [state.active,state.draft]){
    assert.deepEqual(p.days.push.B.support.exercises.map(x=>x.exerciseId),['fly','overhead']);
    assert.deepEqual(p.days.pull.B.support.exercises.map(x=>x.exerciseId),['pulldown','hammer']);
    assert.equal(p.days.legs.A.main.rounds,4);assert.deepEqual(M.validate(p,catalog),[]);
  }
  assert.equal(state.draft.days.push.A.main.restSeconds,150);assert.equal(state.revision,8);
  assert.equal(JSON.stringify({snapshot,history}),frozen);
  assert.equal(M.migrateRearDeltToPushB(state),false);
  const saved=M.read(JSON.stringify(state),extras);assert.equal(M.migrateRearDeltToPushB(saved),false);
});

test('customized B doses or actions remain unchanged, and a later manual reversal is respected',()=>{
  const alterations=[p=>{p.days.push.B.support.exercises[0].repMax=15;},p=>{p.days.pull.B.support.exercises[1].rir=2;},p=>{p.days.push.B.support.rounds=3;},p=>{p.days.pull.B.support.exercises.reverse();}];
  for(const edit of alterations){
    const p=oldTemplate();edit(p);const before=JSON.stringify(p),state={schema:1,revision:4,active:p,draft:null,custom:[]};
    M.migrateRearDeltToPushB(state);assert.equal(JSON.stringify(state.active),before);assert.equal(state.revision,4);
  }
  const state={schema:1,revision:1,active:oldTemplate(),draft:oldTemplate(),custom:[]};
  state.draft.days.pull.B.support.exercises[1].cue='自选节奏';const draft=JSON.stringify(state.draft);
  M.migrateRearDeltToPushB(state);assert.equal(JSON.stringify(state.draft),draft);
  state.active=oldTemplate();const manual=JSON.stringify(state.active);
  assert.equal(M.migrateRearDeltToPushB(state),false);assert.equal(JSON.stringify(state.active),manual);
});
test('library provides usable dumbbell actions backed by actual project media',()=>{
  assert.ok(extras.some(c=>c.equipment==='哑铃'));
  for(const c of extras)assert.ok(fs.existsSync(path.join(__dirname,'..',c.gif.slice(1))),c.gif);
  for(const c of M.HOME_CATALOG.filter(x=>x.gif))assert.ok(fs.existsSync(path.join(__dirname,'..','IMG',c.gif)),c.gif);
});
test('every default leg B action has an existing GIF and a matching display guide',()=>{
  const guides={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','gif-links.js'),'utf8'),guides);
  const leg=M.defaults().days.legs.B;
  for(const ref of [...leg.main.exercises,...leg.support.exercises]){
    const c=catalog.find(x=>x.id===ref.exerciseId);
    assert.ok(c.gif,`${c.name} lacks media`);
    const asset=fs.readFileSync(path.join(__dirname,'..','IMG',c.gif));
    assert.match(asset.subarray(0,6).toString(),/^GIF8[79]a$/);
    assert.ok(guides.window.WORKOUT_GIF_LINKS[c.name].items.some(x=>x.url===c.gif),c.name);
  }
});

test('editing dose preserves identity; switching action uses a distinct history key',()=>{
  const p=M.defaults(),original=M.compile(p,catalog).push.A.find(s=>s.id==='main').exercises[0];
  p.days.push.A.main.exercises[0].repMax=15;p.days.push.A.main.rounds=4;
  const edited=M.compile(p,catalog).push.A.find(s=>s.id==='main').exercises[0];assert.equal(original.name,edited.name);assert.equal(edited.repMax,15);
  p.days.push.A.main.exercises[0].exerciseId=extras.find(c=>c.equipment==='哑铃').id;
  const replacement=M.compile(p,catalog).push.A.find(s=>s.id==='main').exercises[0];assert.notEqual(replacement.name,original.name);assert.ok(replacement.displayName);assert.ok(replacement.manualResistance);
});
test('round settings and optional timers are reflected in the executable plan',()=>{
  const p=M.defaults();p.days.push.A.warmupEnabled=false;p.days.push.A.tabataEnabled=false;p.days.push.A.main.restSeconds=180;
  const sections=M.compile(p,catalog).push.A;assert.deepEqual(sections.map(s=>s.id),['main','support']);assert.equal(sections[0].restSeconds,180);
  p.days.push.A.tabataEnabled=true;p.days.push.A.tabata.rounds=8;p.days.push.A.tabata.work=30;
  assert.equal(M.compile(p,catalog).push.A.at(-1).exercises[0].timer,320);
});
test('invalid doses and duplicate actions cannot become an active plan',()=>{
  const p=M.defaults();p.days.pull.A.main.exercises[0].repMax=1;p.days.pull.A.support.exercises[0].exerciseId='pull';
  assert.ok(M.validate(p,catalog).length>=2);assert.throws(()=>M.compile(p,catalog));
});
test('custom text is escaped and malformed synced custom identifiers are rejected',()=>{
  const p=M.defaults(),id='custom-12345678-1234-1234-1234-123456789abc',c={id,name:id,custom:true,displayName:'<img src=x onerror=alert(1)>',equipment:'哑铃',focus:'背',cue:'<script>alert(1)</script>',gif:''};
  p.days.push.A.main.exercises[0].exerciseId=id;const state={schema:1,active:p,draft:null,custom:[c]};
  assert.ok(M.read(JSON.stringify(state),extras));const ex=M.compile(p,M.catalog(extras,[c])).push.A.find(s=>s.id==='main').exercises[0];assert.ok(!ex.displayName.includes('<img'));assert.ok(!ex.detail.includes('<script'));
  c.name='" onmouseover="alert(1)';assert.equal(M.read(JSON.stringify(state),extras),null);
});
