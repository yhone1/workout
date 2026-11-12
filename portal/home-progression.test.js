const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('./home-progression'),M=require('./home-plan');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const block=source.slice(source.indexOf('  const LEVEL_LIBRARY ='),source.indexOf('  function levelConfig('));
function library(extend=true){const ctx={HomeProgression:P};vm.createContext(ctx);vm.runInContext((extend?block:block.replace('HomeProgression.extend(LEVEL_LIBRARY);',''))+';globalThis.library=LEVEL_LIBRARY;',ctx);return JSON.parse(JSON.stringify(ctx.library));}
test('all 29 existing home exercises have a route and existing levels remain an exact prefix',()=>{
  const old=library(false),next=library(),strength=M.catalog([]).filter(ex=>!ex.timerType);assert.equal(strength.length,29);
  assert.equal(M.catalog([]).filter(ex=>ex.timerType).length,2);
  for(const ex of strength)assert.ok(next[ex.name]?.levels.length,ex.name);
  for(const [name,cfg] of Object.entries(old)){
    assert.deepEqual(next[name].levels.slice(0,cfg.levels.length),cfg.levels,name);
    assert.equal(next[name].defaultIndex,cfg.defaultIndex,name);assert.ok(next[name].levels.length>cfg.levels.length,name);
  }
});
test('new equipment and advanced variants require setup confirmation; final stages allow further adjustment',()=>{
  const next=library();
  for(const name of Object.keys(P.routes)){
    const cfg=next[name];assert.ok(cfg.strategy&&cfg.setupHint,name);
    const added=cfg.levels.slice(cfg.legacyLength);assert.ok(added.every(level=>level.requiresSetup===true),name);assert.equal(added.at(-1).loadable,true,name);
  }
  assert.equal(next['TRX划船'].levels.at(-1).perSide,true);
  assert.match(next['脚抬高俯卧撑'].levels.at(-1).cue,/不靠继续抬高脚/);
  assert.match(next['引体向上 / 弹力带辅助'].levels.at(-1).name,/需负重装备/);
});
test('setup revisions distinguish new resistance from historical unknown resistance and survive JSON storage',()=>{
  const entry={levelIndex:3,xp:77,upgradeStreak:1,hardStreak:1,history:[{levelIndex:2}]};
  assert.equal(P.sameSetup({levelIndex:3},entry,3),true);assert.equal(P.setSetup(entry,'红带，握持40cm，脚高25cm'),true);
  assert.equal(entry.setupRevision,1);assert.equal(entry.upgradeStreak,0);assert.equal(entry.hardStreak,0);assert.equal(entry.xp,77);assert.equal(entry.history.length,1);
  assert.equal(P.sameSetup({levelIndex:3},entry,3),false);assert.equal(P.sameSetup({levelIndex:3,setupRevision:1},entry,3),true);assert.equal(P.sameSetup({levelIndex:2,setupRevision:1},entry,3),false);
  assert.equal(P.setSetup(entry,entry.setupNote),false);assert.equal(P.setSetup(entry,'  '),false);assert.equal(P.setSetup(entry,'x'.repeat(241)),false);
  assert.equal(P.setSetup(entry,'红带，握持38cm，脚高25cm'),true);const reloaded=JSON.parse(JSON.stringify(entry));assert.equal(reloaded.setupRevision,2);assert.equal(reloaded.xp,77);
  assert.equal(P.escape('<img src=x onerror=alert(1)>').includes('<'),false);
});

