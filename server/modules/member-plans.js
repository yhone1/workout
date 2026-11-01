const { normalizePlanContent } = require('./catalog-plans');
const { findActiveMembership, isSuperAdmin } = require('./membership-access');

const VALID_SPLITS = new Set(['ppl', 'upper_lower', 'five_day', 'custom']);
const PLAN_ERRORS = new Set([
  'invalid_plan', 'invalid_plan_target', 'empty_training_day', 'too_many_exercises',
  'duplicate_exercise_in_day', 'exercise_not_available',
]);

function cleanText(value, max = 100) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function ensurePlanRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || !VALID_SPLITS.has(body.splitType)
      || !body.content || typeof body.content !== 'object' || Array.isArray(body.content)) {
    throw new Error('invalid_plan');
  }
  if (Array.isArray(body.content.days) && body.content.days.some((day) => !day || typeof day !== 'object'
      || !Array.isArray(day.exercises) || day.exercises.some((exercise) => !exercise || typeof exercise !== 'object' || Array.isArray(exercise)))) {
    throw new Error('invalid_plan');
  }
}

async function normalizeMemberPlan(pool, body, splitType, requireExercises = false) {
  ensurePlanRequest({ ...body, splitType, content: body });
  return normalizePlanContent(pool, body, splitType, requireExercises);
}

async function membershipIsCurrent(client, user) {
  if (isSuperAdmin(user)) return true;
  return Boolean(await findActiveMembership(client, user.user_id));
}

function versionResponse(row) {
  return {
    versionNo: Number(row.version_no),
    content: row.version_content ?? row.content,
    confirmedAt: row.confirmed_at,
  };
}

function groupedPlans(rows) {
  const plans = new Map();
  for (const row of rows) {
    let plan = plans.get(row.id);
    if (!plan) {
      plan = {
        id: row.id,
        splitType: row.split_type,
        name: row.name,
        status: row.status,
        currentVersionNo: row.current_version_no === null ? null : Number(row.current_version_no),
        draftContent: row.draft_content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        versions: [],
      };
      plans.set(row.id, plan);
    }
    if (row.version_no !== null && row.version_no !== undefined) plan.versions.push(versionResponse(row));
  }
  for (const plan of plans.values()) {
    plan.currentVersion = plan.versions.find((version) => version.versionNo === plan.currentVersionNo) || null;
  }
  return [...plans.values()];
}

function draftPlanResponse(row) {
  return {
    id: row.id,
    splitType: row.split_type,
    name: row.name,
    status: row.status,
    currentVersionNo: row.current_version_no === null || row.current_version_no === undefined
      ? null : Number(row.current_version_no),
    draftContent: row.draft_content,
    versions: [],
    currentVersion: null,
  };
}

function errorResponse(res, error, routeName) {
  if (PLAN_ERRORS.has(error.message)) return res.status(400).json({ error: error.message });
  if (error.message === 'plan_not_found') return res.status(404).json({ error: error.message });
  if (error.message === 'plan_not_confirmable') return res.status(409).json({ error: error.message });
  if (error.code === '23505') return res.status(409).json({ error: 'plan_conflict' });
  console.error(routeName, error.message);
  return res.status(500).json({ error: 'db' });
}

