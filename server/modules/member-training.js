const { findActiveMembership, isSuperAdmin } = require('./membership-access');
const { sessionDetails } = require('./workouts-measurements');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function membershipIsCurrent(client, user) {
  if (isSuperAdmin(user)) return true;
  return Boolean(await findActiveMembership(client, user.user_id));
}

function parseSetValues(body = {}) {
  const actualWeight = body.actualWeight === '' || body.actualWeight == null ? null : Number(body.actualWeight);
  const actualReps = body.actualReps === '' || body.actualReps == null ? null : Number(body.actualReps);
  const actualRir = body.actualRir === '' || body.actualRir == null ? null : Number(body.actualRir);
  const replacementName = String(body.replacementName || '').trim().slice(0, 100) || null;
  const status = ['pending', 'completed', 'skipped', 'replaced'].includes(body.status)
    ? body.status : (actualReps !== null && actualRir !== null ? 'completed' : 'pending');
  if ((actualWeight !== null && (!Number.isFinite(actualWeight) || actualWeight < 0 || actualWeight > 1000))
      || (actualReps !== null && (!Number.isInteger(actualReps) || actualReps < 0 || actualReps > 300))
      || (actualRir !== null && (!Number.isInteger(actualRir) || actualRir < 0 || actualRir > 10))
      || (status === 'completed' && (actualReps === null || actualRir === null))
      || (status === 'replaced' && !replacementName)) throw new Error('invalid_set_values');
  return { actualWeight, actualReps, actualRir, replacementName, status, note: String(body.note || '').trim().slice(0, 300) };
}

function sessionListItem(row) {
  return {
    id: row.id,
    planId: row.member_plan_id,
    planVersionId: row.member_plan_version_id,
    dayNo: row.day_no,
    dayName: row.day_name,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
  };
}

