const { requireRole } = require('./identity-coaching');

async function coachOwnsStudent(pool, coachId, studentId, lock = false) {
  const result = await pool.query(
    `SELECT id FROM coach_student_relationships
     WHERE coach_id=$1 AND student_id=$2 AND status='active' LIMIT 1 ${lock ? 'FOR SHARE' : ''}`,
    [coachId, studentId],
  );
  return result.rowCount > 0;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function optionalNumber(value, min, max, precision = 2) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('invalid_measurement');
  return Number(number.toFixed(precision));
}

function normalizeMeasurement(body) {
  const weightKg = optionalNumber(body.weightKg, 15, 500);
  const waistCm = optionalNumber(body.waistCm, 30, 300);
  const bodyFatPct = optionalNumber(body.bodyFatPct, 2, 70);
  if (weightKg === null && waistCm === null && bodyFatPct === null) throw new Error('empty_measurement');
  return { weightKg, waistCm, bodyFatPct, note: String(body.note || '').trim().slice(0, 300) };
}

function mapMeasurement(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    enteredBy: row.entered_by,
    entryType: row.entry_type,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    waistCm: row.waist_cm === null ? null : Number(row.waist_cm),
    bodyFatPct: row.body_fat_pct === null ? null : Number(row.body_fat_pct),
    note: row.note,
    status: row.status,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    recordedAt: row.recorded_at,
  };
}

