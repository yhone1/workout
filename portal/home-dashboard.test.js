const test=require('node:test'),assert=require('node:assert/strict');
const D=require('./home-dashboard'),M=require('./home-plan');
const catalog=M.catalog([]);
const day=86400000;
const slug=name=>encodeURIComponent(name);

function session({plan,dayKey='pull',variant='A',startedAt,completed={},values={},durationMs=3600000,finalized=true}){
  return {day:dayKey,variant,startedAt,endedAt:startedAt+durationMs,durationMs,planSnapshot:plan,roundProgress:completed,finalized,values};
}

test('focus labels map to the seven dashboard muscle groups',()=>{
  assert.deepEqual(D.focusGroups('上胸'),['chest']);
  assert.deepEqual(D.focusGroups('后肩、上背'),['back','shoulders']);
  assert.deepEqual(D.focusGroups('二头、肱肌'),['biceps']);
  assert.deepEqual(D.focusGroups('臀、腿后侧'),['legs']);
  assert.deepEqual(D.focusGroups('三头'),['triceps']);
  assert.deepEqual(D.focusGroups('核心'),['core']);
  assert.deepEqual(D.focusGroups(''),[]);
});

test('volume counts only completed rounds and maps each exercise focus',()=>{
  const plan=M.groupDefaults('threeDay'),now=Date.now();
  const row=session({plan,startedAt:now-day,completed:{main:{completed:2},secondary:{completed:3},support:{completed:2}}});
  const volume=D.sessionVolume(row,catalog);
  assert.equal(volume.sets.back,2+3+2);
  assert.equal(volume.sets.shoulders,2);
  assert.equal(volume.sets.biceps,2);
  assert.equal(volume.totalSets,11);
});

test('compiled plan snapshots count the same sets as group snapshots',()=>{
  const plan=M.groupDefaults('threeDay'),compiled=M.compile(plan,catalog),now=Date.now();
  const row=session({plan:compiled.pull,startedAt:now-day,completed:{main:{completed:2},secondary:{completed:3},support:{completed:2}}});
  const volume=D.sessionVolume(row,catalog);
  assert.equal(volume.sets.back,2+3+2);
  assert.equal(volume.sets.shoulders,2);
  assert.equal(volume.sets.biceps,2);
  assert.equal(volume.totalSets,11);
});

test('per-exercise set limits skip rounds the exercise did not perform',()=>{
  const plan=M.groupDefaults('threeDay');
  const group=plan.days.push.A.groups.find(g=>g.id==='support');
  group.exercises[0].sets=2;
  group.exercises[1].sets=3;
  const row=session({plan,dayKey:'push',startedAt:Date.now(),completed:{support:{completed:4}}});
  const volume=D.sessionVolume(row,catalog);
  assert.equal(volume.sets.shoulders,2);
  assert.equal(volume.sets.triceps,3);
});

test('eight-day and twenty-eight-day windows normalize weekly sets',()=>{
  const plan=M.groupDefaults('threeDay'),now=Date.now();
  const recent=session({plan,startedAt:now-day,completed:{main:{completed:3},secondary:{completed:3},support:{completed:3}}});
  const old=session({plan,startedAt:now-10*day,completed:{main:{completed:3},secondary:{completed:3},support:{completed:3}}});
  const volumes=[D.sessionVolume(recent,catalog),D.sessionVolume(old,catalog)];
  const eight=D.volumeSummary(volumes,{days:8,now}),twentyEight=D.volumeSummary(volumes,{days:28,now});
  const back8=eight.find(x=>x.id==='back'),back28=twentyEight.find(x=>x.id==='back');
  assert.equal(back8.sets,9);
  assert.ok(Math.abs(back8.weekly-9*7/8)<1e-9);
  assert.equal(back28.sets,18);
  assert.equal(back28.status,'low');
});

