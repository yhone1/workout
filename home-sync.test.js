const test = require('node:test');
const assert = require('node:assert/strict');

let createHomeSync = null;
let LEGACY_KEYS = null;
let OWNER_KEY = null;
let SNAPSHOT_PREFIX = null;
try {
  ({ createHomeSync, LEGACY_KEYS, OWNER_KEY, SNAPSHOT_PREFIX } = require('./home-sync'));
} catch {
  // Keep the first red run assertion-based until the sync module is implemented.
}

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
  keys() { return [...this.values.keys()]; }
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function requireSync() {
  assert.equal(typeof createHomeSync, 'function', 'home-sync module should load');
}

test('home sync module exposes owner marker and legacy key inventory', () => {
  requireSync();
  assert.equal(OWNER_KEY, 'thinMuscleStateOwnerV1');
  assert.equal(SNAPSHOT_PREFIX, 'thinMuscleLocalSnapshotV1:');
  assert.deepEqual(LEGACY_KEYS, [
    'thinMuscleDoneV8', 'thinMusclePlanVariantV3', 'thinMuscleWorkoutSessionV3',
    'thinMuscleIntensityRatingsV2', 'thinMuscleRestSecondsV2', 'thinMuscleBodyProfileV1',
    'thinMuscleExercisePerformanceV1', 'thinMuscleGrowthV1', 'thinMuscleMrtV1', 'thinMuscleCindyV1', 'thinMuscleHomePlanV1',
  ]);
});

test('refresh preserves one newer pending workout snapshot, including rounds, reps and challenges', async()=>{
  const session='thinMuscleWorkoutSessionV3',done='thinMuscleDoneV8',reps='thinMuscleExercisePerformanceV1',cindy='thinMuscleCindyV1';
  const local={[session]:JSON.stringify({updatedAt:200,active:{homeSchedule:'fourDay',roundFlow:{added:{main:1}}}}),[done]:'new rounds',[reps]:'new reps',[cindy]:'new Cindy'};
  const remote={[session]:JSON.stringify({updatedAt:100,active:null}),[done]:'old rounds',[reps]:'old reps',[cindy]:'old Cindy'};
  const storage=new MemoryStorage({[OWNER_KEY]:'7',...local}),writes=[];
  const sync=createHomeSync({storage,fetchImpl:async(_url,options)=>{if(options.method==='POST'){writes.push(JSON.parse(options.body));return jsonResponse({ok:true});}return jsonResponse(remote);}});
  await sync.prepareAccount({userId:7});
  for(const key of Object.keys(local)){assert.equal(storage.getItem(key),local[key]);assert.equal(writes[0][key],local[key]);}
});

test('newer cloud workouts win, and pending workout bundles never cross account boundaries', async()=>{
  const key='thinMuscleWorkoutSessionV3',local=JSON.stringify({updatedAt:300,active:{day:'push'}}),remote=JSON.stringify({updatedAt:400,active:null});
  for(const target of [7,8]){
    const storage=new MemoryStorage({[OWNER_KEY]:'7',[key]:local,thinMuscleDoneV8:'private rounds'}),writes=[];
    const sync=createHomeSync({storage,fetchImpl:async(_url,options)=>{if(options.method==='POST')writes.push(options.body);return jsonResponse({[key]:remote,thinMuscleDoneV8:'cloud rounds'});}});
    await sync.prepareAccount({userId:target});assert.equal(storage.getItem(key),remote);assert.equal(storage.getItem('thinMuscleDoneV8'),'cloud rounds');assert.equal(writes.length,0);
  }
});

test('a failed pending-workout retry cannot destroy the local snapshot', async()=>{
  const key='thinMuscleWorkoutSessionV3',local=JSON.stringify({updatedAt:300,active:{day:'pull'}});
  const storage=new MemoryStorage({[OWNER_KEY]:'7',[key]:local,thinMuscleExercisePerformanceV1:'actual reps'});
  const sync=createHomeSync({storage,fetchImpl:async(_url,options)=>options.method==='POST'?jsonResponse({error:'offline'},503):jsonResponse({[key]:JSON.stringify({updatedAt:100})})});
  await assert.rejects(sync.prepareAccount({userId:7}));assert.equal(storage.getItem(key),local);assert.equal(storage.getItem('thinMuscleExercisePerformanceV1'),'actual reps');
});