async function createMeasurement(pool, { studentId, actorId, coachId = null, body, initial }) {
  const values = normalizeMeasurement(body || {});
  if (initial && (values.weightKg === null || values.waistCm === null)) throw new Error('initial_requires_weight_and_waist');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (coachId && !await coachOwnsStudent(client, coachId, studentId, true)) { await client.query('ROLLBACK'); throw new Error('student_not_found'); }
    if (initial) {
      const existing = await client.query("SELECT id FROM gym_measurements WHERE student_id=$1 AND entry_type='initial' FOR UPDATE", [studentId]);
      if (existing.rowCount) { await client.query('ROLLBACK'); throw new Error('initial_already_exists'); }
    }
    const result = await client.query(
      `INSERT INTO gym_measurements (
         student_id, entered_by, entry_type, weight_kg, waist_cm, body_fat_pct, note,
         status, confirmed_by, confirmed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [studentId, actorId, initial ? 'initial' : 'followup', values.weightKg, values.waistCm, values.bodyFatPct, values.note,
        initial ? 'pending_student_confirmation' : 'confirmed', initial ? null : actorId, initial ? null : new Date()],
    );
    await client.query('INSERT INTO gym_measurement_events (measurement_id,actor_id,event_type) VALUES ($1,$2,\'created\')', [result.rows[0].id, actorId]);
    await client.query('COMMIT');
    return mapMeasurement(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw new Error('initial_already_exists');
    throw error;
  } finally { client.release(); }
}

async function listMeasurements(pool, studentId) {
  const result = await pool.query('SELECT * FROM gym_measurements WHERE student_id=$1 ORDER BY recorded_at DESC,id DESC', [studentId]);
  return result.rows.map(mapMeasurement);
}

async function sessionDetails(pool, sessionId) {
  const result = await pool.query('SELECT * FROM gym_sessions WHERE id=$1', [sessionId]);
  if (!result.rowCount) return null;
  const session = result.rows[0];
  const sets = await pool.query(
    `SELECT * FROM gym_session_sets WHERE session_id=$1 ORDER BY exercise_index,set_no`, [sessionId],
  );
  const suggestions = await pool.query('SELECT * FROM gym_progression_suggestions WHERE session_id=$1 ORDER BY id', [sessionId]);
  return {
    id: session.id,
    studentId: session.student_id,
    coachId: session.coach_id,
    planId: session.plan_id,
    memberPlanId: session.member_plan_id ?? null,
    memberPlanVersionId: session.member_plan_version_id ?? null,
    dayNo: session.day_no,
    dayName: session.day_name,
    snapshot: session.snapshot,
    status: session.status,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    durationSeconds: session.duration_seconds,
    notes: session.notes,
    sets: sets.rows.map((row) => ({
      exerciseIndex: row.exercise_index, setNo: row.set_no, exerciseSlug: row.exercise_slug,
      exerciseNameZh: row.exercise_name_zh, targetWeight: row.target_weight === null ? null : Number(row.target_weight),
      targetRepMin: row.target_rep_min, targetRepMax: row.target_rep_max, targetRir: row.target_rir,
      actualWeight: row.actual_weight === null ? null : Number(row.actual_weight), actualReps: row.actual_reps,
      actualRir: row.actual_rir, status: row.status, replacementName: row.replacement_name, note: row.note,
      updatedAt: row.updated_at,
    })),
    suggestions: suggestions.rows.map((row) => ({ id: row.id, exerciseSlug: row.exercise_slug, exerciseNameZh: row.exercise_name_zh, suggestion: row.suggestion, status: row.status })),
  };
}

async function sessionAccess(pool, sessionId, userId, role) {
  const result = await pool.query('SELECT * FROM gym_sessions WHERE id=$1', [sessionId]);
  if (!result.rowCount) return null;
  const session = result.rows[0];
  if (role === 'student') return session.student_id === userId && !session.member_plan_id ? session : null;
  if (session.coach_id !== userId || !await coachOwnsStudent(pool, userId, session.student_id)) return null;
  return session;
}

async function createProgressionSuggestions(client, session, sets, actorId) {
  const exerciseIndexes = [...new Set(sets.map((row) => row.exercise_index))];
  for (const exerciseIndex of exerciseIndexes) {
    const current = sets.filter((row) => row.exercise_index === exerciseIndex && row.status === 'completed');
    if (!current.length || sets.some((row) => row.exercise_index === exerciseIndex && row.status === 'pending')) continue;
    if (!current.every((row) => row.actual_reps >= row.target_rep_max && row.actual_rir >= 3 && row.actual_weight !== null && Number(row.actual_weight) > 0)) continue;
    const slug = current[0].exercise_slug;
    const previous = await client.query(
      `SELECT MAX(ss.actual_weight)::numeric AS max_weight, MAX(ss.actual_reps)::int AS max_reps
       FROM gym_sessions gs JOIN gym_session_sets ss ON ss.session_id=gs.id
       WHERE gs.student_id=$1 AND gs.status='completed' AND gs.coach_id IS NOT NULL AND gs.id<>$2 AND ss.exercise_slug=$3 AND ss.status='completed'
       GROUP BY gs.id ORDER BY MAX(gs.started_at) DESC LIMIT 1`,
      [session.student_id, session.id, slug],
    );
    if (!previous.rowCount) continue;
    const priorWeight = Number(previous.rows[0].max_weight || 0);
    const currentWeight = Math.max(...current.map((row) => Number(row.actual_weight)));
    const currentReps = Math.min(...current.map((row) => row.actual_reps));
    if (currentWeight < priorWeight || (currentWeight === priorWeight && currentReps < Number(previous.rows[0].max_reps || 0))) continue;
    const targetWeight = Math.max(currentWeight + 1.25, Math.round(currentWeight * 1.025 * 4) / 4);
    await client.query(
      `INSERT INTO gym_progression_suggestions (session_id,student_id,coach_id,exercise_slug,exercise_name_zh,suggestion)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [session.id, session.student_id, actorId, slug, current[0].exercise_name_zh,
        JSON.stringify({ type: 'load', previousWeight: priorWeight, completedWeight: currentWeight, targetWeight, reason: '所有完成组达到次数上限且 RIR≥3，表现未低于最近一次记录；由教练审核后应用。' })],
    );
  }
}

