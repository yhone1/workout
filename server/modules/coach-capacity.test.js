const test = require('node:test');
const assert = require('node:assert/strict');

let capacity = null;
try {
  capacity = require('./coach-capacity');
} catch {
  // Keep the first red run an assertion about the missing feature, not import failure.
}

test('个人名额覆盖等级上限，否则继承等级上限', () => {
  assert.ok(capacity, 'coach-capacity module should load');
  assert.equal(capacity.resolveCoachLimit({ tierLimit: 12, overrideLimit: 4 }), 4);
  assert.equal(capacity.resolveCoachLimit({ tierLimit: 12, overrideLimit: null }), 12);
  assert.equal(capacity.resolveCoachLimit({ tierLimit: null, overrideLimit: null }), null);
});

test('未配置和零名额都拒绝新增学员', () => {
  assert.ok(capacity, 'coach-capacity module should load');
  assert.deepEqual(capacity.capacitySnapshot({ activeStudents: 0, maxStudents: null }), {
    activeStudents: 0, maxStudents: null, remaining: 0, canAccept: false,
  });
  assert.deepEqual(capacity.capacitySnapshot({ activeStudents: 0, maxStudents: 0 }), {
    activeStudents: 0, maxStudents: 0, remaining: 0, canAccept: false,
  });
});

test('容量快照正确处理有余量、正好满额和调低上限后的既有超额', () => {
  assert.ok(capacity, 'coach-capacity module should load');
  assert.deepEqual(capacity.capacitySnapshot({ activeStudents: 2, maxStudents: 5 }), {
    activeStudents: 2, maxStudents: 5, remaining: 3, canAccept: true,
  });
  assert.deepEqual(capacity.capacitySnapshot({ activeStudents: 5, maxStudents: 5 }), {
    activeStudents: 5, maxStudents: 5, remaining: 0, canAccept: false,
  });
  assert.deepEqual(capacity.capacitySnapshot({ activeStudents: 6, maxStudents: 3 }), {
    activeStudents: 6, maxStudents: 3, remaining: 0, canAccept: false,
  });
});

function fakeApp() {
  const routes = new Map(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((method) => [method, new Map()]));
  return {
    routes,
    get(path, ...handlers) { routes.get('GET').set(path, handlers); },
    post(path, ...handlers) { routes.get('POST').set(path, handlers); },
    patch(path, ...handlers) { routes.get('PATCH').set(path, handlers); },
    put(path, ...handlers) { routes.get('PUT').set(path, handlers); },
    delete(path, ...handlers) { routes.get('DELETE').set(path, handlers); },
  };
}

async function invoke(stack, req) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let index = 0;
  const next = async (err) => {
    if (err) throw err;
    const handler = stack[index++];
    if (handler) return handler(req, res, next);
  };
  await next();
  return res;
}

function installCapacityRoutes(pool) {
  assert.equal(typeof capacity?.mountCoachCapacityRoutes, 'function', 'capacity API routes should be implemented');
  const app = fakeApp();
  capacity.mountCoachCapacityRoutes(app, { pool, auth: async (_req, _res, next) => next() });
  return app;
}

function makeTransactionalPool(handler) {
  const statements = [];
  const client = {
    async query(sql, args = []) {
      statements.push({ sql, args });
      return handler(sql, args, statements);
    },
    release() {},
  };
  return {
    statements,
    pool: {
      async query(sql, args = []) {
        statements.push({ sql, args });
        return handler(sql, args, statements);
      },
      async connect() { return client; },
    },
  };
}

test('名额管理全部路由只允许 superadmin，且拒绝发生在数据库访问前', async () => {
  let dbCalls = 0;
  const app = installCapacityRoutes({
    async query() { dbCalls += 1; return { rows: [], rowCount: 0 }; },
    async connect() { dbCalls += 1; throw new Error('must not connect'); },
  });
  const paths = [
    ['GET', '/api/admin/coach-capacity', { query: {} }],
    ['POST', '/api/admin/coach-capacity/tiers', { body: {} }],
    ['PATCH', '/api/admin/coach-capacity/tiers/:tierId', { params: { tierId: '1' }, body: {} }],
    ['DELETE', '/api/admin/coach-capacity/tiers/:tierId', { params: { tierId: '1' } }],
    ['PUT', '/api/admin/coach-capacity/coaches/:coachId', { params: { coachId: '2' }, body: {} }],
  ];
  for (const role of ['admin', 'coach', 'student']) {
    for (const [method, path, extra] of paths) {
      const res = await invoke(app.routes.get(method).get(path), {
        user: { user_id: 90, roles: [role] }, ...extra,
      });
      assert.equal(res.statusCode, 403, `${role} should be denied at ${method} ${path}`);
    }
  }
  assert.equal(dbCalls, 0);
});

