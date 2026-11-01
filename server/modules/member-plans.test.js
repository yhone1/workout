const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let mountMemberPlanRoutes = null;
try { ({ mountMemberPlanRoutes } = require('./member-plans')); } catch {}

function fakeApp() {
  const routes = { GET: new Map(), POST: new Map(), PUT: new Map() };
  return {
    routes,
    get(path, ...handlers) { routes.GET.set(path, handlers); },
    post(path, ...handlers) { routes.POST.set(path, handlers); },
    put(path, ...handlers) { routes.PUT.set(path, handlers); },
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

function mount(pool) {
  assert.equal(typeof mountMemberPlanRoutes, 'function', 'member plan routes should be implemented');
  const app = fakeApp();
  mountMemberPlanRoutes(app, {
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

function emptySplit(splitType = 'ppl') {
  const count = { ppl: 3, upper_lower: 4, five_day: 5, custom: 1 }[splitType] || 3;
  return { days: Array.from({ length: count }, (_, index) => ({ name: `训练日 ${index + 1}`, exercises: [] })) };
}

function filledSplit() {
  return { days: Array.from({ length: 3 }, (_, index) => ({
    name: `训练日 ${index + 1}`,
    exercises: [{ exerciseSlug: 'pectorals/barbell-bench-press', sets: 3, repMin: 6, repMax: 10, rir: 2, restSeconds: 90 }],
  })) };
}

function exerciseRow() {
  return { id: 4, slug: 'pectorals/barbell-bench-press', name_zh: '杠铃卧推', primary_muscle_zh: '胸部', secondary_muscles_zh: ['三头'], equipment: 'barbell', equipment_zh: '杠铃', media_path: null, cue_zh: '控制下放' };
}

test('member plan routes are mounted as independent endpoints', () => {
  assert.equal(typeof mountMemberPlanRoutes, 'function');
});

test('no-membership students and coach-related students cannot access plan APIs or touch plan data', async () => {
  let touched = 0;
  const app = mount({
    query: async () => { touched += 1; throw new Error('must_not_query'); },
    connect: async () => { touched += 1; throw new Error('must_not_connect'); },
  });
  const requests = [
    [app.routes.GET.get('/api/member/plans'), { ...member(12, false) }],
    [app.routes.POST.get('/api/member/plans/drafts'), { ...member(12, false), body: { splitType: 'ppl', content: emptySplit() } }],
    [app.routes.PUT.get('/api/member/plans/:planId/draft'), { ...member(12, false), params: { planId: '8' }, body: { content: emptySplit() } }],
    [app.routes.POST.get('/api/member/plans/:planId/confirm'), { ...member(12, false), params: { planId: '8' } }],
    [app.routes.GET.get('/api/member/plans'), { user: { user_id: 12, roles: ['student', 'coach'] }, hasMembership: false }],
  ];
  for (const [stack, req] of requests) {
    const response = await invoke(stack, req);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: 'membership_required' });
  }
  assert.equal(touched, 0);
});

test('plan listing is scoped to the authenticated owner and includes only member-plan versions', async () => {
  const calls = [];
  const app = mount({ query: async (sql, args) => {
    calls.push({ sql, args });
    return { rows: [{ id: 51, owner_id: 12, split_type: 'ppl', name: '自选计划', status: 'active', current_version_no: 1,
      draft_content: emptySplit(), version_no: 1, version_content: filledSplit(), confirmed_at: '2026-09-29T00:00:00Z' }] };
  } });
  const response = await invoke(app.routes.GET.get('/api/member/plans'), member());
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.plans[0].id, 51);
  assert.equal(response.body.plans[0].versions[0].versionNo, 1);
  assert.match(calls[0].sql, /member_plans/);
  assert.match(calls[0].sql, /owner_id\s*=\s*\$1/);
  assert.deepEqual(calls[0].args, [12]);
});

test('a member cannot update another user plan even with its exact ID', async () => {
  const statements = [];
  const client = {
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM member_plans')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.PUT.get('/api/member/plans/:planId/draft'), {
    ...member(12), params: { planId: '91' }, body: { content: emptySplit() },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'plan_not_found' });
  const ownershipLookup = statements.find(({ sql }) => sql.includes('FROM member_plans'));
  assert.deepEqual(ownershipLookup.args, [91, 12]);
  assert.equal(statements.some(({ sql }) => sql.includes('UPDATE member_plans')), false);
});

test('invalid split and invalid target values are rejected instead of becoming a plan', async () => {
  let touched = 0;
  const app = mount({ connect: async () => {
    touched += 1;
    return {
      async query(sql) {
        if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
        if (sql.includes('FROM gym_exercises')) return { rows: [exerciseRow()] };
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
  } });
  const invalidSplit = await invoke(app.routes.POST.get('/api/member/plans/drafts'), {
    ...member(), body: { splitType: 'bro_split', content: emptySplit() },
  });
  assert.equal(invalidSplit.statusCode, 400);
  assert.deepEqual(invalidSplit.body, { error: 'invalid_plan' });
  assert.equal(touched, 0);

  const badTarget = filledSplit();
  badTarget.days[0].exercises[0].rir = 9;
  const invalidPlan = await invoke(app.routes.POST.get('/api/member/plans/drafts'), {
    ...member(), body: { splitType: 'ppl', content: badTarget },
  });
  assert.equal(invalidPlan.statusCode, 400);
  assert.equal(invalidPlan.body.error, 'invalid_plan_target');
});

test('draft save is owner-scoped and does not create a formal version', async () => {
  const statements = [];
  const client = {
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM gym_exercises')) return { rows: [exerciseRow()] };
      if (sql.includes('INSERT INTO member_plans')) return { rows: [{ id: 51, owner_id: 12, split_type: 'ppl', name: '手动计划', status: 'draft', current_version_no: null, draft_content: JSON.parse(args[3]) }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/drafts'), {
    ...member(), body: { splitType: 'ppl', name: '手动计划', content: emptySplit() },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.plan.status, 'draft');
  assert.equal(response.body.plan.currentVersionNo, null);
  assert.deepEqual(statements[0], { sql: 'BEGIN', args: undefined });
  const insert = statements.find(({ sql }) => sql.includes('INSERT INTO member_plans'));
  assert.deepEqual(insert.args.slice(0, 3), [12, 'ppl', '手动计划']);
  assert.equal(statements.some(({ sql }) => sql.includes('member_plan_versions')), false);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('member self-service plan editor offers custom split and editable training-day controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../member/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../member/app.js'), 'utf8');
  assert.match(html, /<option value="custom">自定义<\/option>/);
  assert.match(html, /id="addTrainingDayButton"/);
  assert.match(app, /data-remove-training-day/);
  assert.match(app, /最多安排\s*7\s*个训练日/);
  assert.match(app, /至少保留\s*1\s*个训练日/);
});

test('a member can create a custom-plan draft with one through seven training days', async () => {
  const statements = [];
  const client = {
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('INSERT INTO member_plans')) return { rows: [{
        id: 52, owner_id: 12, split_type: 'custom', name: '自定义计划', status: 'draft', current_version_no: null,
        draft_content: JSON.parse(args[3]),
      }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/drafts'), {
    ...member(), body: { splitType: 'custom', name: '自定义计划', content: emptySplit('custom') },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.plan.splitType, 'custom');
  assert.equal(response.body.plan.draftContent.days.length, 1);
  const insert = statements.find(({ sql }) => sql.includes('INSERT INTO member_plans'));
  assert.deepEqual(insert.args.slice(0, 3), [12, 'custom', '自定义计划']);
  assert.equal(statements.at(-1).sql, 'COMMIT');

  let inserted = false;
  const tooManyDaysApp = mount({ connect: async () => ({
    async query(sql) {
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('INSERT INTO member_plans')) inserted = true;
      return { rows: [], rowCount: 1 };
    },
    release() {},
  }) });
  const tooManyDays = await invoke(tooManyDaysApp.routes.POST.get('/api/member/plans/drafts'), {
    ...member(), body: { splitType: 'custom', content: { days: Array.from({ length: 8 }, (_, index) => ({ name: `训练日 ${index + 1}`, exercises: [] })) } },
  });
  assert.equal(tooManyDays.statusCode, 400);
  assert.deepEqual(tooManyDays.body, { error: 'invalid_plan' });
  assert.equal(inserted, false);
});

test('membership revoked after middleware check is rechecked inside the plan transaction', async () => {
  const statements = [];
  const client = { async query(sql) { statements.push(sql); return { rows: [], rowCount: 0 }; }, release() {} };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/drafts'), {
    ...member(), body: { splitType: 'ppl', content: emptySplit() },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'membership_required' });
  assert.ok(statements[1].includes('membership_grants'));
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO member_plans')), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('confirm appends an immutable version snapshot without updating earlier versions or coach plans', async () => {
  const statements = [];
  const priorDraft = filledSplit();
  const versionTwo = { id: 17, plan_id: 51, version_no: 2, content: priorDraft, confirmed_at: '2026-09-29T00:00:00Z' };
  const client = {
    async query(sql, args) {
      statements.push({ sql, args });
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM member_plans')) return { rows: [{ id: 51, owner_id: 12, split_type: 'ppl', name: '手动计划', status: 'active', current_version_no: 1, draft_content: priorDraft }], rowCount: 1 };
      if (sql.includes('FROM gym_exercises')) return { rows: [exerciseRow()] };
      if (sql.includes('MAX(version_no)')) return { rows: [{ next: 2 }], rowCount: 1 };
      if (sql.includes('INSERT INTO member_plan_versions')) return { rows: [versionTwo], rowCount: 1 };
      if (sql.includes('UPDATE member_plans')) return { rows: [{ id: 51, owner_id: 12, split_type: 'ppl', name: '手动计划', status: 'active', current_version_no: 2, draft_content: priorDraft }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/:planId/confirm'), {
    ...member(), params: { planId: '51' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.plan.currentVersionNo, 2);
  assert.equal(response.body.plan.versions.at(-1).versionNo, 2);
  assert.equal(statements.some(({ sql }) => /UPDATE\s+member_plan_versions/i.test(sql)), false);
  assert.equal(statements.some(({ sql }) => /gym_plans|gym_plan_versions/.test(sql)), false);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('a draft with an empty training day cannot be confirmed as the active plan', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('membership_grants')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (sql.includes('FROM member_plans')) return { rows: [{ id: 51, owner_id: 12, split_type: 'ppl', name: '空计划', status: 'draft', draft_content: emptySplit() }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = mount({ connect: async () => client });
  const response = await invoke(app.routes.POST.get('/api/member/plans/:planId/confirm'), {
    ...member(), params: { planId: '51' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'empty_training_day' });
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO member_plan_versions')), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});