function mountWorkoutMeasurementRoutes(app, { pool, auth }) {
  const student = [auth, requireRole('student')];
  const coach = [auth, requireRole('coach')];
  const members = [auth, requireRole('student', 'coach', 'admin')];

  app.get('/api/gym/measurements', ...members, async (req, res) => {
    try { res.json({ measurements: await listMeasurements(pool, req.user.user_id) }); }
    catch (error) { console.error('GET /api/gym/measurements', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.get('/api/coach/students/:studentId/measurements', ...coach, async (req, res) => {
    const studentId = positiveId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'invalid_student' });
    try {
      if (!await coachOwnsStudent(pool, req.user.user_id, studentId)) return res.status(404).json({ error: 'student_not_found' });
      res.json({ measurements: await listMeasurements(pool, studentId) });
    } catch (error) { console.error('GET coach measurements', error.message); res.status(500).json({ error: 'db' }); }
  });

  async function createForStudent(req, res, studentId, initial) {
    try {
      const measurement = await createMeasurement(pool, { studentId, actorId: req.user.user_id, coachId: req.user.roles.includes('coach') ? req.user.user_id : null, body: req.body, initial });
      res.status(201).json({ measurement });
    } catch (error) {
      if (['invalid_measurement', 'empty_measurement', 'initial_requires_weight_and_waist'].includes(error.message)) return res.status(400).json({ error: error.message });
      if (error.message === 'initial_already_exists') return res.status(409).json({ error: error.message });
      if (error.message === 'student_not_found') return res.status(404).json({ error: error.message });
      console.error('POST gym measurements', error.message); res.status(500).json({ error: 'db' });
    }
  }

  app.post('/api/gym/measurements/initial', ...student, (req, res) => createForStudent(req, res, req.user.user_id, true));
  app.post('/api/gym/measurements', ...student, (req, res) => createForStudent(req, res, req.user.user_id, false));
  app.post('/api/coach/students/:studentId/measurements/initial', ...coach, (req, res) => {
    const studentId = positiveId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'invalid_student' });
    return createForStudent(req, res, studentId, true);
  });
  app.post('/api/coach/students/:studentId/measurements', ...coach, (req, res) => {
    const studentId = positiveId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'invalid_student' });
    return createForStudent(req, res, studentId, false);
  });

  app.post('/api/gym/measurements/:id/confirm', ...student, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_measurement' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const changed = await client.query(
        `UPDATE gym_measurements SET status='confirmed',confirmed_by=$2,confirmed_at=now()
         WHERE id=$1 AND student_id=$2 AND entry_type='initial' AND status='pending_student_confirmation' RETURNING *`,
        [id, req.user.user_id],
      );
      if (!changed.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'measurement_not_confirmable' }); }
      await client.query("INSERT INTO gym_measurement_events (measurement_id,actor_id,event_type) VALUES ($1,$2,'confirmed')", [id, req.user.user_id]);
      await client.query('COMMIT');
      res.json({ measurement: mapMeasurement(changed.rows[0]) });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('confirm measurement', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.post('/api/coach/students/:studentId/sessions/start', ...coach, async (req, res) => {
    const studentId = positiveId(req.params.studentId);
    const dayNo = Number(req.body?.dayNo);
    if (!studentId || !Number.isSafeInteger(dayNo) || dayNo < 1) return res.status(400).json({ error: 'invalid_session' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await coachOwnsStudent(client, req.user.user_id, studentId, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      const active = await client.query(
        `SELECT p.id AS plan_id,p.coach_id,p.student_id,v.id AS version_id,v.version_no,v.content
         FROM gym_plans p JOIN gym_plan_versions v ON v.plan_id=p.id AND v.version_no=p.current_version_no AND v.status='published'
         WHERE p.student_id=$1 AND p.coach_id=$2 AND p.status='active' FOR SHARE OF p,v`,
        [studentId, req.user.user_id],
      );
      if (!active.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'active_plan_required' }); }
      const day = active.rows[0].content.days.find((item) => Number(item.dayNo) === dayNo);
      if (!day) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'training_day_not_found' }); }
      const session = await client.query(
        `INSERT INTO gym_sessions (student_id,coach_id,plan_id,plan_version_id,day_no,day_name,snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
        [studentId, req.user.user_id, active.rows[0].plan_id, active.rows[0].version_id, dayNo, day.name, JSON.stringify(day)],
      );
      const exercises = day.exercises || [];
      for (let index = 0; index < exercises.length; index += 1) {
        const exercise = exercises[index];
        for (let setNo = 1; setNo <= Number(exercise.sets); setNo += 1) {
          await client.query(
            `INSERT INTO gym_session_sets (session_id,exercise_index,set_no,exercise_slug,exercise_name_zh,target_weight,target_rep_min,target_rep_max,target_rir)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [session.rows[0].id, index, setNo, exercise.exerciseSlug, exercise.exerciseNameZh, exercise.targetWeight ?? null, exercise.repMin, exercise.repMax, exercise.rir],
          );
        }
      }
      await client.query('COMMIT');
      res.status(201).json({ session: await sessionDetails(pool, session.rows[0].id) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505' && error.constraint === 'gym_sessions_one_open_per_student') return res.status(409).json({ error: 'open_session_exists' });
      console.error('start session', error.message); res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.get('/api/coach/students/:studentId/sessions', ...coach, async (req, res) => {
    const studentId = positiveId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'invalid_student' });
    try {
      if (!await coachOwnsStudent(pool, req.user.user_id, studentId)) return res.status(404).json({ error: 'student_not_found' });
      const result = await pool.query('SELECT id,day_name,status,started_at,ended_at,duration_seconds FROM gym_sessions WHERE student_id=$1 AND coach_id=$2 ORDER BY started_at DESC LIMIT 100', [studentId, req.user.user_id]);
      res.json({ sessions: result.rows });
    } catch (error) { console.error('coach sessions list', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.get('/api/gym/sessions', ...members, async (req, res) => {
    try {
      const result = await pool.query('SELECT id,day_name,status,started_at,ended_at,duration_seconds FROM gym_sessions WHERE student_id=$1 AND coach_id IS NOT NULL ORDER BY started_at DESC LIMIT 100', [req.user.user_id]);
      res.json({ sessions: result.rows });
    } catch (error) { console.error('student sessions list', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.get('/api/gym/sessions/:id', ...members, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_session' });
    try {
      const session = await sessionAccess(pool, id, req.user.user_id, 'student');
      if (!session) return res.status(404).json({ error: 'session_not_found' });
      res.json({ session: await sessionDetails(pool, id) });
    } catch (error) { console.error('student session detail', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.get('/api/coach/sessions/:id', ...coach, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_session' });
    try {
      const session = await sessionAccess(pool, id, req.user.user_id, 'coach');
      if (!session) return res.status(404).json({ error: 'session_not_found' });
      res.json({ session: await sessionDetails(pool, id) });
    } catch (error) { console.error('coach session detail', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.patch('/api/coach/sessions/:id/sets/:exerciseIndex/:setNo', ...coach, async (req, res) => {
    const id = positiveId(req.params.id);
    const exerciseIndex = Number(req.params.exerciseIndex);
    const setNo = Number(req.params.setNo);
    if (!id || !Number.isInteger(exerciseIndex) || exerciseIndex < 0 || !Number.isInteger(setNo) || setNo < 1) return res.status(400).json({ error: 'invalid_set' });
    const status = ['pending', 'completed', 'skipped', 'replaced'].includes(req.body?.status) ? req.body.status : 'completed';
    const actualWeight = req.body?.actualWeight === '' || req.body?.actualWeight == null ? null : Number(req.body.actualWeight);
    const actualReps = req.body?.actualReps === '' || req.body?.actualReps == null ? null : Number(req.body.actualReps);
    const actualRir = req.body?.actualRir === '' || req.body?.actualRir == null ? null : Number(req.body.actualRir);
    const replacementName = String(req.body?.replacementName || '').trim().slice(0, 100) || null;
    if ((actualWeight !== null && (!Number.isFinite(actualWeight) || actualWeight < 0 || actualWeight > 1000)) ||
        (actualReps !== null && (!Number.isInteger(actualReps) || actualReps < 0 || actualReps > 300)) ||
        (actualRir !== null && (!Number.isInteger(actualRir) || actualRir < 0 || actualRir > 10)) ||
        (status === 'completed' && (actualReps === null || actualRir === null)) || (status === 'replaced' && !replacementName)) return res.status(400).json({ error: 'invalid_set_values' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT * FROM gym_sessions WHERE id=$1 AND coach_id=$2 FOR UPDATE', [id, req.user.user_id]);
      if (!selected.rowCount || selected.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_editable' }); }
      if (!await coachOwnsStudent(client, req.user.user_id, selected.rows[0].student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      const prior = await client.query('SELECT * FROM gym_session_sets WHERE session_id=$1 AND exercise_index=$2 AND set_no=$3 FOR UPDATE', [id, exerciseIndex, setNo]);
      if (!prior.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'set_not_found' }); }
      const updated = await client.query(
        `UPDATE gym_session_sets SET actual_weight=$4,actual_reps=$5,actual_rir=$6,status=$7,replacement_name=$8,note=$9,updated_by=$10,updated_at=now()
         WHERE session_id=$1 AND exercise_index=$2 AND set_no=$3 RETURNING *`,
        [id, exerciseIndex, setNo, ['skipped','replaced'].includes(status) ? null : actualWeight, ['skipped','replaced'].includes(status) ? null : actualReps, ['skipped','replaced'].includes(status) ? null : actualRir, status, replacementName, String(req.body?.note || '').trim().slice(0, 300), req.user.user_id],
      );
      const row = updated.rows[0];
      const toAudit = (item) => item && ({ actualWeight: item.actual_weight, actualReps: item.actual_reps, actualRir: item.actual_rir, status: item.status, replacementName: item.replacement_name, note: item.note });
      await client.query(
        `INSERT INTO gym_session_set_audit (session_id,exercise_index,set_no,changed_by,before_value,after_value)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [id, exerciseIndex, setNo, req.user.user_id, JSON.stringify(toAudit(prior.rows[0])), JSON.stringify(toAudit(row))],
      );
      await client.query('UPDATE gym_sessions SET updated_at=now() WHERE id=$1', [id]);
      await client.query('COMMIT');
      res.json({ set: { exerciseIndex: row.exercise_index, setNo: row.set_no, actualWeight: row.actual_weight === null ? null : Number(row.actual_weight), actualReps: row.actual_reps, actualRir: row.actual_rir, status: row.status, replacementName: row.replacement_name, note: row.note } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); console.error('save workout set', error.message); res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.patch('/api/coach/sessions/:id/sets/:exerciseIndex/:setNo/correction', ...coach, async (req, res) => {
    const id = positiveId(req.params.id);
    const exerciseIndex = Number(req.params.exerciseIndex);
    const setNo = Number(req.params.setNo);
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (!id || !Number.isInteger(exerciseIndex) || exerciseIndex < 0 || !Number.isInteger(setNo) || setNo < 1 || reason.length < 3) return res.status(400).json({ error: 'correction_reason_required' });
    const status = ['completed', 'skipped', 'replaced'].includes(req.body?.status) ? req.body.status : 'completed';
    const actualWeight = req.body?.actualWeight === '' || req.body?.actualWeight == null ? null : Number(req.body.actualWeight);
    const actualReps = req.body?.actualReps === '' || req.body?.actualReps == null ? null : Number(req.body.actualReps);
    const actualRir = req.body?.actualRir === '' || req.body?.actualRir == null ? null : Number(req.body.actualRir);
    const replacementName = String(req.body?.replacementName || '').trim().slice(0, 100) || null;
    if ((actualWeight !== null && (!Number.isFinite(actualWeight) || actualWeight < 0 || actualWeight > 1000)) ||
        (actualReps !== null && (!Number.isInteger(actualReps) || actualReps < 0 || actualReps > 300)) ||
        (actualRir !== null && (!Number.isInteger(actualRir) || actualRir < 0 || actualRir > 10)) ||
        (status === 'completed' && (actualReps === null || actualRir === null)) || (status === 'replaced' && !replacementName)) return res.status(400).json({ error: 'invalid_set_values' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query("SELECT * FROM gym_sessions WHERE id=$1 AND coach_id=$2 AND status='completed' FOR UPDATE", [id, req.user.user_id]);
      if (!selected.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_correctable' }); }
      if (!await coachOwnsStudent(client, req.user.user_id, selected.rows[0].student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      const prior = await client.query('SELECT * FROM gym_session_sets WHERE session_id=$1 AND exercise_index=$2 AND set_no=$3 FOR UPDATE', [id, exerciseIndex, setNo]);
      if (!prior.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'set_not_found' }); }
      const updated = await client.query(
        `UPDATE gym_session_sets SET actual_weight=$4,actual_reps=$5,actual_rir=$6,status=$7,replacement_name=$8,note=$9,updated_by=$10,updated_at=now()
         WHERE session_id=$1 AND exercise_index=$2 AND set_no=$3 RETURNING *`,
        [id, exerciseIndex, setNo, ['skipped','replaced'].includes(status)?null:actualWeight, ['skipped','replaced'].includes(status)?null:actualReps,
          ['skipped','replaced'].includes(status)?null:actualRir, status, replacementName, String(req.body?.note||'').trim().slice(0,300), req.user.user_id],
      );
      const auditValue = (row) => ({ actualWeight: row.actual_weight, actualReps: row.actual_reps, actualRir: row.actual_rir, status: row.status, replacementName: row.replacement_name, note: row.note });
      await client.query(
        `INSERT INTO gym_session_set_audit (session_id,exercise_index,set_no,changed_by,before_value,after_value)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [id, exerciseIndex, setNo, req.user.user_id, JSON.stringify(auditValue(prior.rows[0])), JSON.stringify({ ...auditValue(updated.rows[0]), correctionReason: reason })],
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('correct completed set', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.post('/api/coach/sessions/:id/complete', ...coach, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_session' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT * FROM gym_sessions WHERE id=$1 AND coach_id=$2 FOR UPDATE', [id, req.user.user_id]);
      if (!selected.rowCount || selected.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_editable' }); }
      const session = selected.rows[0];
      if (!await coachOwnsStudent(client, req.user.user_id, session.student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      const allSets = await client.query('SELECT * FROM gym_session_sets WHERE session_id=$1 ORDER BY exercise_index,set_no', [id]);
      if (!allSets.rowCount || allSets.rows.some((row) => row.status === 'pending') || !allSets.rows.some((row) => row.status === 'completed')) {
        await client.query('ROLLBACK'); return res.status(409).json({ error: 'finish_or_skip_each_set' });
      }
      const result = await client.query(
        `UPDATE gym_sessions SET status='completed',ended_at=now(),duration_seconds=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (now()-started_at)))::int),notes=$2,updated_at=now()
         WHERE id=$1 RETURNING *`,
        [id, String(req.body?.notes || '').trim().slice(0, 1000)],
      );
      await createProgressionSuggestions(client, session, allSets.rows, req.user.user_id);
      await client.query('COMMIT');
      res.json({ session: await sessionDetails(pool, id) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); console.error('complete workout session', error.message); res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.post('/api/coach/sessions/:id/abandon', ...coach, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_session' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT * FROM gym_sessions WHERE id=$1 AND coach_id=$2 FOR UPDATE', [id, req.user.user_id]);
      if (!selected.rowCount || selected.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'session_not_editable' }); }
      if (!await coachOwnsStudent(client, req.user.user_id, selected.rows[0].student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      await client.query("UPDATE gym_sessions SET status='abandoned',ended_at=now(),updated_at=now() WHERE id=$1", [id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('abandon session', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.get('/api/coach/progression-suggestions', ...coach, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT s.*,u.username AS student_username FROM gym_progression_suggestions s JOIN users u ON u.id=s.student_id
         JOIN coach_student_relationships r ON r.student_id=s.student_id AND r.coach_id=s.coach_id AND r.status='active'
         WHERE s.coach_id=$1 AND s.status='pending' ORDER BY s.created_at DESC LIMIT 100`,
        [req.user.user_id],
      );
      res.json({ suggestions: result.rows.map((row) => ({ id: row.id, studentId: row.student_id, studentName: row.student_username, exerciseSlug: row.exercise_slug, exerciseNameZh: row.exercise_name_zh, suggestion: row.suggestion, createdAt: row.created_at })) });
    } catch (error) { console.error('progression queue', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.post('/api/coach/progression-suggestions/:id/decision', ...coach, async (req, res) => {
    const id = positiveId(req.params.id);
    const decision = req.body?.decision;
    if (!id || !['accept', 'dismiss'].includes(decision)) return res.status(400).json({ error: 'invalid_decision' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT * FROM gym_progression_suggestions WHERE id=$1 AND coach_id=$2 FOR UPDATE', [id, req.user.user_id]);
      if (!selected.rowCount || selected.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'suggestion_not_found' }); }
      const suggestion = selected.rows[0];
      if (!await coachOwnsStudent(client, req.user.user_id, suggestion.student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      if (decision === 'accept') {
        const plan = await client.query(
          `SELECT p.*,v.id AS version_id,v.version_no,v.content FROM gym_plans p JOIN gym_plan_versions v
             ON v.plan_id=p.id AND v.version_no=p.current_version_no AND v.status='published'
           WHERE p.student_id=$1 AND p.coach_id=$2 AND p.status='active' FOR UPDATE OF p,v`,
          [suggestion.student_id, req.user.user_id],
        );
        if (!plan.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'active_plan_required' }); }
        const draft = await client.query("SELECT 1 FROM gym_plan_versions WHERE plan_id=$1 AND status='draft'", [plan.rows[0].id]);
        if (draft.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'finish_plan_draft_first' }); }
        const newContent = JSON.parse(JSON.stringify(plan.rows[0].content));
        let changed = 0;
        for (const day of newContent.days || []) for (const exercise of day.exercises || []) {
          if (exercise.exerciseSlug === suggestion.exercise_slug) { exercise.targetWeight = suggestion.suggestion.targetWeight; changed += 1; }
        }
        if (!changed) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'exercise_not_in_active_plan' }); }
        const nextVersion = Number(plan.rows[0].version_no) + 1;
        await client.query(
          `INSERT INTO gym_plan_versions (plan_id,version_no,status,content,created_by,published_at)
           VALUES ($1,$2,'published',$3::jsonb,$4,now())`,
          [plan.rows[0].id, nextVersion, JSON.stringify(newContent), req.user.user_id],
        );
        await client.query('UPDATE gym_plans SET current_version_no=$2,updated_at=now() WHERE id=$1', [plan.rows[0].id, nextVersion]);
      }
      await client.query(
        `UPDATE gym_progression_suggestions SET status=$2,decided_by=$3,decided_at=now() WHERE id=$1`,
        [id, decision === 'accept' ? 'accepted' : 'dismissed', req.user.user_id],
      );
      await client.query('COMMIT');
      res.json({ ok: true, decision });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('progression decision', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });
}

module.exports = { mountWorkoutMeasurementRoutes, normalizeMeasurement, mapMeasurement, coachOwnsStudent, sessionDetails };