function mountMemberTrainingRoutes(app, { pool, auth, requireMembership }) {
  const member = [auth, requireMembership({ pool })];

  app.get('/api/member/sessions', ...member, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id,member_plan_id,member_plan_version_id,day_no,day_name,status,started_at,ended_at,duration_seconds
         FROM gym_sessions WHERE student_id=$1 AND member_plan_id IS NOT NULL
         ORDER BY started_at DESC LIMIT 100`,
        [req.user.user_id],
      );
      res.json({ sessions: result.rows.map(sessionListItem) });
    } catch (error) { console.error('GET /api/member/sessions', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.get('/api/member/sessions/:sessionId', ...member, async (req, res) => {
    const sessionId = positiveId(req.params.sessionId);
    if (!sessionId) return res.status(400).json({ error: 'invalid_session' });
    try {
      const owned = await pool.query(
        'SELECT id FROM gym_sessions WHERE id=$1 AND student_id=$2 AND member_plan_id IS NOT NULL',
        [sessionId, req.user.user_id],
      );
      if (!owned.rowCount) return res.status(404).json({ error: 'session_not_found' });
      res.json({ session: await sessionDetails(pool, sessionId) });
    } catch (error) { console.error('GET /api/member/sessions/:sessionId', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.post('/api/member/plans/:planId/sessions', ...member, async (req, res) => {
    const planId = positiveId(req.params.planId);
    const dayNo = Number(req.body?.dayNo);
    if (!planId || !Number.isSafeInteger(dayNo) || dayNo < 1) return res.status(400).json({ error: 'invalid_session' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const selected = await client.query(
        `SELECT p.id,p.owner_id,p.status,p.current_version_no,v.id AS version_id,v.version_no,v.content
         FROM member_plans p JOIN member_plan_versions v ON v.plan_id=p.id AND v.version_no=p.current_version_no
         WHERE p.id=$1 AND p.owner_id=$2 AND p.status='active' FOR SHARE OF p,v`,
        [planId, req.user.user_id],
      );
      if (!selected.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'plan_not_found' }); }
      const plan = selected.rows[0];
      const day = plan.content.days?.find((item) => Number(item.dayNo) === dayNo);
      if (!day) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'training_day_not_found' }); }
      if (!Array.isArray(day.exercises) || day.exercises.length === 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'empty_training_day' }); }
      const created = await client.query(
        `INSERT INTO gym_sessions (student_id,member_plan_id,member_plan_version_id,day_no,day_name,snapshot)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
        [req.user.user_id, plan.id, plan.version_id, dayNo, day.name, JSON.stringify({ ...day, versionNo: Number(plan.version_no) })],
      );
      const sessionId = created.rows[0].id;
      for (let index = 0; index < day.exercises.length; index += 1) {
        const exercise = day.exercises[index];
        for (let setNo = 1; setNo <= Number(exercise.sets); setNo += 1) {
          await client.query(
            `INSERT INTO gym_session_sets (session_id,exercise_index,set_no,exercise_slug,exercise_name_zh,target_weight,target_rep_min,target_rep_max,target_rir)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [sessionId, index, setNo, exercise.exerciseSlug, exercise.exerciseNameZh, exercise.targetWeight ?? null, exercise.repMin, exercise.repMax, exercise.rir],
          );
        }
      }
      await client.query('COMMIT');
      res.status(201).json({ session: await sessionDetails(pool, sessionId) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505' && error.constraint === 'gym_sessions_one_open_per_student') return res.status(409).json({ error: 'open_session_exists' });
      console.error('POST member session start', error.message);
      res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.patch('/api/member/sessions/:sessionId/sets/:exerciseIndex/:setNo', ...member, async (req, res) => {
    const sessionId = positiveId(req.params.sessionId);
    const exerciseIndex = Number(req.params.exerciseIndex);
    const setNo = Number(req.params.setNo);
    if (!sessionId || !Number.isInteger(exerciseIndex) || exerciseIndex < 0 || !Number.isInteger(setNo) || setNo < 1) return res.status(400).json({ error: 'invalid_set' });
    let values;
    try { values = parseSetValues(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const selected = await client.query(
        `SELECT * FROM gym_sessions WHERE id=$1 AND student_id=$2 AND member_plan_id IS NOT NULL FOR UPDATE`,
        [sessionId, req.user.user_id],
      );
      if (!selected.rowCount || selected.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_editable' }); }
      const prior = await client.query(
        'SELECT * FROM gym_session_sets WHERE session_id=$1 AND exercise_index=$2 AND set_no=$3 FOR UPDATE',
        [sessionId, exerciseIndex, setNo],
      );
      if (!prior.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'set_not_found' }); }
      const updated = await client.query(
        `UPDATE gym_session_sets SET actual_weight=$4,actual_reps=$5,actual_rir=$6,status=$7,replacement_name=$8,note=$9,updated_by=$10,updated_at=now()
         WHERE session_id=$1 AND exercise_index=$2 AND set_no=$3 RETURNING *`,
        [sessionId, exerciseIndex, setNo, ['skipped', 'replaced'].includes(values.status) ? null : values.actualWeight,
          ['skipped', 'replaced'].includes(values.status) ? null : values.actualReps,
          ['skipped', 'replaced'].includes(values.status) ? null : values.actualRir,
          values.status, values.replacementName, values.note, req.user.user_id],
      );
      const auditValue = (row) => ({ actualWeight: row.actual_weight, actualReps: row.actual_reps, actualRir: row.actual_rir, status: row.status, replacementName: row.replacement_name, note: row.note });
      await client.query(
        `INSERT INTO gym_session_set_audit (session_id,exercise_index,set_no,changed_by,before_value,after_value)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [sessionId, exerciseIndex, setNo, req.user.user_id, JSON.stringify(auditValue(prior.rows[0])), JSON.stringify(auditValue(updated.rows[0]))],
      );
      await client.query('UPDATE gym_sessions SET updated_at=now() WHERE id=$1', [sessionId]);
      await client.query('COMMIT');
      const row = updated.rows[0];
      res.json({ set: { exerciseIndex: row.exercise_index, setNo: row.set_no, actualWeight: row.actual_weight === null ? null : Number(row.actual_weight), actualReps: row.actual_reps, actualRir: row.actual_rir, status: row.status, replacementName: row.replacement_name, note: row.note } });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('save member set', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.post('/api/member/sessions/:sessionId/complete', ...member, async (req, res) => {
    const sessionId = positiveId(req.params.sessionId);
    if (!sessionId) return res.status(400).json({ error: 'invalid_session' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const selected = await client.query(
        `SELECT * FROM gym_sessions WHERE id=$1 AND student_id=$2 AND member_plan_id IS NOT NULL FOR UPDATE`,
        [sessionId, req.user.user_id],
      );
      if (!selected.rowCount || selected.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_editable' }); }
      const allSets = await client.query('SELECT * FROM gym_session_sets WHERE session_id=$1 ORDER BY exercise_index,set_no', [sessionId]);
      if (!allSets.rowCount || allSets.rows.some((row) => row.status === 'pending') || !allSets.rows.some((row) => row.status === 'completed')) {
        await client.query('ROLLBACK'); return res.status(409).json({ error: 'finish_or_skip_each_set' });
      }
      await client.query(
        `UPDATE gym_sessions SET status='completed',ended_at=now(),duration_seconds=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (now()-started_at)))::int),notes=$2,updated_at=now()
         WHERE id=$1`,
        [sessionId, String(req.body?.notes || '').trim().slice(0, 1000)],
      );
      await client.query('COMMIT');
      res.json({ session: await sessionDetails(pool, sessionId) });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('complete member session', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.post('/api/member/sessions/:sessionId/abandon', ...member, async (req, res) => {
    const sessionId = positiveId(req.params.sessionId);
    if (!sessionId) return res.status(400).json({ error: 'invalid_session' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await membershipIsCurrent(client, req.user)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'membership_required' }); }
      const selected = await client.query(
        `SELECT id,status FROM gym_sessions WHERE id=$1 AND student_id=$2 AND member_plan_id IS NOT NULL FOR UPDATE`,
        [sessionId, req.user.user_id],
      );
      if (!selected.rowCount || selected.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_editable' }); }
      await client.query("UPDATE gym_sessions SET status='abandoned',ended_at=now(),updated_at=now() WHERE id=$1", [sessionId]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('abandon member session', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });
}

module.exports = { mountMemberTrainingRoutes, membershipIsCurrent, parseSetValues, sessionListItem };
