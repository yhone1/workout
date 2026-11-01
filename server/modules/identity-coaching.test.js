const test = require('node:test');
const assert = require('node:assert/strict');
const { mountIdentityCoachingRoutes } = require('./identity-coaching');

function fakeApp() {
  const routes = new Map();
  for (const method of ['get', 'post', 'delete']) {
    routes.set(method.toUpperCase(), new Map());
  }
  return {
    routes,
    get(path, ...handlers) { routes.get('GET').set(path, handlers); },
    post(path, ...handlers) { routes.get('POST').set(path, handlers); },
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

test('普通学员不能访问管理员用户列表，且请求不会触达数据库', async () => {
  const app = fakeApp();
  let queryCount = 0;
  mountIdentityCoachingRoutes(app, {
    pool: { query: async () => { queryCount += 1; return { rows: [], rowCount: 0 }; } },
    auth: async (_req, _res, next) => next(),
  });
  const stack = app.routes.get('GET').get('/api/admin/users');
  const res = await invoke(stack, { user: { user_id: 12, username: 'student', roles: ['student'] }, query: {} });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'forbidden' });
  assert.equal(queryCount, 0);
});

test('教练也不能访问管理员用户列表', async () => {
  const app = fakeApp();
  mountIdentityCoachingRoutes(app, { pool: {}, auth: async (_req, _res, next) => next() });
  const res = await invoke(app.routes.get('GET').get('/api/admin/users'), {
    user: { user_id: 15, username: 'coach', roles: ['coach'] }, query: {},
  });
  assert.equal(res.statusCode, 403);
});

test('管理员撤销仍有有效学员的教练时返回冲突且不删除角色', async () => {
  const app = fakeApp();
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('SELECT 1 FROM coach_student_relationships')) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  mountIdentityCoachingRoutes(app, { pool: { connect: async () => client }, auth: async (_req, _res, next) => next() });
  const res = await invoke(app.routes.get('DELETE').get('/api/admin/users/:userId/coach'), {
    user: { user_id: 1, username: 'yhone', roles: ['admin'] }, params: { userId: '22' },
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'coach_has_active_students' });
  assert.equal(statements.includes("DELETE FROM user_roles WHERE user_id = $1 AND role = 'coach'"), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('教练学员列表查询严格限定当前教练 ID', async () => {
  const app = fakeApp();
  let queryArgs;
  mountIdentityCoachingRoutes(app, {
    pool: { query: async (_sql, args) => { queryArgs = args; return { rows: [], rowCount: 0 }; } },
    auth: async (_req, _res, next) => next(),
  });
  const res = await invoke(app.routes.get('GET').get('/api/coach/students'), {
    user: { user_id: 77, username: 'coach-a', roles: ['coach'] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(queryArgs, [77]);
});

test('教练解除关系后沿用邀请事务释放名额并在有空位时恢复当前码', async () => {
  const statements = [];
  const client = {
    async query(sql, args = []) {
      statements.push({ sql, args });
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: args[0].map((id) => ({ id })), rowCount: args[0].length };
      if (sql.includes('FROM coach_student_relationships') && sql.includes('coach_id')) return { rows: [{ id: 61 }], rowCount: 1 };
      if (sql.includes('FROM user_roles')) return { rows: [{ role: 'coach' }], rowCount: 1 };
      if (sql.includes('coach_capacity_settings')) return { rows: [{ tier_limit: 4, override_limit: null, active_students: 0 }], rowCount: 1 };
      if (sql.includes('FROM coach_invitations') && sql.includes('is_current')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT INTO coach_invitations')) return { rows: [{ id: 91 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = fakeApp();
  mountIdentityCoachingRoutes(app, {
    pool: { connect: async () => client },
    auth: async (_req, _res, next) => next(),
    inviteEncryptionKey: Buffer.alloc(32, 2),
  });
  const res = await invoke(app.routes.get('POST').get('/api/coach/students/:studentId/end'), {
    user: { user_id: 9, roles: ['coach'] }, params: { studentId: '3' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.coachCapacity.canAccept, true);
  assert.ok(statements.some(({ sql }) => sql.startsWith('INSERT INTO coach_invitations')));
  assert.equal(statements.at(-1).sql, 'COMMIT');
});
