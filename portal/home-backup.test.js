const test=require('node:test'),assert=require('node:assert/strict');
const B=require('./home-backup');
const K=B.DEFAULT_KEYS;
class Storage{
  constructor(values={}){this.values={...values};}
  getItem(key){return Object.hasOwn(this.values,key)?this.values[key]:null;}
  setItem(key,value){this.values[key]=String(value);}
  removeItem(key){delete this.values[key];}
}
const sample={
  thinMuscleDoneV8:'{"push":true}',
  thinMuscleWorkoutSessionV3:JSON.stringify({days:{'2026-11-10':{pull:{count:1,totalMs:3600000,lastFeedback:'right',sessions:[{startedAt:1762764000000,endedAt:1762767600000,durationMs:3600000,variant:'A',feedback:'right',planLabel:'居家计划'}]}}}}),
  thinMuscleExerciseFavoritesV1:'["row"]',
};
test('full backup round-trips known keys and keeps the auth token out',()=>{
  const storage=new Storage({...sample,thinMuscleAuthToken:'secret',unrelated:'x'});
  const backup=B.createBackup(storage,{now:Date.parse('2026-11-11T10:00:00Z')});
  assert.equal(backup.format,B.FORMAT);assert.equal(backup.version,1);
  assert.deepEqual(Object.keys(backup.data).sort(),Object.keys(sample).sort());
  assert.equal(backup.data.thinMuscleAuthToken,undefined);
  const parsed=B.parseBackup(JSON.stringify(backup));
  assert.equal(parsed.format,B.FORMAT);
  assert.equal(parsed.sessions,1);
  assert.deepEqual(parsed.data,sample);
});
test('flat localStorage dumps are accepted for migration',()=>{
  const parsed=B.parseBackup(JSON.stringify(sample));
  assert.equal(parsed.format,'legacy');
  assert.deepEqual(parsed.data,sample);
});
test('invalid, foreign or partial files are rejected with a clear code',()=>{
  for(const text of ['not json','[]','{"foo":"bar"}','{"format":"other","version":1,"data":{}}','{"format":"thin-muscle-backup","version":99,"data":{}}']){
    assert.throws(()=>B.parseBackup(text),error=>error.code==='invalid_backup');
  }
  assert.throws(()=>B.parseBackup(JSON.stringify({thinMuscleDoneV8:'{bad'})),error=>error.code==='invalid_backup');
});
test('applying a backup replaces stale snapshots but preserves auth and ownership',()=>{
  const storage=new Storage({thinMuscleDoneV8:'{"old":true}',thinMuscleBodyProfileV1:'{"weight":70}',thinMuscleAuthToken:'token',thinMuscleStateOwnerV1:'7'});
  const applied=B.applyBackup(storage,sample,{keys:K});
  assert.equal(applied.count,3);
  assert.equal(storage.getItem('thinMuscleDoneV8'),sample.thinMuscleDoneV8);
  assert.equal(storage.getItem('thinMuscleBodyProfileV1'),null);
  assert.equal(storage.getItem('thinMuscleAuthToken'),'token');
  assert.equal(storage.getItem('thinMuscleStateOwnerV1'),'7');
});
test('session CSV exports one row per session and escapes unsafe text',()=>{
  const csv=B.sessionCsv({'2026-11-10':{pull:{count:1,totalMs:3600000,lastFeedback:'right',sessions:[{startedAt:1762764000000,endedAt:1762767600000,durationMs:3600000,variant:'A',feedback:'hard',planLabel:'计划, "A"'}]}}});
  const lines=csv.split('\r\n');
  assert.equal(lines[0],'日期,训练日,开始时间,结束时间,时长（分钟）,体感,版本,计划,轮次摘要');
  assert.match(lines[1],/^2026-11-10,拉,/);
  assert.match(lines[1],/60\.0,偏吃力,A,"计划, ""A"""/);
});
test('performance CSV includes reps, RIR, level and resistance per set',()=>{
  const csv=B.performanceCsv({1:{day:'pull',variant:'A',startedAt:1762764000000,endedAt:1762767600000,values:{[`main::2::${encodeURIComponent('TRX划船')}`]:{reps:12,rir:2,levelIndex:1,levelName:'高阻力TRX划船',bandLoad:{combination:'65+32',unit:'lb'}}}}});
  const lines=csv.split('\r\n');
  assert.match(lines[1],/TRX划船/);
  assert.match(lines[1],/12,2,高阻力TRX划船,阻力 65\+32 lb/);
});
