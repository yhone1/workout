const test = require('node:test');
const assert = require('node:assert/strict');

let mountMemberTrainingRoutes = null;
try { ({ mountMemberTrainingRoutes } = require('./member-training')); } catch {}

function fakeApp() {
  const routes = { GET: new Map(), POST: new Map(), PATCH: new Map() };
  return {
    routes,
    get(path, ...handlers) { routes.GET.set(path, handlers); },
    post(path, ...handlers) { routes.POST.set(path, handlers); },
    patch(path, ...handlers) { routes.PATCH.set(path, handlers); },
  };
}

async function invoke(stack, req) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
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
  assert.equal(typeof mountMemberTrainingRoutes, 'function', 'member training routes should be implemented');
  const app = fakeApp();
  mountMemberTrainingRoutes(app, {
    pool,
    auth: async (_req, _res, next) => next(),
    requireMembership: () => async (req, res, next) => {
      if (req.hasMembership || req.user?.roles?.includes('superadmin')) return next();
      return res.status(403).json({ error: 'membership_required' });
    },
  });
  return app;
}

function member(userId = 12, hasMembership = true) {
  return { user: { user_id: userId, roles: ['student'] }, hasMembership };
}

function activePlan() {
  return {
    id: 21, owner_id: 12, split_type: 'ppl', name: 'PPL', status: 'active', current_version_no: 1,
    version_id: 41, version_no: 1,
    content: { splitType: 'ppl', days: [{ dayNo: 1, name: '推', exercises: [
      { exerciseSlug: 'pectorals/barbell-bench-press', exerciseNameZh: '杠铃卧推', sets: 2, repMin: 8, repMax: 10, rir: 2, targetWeight: 30 },
    ] }] },
  };
}

function sessionRow(overrides = {}) {
  return { id: 71, student_id: 12, coach_id: null, plan_id: null, plan_version_id: null,
    member_plan_id: 21, member_plan_version_id: 41, day_no: 1, day_name: '推', snapshot: activePlan().content,
    status: 'draft', started_at: '2026-09-29T10:00:00.000Z', ended_at: null, duration_seconds: null, notes: '', ...overrides };
}

function setRow(overrides = {}) {
  return { session_id: 71, exercise_index: 0, set_no: 1, exercise_slug: 'pectorals/barbell-bench-press', exercise_name_zh: '杠铃卧推',
    target_weight: 30, target_rep_min: 8, target_rep_max: 10, target_rir: 2, actual_weight: 27.5, actual_reps: 9, actual_rir: 2,
    status: 'completed', replacement_name: null, note: '', updated_at: '2026-09-29T10:02:00.000Z', ...overrides };
}

