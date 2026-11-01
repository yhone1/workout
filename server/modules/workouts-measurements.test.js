const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMeasurement, mountWorkoutMeasurementRoutes } = require('./workouts-measurements');

function fakeApp() {
  const routes = new Map();
  for (const method of ['get', 'post', 'patch']) routes.set(method.toUpperCase(), new Map());
  return {
    routes,
    get(path, ...handlers) { routes.get('GET').set(path, handlers); },
    post(path, ...handlers) { routes.get('POST').set(path, handlers); },
    patch(path, ...handlers) { routes.get('PATCH').set(path, handlers); },
  };
}

async function invoke(stack, req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  let index = 0;
  const next = async (error) => {
    if (error) throw error;
    const handler = stack[index++];
    if (handler) return handler(req, res, next);
  };
  await next();
  return res;
}

test('coach starts days 6 and 7 using the published plan and rejects missing days', async () => {
  for (const dayNo of [6, 7, 8]) {
    const days = Array.from({ length: 7 }, (_, index) => ({ dayNo: index + 1, name: `训练日 ${index + 1}`, exercises: [] }));
    const statements = [];
    const row = { id: 71, student_id: 81, coach_id: 25, day_no: dayNo, status: 'draft' };
    const client = { async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('coach_student_relationships')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM gym_plans')) return { rows: [{ plan_id: 21, version_id: 41, content: { days } }], rowCount: 1 };
      if (sql.includes('INSERT INTO gym_sessions')) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }, release() {} };
    const app = fakeApp();
    mountWorkoutMeasurementRoutes(app, {
      pool: { connect: async () => client, query: async (sql) => sql.includes('FROM gym_sessions WHERE id=$1') ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 } },
      auth: async (_req, _res, next) => next(),
    });
    const response = await invoke(app.routes.get('POST').get('/api/coach/students/:studentId/sessions/start'), {
      user: { user_id: 25, roles: ['coach'] }, params: { studentId: '81' }, body: { dayNo },
    });
    assert.equal(response.statusCode, dayNo <= 7 ? 201 : 404);
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO gym_sessions'));
    if (dayNo <= 7) assert.equal(insert.args[4], dayNo);
    else { assert.deepEqual(response.body, { error: 'training_day_not_found' }); assert.equal(insert, undefined); }
  }
});

test('身体数据允许体脂为空并保留准确单位数值', () => {
  assert.deepEqual(normalizeMeasurement({ weightKg: '72.5', waistCm: '84', bodyFatPct: '' }), {
    weightKg: 72.5, waistCm: 84, bodyFatPct: null, note: '',
  });
});

test('拒绝空身体数据和超范围体脂', () => {
  assert.throws(() => normalizeMeasurement({}), { message: 'empty_measurement' });
  assert.throws(() => normalizeMeasurement({ bodyFatPct: 99 }), { message: 'invalid_measurement' });
});

test('普通学员不能以教练身份开始训练，拒绝发生在数据库访问前', async () => {
  const app = fakeApp();
  let databaseTouched = false;
  mountWorkoutMeasurementRoutes(app, {
    pool: { connect: async () => { databaseTouched = true; throw new Error('must_not_connect'); } },
    auth: async (_req, _res, next) => next(),
  });
  const response = await invoke(app.routes.get('POST').get('/api/coach/students/:studentId/sessions/start'), {
    user: { user_id: 25, roles: ['student'] }, params: { studentId: '81' }, body: { dayNo: 1 },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'forbidden' });
  assert.equal(databaseTouched, false);
});

test('既有健身房学员历史接口不会暴露会员自助训练会话', async () => {
  const app = fakeApp();
  const queries = [];
  mountWorkoutMeasurementRoutes(app, {
    pool: { query: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.includes('FROM gym_sessions WHERE id=$1')) return { rows: [{ id: 71, student_id: 25, member_plan_id: 21, coach_id: null }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    } },
    auth: async (_req, _res, next) => next(),
  });
  const user = { user_id: 25, roles: ['student'] };
  const list = await invoke(app.routes.get('GET').get('/api/gym/sessions'), { user });
  assert.equal(list.statusCode, 200);
  assert.match(queries[0].sql, /coach_id IS NOT NULL/);
  assert.deepEqual(queries[0].args, [25]);

  const detail = await invoke(app.routes.get('GET').get('/api/gym/sessions/:id'), { user, params: { id: '71' } });
  assert.equal(detail.statusCode, 404);
  assert.deepEqual(detail.body, { error: 'session_not_found' });
  assert.equal(queries.length, 2);
});
