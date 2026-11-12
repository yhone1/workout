const test = require('node:test');
const assert = require('node:assert/strict');
const HomePlan = require('../../portal/home-plan');
const {
  mountAiCoachRoutes,
  buildTrainingContext,
  normalizeProposal,
  readConfig,
  extractJson,
  bandLoadLabel,
} = require('./ai-coach');

const plan = HomePlan.groupDefaults('threeDay');
const names = { lateral: '弹力带侧平举', 'feet-push': '脚抬高俯卧撑' };

class FakePool {
  constructor({ state = {}, messages = [], reviewRows = [], applyRowCount = 1 } = {}) {
    this.state = state;
    this.messages = messages;
    this.reviewRows = reviewRows;
    this.applyRowCount = applyRowCount;
    this.calls = [];
    this.insertedMessages = null;
    this.insertedReview = null;
    this.insertedProposal = null;
  }

  async query(sql, args = []) {
    this.calls.push({ sql, args });
    if (sql.includes('FROM workout_records')) {
      return { rows: Object.entries(this.state).map(([key, value]) => ({ key, value })), rowCount: Object.keys(this.state).length };
    }
    if (sql.includes('INSERT INTO ai_coach_messages')) {
      this.insertedMessages = args;
      return { rows: [], rowCount: 2 };
    }
    if (sql.includes('FROM ai_coach_messages')) return { rows: this.messages, rowCount: this.messages.length };
    if (sql.includes('DELETE FROM ai_coach_messages')) return { rows: [], rowCount: 1 };
    if (sql.includes('INSERT INTO ai_coach_reviews')) {
      this.insertedReview = args;
      return { rows: [{ id: 9, created_at: '2026-11-12T00:00:00.000Z' }], rowCount: 1 };
    }
    if (sql.includes('FROM ai_coach_reviews')) return { rows: this.reviewRows, rowCount: this.reviewRows.length };
    if (sql.includes('INSERT INTO ai_coach_proposals')) {
      this.insertedProposal = args;
      return { rows: [{ id: 7, created_at: '2026-11-12T00:00:00.000Z' }], rowCount: 1 };
    }
    if (sql.includes('FROM ai_coach_proposals')) return { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE ai_coach_proposals')) return { rows: [], rowCount: this.applyRowCount };
    return { rows: [], rowCount: 0 };
  }
}

function appHarness() {
  const routes = [];
  const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
  return {
    routes,
    get: add('GET'),
    post: add('POST'),
    delete: add('DELETE'),
  };
}

function matchPath(pattern, path) {
  const expected = pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(':')) params[expected[index].slice(1)] = actual[index];
    else if (expected[index] !== actual[index]) return null;
  }
  return params;
}

async function invoke(app, method, path, req = {}) {
  const route = app.routes.find((item) => item.method === method && matchPath(item.path, path));
  assert.ok(route, `missing route ${method} ${path}`);
  const params = matchPath(route.path, path);
  const request = { user: { user_id: 5, roles: ['student'] }, body: {}, params, ...req };
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let index = 0;
  const next = async () => {
    const handler = route.handlers[index++];
    if (handler) return handler(request, response, next);
  };
  await next();
  return { response, request, route };
}

function mount({ pool, env = { AI_COACH_API_KEY: 'test-key' }, fetchImpl, now = () => Date.parse('2026-11-12T12:00:00Z'), limits } = {}) {
  const app = appHarness();
  mountAiCoachRoutes(app, {
    pool: pool || new FakePool(),
    auth: (req, _res, next) => next(),
    requireMembership: () => (_req, _res, next) => next(),
    env,
    fetchImpl: fetchImpl || (async () => { throw new Error('unexpected fetch'); }),
    now,
    limits,
  });
  return app;
}

function modelResponse(content, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok, status, text: async () => JSON.stringify(ok ? { choices: [{ message: { content } }] } : { error: 'bad' }) };
  };
  impl.calls = calls;
  return impl;
}