test('a newer unsynced plan is retained and uploaded on same-account refresh', async () => {
  const key='thinMuscleHomePlanV1',local=JSON.stringify({updatedAt:200,active:{label:'local'},draft:{label:'draft'}}),remote=JSON.stringify({updatedAt:100,active:{label:'old'}});
  const storage=new MemoryStorage({[OWNER_KEY]:'7',[key]:local}),writes=[];
  const sync=createHomeSync({storage,fetchImpl:async (_url,options)=>{
    if(options.method==='POST')writes.push(JSON.parse(options.body));
    return jsonResponse(options.method==='POST'?{ok:true}:{[key]:remote});
  }});
  await sync.prepareAccount({userId:7});
  assert.equal(storage.getItem(key),local);assert.equal(writes[0][key],local);
});

test('plan draft and custom actions never leak into another account', async () => {
  const key='thinMuscleHomePlanV1',local=JSON.stringify({updatedAt:999,custom:[{id:'old'}],draft:{label:'private'}}),remote=JSON.stringify({updatedAt:100,custom:[],draft:null});
  const storage=new MemoryStorage({[OWNER_KEY]:'7',[key]:local}),writes=[];
  const sync=createHomeSync({storage,fetchImpl:async (_url,options)=>{
    if(options.method==='POST')writes.push(JSON.parse(options.body));return jsonResponse({[key]:remote});
  }});
  await sync.prepareAccount({userId:8});assert.equal(storage.getItem(key),remote);assert.equal(writes.length,0);
  const backup=JSON.parse(storage.getItem(storage.keys().find(k=>k.startsWith(SNAPSHOT_PREFIX))));assert.equal(backup.entries[key],local);
});

test('newer cloud plan wins and failed retry never destroys the local plan', async () => {
  const key='thinMuscleHomePlanV1',local=JSON.stringify({updatedAt:200}),remote=JSON.stringify({updatedAt:300});
  const storage=new MemoryStorage({[OWNER_KEY]:'7',[key]:local});
  const sync=createHomeSync({storage,fetchImpl:async()=>jsonResponse({[key]:remote})});
  await sync.prepareAccount({userId:7});assert.equal(storage.getItem(key),remote);
  storage.setItem(key,local);
  const failed=createHomeSync({storage,fetchImpl:async (_url,options)=>{if(options.method==='POST')throw new Error('offline');return jsonResponse({[key]:JSON.stringify({updatedAt:100})});}});
  await assert.rejects(failed.prepareAccount({userId:7}),/offline/);assert.equal(storage.getItem(key),local);
});

test('unowned legacy data is backed up and never silently uploaded to an empty account', async () => {
  requireSync();
  const storage = new MemoryStorage({ thinMuscleDoneV8: '{"push":true}', thinMuscleRestSecondsV2: '60' });
  const calls = [];
  const sync = createHomeSync({ storage, now: () => 1790640000000, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({});
  } });
  const result = await sync.prepareAccount({ userId: 7 });
  assert.equal(result.status, 'legacy_import_confirmation');
  assert.equal(calls.some(({ options }) => options.method === 'POST'), false);
  assert.equal(storage.getItem(OWNER_KEY), null);
  assert.equal(storage.getItem('thinMuscleDoneV8'), '{"push":true}');
  const snapshots = storage.keys().filter((key) => key.startsWith(SNAPSHOT_PREFIX));
  assert.equal(snapshots.length, 1);
  const backup = JSON.parse(storage.getItem(snapshots[0]));
  assert.equal(backup.ownerId, null);
  assert.equal(backup.entries.thinMuscleDoneV8, '{"push":true}');
});

test('legacy data enters an account only after explicit confirmation', async () => {
  requireSync();
  const storage = new MemoryStorage({ thinMuscleDoneV8: '{"pull":true}' });
  const calls = [];
  const sync = createHomeSync({ storage, fetchImpl: async (_url, options = {}) => {
    calls.push(options);
    return jsonResponse(options.method === 'POST' ? { ok: true } : {});
  } });
  const prepared = await sync.prepareAccount({ userId: 9 });
  const completed = await sync.completeLegacyImport({ userId: 9, prepared, importLegacy: true });
  const post = calls.find((options) => options.method === 'POST');
  assert.equal(completed.status, 'ready');
  assert.equal(storage.getItem(OWNER_KEY), '9');
  assert.deepEqual(JSON.parse(post.body), { thinMuscleDoneV8: '{"pull":true}' });
});