test('名额等级拒绝非法上限，并将重复名称作为冲突回滚', async () => {
  let dbCalls = 0;
  const app = installCapacityRoutes({
    async query() { dbCalls += 1; return { rows: [], rowCount: 0 }; },
    async connect() { dbCalls += 1; throw new Error('invalid input must be rejected before transaction'); },
  });
  const invalid = await invoke(app.routes.get('POST').get('/api/admin/coach-capacity/tiers'), {
    user: { user_id: 1, roles: ['superadmin'] }, body: { name: '入门', maxStudents: -1, sortOrder: 0 },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(dbCalls, 0);

  for (const body of [
    { name: '超范围', maxStudents: 2147483648, sortOrder: 0 },
    { name: '排序超范围', maxStudents: 5, sortOrder: 2147483648 },
  ]) {
    const outOfRange = await invoke(app.routes.get('POST').get('/api/admin/coach-capacity/tiers'), {
      user: { user_id: 1, roles: ['superadmin'] }, body,
    });
    assert.equal(outOfRange.statusCode, 400);
  }
  const updateOutOfRange = await invoke(app.routes.get('PATCH').get('/api/admin/coach-capacity/tiers/:tierId'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { tierId: '1' },
    body: { name: '超范围', maxStudents: 5, sortOrder: -2147483649 },
  });
  assert.equal(updateOutOfRange.statusCode, 400);
  assert.equal(dbCalls, 0);

  const transactional = makeTransactionalPool(async (sql) => {
    if (sql.includes('INSERT INTO coach_capacity_tiers')) throw Object.assign(new Error('duplicate'), { code: '23505' });
    return { rows: [], rowCount: 0 };
  });
  const duplicateApp = installCapacityRoutes(transactional.pool);
  const duplicate = await invoke(duplicateApp.routes.get('POST').get('/api/admin/coach-capacity/tiers'), {
    user: { user_id: 1, roles: ['superadmin'] }, body: { name: '入门', maxStudents: 5, sortOrder: 0 },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(transactional.statements.at(-1).sql, 'ROLLBACK');
});

test('已分配教练的名额等级不能删除', async () => {
  const transactional = makeTransactionalPool(async (sql) => {
    if (sql.includes('FROM coach_capacity_tiers') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: 3, name: '进阶', max_students: 8, sort_order: 2 }], rowCount: 1 };
    }
    if (sql.includes('FROM coach_capacity_settings') && sql.includes('tier_id')) return { rows: [{ coach_id: 7 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const app = installCapacityRoutes(transactional.pool);
  const res = await invoke(app.routes.get('DELETE').get('/api/admin/coach-capacity/tiers/:tierId'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { tierId: '3' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(transactional.statements.some(({ sql }) => sql.startsWith('DELETE FROM coach_capacity_tiers')), false);
  assert.equal(transactional.statements.at(-1).sql, 'ROLLBACK');
});

test('修改名额等级先锁定受影响教练并与审计事件原子提交', async () => {
  const transactional = makeTransactionalPool(async (sql) => {
    if (sql.includes('SELECT u.id FROM users u') && sql.includes('FOR UPDATE')) return { rows: [{ id: 7 }, { id: 11 }], rowCount: 2 };
    if (sql.includes('FROM coach_capacity_tiers') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: 3, name: '进阶', max_students: 8, sort_order: 2 }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE coach_capacity_tiers')) return { rows: [{ id: 3, name: '进阶', max_students: 10, sort_order: 2 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const app = installCapacityRoutes(transactional.pool);
  const res = await invoke(app.routes.get('PATCH').get('/api/admin/coach-capacity/tiers/:tierId'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { tierId: '3' },
    body: { name: '进阶', maxStudents: 10, sortOrder: 2 },
  });
  assert.equal(res.statusCode, 200);
  const lock = transactional.statements.find(({ sql }) => sql.includes('SELECT u.id FROM users u'));
  assert.match(lock.sql, /ORDER BY u\.id\s+FOR UPDATE OF u/i);
  const coachLockIndexes = transactional.statements.map(({ sql }, index) => sql.includes('SELECT u.id FROM users u') ? index : -1).filter((index) => index >= 0);
  const tierLockIndex = transactional.statements.findIndex(({ sql }) => sql.includes('FROM coach_capacity_tiers') && sql.includes('FOR UPDATE'));
  assert.equal(coachLockIndexes.length, 2, 'must re-lock assignments after the tier lock to include a concurrent first assignment');
  assert.ok(coachLockIndexes[0] < tierLockIndex && tierLockIndex < coachLockIndexes[1]);
  const auditIndex = transactional.statements.findIndex(({ sql }) => sql.includes('INSERT INTO coach_capacity_events'));
  const commitIndex = transactional.statements.findIndex(({ sql }) => sql === 'COMMIT');
  assert.ok(auditIndex > -1 && commitIndex > auditIndex);
});

test('教练名额只可分配给具备 coach 或 admin 资格的账号，非法 ID 提前拒绝', async () => {
  let connects = 0;
  const invalidPool = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { connects += 1; } };
  const app = installCapacityRoutes(invalidPool);
  const invalidId = await invoke(app.routes.get('PUT').get('/api/admin/coach-capacity/coaches/:coachId'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { coachId: '0' }, body: { tierId: null, maxStudentsOverride: null },
  });
  assert.equal(invalidId.statusCode, 400);
  assert.equal(connects, 0);

  const overflow = await invoke(app.routes.get('PUT').get('/api/admin/coach-capacity/coaches/:coachId'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { coachId: '22' },
    body: { tierId: null, maxStudentsOverride: 2147483648 },
  });
  assert.equal(overflow.statusCode, 400);
  assert.equal(connects, 0);

  const transactional = makeTransactionalPool(async (sql) => {
    if (sql.includes('SELECT id FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 22 }], rowCount: 1 };
    if (sql.includes('FROM user_roles')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
  const unqualifiedApp = installCapacityRoutes(transactional.pool);
  const unqualified = await invoke(unqualifiedApp.routes.get('PUT').get('/api/admin/coach-capacity/coaches/:coachId'), {
    user: { user_id: 1, roles: ['superadmin'] }, params: { coachId: '22' }, body: { tierId: null, maxStudentsOverride: 4 },
  });
  assert.equal(unqualified.statusCode, 400);
  assert.equal(transactional.statements.some(({ sql }) => sql.includes('INSERT INTO coach_capacity_settings')), false);
  assert.equal(transactional.statements.at(-1).sql, 'ROLLBACK');
});

test('名额列表用个人覆盖计算有效上限并限制审计结果数量', async () => {
  const statements = [];
  const pool = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FROM coach_capacity_tiers')) return { rows: [{ id: 2, name: '进阶', max_students: 8, sort_order: 1 }], rowCount: 1 };
      if (sql.includes('FROM coach_capacity_events')) return { rows: [], rowCount: 0 };
      return { rows: [{ id: 7, username: 'coach-a', tier_id: 2, tier_name: '进阶', tier_limit: 8, override_limit: 3, active_students: '2' }], rowCount: 1 };
    },
  };
  const app = installCapacityRoutes(pool);
  const res = await invoke(app.routes.get('GET').get('/api/admin/coach-capacity'), {
    user: { user_id: 1, roles: ['superadmin'] }, query: { q: '' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.coaches[0], {
    id: 7, username: 'coach-a', tierId: 2, tierName: '进阶', tierLimit: 8,
    maxStudentsOverride: 3, maxStudents: 3, activeStudents: 2, remaining: 1,
  });
  assert.ok(statements.some((sql) => /COUNT\s*\(\s*DISTINCT\s+r\.id\s*\)/i.test(sql)), 'dual admin/coach roles must not double-count students');
  assert.ok(statements.some((sql) => sql.includes('FROM coach_capacity_events') && /LIMIT\s+100\b/i.test(sql)));
});