test('band loads are stored per level without resetting XP, identities or historical snapshots',()=>{
  const entry={levelIndex:2,xp:77,setupNote:'红带，握持40cm',upgradeStreak:1,hardStreak:1,history:[{type:'up',levelIndex:1}]};
  assert.equal(P.setBandLoad(entry,2,{min:'10',max:'20',unit:'lb',mode:'resistance'}),true);
  const first=P.bandLoad(entry,2);assert.equal(P.bandLabel(first),'阻力 10–20 lb');
  const oldRound={levelIndex:2,setupRevision:entry.setupRevision,bandLoad:first};
  assert.equal(P.sameSetup(oldRound,entry,2),true);
  assert.equal(P.setBandLoad(entry,2,{min:15,max:'',unit:'kg',mode:'resistance'}),true);
  assert.equal(P.sameSetup(oldRound,entry,2),false);assert.equal(P.bandLabel(oldRound.bandLoad),'阻力 10–20 lb');
  P.setBandLoad(entry,1,{min:5,max:5,unit:'kg',mode:'assistance'});
  const restored=JSON.parse(JSON.stringify(entry));
  assert.equal(P.bandLabel(P.bandLoad(restored,1)),'辅助 5 kg');assert.equal(P.bandLabel(P.bandLoad(restored,2)),'阻力 15 kg');
  assert.equal(restored.levelIndex,2);assert.equal(restored.xp,77);assert.equal(restored.history.length,1);assert.equal(restored.setupNote,'红带，握持40cm');
  assert.equal(restored.upgradeStreak,0);assert.equal(restored.hardStreak,0);
  const revision=restored.setupRevision;assert.equal(P.setBandLoad(restored,2,P.bandLoad(restored,2)),false);assert.equal(restored.setupRevision,revision);
  assert.equal(P.setBandLoad(restored,2,{min:'',max:'',unit:'kg',mode:'resistance'}),true);assert.equal(P.bandLoad(restored,2),null);assert.ok(P.bandLoad(restored,1));
});
test('band load validation rejects invalid values atomically and old unknown data stays unknown',()=>{
  const entry={levelIndex:0,xp:9,history:[]},base=JSON.stringify(entry);
  for(const bad of [{min:-1,max:2},{min:0,max:1},{min:10,max:5},{min:1,max:1001},{min:1,max:2,unit:'stone'},{min:1,max:2,mode:'fake'},{min:'',max:3},{min:'no',max:3}]){
    assert.throws(()=>P.setBandLoad(entry,0,{unit:'kg',mode:'resistance',...bad}));assert.equal(JSON.stringify(entry),base);
  }
  assert.equal(P.bandLoad(entry),null);assert.equal(P.bandLabel({min:'<script>',unit:'kg',mode:'resistance'}),'');
  assert.equal(P.usesBand('弹力带二头弯举'),true);assert.equal(P.usesBand('脚抬高俯卧撑'),true);assert.equal(P.usesBand('引体向上 / 弹力带辅助'),true);assert.equal(P.usesBand('跪姿健腹轮'),false);assert.equal(P.usesBand('TRX划船'),false);
});

test('combined bands retain the ordered combination per level without treating the sum as actual force',()=>{
  const entry={levelIndex:0,xp:42,history:[]};
  P.setBandLoad(entry,0,{combination:' 65 ＋ 32 + 20 ',unit:'lb',mode:'resistance'});
  const load=P.bandLoad(entry,0);assert.equal(load.combination,'65+32+20');assert.equal(load.min,undefined);
  assert.equal(P.bandLabel(load),'阻力 65+32+20 lb');assert.equal(P.bandInput(load),'65+32+20');
  const version=entry.setupRevision;assert.equal(P.setBandLoad(entry,0,{combination:'65+32+20',unit:'lb',mode:'resistance'}),false);assert.equal(entry.setupRevision,version);
  P.setBandLoad(entry,1,{combination:'32+20',unit:'kg',mode:'assistance'});
  const restored=JSON.parse(JSON.stringify(entry));assert.equal(P.bandLabel(P.bandLoad(restored,0)),'阻力 65+32+20 lb');assert.equal(P.bandLabel(P.bandLoad(restored,1)),'辅助 32+20 kg');
  assert.equal(restored.xp,42);assert.equal(restored.levelIndex,0);
  P.setBandLoad(entry,0,{combination:'',unit:'lb',mode:'resistance'});assert.equal(P.bandLoad(entry,0),null);assert.ok(P.bandLoad(entry,1));
});

test('text entry keeps legacy single loads and ranges equivalent and rejects malformed combinations atomically',()=>{
  const entry={levelIndex:0,xp:12,history:[]};P.setBandLoad(entry,0,{min:15,max:25,unit:'kg',mode:'resistance'});
  assert.equal(P.bandInput(P.bandLoad(entry,0)),'15–25');const revision=entry.setupRevision;
  assert.equal(P.setBandLoad(entry,0,{combination:'15-25',unit:'kg',mode:'resistance'}),false);assert.equal(entry.setupRevision,revision);
  P.setBandLoad(entry,1,{min:65,max:65,unit:'lb',mode:'resistance'});
  assert.equal(P.setBandLoad(entry,1,{combination:'65',unit:'lb',mode:'resistance'}),false);
  const before=JSON.stringify(entry);
  for(const combination of ['65++32','65+','+65','65+0','65+-2','1001+20','15-5','NaN+20','Infinity+20','65+32*2','<img src=x onerror=alert(1)>','1+'.repeat(41)+'2']){
    assert.throws(()=>P.setBandLoad(entry,0,{combination,unit:'kg',mode:'resistance'}),combination);assert.equal(JSON.stringify(entry),before);
  }
});