function performanceState() {
  const now = Date.parse('2026-11-12T12:00:00Z');
  return {
    thinMuscleHomePlanV1: JSON.stringify({ schema: 1, revision: 4, active: plan }),
    thinMuscleBodyProfileV1: JSON.stringify({ baseline: { sex: 'male', height: 176, weight: 72.5, waist: 85 }, current: { weight: 71.8, waist: 84 }, history: [{ date: '2026-11-10', weight: 71.8, waist: 84 }] }),
    thinMuscleExercisePerformanceV1: JSON.stringify({
      sessions: {
        [now - 86400000]: {
          day: 'push', variant: 'A', startedAt: now - 86400000, durationMs: 3600000, finalized: true, feedback: 'right',
          roundProgress: { main: { planned: 3, completed: 3, sets: 3 }, support: { planned: 4, completed: 4, sets: 7 } },
          values: {
            [`main::1::${encodeURIComponent('脚抬高俯卧撑')}`]: { reps: 10, rir: 1, levelName: '脚抬高俯卧撑', bandLoad: { combination: '120+2', unit: 'lb', mode: 'resistance' } },
            [`support::1::${encodeURIComponent('弹力带侧平举')}`]: { reps: 15, rir: 2, levelName: '弹力带侧平举', bandLoad: { min: 15, max: 25, unit: 'lb', mode: 'resistance' } },
          },
        },
        [now - 40000000]: {
          day: 'pull', variant: 'A', startedAt: now - 40000000, finalized: false,
          roundProgress: { main: { planned: 3, completed: 1, sets: 1 } },
          values: { [`main::1::${encodeURIComponent('引体向上')}`]: { reps: 99, levelName: '引体向上' } },
        },
      },
    }),
  };
}

test('reads provider configuration from environment without exposing the key', () => {
  const config = readConfig({ AI_COACH_API_KEY: 'secret', AI_COACH_BASE_URL: 'https://example.com/v1/', AI_COACH_MODEL: 'model-x' });
  assert.equal(config.apiKey, 'secret');
  assert.equal(config.baseUrl, 'https://example.com/v1');
  assert.equal(config.model, 'model-x');
  const app = mount({ env: {} });
  return invoke(app, 'GET', '/api/ai-coach/status').then(({ response }) => {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.configured, false);
    assert.equal(JSON.stringify(response.body).includes('secret'), false);
  });
});

test('training context ignores unfinished sessions and keeps loads separate', () => {
  const context = buildTrainingContext({
    state: performanceState(),
    names,
    now: Date.parse('2026-11-12T12:00:00Z'),
    windowDays: 28,
  });
  assert.equal(context.weekly.last7.sessions, 1);
  assert.equal(context.weekly.last7.sets, 10);
  assert.equal(context.weekly.last7.activeDays, 1);
  assert.equal(context.recentSessions.length, 1);
  assert.equal(context.recentSessions[0].day, '推');
  assert.equal(context.body.current.weight, 71.8);
  assert.equal(context.plan.days.push.A.length, 5);
  const namesSeen = context.exerciseTrends.map((row) => row.name);
  assert.deepEqual(namesSeen.sort(), ['弹力带侧平举', '脚抬高俯卧撑'].sort());
  const push = context.exerciseTrends.find((row) => row.name === '脚抬高俯卧撑');
  assert.equal(push.points[0].reps, 10);
  assert.equal(push.points[0].load, '阻力120+2lb');
});

test('chat sends the training context and stores both messages after success', async () => {
  const pool = new FakePool({ state: performanceState() });
  const fetchImpl = modelResponse('本周推日完成了 3 轮主关卡，先保持次数再考虑加阻力。');
  const app = mount({ pool, fetchImpl });
  const { response } = await invoke(app, 'POST', '/api/ai-coach/chat', { body: { message: '这周推日怎么样？', names } });
  assert.equal(response.statusCode, 200);
  assert.match(response.body.answer, /推日/);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /\/chat\/completions$/);
  const system = fetchImpl.calls[0].body.messages[0].content;
  assert.match(system, /薄肌/);
  assert.match(system, /弹力带侧平举/);
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer test-key');
  assert.deepEqual(pool.insertedMessages.slice(0, 2), [5, '这周推日怎么样？']);
  assert.match(pool.insertedMessages[2], /主关卡/);
});

test('unconfigured AI stops before reading training data', async () => {
  const pool = new FakePool({ state: performanceState() });
  const app = mount({ pool, env: {} });
  const { response } = await invoke(app, 'POST', '/api/ai-coach/chat', { body: { message: '你好' } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: 'ai_not_configured' });
  assert.equal(pool.calls.length, 0);
});

test('weekly review parses fenced JSON and persists structured fields', async () => {
  const content = '```json\n{"headline":"本周完成1次推日","summary":"最近7天训练1次共10组，前7天为0次。","wins":["侧平举15次"],"watchouts":["RIR记录不全"],"nextWeek":["保持每周3练"]}\n```';
  const fetchImpl = modelResponse(content);
  const pool = new FakePool({ state: performanceState() });
  const app = mount({ pool, fetchImpl });
  const { response } = await invoke(app, 'POST', '/api/ai-coach/reviews', { body: { names } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.review.headline, '本周完成1次推日');
  assert.deepEqual(response.body.review.nextWeek, ['保持每周3练']);
  assert.deepEqual(JSON.parse(pool.insertedReview[1]).wins, ['侧平举15次']);
});

test('invalid review output is rejected instead of stored', async () => {
  const fetchImpl = modelResponse('这不是 JSON');
  const pool = new FakePool({ state: performanceState() });
  const app = mount({ pool, fetchImpl });
  const { response } = await invoke(app, 'POST', '/api/ai-coach/reviews', { body: { names } });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { error: 'invalid_model_output' });
  assert.equal(pool.insertedReview, null);
});

