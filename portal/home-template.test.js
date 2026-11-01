const test=require('node:test'),assert=require('node:assert/strict');
const M=require('./home-plan'),catalog=M.catalog();

test('hypertrophy template separates compound lifts and alternates A/B priorities',()=>{
  const p=M.groupDefaults();assert.deepEqual(M.validate(p,catalog),[]);
  const expected={push:{A:['feet-push','band-push'],B:['band-push','feet-push']},pull:{A:['pull','row'],B:['wide-row','chin']},legs:{A:['split','rdl'],B:['lunge','leg-curl']}};
  for(const day of M.dayKeys(p))for(const v of ['A','B']){
    const groups=p.days[day][v].groups;
    assert.deepEqual(groups.slice(1,3).map(g=>g.exercises.map(e=>e.exerciseId)),expected[day][v].map(id=>[id]));
    assert.equal(groups[0].exercises[0].exerciseId,'prepare');
    assert.equal(groups[0].exercises[0].seconds,day==='legs'?240:180);
    assert.ok(groups.slice(1,3).every(g=>g.restSeconds>=90));
    assert.equal(groups.at(-1).optional,true);assert.equal(groups.at(-1).exercises[0].exerciseId,'tabata');
  }
  assert.deepEqual(p.days.pull.A.groups[3].exercises.map(e=>e.exerciseId),['face','curl']);
  assert.deepEqual(p.days.pull.B.groups[3].exercises.map(e=>e.exerciseId),['fly','hammer']);
  assert.ok(p.days.legs.A.groups[1].exercises[0].cue.includes('弹力带'));
  assert.ok(p.days.legs.B.groups[1].exercises[0].cue.includes('弹力带'));
});

test('work sets and unequal accessory rounds match the approved six-day prescription',()=>{
  const p=M.groupDefaults(),plans=M.compile(p,catalog);
  assert.deepEqual(M.summary(p,catalog).map(row=>row.sets),[12,12,12,12,12,12]);
  for(const v of ['A','B']){
    const push=plans.push[v];assert.deepEqual(push.map(g=>g.rounds),[1,3,2,4,1]);
    assert.deepEqual(push.map(g=>g.restSeconds),[30,150,120,90,0]);
    assert.deepEqual(M.exercisesForRound(push[3],4).map(e=>e.id),['lateral']);
    assert.deepEqual(push[3].exercises.map(e=>M.setCount(push[3],e)),[4,3]);
    const pull=plans.pull[v];assert.deepEqual(pull.map(g=>g.restSeconds),[30,180,150,90,0]);
    assert.deepEqual(pull.map(g=>g.rounds),[1,3,3,3,1]);
    const legs=plans.legs[v];assert.deepEqual(legs.map(g=>g.rounds),[1,4,3,3,1]);
    assert.deepEqual(M.exercisesForRound(legs[3],3).map(e=>e.id),[v==='A'?'calf':'bent-calf']);
    assert.deepEqual(legs[3].exercises.map(e=>M.setCount(legs[3],e)),[3,2]);
  }
  assert.deepEqual(p.days.push.A.groups[1].exercises.map(e=>[e.repMin,e.repMax,e.rir]),[[6,12,2]]);
  assert.deepEqual(p.days.push.A.groups[2].exercises.map(e=>[e.repMin,e.repMax]),[[10,15]]);
  assert.deepEqual(p.days.push.B.groups[2].exercises.map(e=>[e.repMin,e.repMax]),[[8,15]]);
  assert.deepEqual(p.days.pull.A.groups[1].exercises.map(e=>[e.repMin,e.repMax]),[[5,8]]);
});

test('existing plans, legacy snapshots and four-day defaults are not overwritten by template creation',()=>{
  const legacy=M.defaults(),state={schema:1,revision:4,active:M.toGroups(legacy),draft:M.toGroups(legacy),custom:[],programs:{fourDay:M.groupDefaults('fourDay')}};
  const before=JSON.stringify(state),snapshot=JSON.stringify(M.compile(legacy,catalog));
  M.groupDefaults();assert.equal(JSON.stringify(state),before);
  assert.deepEqual(M.groupDefaults('fourDay'),M.toGroups(M.defaults('fourDay')));
  assert.equal(JSON.stringify(M.compile(legacy,catalog)),snapshot);
  assert.deepEqual(M.read(JSON.stringify(state),[]),state);
});