test('weekly trend merges training calendars and performance sets',()=>{
  const plan=M.groupDefaults('threeDay'),now=new Date('2026-11-11T12:00:00');
  const row=session({plan,startedAt:now.getTime()-day,completed:{main:{completed:3},secondary:{completed:3},support:{completed:3}}});
  const trend=D.weeklyTrend([D.sessionVolume(row,catalog)],{weeks:2,now:now.getTime(),days:{'2026-11-10':{pull:{count:1,totalMs:3600000}}}});
  assert.equal(trend.length,2);
  assert.equal(trend.at(-1).sessions,1);
  assert.equal(trend.at(-1).sets,15);
  assert.equal(trend.at(-1).totalMs,3600000);
});

test('exercise progression flags new bests, plateaus and regressions',()=>{
  const plan=M.groupDefaults('threeDay'),base=Date.now()-10*day,name='脚抬高俯卧撑',key=`main::1::${slug(name)}`;
  const make=(offset,reps,levelName=name)=>session({plan,dayKey:'push',startedAt:base+offset*day,completed:{main:{completed:1}},values:{[key]:{reps,levelName}}});
  const rows=D.progressRows([], [make(0,8),make(1,9),make(2,10),make(3,12)], catalog);
  assert.equal(rows[0].status,'up');
  assert.equal(rows[0].delta,4);
  const flat=D.progressRows([], [make(0,10),make(1,10),make(2,10),make(3,10)], catalog);
  assert.equal(flat[0].status,'stall');
  const down=D.progressRows([], [make(0,12),make(1,12),make(2,8)], catalog);
  assert.equal(down[0].status,'regress');
});

test('adding load or raising the level is progression even when reps fall',()=>{
  const plan=M.groupDefaults('threeDay'),base=Date.now()-10*day,name='脚抬高俯卧撑',key=`main::1::${slug(name)}`;
  const make=(offset,reps,extra={})=>session({plan,dayKey:'push',startedAt:base+offset*day,completed:{main:{completed:1}},values:{[key]:{reps,levelName:name,...extra}}});
  const band={min:15,max:25,unit:'kg',mode:'resistance'};
  const banded=D.progressRows([], [make(0,12),make(1,9,{bandLoad:band})], catalog);
  assert.equal(banded[0].status,'advance');
  assert.equal(banded[0].note,'负荷提升');
  assert.equal(banded[0].best,9);
  assert.equal(banded[0].points.length,1);
  assert.equal(banded[0].loadLabel,'阻力 15–25 kg');
  const level=D.progressRows([], [make(0,12,{levelIndex:0}),make(1,9,{levelIndex:1,levelName:'渐进加阻 · 脚抬高俯卧撑'})], catalog);
  assert.equal(level[0].status,'advance');
});

test('combined band loads and assistance bands compare in the right direction',()=>{
  const plan=M.groupDefaults('threeDay'),base=Date.now()-10*day,name='脚抬高俯卧撑',key=`main::1::${slug(name)}`;
  const make=(offset,reps,extra={})=>session({plan,dayKey:'push',startedAt:base+offset*day,completed:{main:{completed:1}},values:{[key]:{reps,levelName:name,...extra}}});
  const twoBands={bandLoad:{combination:'120+2',unit:'lb',mode:'resistance'}};
  const addedBand={bandLoad:{combination:'135+2',unit:'lb',mode:'resistance'}};
  const combo=D.progressRows([], [make(0,10,twoBands),make(1,9,addedBand)], catalog);
  assert.equal(combo[0].status,'advance');
  assert.equal(combo[0].loadLabel,'阻力 135+2 lb');
  const lessAssist=D.progressRows([], [
    make(0,8,{bandLoad:{min:20,max:20,unit:'kg',mode:'assistance'}}),
    make(1,8,{bandLoad:{min:10,max:10,unit:'kg',mode:'assistance'}}),
  ], catalog);
  assert.equal(lessAssist[0].status,'advance');
  assert.equal(lessAssist[0].loadLabel,'辅助 10 kg');
});

