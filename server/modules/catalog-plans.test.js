const test = require('node:test');
const assert = require('node:assert/strict');
const { mountCatalogPlanRoutes, normalizePlanContent } = require('./catalog-plans');

function fakeApp() {
  const routes = { GET: new Map(), POST: new Map(), PUT: new Map(), DELETE: new Map() };
  return {
    routes,
    get(path, ...handlers) { routes.GET.set(path, handlers); },
    post(path, ...handlers) { routes.POST.set(path, handlers); },
    put(path, ...handlers) { routes.PUT.set(path, handlers); },
    delete(path, ...handlers) { routes.DELETE.set(path, handlers); },
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

function createPlanRoute(pool) {
  const app = fakeApp();
  mountCatalogPlanRoutes(app, { pool, auth: async (_req, _res, next) => next(), staticRoot: process.cwd() });
  return app.routes.POST.get('/api/coach/students/:studentId/plans');
}

test('custom coach plans allow one to seven days and preserve each day filter', async () => {
  const days = [
    { name: '胸背', focus: '胸、背', exerciseFilterTag: 'five_chest', exercises: [] },
    { name: '核心补充', focus: '', exerciseFilterTag: 'all', exercises: [] },
  ];
  const content = await normalizePlanContent({}, { days }, 'custom');

  assert.equal(content.splitType, 'custom');
  assert.deepEqual(content.days.map((day) => day.exerciseFilterTag), ['five_chest', 'all']);
  assert.deepEqual(content.days.map((day) => day.dayNo), [1, 2]);
});

test('custom plans reject zero or more than seven days', async () => {
  await assert.rejects(normalizePlanContent({}, { days: [] }, 'custom'), { message: 'invalid_plan' });
  await assert.rejects(normalizePlanContent({}, { days: Array.from({ length: 8 }, () => ({ exercises: [] })) }, 'custom'), { message: 'invalid_plan' });
});

test('custom coach plan creation retains the coach-student ownership check', async () => {
  const statements = [];
  const planRow = { id: 31, coach_id: 7, student_id: 18, template_code: null, split_type: 'custom', name: '自定义计划', status: 'draft', current_version_no: null };
  const versionContent = { splitType: 'custom', days: [{ dayNo: 1, name: '训练日 1', focus: '', exerciseFilterTag: 'all', exercises: [] }] };
  const versionRow = { version_no: 1, status: 'draft', content: versionContent, updated_at: '2026-09-30T00:00:00Z' };
  const client = {
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('FROM coach_student_relationships')) return { rowCount: 1, rows: [{}] };
      if (sql.startsWith('INSERT INTO gym_plans')) return { rowCount: 1, rows: [planRow] };
      if (sql.startsWith('INSERT INTO gym_plan_versions')) return { rowCount: 1, rows: [versionRow] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const response = await invoke(createPlanRoute(pool), {
    params: { studentId: '18' }, user: { user_id: 7, roles: ['coach'] },
    body: { splitType: 'custom', name: '自定义计划', content: { days: [{ name: '训练日 1', exerciseFilterTag: 'all', exercises: [] }] } },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.plan.splitType, 'custom');
  assert.equal(response.body.plan.templateCode, null);
  assert.equal(statements.find((entry) => entry.sql.startsWith('INSERT INTO gym_plans')).values[2], null);
  assert.ok(statements.some((entry) => entry.sql.includes('FROM coach_student_relationships')));
});

test('custom coach plan cannot be created for a student outside the coach relationship', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FROM coach_student_relationships')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const response = await invoke(createPlanRoute({ async connect() { return client; } }), {
    params: { studentId: '18' }, user: { user_id: 7, roles: ['coach'] },
    body: { splitType: 'custom', content: { days: [{ name: '训练日 1', exercises: [] }] } },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, 'student_not_found');
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO gym_plans')), false);
});

test('older plan content defaults a missing or invalid day filter without changing exercises', async () => {
  const content = await normalizePlanContent({}, {
    days: [
      { name: '推', exercises: [] },
      { name: '拉', exerciseFilterTag: 'not-a-filter', exercises: [] },
      { name: '腿', exercises: [] },
    ],
  }, 'ppl');

  assert.deepEqual(content.days.map((day) => day.exerciseFilterTag), [null, null, null]);
  assert.deepEqual(content.days[0].exercises, []);
});