function mountMemberPlanRoutes(app, { pool, auth, requireMembership }) {
  const member = [auth, requireMembership({ pool })];

  app.get('/api/member/plans', ...member, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT p.id,p.owner_id,p.split_type,p.name,p.status,p.current_version_no,p.draft_content,p.created_at,p.updated_at,
                v.version_no,v.content AS version_content,v.confirmed_at
         FROM member_plans p LEFT JOIN member_plan_versions v ON v.plan_id=p.id
         WHERE p.owner_id=$1
         ORDER BY p.updated_at DESC,p.id DESC,v.version_no ASC`,
        [req.user.user_id],
      );
      res.json({ plans: groupedPlans(result.rows) });
    } catch (error) { errorResponse(res, error, 'GET /api/member/plans'); }
  });

  app.post('/api/member/plans/drafts', ...member, async (req, res) => {
    const body = req.body || {};
    try { ensurePlanRequest(body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const name = cleanText(body.name) || '我的训练计划';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const content = await normalizeMemberPlan(client, body.content, body.splitType, false);
      const result = await client.query(
        `INSERT INTO member_plans (owner_id,split_type,name,status,draft_content)
         VALUES ($1,$2,$3,'draft',$4::jsonb) RETURNING *`,
        [req.user.user_id, body.splitType, name, JSON.stringify(content)],
      );
      await client.query('COMMIT');
      res.status(201).json({ plan: draftPlanResponse(result.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      errorResponse(res, error, 'POST /api/member/plans/drafts');
    } finally { client.release(); }
  });

  app.put('/api/member/plans/:planId/draft', ...member, async (req, res) => {
    const planId = positiveId(req.params.planId);
    if (!planId) return res.status(400).json({ error: 'invalid_plan' });
    const body = req.body || {};
    if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) return res.status(400).json({ error: 'invalid_plan' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const selected = await client.query(
        `SELECT * FROM member_plans WHERE id=$1 AND owner_id=$2 AND status IN ('draft','active') FOR UPDATE`,
        [planId, req.user.user_id],
      );
      if (!selected.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'plan_not_found' }); }
      const plan = selected.rows[0];
      const content = await normalizeMemberPlan(client, body.content, plan.split_type, false);
      const name = cleanText(body.name) || plan.name;
      const updated = await client.query(
        `UPDATE member_plans SET name=$3,draft_content=$4::jsonb,updated_at=now()
         WHERE id=$1 AND owner_id=$2 RETURNING *`,
        [planId, req.user.user_id, name, JSON.stringify(content)],
      );
      await client.query('COMMIT');
      res.json({ plan: draftPlanResponse(updated.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      errorResponse(res, error, 'PUT /api/member/plans/:planId/draft');
    } finally { client.release(); }
  });

  app.post('/api/member/plans/:planId/confirm', ...member, async (req, res) => {
    const planId = positiveId(req.params.planId);
    if (!planId) return res.status(400).json({ error: 'invalid_plan' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const selected = await client.query(
        `SELECT * FROM member_plans WHERE id=$1 AND owner_id=$2 AND status IN ('draft','active') FOR UPDATE`,
        [planId, req.user.user_id],
      );
      if (!selected.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'plan_not_found' }); }
      const plan = selected.rows[0];
      const content = await normalizeMemberPlan(client, plan.draft_content, plan.split_type, true);
      const nextVersion = await client.query(
        'SELECT COALESCE(MAX(version_no),0)+1 AS next FROM member_plan_versions WHERE plan_id=$1', [planId],
      );
      const versionNo = Number(nextVersion.rows[0].next);
      const version = await client.query(
        `INSERT INTO member_plan_versions (plan_id,version_no,content,created_by)
         VALUES ($1,$2,$3::jsonb,$4)
         RETURNING id,plan_id,version_no,content AS version_content,confirmed_at`,
        [planId, versionNo, JSON.stringify(content), req.user.user_id],
      );
      const updated = await client.query(
        `UPDATE member_plans SET status='active',current_version_no=$3,draft_content=$4::jsonb,updated_at=now()
         WHERE id=$1 AND owner_id=$2 RETURNING *`,
        [planId, req.user.user_id, versionNo, JSON.stringify(content)],
      );
      await client.query('COMMIT');
      const currentVersion = versionResponse(version.rows[0]);
      res.json({ plan: {
        ...draftPlanResponse(updated.rows[0]),
        versions: [...(plan.current_version_no ? [{ versionNo: Number(plan.current_version_no) }] : []), currentVersion],
        currentVersion,
      } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      errorResponse(res, error, 'POST /api/member/plans/:planId/confirm');
    } finally { client.release(); }
  });
}

module.exports = { groupedPlans, mountMemberPlanRoutes, normalizeMemberPlan };
