const test=require('node:test'),assert=require('node:assert/strict');
const C=require('./training-calendar');

test('calendar prefers newer pending local workouts only for the verified same account',()=>{
  const key='thinMuscleWorkoutSessionV3',local={[key]:JSON.stringify({updatedAt:300,days:{local:true}})},remote={[key]:JSON.stringify({updatedAt:100,days:{remote:true}})};
  assert.equal(C.selectHomeState(remote,local,'7',7),local);
  assert.equal(C.selectHomeState(remote,local,'7',8),remote);
  assert.equal(C.selectHomeState(remote,local,null,7),remote);
  assert.equal(C.selectHomeState(remote,{[key]:'invalid'},'7',7),remote);
  assert.equal(C.selectHomeState({...remote,[key]:JSON.stringify({updatedAt:400})},local,'7',7)[key],JSON.stringify({updatedAt:400}));
});

test('all training types share one calendar without counting draft or abandoned sessions',()=>{
  const input={days:{'2026-10-25':{push:{count:1,totalMs:1200000,sessions:[{variant:'A'}]},four_pull:{count:1,totalMs:1500000,sessions:[{variant:'B'}]},mrt:{count:1,totalMs:300000}}},
    cindy:[{startedAt:new Date(2026,9,25,15).getTime(),endedAt:new Date(2026,9,25,15,20).getTime(),durationMs:1200000,completedRounds:10}],
    gym:[{id:1,status:'completed',day_name:'教练腿日',ended_at:new Date(2026,9,25,16),duration_seconds:1800},{id:2,status:'draft',ended_at:new Date(2026,9,25,16)}],
    member:[{id:3,status:'completed',dayName:'自助上肢',endedAt:new Date(2026,9,25,18),durationSeconds:2400},{id:4,status:'abandoned',endedAt:new Date(2026,9,25,18)}]};
  const before=JSON.stringify(input),entries=C.mergeEntries(input),stats=C.stats(entries,['2026-10-25']);
  assert.equal(entries.length,6);assert.equal(stats.days,1);assert.equal(stats.count,6);assert.equal(stats.totalMs,8400000);
  assert.deepEqual(new Set(entries.map(e=>e.source)),new Set(['居家','挑战','健身房','会员自助']));
  assert.ok(entries.some(e=>e.label.includes('四练')));assert.equal(JSON.stringify(input),before);
});

test('historical Cindy is included but new daily Cindy records are not double counted',()=>{
  const record={startedAt:new Date(2026,9,25,12).getTime(),endedAt:new Date(2026,9,25,12,20).getTime(),durationMs:1200000};
  assert.equal(C.mergeEntries({cindy:[record,record]}).length,1);
  const entries=C.mergeEntries({days:{'2026-10-25':{cindy:{count:1,totalMs:1200000,sessions:[record]}}},cindy:[record]});
  assert.equal(entries.length,1);assert.equal(entries[0].count,1);
});

test('database sessions have a global identity across APIs and legacy aggregates retain totals',()=>{
  const row={id:9,status:'completed',startedAt:new Date(2026,9,24,22),endedAt:new Date(2026,9,25,0,10),durationSeconds:7800};
  const entries=C.mergeEntries({days:{'2026-10-25':{legs:{count:7,totalMs:700000,sessions:[]}}},gym:[row],member:[row]});
  assert.equal(entries.length,2);assert.equal(C.stats(entries,['2026-10-25']).count,8);
  assert.equal(entries.find(e=>e.id==='db:9').date,'2026-10-25');
});

test('changed totals on the same date are visible and invalid timestamps cannot create calendar cells',()=>{
  const input={days:{'2026-10-25':{push:{count:1,totalMs:60000}}}};
  assert.equal(C.stats(C.mergeEntries(input),['2026-10-25']).count,1);
  input.days['2026-10-25'].push.count=2;
  assert.equal(C.stats(C.mergeEntries(input),['2026-10-25']).count,2);
  assert.deepEqual(C.mergeEntries({gym:[{id:1,status:'completed',startedAt:'invalid'}]}),[]);
  assert.deepEqual(C.stats([],['2026-10-25']),{days:0,count:0,totalMs:0});
});
