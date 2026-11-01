const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const T=require('./tabata'),M=require('./home-plan');
test('the action library has instructions and real demonstrations, and default exclusions are enforced',()=>{
  assert.equal(new Set(T.LIBRARY.map(a=>a.id)).size,T.LIBRARY.length);assert.ok(T.LIBRARY.length>=8);
  for(const a of T.LIBRARY){assert.ok(a.cue);assert.ok(fs.existsSync(path.join(__dirname,'..','IMG',a.media)),a.media);}
  assert.ok(T.pool({}).length>=2);assert.ok(T.pool({}).every(a=>!a.tags.includes('jump')&&!a.tags.includes('support')));
});
test('random pairs are distinct, obey exclusions and avoid previous unordered pairs where possible',()=>{
  const config={...T.randomSettings(),excludedIds:['punch']};let previous=[];
  for(let i=0;i<50;i++){
    const picked=T.pick(config,previous.length?[previous]:[],()=>i/50);
    assert.equal(new Set(picked.ids).size,2);assert.ok(picked.ids.every(id=>T.pool(config).some(a=>a.id===id)));
    if(previous.length)assert.notEqual([...picked.actions].sort().join('|'),[...previous].sort().join('|'));
    previous=picked.actions;
  }
});
test('two-candidate fallback works and an insufficient or malformed pool is rejected',()=>{
  const config={mode:'random',excludedTags:[],excludedIds:T.LIBRARY.slice(2).map(a=>a.id)};
  assert.equal(T.pick(config,[T.LIBRARY.slice(0,2).map(a=>a.name)]).ids.length,2);
  assert.throws(()=>T.pick({...config,excludedIds:T.LIBRARY.slice(1).map(a=>a.id)}),/至少保留两个/);
  assert.ok(T.validate({mode:'random',excludedTags:['unknown']}));assert.ok(T.validate({mode:'random',excludedIds:['unknown']}));
});
test('session selections survive JSON reload, stay fixed once locked and permit pre-start replacement',()=>{
  let active={};const config=T.randomSettings(),key='group::tabata';
  const first=T.ensure(active,key,config,[],false,()=>.1),again=T.ensure(active,key,config,[],false,()=>.9);assert.equal(first,again);
  const changed=T.ensure(active,key,config,[],true,()=>.4);assert.notDeepEqual([...changed.ids].sort(),[...first.ids].sort());
  changed.locked=true;active=JSON.parse(JSON.stringify(active));
  const before=JSON.stringify(active);T.ensure(active,key,config,[],true,()=>.8);assert.equal(JSON.stringify(active),before);
});
test('new Tabata defaults are random, while legacy/custom fixed actions remain valid',()=>{
  const p=M.groupDefaults(),t=p.days.push.A.groups.at(-1).exercises[0].interval;
  assert.equal(t.mode,'random');assert.deepEqual(M.validate(p,M.catalog()),[]);
  t.mode='fixed';t.actions=['自选动作一','自选动作二'];assert.deepEqual(M.validate(p,M.catalog()),[]);
  t.mode='random';t.excludedIds=T.LIBRARY.map(a=>a.id);assert.match(M.validate(p,M.catalog()).join(','),/至少保留两个/);
});
test('current and next timer actions alternate and the final rest indicates completion',()=>{
  const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const ctx={timer:{intervalPlan:{actions:['动作A','动作B'],rest:1},phase:'work',round:1,totalRounds:2,left:12}};vm.createContext(ctx);
  for(const name of ['intervalAction','intervalNextAction']){const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);vm.runInContext(source.slice(start,end),ctx);}
  assert.equal(ctx.intervalAction(1),'动作A');assert.equal(ctx.intervalNextAction(),'动作B');
  ctx.timer.phase='rest';ctx.timer.round=2;ctx.timer.left=7;assert.equal(ctx.intervalNextAction(),'动作B');
  ctx.timer.phase='work';ctx.timer.left=6;assert.equal(ctx.intervalAction(2),'动作B');assert.equal(ctx.intervalNextAction(),'计时完成');
  ctx.timer.phase='rest';ctx.timer.left=.8;assert.equal(ctx.intervalNextAction(),'计时完成');
});