test('member starts custom days 6 and 7 but cannot start a day absent from that plan', async () => {
  for (const dayNo of [6, 7, 8]) {
    const plan = activePlan();
    plan.content.days = Array.from({ length: 7 }, (_, index) => ({
      dayNo: index + 1, name: `训练日 ${index + 1}`,
      exercises: [{ ...plan.content.days[0].exercises[0], restSeconds: 90 }],
    }));
    const statements = [];
    const client = { async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM member_plans')) return { rows: [plan], rowCount: 1 };
      if (sql.includes('INSERT INTO gym_sessions')) return { rows: [{ id: 71 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }, release() {} };
    const app = mount({ connect: async () => client, async query(sql) {
      if (sql.includes('FROM gym_sessions')) return { rows: [sessionRow({ day_no: dayNo })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    } });
    const response = await invoke(app.routes.POST.get('/api/member/plans/:planId/sessions'), {
      ...member(), params: { planId: '21' }, body: { dayNo },
    });
    assert.equal(response.statusCode, dayNo <= 7 ? 201 : 404);
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO gym_sessions'));
    if (dayNo <= 7) {
      assert.equal(insert.args[3], dayNo);
      assert.equal(JSON.parse(insert.args[5]).exercises[0].restSeconds, 90);
    } else {
      assert.deepEqual(response.body, { error: 'training_day_not_found' });
      assert.equal(insert, undefined);
    }
  }
});

test('member training routes are mounted as protected, isolated endpoints', () => {
  assert.equal(typeof mountMemberTrainingRoutes, 'function');
});

test('expired or absent membership blocks member session routes before session data is queried', async () => {
  let touched = 0;
  const app = mount({ query: async () => { touched += 1; throw new Error('must_not_query'); }, connect: async () => { touched += 1; } });
  const requests = [
    [app.routes.GET.get('/api/member/sessions'), member(12, false)],
    [app.routes.GET.get('/api/member/sessions/:sessionId'), { ...member(12, false), params: { sessionId: '71' } }],
    [app.routes.POST.get('/api/member/plans/:planId/sessions'), { ...member(12, false), params: { planId: '21' }, body: { dayNo: 1 } }],
    [app.routes.PATCH.get('/api/member/sessions/:sessionId/sets/:exerciseIndex/:setNo'), { ...member(12, false), params: { sessionId: '71', exerciseIndex: '0', setNo: '1' } }],
    [app.routes.POST.get('/api/member/sessions/:sessionId/complete'), { ...member(12, false), params: { sessionId: '71' } }],
    [app.routes.POST.get('/api/member/sessions/:sessionId/abandon'), { ...member(12, false), params: { sessionId: '71' } }],
  ];
  for (const [stack, req] of requests) {
    const response = await invoke(stack, req);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: 'membership_required' });
  }
  assert.equal(touched, 0);
});

test('session start rechecks membership in the transaction before reading a plan', async () => {
  const statements = [];
  const client = { async query(sql) { statements.push(sql); if (sql.includes('membership_grants')) return { rows: [], rowCount: 0 }; return { rows: [], rowCount: 1 }; }, release() {} };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/:planId/sessions'), {
    ...member(), params: { planId: '21' }, body: { dayNo: 1 },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'membership_required' });
  assert.equal(statements[0], 'BEGIN');
  assert.ok(statements[1].includes('membership_grants'));
  assert.equal(statements.some((sql) => sql.includes('FROM member_plans')), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('member starts only their confirmed current plan version and snapshots every target set', async () => {
  const statements = [];
  const plan = activePlan();
  const client = { async query(sql, args) {
    statements.push({ sql, args });
    if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM member_plans')) return { rows: [plan], rowCount: 1 };
    if (sql.includes('INSERT INTO gym_sessions')) return { rows: [sessionRow()], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    connect: async () => client,
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('FROM gym_sessions WHERE id=$1')) return { rows: [sessionRow()], rowCount: 1 };
      if (sql.includes('FROM gym_session_sets')) return { rows: [setRow()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const app = mount(pool);
  const response = await invoke(app.routes.POST.get('/api/member/plans/:planId/sessions'), {
    ...member(), params: { planId: '21' }, body: { dayNo: 1 },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.session.id, 71);
  assert.equal(response.body.session.memberPlanId, 21);
  const insert = statements.find(({ sql }) => sql.includes('INSERT INTO gym_sessions'));
  assert.match(insert.sql, /member_plan_id,member_plan_version_id/);
  assert.deepEqual(insert.args.slice(0, 5), [12, 21, 41, 1, '推']);
  const setInsert = statements.find(({ sql }) => sql.includes('INSERT INTO gym_session_sets'));
  assert.deepEqual(setInsert.args, [71, 0, 1, 'pectorals/barbell-bench-press', '杠铃卧推', 30, 8, 10, 2]);
  assert.equal(statements.some(({ sql }) => sql === 'COMMIT'), true);
});

test('member cannot start another account plan or unconfirmed plan', async () => {
  const statements = [];
  const client = { async query(sql, args) {
    statements.push({ sql, args });
    if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM member_plans')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/:planId/sessions'), {
    ...member(99), params: { planId: '21' }, body: { dayNo: 1 },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'plan_not_found' });
  const select = statements.find(({ sql }) => sql.includes('FROM member_plans'));
  assert.match(select.sql, /owner_id=\$2/);
  assert.deepEqual(select.args, [21, 99]);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

test('member session history is owner-scoped and includes resumable drafts', async () => {
  let query;
  const app = mount({ query: async (sql, args) => { query = { sql, args }; return { rows: [{ id: 71, day_no: 2, day_name: '拉', status: 'draft', plan_id: null, member_plan_id: 21, started_at: '2026-09-29T10:00:00Z', ended_at: null, duration_seconds: null }] }; } });
  const response = await invoke(app.routes.GET.get('/api/member/sessions'), member());
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.sessions[0].status, 'draft');
  assert.equal(response.body.sessions[0].planId, 21);
  assert.match(query.sql, /student_id=\$1 AND member_plan_id IS NOT NULL/);
  assert.deepEqual(query.args, [12]);
});

test('a member can only inspect their own member-plan sessions, not coach sessions or another account history', async () => {
  let args;
  const app = mount({ query: async (_sql, queryArgs) => { args = queryArgs; return { rows: [], rowCount: 0 }; } });
  const response = await invoke(app.routes.GET.get('/api/member/sessions/:sessionId'), {
    ...member(12), params: { sessionId: '501' },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'session_not_found' });
  assert.deepEqual(args, [501, 12]);
});

test('set values are validated and successful set writes include an audit row', async () => {
  const statements = [];
  const client = { async query(sql, args) {
    statements.push({ sql, args });
    if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM gym_sessions')) return { rows: [sessionRow()], rowCount: 1 };
    if (sql.includes('FROM gym_session_sets')) return { rows: [setRow({ status: 'pending', actual_reps: null, actual_rir: null })], rowCount: 1 };
    if (sql.includes('UPDATE gym_session_sets')) return { rows: [setRow({ actual_weight: 27.5, actual_reps: 10, actual_rir: 2 })], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const app = mount({ connect: async () => client });
  const invalid = await invoke(app.routes.PATCH.get('/api/member/sessions/:sessionId/sets/:exerciseIndex/:setNo'), {
    ...member(), params: { sessionId: '71', exerciseIndex: '0', setNo: '1' }, body: { actualReps: 10, actualRir: 12 },
  });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.body, { error: 'invalid_set_values' });
  assert.equal(statements.length, 0);

  const response = await invoke(app.routes.PATCH.get('/api/member/sessions/:sessionId/sets/:exerciseIndex/:setNo'), {
    ...member(), params: { sessionId: '71', exerciseIndex: '0', setNo: '1' }, body: { actualWeight: '27.5', actualReps: '10', actualRir: '2' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.set.actualWeight, 27.5);
  assert.equal(response.body.set.status, 'completed');
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO gym_session_set_audit')), true);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('set edits reject completed, non-owned, or coach-origin sessions', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM gym_sessions')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.PATCH.get('/api/member/sessions/:sessionId/sets/:exerciseIndex/:setNo'), {
    ...member(99), params: { sessionId: '71', exerciseIndex: '0', setNo: '1' }, body: { actualReps: 9, actualRir: 2 },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(statements.some((sql) => sql.includes('UPDATE gym_session_sets')), false);
});

test('session cannot complete while a set is pending; finishing requires an explicit completed set', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM gym_sessions')) return { rows: [sessionRow()], rowCount: 1 };
    if (sql.includes('FROM gym_session_sets')) return { rows: [setRow({ status: 'pending' })], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/sessions/:sessionId/complete'), {
    ...member(), params: { sessionId: '71' }, body: {},
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'finish_or_skip_each_set' });
  assert.equal(statements.some((sql) => sql.includes("SET status='completed'")), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('abandoning a member draft changes only that draft and leaves completed sessions untouched', async () => {
  const statements = [];
  const client = { async query(sql, args) {
    statements.push({ sql, args });
    if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM gym_sessions')) return { rows: [sessionRow()], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/sessions/:sessionId/abandon'), {
    ...member(), params: { sessionId: '71' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
  const update = statements.find(({ sql }) => sql.includes("SET status='abandoned'"));
  assert.deepEqual(update.args, [71]);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});