test('skipping legacy import applies only the selected account server state', async () => {
  requireSync();
  const storage = new MemoryStorage({ thinMuscleDoneV8: 'old-user', thinMuscleBodyProfileV1: 'old-body' });
  const sync = createHomeSync({ storage, fetchImpl: async () => jsonResponse({}) });
  const prepared = await sync.prepareAccount({ userId: 12 });
  const result = await sync.completeLegacyImport({ userId: 12, prepared, importLegacy: false });
  assert.equal(result.status, 'ready');
  assert.equal(storage.getItem(OWNER_KEY), '12');
  assert.equal(storage.getItem('thinMuscleDoneV8'), null);
  assert.equal(storage.getItem('thinMuscleBodyProfileV1'), null);
});

test('unowned local data is backed up when the target account already has cloud data', async () => {
  requireSync();
  const storage = new MemoryStorage({ thinMuscleDoneV8: 'old-user', thinMuscleBodyProfileV1: 'old-body' });
  const sync = createHomeSync({ storage, fetchImpl: async () => jsonResponse({ thinMuscleBodyProfileV1: 'current-user' }) });
  const result = await sync.prepareAccount({ userId: 14 });
  assert.equal(result.status, 'ready');
  assert.equal(storage.getItem(OWNER_KEY), '14');
  assert.equal(storage.getItem('thinMuscleDoneV8'), null);
  assert.equal(storage.getItem('thinMuscleBodyProfileV1'), 'current-user');
  assert.equal(storage.keys().filter((key) => key.startsWith(SNAPSHOT_PREFIX)).length, 1);
});

test('switching accounts snapshots the previous owner before replacing local workout values', async () => {
  requireSync();
  const storage = new MemoryStorage({
    [OWNER_KEY]: '21', thinMuscleDoneV8: 'account-a', thinMuscleBodyProfileV1: 'private-a',
  });
  const sync = createHomeSync({ storage, fetchImpl: async () => jsonResponse({ thinMuscleDoneV8: 'account-b' }) });
  const result = await sync.prepareAccount({ userId: 22 });
  assert.equal(result.status, 'ready');
  assert.equal(storage.getItem(OWNER_KEY), '22');
  assert.equal(storage.getItem('thinMuscleDoneV8'), 'account-b');
  assert.equal(storage.getItem('thinMuscleBodyProfileV1'), null);
  const key = storage.keys().find((item) => item.startsWith(SNAPSHOT_PREFIX));
  const backup = JSON.parse(storage.getItem(key));
  assert.equal(backup.ownerId, '21');
  assert.equal(backup.entries.thinMuscleBodyProfileV1, 'private-a');
});

test('same-account refresh restores cloud values and uploads only locally owned missing keys', async () => {
  requireSync();
  const storage = new MemoryStorage({
    [OWNER_KEY]: '5', thinMuscleDoneV8: 'stale', thinMusclePlanVariantV3: 'local-only',
  });
  const calls = [];
  const sync = createHomeSync({ storage, fetchImpl: async (_url, options = {}) => {
    calls.push(options);
    return jsonResponse(options.method === 'POST' ? { ok: true } : { thinMuscleDoneV8: 'cloud' });
  } });
  const result = await sync.prepareAccount({ userId: 5 });
  assert.equal(result.status, 'ready');
  assert.equal(storage.getItem('thinMuscleDoneV8'), 'cloud');
  assert.equal(storage.getItem('thinMusclePlanVariantV3'), 'local-only');
  const post = calls.find((options) => options.method === 'POST');
  assert.deepEqual(JSON.parse(post.body), { thinMusclePlanVariantV3: 'local-only' });
});

test('403 and network errors fail closed without clearing or reassigning local data', async () => {
  requireSync();
  for (const fetchImpl of [
    async () => jsonResponse({ error: 'membership_required' }, 403),
    async () => { throw new Error('offline'); },
  ]) {
    const storage = new MemoryStorage({ [OWNER_KEY]: '8', thinMuscleDoneV8: 'keep-me' });
    const sync = createHomeSync({ storage, fetchImpl });
    await assert.rejects(sync.prepareAccount({ userId: 8 }));
    assert.equal(storage.getItem(OWNER_KEY), '8');
    assert.equal(storage.getItem('thinMuscleDoneV8'), 'keep-me');
  }
});