test('proposal fills current values from the stored plan and restricts fields', () => {
  const proposal = normalizeProposal({
    summary: '侧平举提高次数上限',
    rationale: '连续两次同负荷达到 15 次，RIR 仍为 2。',
    operations: [
      { day: 'push', variant: 'A', sectionId: 'support', exerciseId: 'lateral', field: 'repMax', value: 22, reason: '连续达标' },
    ],
  }, { plan, names, revision: 4 });
  assert.equal(proposal.operations[0].current, 20);
  assert.equal(proposal.operations[0].value, 22);
  assert.equal(proposal.operations[0].exerciseName, '弹力带侧平举');
  assert.equal(proposal.baseRevision, 4);

  assert.throws(() => normalizeProposal({
    summary: '删除动作',
    rationale: '测试',
    operations: [{ day: 'push', variant: 'A', sectionId: 'support', exerciseId: 'lateral', field: 'exerciseId', value: 'pull' }],
  }, { plan, names }), /invalid_model_output/);

  assert.throws(() => normalizeProposal({
    summary: '轮数降到 1',
    rationale: '测试',
    operations: [{ day: 'push', variant: 'A', sectionId: 'support', field: 'rounds', value: 1 }],
  }, { plan, names }), /invalid_model_output/);
});

test('proposal endpoint stores a pending proposal with validated operations', async () => {
  const content = JSON.stringify({
    summary: '侧平举提高次数上限',
    rationale: '最近两次同负荷达到 20 次。',
    operations: [{ day: 'push', variant: 'A', sectionId: 'support', exerciseId: 'lateral', field: 'repMax', value: 22 }],
  });
  const fetchImpl = modelResponse(content);
  const pool = new FakePool({ state: performanceState() });
  const app = mount({ pool, fetchImpl });
  const { response } = await invoke(app, 'POST', '/api/ai-coach/proposals', { body: { names, focus: '肩部' } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.proposal.status, 'pending');
  assert.equal(response.body.proposal.operations[0].current, 20);
  assert.equal(pool.insertedProposal[0], 5);
  assert.deepEqual(JSON.parse(pool.insertedProposal[3])[0].exerciseId, 'lateral');
  assert.equal(pool.insertedProposal[4], 4);
});

test('legacy non-group plans cannot generate structured proposals', async () => {
  const state = performanceState();
  state.thinMuscleHomePlanV1 = JSON.stringify({ schema: 1, revision: 1, active: HomePlan.defaults('threeDay') });
  const pool = new FakePool({ state });
  const app = mount({ pool, fetchImpl: modelResponse('{}') });
  const { response } = await invoke(app, 'POST', '/api/ai-coach/proposals', { body: { names } });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'plan_required' });
});

test('proposal decisions are scoped to the authenticated account and pending status', async () => {
  const pool = new FakePool({ applyRowCount: 1 });
  const app = mount({ pool });
  const { response, route } = await invoke(app, 'POST', '/api/ai-coach/proposals/7/apply');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
  const update = pool.calls.find(({ sql }) => sql.includes('UPDATE ai_coach_proposals'));
  assert.match(update.sql, /user_id = \$2 AND status = 'pending'/);
  assert.deepEqual(update.args, [7, 5]);
  assert.match(route.path, /:id\/apply/);

  const missing = mount({ pool: new FakePool({ applyRowCount: 0 }) });
  const denied = await invoke(missing, 'POST', '/api/ai-coach/proposals/7/dismiss');
  assert.equal(denied.response.statusCode, 409);
  assert.deepEqual(denied.response.body, { error: 'proposal_not_pending' });
});

test('utility parsers tolerate text and reject empty JSON', () => {
  assert.deepEqual(extractJson('说明\n{"a":1}\n结束'), { a: 1 });
  assert.throws(() => extractJson(''), /invalid_model_output/);
  assert.equal(bandLoadLabel({ combination: '120+2', unit: 'lb', mode: 'resistance' }), '阻力120+2lb');
  assert.equal(bandLoadLabel({ min: 15, max: 25, unit: 'lb', mode: 'assistance' }), '辅助15–25lb');
  assert.equal(bandLoadLabel({ min: 15, max: 15, unit: 'kg', mode: 'resistance' }), '阻力15kg');
});
