const test = require('node:test');
const assert = require('node:assert/strict');
const { requireMembership } = require('./membership-access');

let mountWorkoutStateRoutes = null;
try { ({ mountWorkoutStateRoutes } = require('./workout-state')); } catch {}

function appHarness() {
  const routes = { GET: new Map(), POST: new Map() };
  return {
    routes,
    get(path, ...handlers) { routes.GET.set(path, handlers); },
    post(path, ...handlers) { routes.POST.set(path, handlers); },
  };
}

async function invoke(stack, req) {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let index = 0;
  const next = async (error) => {
    if (error) throw error;
    const handler = stack[index++];
    if (handler) return handler(req, res, next);
  };
  await next();
  return res;
}

function mount(pool, auth = async (_req, _res, next) => next()) {
  assert.equal(typeof mountWorkoutStateRoutes, 'function', 'workout state route module should load');
  const app = appHarness();
  mountWorkoutStateRoutes(app, {
    pool,
    auth,
    requireMembership,
  });
  return app;
}

test('state routes are mounted as independently testable endpoints', () => {
  assert.equal(typeof mountWorkoutStateRoutes, 'function');
});

test('unentitled members cannot read state rows', async () => {
  const calls = [];
  const app = mount({ query: async (sql, args) => { calls.push({ sql, args }); return { rows: [], rowCount: 0 }; } });
  const response = await invoke(app.routes.GET.get('/api/state'), { user: { user_id: 12, roles: ['student'] } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'membership_required' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /membership_grants/);
});

test('unentitled members cannot write legacy state rows', async () => {
  const calls = [];
  const app = mount({ query: async (sql, args) => { calls.push({ sql, args }); return { rows: [], rowCount: 0 }; } });
  const response = await invoke(app.routes.POST.get('/api/state'), {
    user: { user_id: 12, roles: ['student'] }, body: { thinMuscleDoneV8: 'private' },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'membership_required' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /membership_grants/);
});

test('unauthenticated reads and writes stop before any state or membership query', async () => {
  const calls = [];
  const auth = (_req, res) => res.status(401).json({ error: 'unauthorized' });
  const app = mount({ query: async (sql) => { calls.push(sql); return { rows: [] }; } }, auth);
  const get = await invoke(app.routes.GET.get('/api/state'), { user: null });
  const post = await invoke(app.routes.POST.get('/api/state'), { user: null, body: { thinMuscleDoneV8: 'private' } });
  assert.equal(get.statusCode, 401);
  assert.equal(post.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('member state reads stay scoped to the authenticated account', async () => {
  const queries = [];
  const app = mount({ query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('membership_grants')) return { rows: [{ id: 1, starts_on: '2026-01-01', expires_on: '2999-01-01' }] };
    return { rows: [{ key: 'thinMuscleDoneV8', value: 'owned' }] };
  } });
  const response = await invoke(app.routes.GET.get('/api/state'), { user: { user_id: 33, roles: ['student'] } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { thinMuscleDoneV8: 'owned' });
  assert.deepEqual(queries.at(-1).args, [33]);
  assert.match(queries.at(-1).sql, /WHERE user_id = \$1/);
});

test('authorized member writes keep each legacy value attached to the authenticated account', async () => {
  const queries = [];
  const app = mount({ query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('membership_grants')) return { rows: [{ id: 1, starts_on: '2026-01-01', expires_on: '2999-01-01' }] };
    return { rows: [], rowCount: 1 };
  } });
  const response = await invoke(app.routes.POST.get('/api/state'), {
    user: { user_id: 33, roles: ['student'] }, body: { thinMuscleDoneV8: 'owned', thinMuscleRestSecondsV2: 60 },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, count: 2 });
  const writes = queries.filter(({ sql }) => sql.includes('INSERT INTO workout_records'));
  assert.deepEqual(writes.map(({ args }) => args), [
    ['thinMuscleDoneV8', 'owned', 33], ['thinMuscleRestSecondsV2', '60', 33],
  ]);
});

test('superadmin retains personal state access without a membership lookup', async () => {
  const queries = [];
  const app = mount({ query: async (sql, args) => {
    queries.push({ sql, args });
    return { rows: [{ key: 'thinMuscleDoneV8', value: 'yhone' }] };
  } });
  const response = await invoke(app.routes.GET.get('/api/state'), { user: { user_id: 1, roles: ['superadmin'] } });
  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM workout_records/);
  assert.deepEqual(queries[0].args, [1]);
});