test('removing load is labelled deload instead of regression',()=>{
  const plan=M.groupDefaults('threeDay'),base=Date.now()-10*day,name='脚抬高俯卧撑',key=`main::1::${slug(name)}`;
  const make=(offset,reps,extra={})=>session({plan,dayKey:'push',startedAt:base+offset*day,completed:{main:{completed:1}},values:{[key]:{reps,levelName:name,...extra}}});
  const rows=D.progressRows([], [
    make(0,8,{bandLoad:{min:15,max:25,unit:'kg',mode:'resistance'}}),
    make(1,12),
  ], catalog);
  assert.equal(rows[0].status,'deload');
  assert.equal(rows[0].note,'负荷下调');
  assert.equal(rows[0].best,12);
});

test('stalls and regressions only compare sets at the current load',()=>{
  const plan=M.groupDefaults('threeDay'),base=Date.now()-10*day,name='脚抬高俯卧撑',key=`main::1::${slug(name)}`;
  const make=(offset,reps,extra={})=>session({plan,dayKey:'push',startedAt:base+offset*day,completed:{main:{completed:1}},values:{[key]:{reps,levelName:name,...extra}}});
  const band={min:15,max:25,unit:'kg',mode:'resistance'};
  const flat=D.progressRows([], [make(0,12),make(1,8,{bandLoad:band}),make(2,8,{bandLoad:band}),make(3,8,{bandLoad:band}),make(4,8,{bandLoad:band})], catalog);
  assert.equal(flat[0].status,'stall');
  assert.equal(flat[0].best,8);
  assert.deepEqual(flat[0].points.map(p=>p.reps),[8,8,8,8]);
  const down=D.progressRows([], [make(0,12),make(1,8,{bandLoad:band}),make(2,6,{bandLoad:band})], catalog);
  assert.equal(down[0].status,'regress');
});

test('recently trained exercises are listed first',()=>{
  const plan=M.groupDefaults('threeDay'),base=Date.now()-10*day;
  const oldName='脚抬高俯卧撑',recentName='分腿蹲';
  const make=(offset,name)=>session({plan,dayKey:'push',startedAt:base+offset*day,completed:{main:{completed:1}},values:{[`main::1::${slug(name)}`]:{reps:10,levelName:name,levelIndex:0}}});
  const rows=D.progressRows([], [make(0,oldName),make(1,recentName)], catalog);
  assert.equal(rows[0].slug,slug(recentName));
  assert.equal(rows[1].slug,slug(oldName));
});

test('unfinished rounds and incomplete values are ignored',()=>{
  const plan=M.groupDefaults('threeDay'),name='脚抬高俯卧撑',key=`main::1::${slug(name)}`;
  const row=session({plan,dayKey:'push',startedAt:Date.now(),completed:{main:{completed:0}},values:{[key]:{reps:12}}});
  assert.deepEqual(D.progressRows([],[row],catalog),[]);
  row.values[key].reps='';
  row.roundProgress.main.completed=1;
  assert.deepEqual(D.progressRows([],[row],catalog),[]);
});

test('weekly summary compares the last seven days with the prior week',()=>{
  const now=new Date('2026-11-11T12:00:00').getTime();
  const days={
    '2026-11-10':{pull:{count:1,totalMs:3600000}},
    '2026-11-09':{push:{count:1,totalMs:3600000},legs:{count:1,totalMs:1800000}},
    '2026-11-03':{push:{count:1,totalMs:2400000}},
  };
  const volumes=[{date:'2026-11-10',totalSets:9},{date:'2026-11-09',totalSets:12},{date:'2026-11-03',totalSets:6}];
  const stat=D.summary(volumes,{days,now});
  assert.equal(stat.sessions,3);
  assert.equal(stat.activeDays,2);
  assert.equal(stat.sets,21);
  assert.equal(stat.prevSessions,1);
  assert.equal(stat.prevSets,6);
});
