const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('./identity-coaching');

let mountMembershipRoutes = null;
try {
  ({ mountMembershipRoutes } = require('./memberships'));
} catch {
  // Keep the initial red run assertion-based while the route module is absent.
}

function fakeApp() {
  const routes = { GET: new Map(), POST: new Map() };
  return {
    routes,
    get(path, ...handlers) { routes.GET.set(path, handlers); },
    post(path, ...handlers) { routes.POST.set(path, handlers); },
  };
}

async function invoke(stack, req) {
  const res = {
    statusCode: 200,
    body: null,
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

function mount(pool) {
  assert.equal(typeof mountMembershipRoutes, 'function', 'membership route module should load');
  const app = fakeApp();
  mountMembershipRoutes(app, { pool, auth: async (_req, _res, next) => next(), requireRole });
  return app;
}

test('membership routes are implemented as an Express route module', () => {
  assert.equal(typeof mountMembershipRoutes, 'function');
});

test('coach and student cannot read membership grants or touch the database', async () => {
  let queries = 0;
  let connections = 0;
  const app = mount({
    query: async () => { queries += 1; return { rows: [] }; },
    connect: async () => { connections += 1; throw new Error('must not connect'); },
  });
  for (const role of ['coach', 'student']) {
    const user = { user_id: 9, roles: [role] };
    const requests = [
      [app.routes.GET.get('/api/admin/users/:userId/membership'), { user, params: { userId: '22' } }],
      [app.routes.POST.get('/api/admin/users/:userId/membership'), { user, params: { userId: '22' }, body: { startsOn: '2026-09-01', expiresOn: '2026-10-01' } }],
      [app.routes.POST.get('/api/admin/memberships/:grantId/revoke'), { user, params: { grantId: '31' }, body: { reason: 'test' } }],
    ];
    for (const [route, req] of requests) {
      const response = await invoke(route, req);
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.body, { error: 'forbidden' });
    }
  }
  assert.equal(queries, 0);
  assert.equal(connections, 0);
});

test('admin reads one account membership with current grant and audit history', async () => {
  const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const dateValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const today = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  const expiry = new Date(`${today}T00:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 30);
  const expiresOn = expiry.toISOString().slice(0, 10);
  const grant = {
    id: 11, user_id: 22, starts_on: today, expires_on: expiresOn,
    granted_by: 1, created_at: new Date().toISOString(), revoked_at: null, revoked_by: null,
    reason: '首期会员', is_current: true,
  };
  const calls = [];
  const pool = {
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes('FROM users WHERE id')) return { rows: [{ id: 22 }], rowCount: 1 };
      if (sql.includes('FROM membership_grants')) return { rows: [grant], rowCount: 1 };
      if (sql.includes('FROM membership_events')) return {
        rows: [{ grant_id: 11, actor_id: 1, event_type: 'granted', reason: '首期会员', created_at: grant.created_at }],
        rowCount: 1,
      };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const app = mount(pool);
  const response = await invoke(app.routes.GET.get('/api/admin/users/:userId/membership'), {
    user: { user_id: 1, roles: ['admin'] }, params: { userId: '22' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.current.id, 11);
  assert.equal(response.body.history[0].startsOn, today);
  assert.deepEqual(response.body.history[0].events, [{
    actorId: 1, eventType: 'granted', reason: '首期会员', createdAt: grant.created_at,
  }]);
  assert.deepEqual(calls[0].args, [22]);
});

test('invalid membership dates are rejected before opening a transaction', async () => {
  let connects = 0;
  const app = mount({ connect: async () => { connects += 1; throw new Error('should not connect'); } });
  const response = await invoke(app.routes.POST.get('/api/admin/users/:userId/membership'), {
    user: { user_id: 1, roles: ['admin'] },
    params: { userId: '22' },
    body: { startsOn: '2026-10-02', expiresOn: '2026-10-01', reason: 'invalid' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'invalid_membership_dates' });
  assert.equal(connects, 0);
});

test('admin grants and renews membership in one transaction with an audit event', async () => {
  const statements = [];
  const grant = {
    id: 31, user_id: 22, starts_on: '2026-10-01', expires_on: '2026-10-31',
    granted_by: 1, created_at: '2026-09-29T03:00:00.000Z', revoked_at: null, revoked_by: null, reason: '续期',
  };
  const client = {
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('FROM users WHERE id')) return { rows: [{ id: 22 }], rowCount: 1 };
      if (sql.includes('INSERT INTO membership_grants')) return { rows: [grant], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/admin/users/:userId/membership'), {
    user: { user_id: 1, roles: ['admin'] }, params: { userId: '22' },
    body: { startsOn: '2026-10-01', expiresOn: '2026-10-31', reason: '续期' },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.grant.id, 31);
  assert.equal(statements[0].sql, 'BEGIN');
  assert.deepEqual(statements.find(({ sql }) => sql.includes('INSERT INTO membership_grants')).args,
    [22, '2026-10-01', '2026-10-31', 1, '续期']);
  assert.equal(statements.some(({ sql, args }) => sql.includes('INSERT INTO membership_events')
    && args[0] === 31 && args[1] === 1 && args[2] === 'granted'), true);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('admin revoke writes the revocation and audit record in one transaction', async () => {
  const statements = [];
  const existing = { id: 31, user_id: 22, starts_on: '2026-10-01', expires_on: '2026-10-31', revoked_at: null };
  const revoked = { ...existing, revoked_at: '2026-09-29T04:00:00.000Z', revoked_by: 1 };
  const client = {
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('SELECT * FROM membership_grants')) return { rows: [existing], rowCount: 1 };
      if (sql.includes('UPDATE membership_grants')) return { rows: [revoked], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/admin/memberships/:grantId/revoke'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { grantId: '31' }, body: { reason: '退款' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.grant.revokedAt, revoked.revoked_at);
  assert.equal(statements.some(({ sql, args }) => sql.includes('INSERT INTO membership_events')
    && args[0] === 31 && args[1] === 1 && args[2] === 'revoked' && args[3] === '退款'), true);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('already revoked membership cannot be revoked twice', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('SELECT * FROM membership_grants')) return {
        rows: [{ id: 31, revoked_at: '2026-09-29T04:00:00.000Z', revoked_by: 1 }], rowCount: 1,
      };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/admin/memberships/:grantId/revoke'), {
    user: { user_id: 1, roles: ['admin'] }, params: { grantId: '31' }, body: { reason: '重复操作' },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'membership_already_revoked' });
  assert.equal(statements.some((sql) => sql.includes('UPDATE membership_grants')), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});
