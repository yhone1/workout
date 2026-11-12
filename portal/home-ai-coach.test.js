const test=require('node:test'),assert=require('node:assert/strict');
const A=require('./home-ai-coach'),M=require('./home-plan');
const catalog=M.catalog([]);

test('proposal operations render targets, fields and value changes',()=>{
  assert.equal(A.proposalOperationLabel({day:'push',variant:'A',sectionId:'support',exerciseName:'弹力带侧平举',field:'repMax',current:20,value:22}),'推 A · 补强组 · 弹力带侧平举 · 次数上限 20 → 22');
  assert.equal(A.proposalOperationLabel({day:'pull',variant:'B',sectionId:'main',field:'rounds',current:3,value:4}),'拉 B · 主关卡 · 轮数 3 → 4');
  assert.equal(A.proposalOperationLabel({day:'legs',variant:'A',sectionId:'main',field:'restSeconds',current:150,value:180}),'腿 A · 主关卡 · 组间休息 150 秒 → 180 秒');
  assert.equal(A.fieldValue({field:'rir',current:2,value:1}),'2 → 1');
  assert.equal(A.statusLabels.pending,'待确认');
});

test('applyOperations changes only the requested numeric target',()=>{
  const plan=M.groupDefaults(),before=JSON.stringify(plan);
  const result=M.applyOperations(plan,[{day:'push',variant:'A',sectionId:'support',exerciseId:'lateral',field:'repMax',value:22,current:20}],catalog);
  assert.deepEqual(result.errors,[]);
  const group=result.plan.days.push.A.groups.find(g=>g.id==='support');
  assert.equal(group.exercises[0].repMax,22);
  assert.equal(JSON.stringify(plan),before);
});

test('stale or unsupported proposals leave the plan untouched',()=>{
  const plan=M.groupDefaults(),before=JSON.stringify(plan);
  const stale=M.applyOperations(plan,[{day:'push',variant:'A',sectionId:'support',exerciseId:'lateral',field:'repMax',value:22,current:19}],catalog);
  assert.match(stale.errors[0],/计划已变化/);
  assert.equal(JSON.stringify(stale.plan),before);

  const invalid=M.applyOperations(plan,[{day:'push',variant:'A',sectionId:'support',field:'rounds',value:1}],catalog);
  assert.ok(invalid.errors.length);
  assert.equal(JSON.stringify(invalid.plan),before);

  const unknown=M.applyOperations(plan,[{day:'push',variant:'A',sectionId:'nope',field:'rounds',value:4}],catalog);
  assert.match(unknown.errors[0],/动作组不存在/);

  const field=M.applyOperations(plan,[{day:'push',variant:'A',sectionId:'support',exerciseId:'lateral',field:'exerciseId',value:'pull'}],catalog);
  assert.ok(field.errors.length);
});

test('module exposes a browser mount entry that is safe without a DOM',()=>{
  assert.equal(typeof A.mount,'function');
  const coach=A.mount({getToken:()=>'',getCatalogItems:()=>[],isOffline:()=>false});
  assert.equal(coach.state.mounted,false);
  assert.equal(A.mount({}),coach);
});

test('group rest changes apply and duplicate targets are rejected',()=>{
  const plan=M.groupDefaults();
  const rest=M.applyOperations(plan,[{day:'legs',variant:'B',sectionId:'main',field:'restSeconds',value:180,current:150}],catalog);
  assert.deepEqual(rest.errors,[]);
  assert.equal(rest.plan.days.legs.B.groups.find(g=>g.id==='main').restSeconds,180);

  const duplicate=M.applyOperations(plan,[
    {day:'push',variant:'A',sectionId:'support',exerciseId:'lateral',field:'repMax',value:22,current:20},
    {day:'push',variant:'A',sectionId:'support',exerciseId:'lateral',field:'repMax',value:23,current:20},
  ],catalog);
  assert.match(duplicate.errors[0],/重复调整/);
  assert.equal(duplicate.plan.days.push.A.groups.find(g=>g.id==='support').exercises[0].repMax,20);
});
