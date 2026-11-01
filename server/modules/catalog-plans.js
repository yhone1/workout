const path = require('path');
const fs = require('fs');
const { requireRole } = require('./identity-coaching');

const VALID_SPLITS = new Set(['ppl', 'upper_lower', 'five_day', 'custom']);
const VALID_TAGS = new Set([
  'ppl_push', 'ppl_pull', 'ppl_legs', 'upper_lower_upper', 'upper_lower_lower',
  'five_chest', 'five_back', 'five_legs', 'five_shoulders', 'five_arms',
]);
const VALID_EXERCISE_FILTERS = new Set([...VALID_TAGS, 'all']);

function cleanText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function validSlug(value) {
  return /^[a-z0-9][a-z0-9/_-]{2,180}$/.test(String(value || '')) && !String(value).includes('..');
}

function validMediaPath(value, staticRoot) {
  if (!value) return null;
  if (typeof value !== 'string' || !value.startsWith('/gym/media/exercises/')) throw new Error('invalid_media_path');
  const relative = value.replace(/^\/+/, '');
  const target = path.resolve(staticRoot, relative);
  const base = path.resolve(staticRoot, 'gym', 'media', 'exercises') + path.sep;
  if (!target.startsWith(base) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('invalid_media_path');
  return value;
}

function normalizeExercise(body, staticRoot) {
  const slug = cleanText(body.slug, 180);
  const nameZh = cleanText(body.nameZh, 100);
  const primaryMuscle = cleanText(body.primaryMuscle, 48);
  const equipment = cleanText(body.equipment, 48);
  if (!validSlug(slug) || !nameZh || !primaryMuscle || !equipment) throw new Error('invalid_exercise');
  const mediaPath = validMediaPath(body.mediaPath || null, staticRoot);
  if (body.isActive !== false && !mediaPath) throw new Error('invalid_media_path');
  const splitTags = Array.isArray(body.splitTags) ? [...new Set(body.splitTags.filter((tag) => VALID_TAGS.has(tag)))].slice(0, 10) : [];
  const secondaryMuscles = Array.isArray(body.secondaryMuscles) ? [...new Set(body.secondaryMuscles.map((v) => cleanText(v, 48)).filter(Boolean))].slice(0, 8) : [];
  return {
    slug,
    nameZh,
    nameEn: cleanText(body.nameEn, 120) || null,
    primaryMuscle,
    primaryMuscleZh: cleanText(body.primaryMuscleZh, 48) || primaryMuscle,
    secondaryMuscles,
    secondaryMusclesZh: Array.isArray(body.secondaryMusclesZh) ? body.secondaryMusclesZh.map((v) => cleanText(v, 48)).filter(Boolean).slice(0, 8) : [],
    equipment,
    equipmentZh: cleanText(body.equipmentZh, 48) || equipment,
    bodyPart: cleanText(body.bodyPart, 32) || 'strength',
    category: cleanText(body.category, 32) || 'strength',
    splitTags,
    cueZh: cleanText(body.cueZh, 500),
    mediaPath,
    isActive: body.isActive !== false,
  };
}

function exerciseResponse(row) {
  return {
    id: row.id,
    slug: row.slug,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    primaryMuscle: row.primary_muscle,
    primaryMuscleZh: row.primary_muscle_zh,
    secondaryMuscles: row.secondary_muscles,
    secondaryMusclesZh: row.secondary_muscles_zh,
    equipment: row.equipment,
    equipmentZh: row.equipment_zh,
    bodyPart: row.body_part,
    category: row.category,
    splitTags: row.split_tags,
    cueZh: row.cue_zh,
    mediaPath: row.media_path,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

async function coachOwnsStudent(pool, coachId, studentId, lock = false) {
  const relation = await pool.query(
    `SELECT 1 FROM coach_student_relationships
     WHERE coach_id = $1 AND student_id = $2 AND status = 'active' LIMIT 1 ${lock ? 'FOR SHARE' : ''}`,
    [coachId, studentId],
  );
  return relation.rowCount > 0;
}

function splitDayCount(splitType) {
  return { ppl: 3, upper_lower: 4, five_day: 5 }[splitType];
}

async function normalizePlanContent(pool, input, splitType, requireExercises = false) {
  const validDayCount = splitType === 'custom'
    ? Array.isArray(input?.days) && input.days.length >= 1 && input.days.length <= 7
    : Array.isArray(input?.days) && input.days.length === splitDayCount(splitType);
  if (!VALID_SPLITS.has(splitType) || !input || !validDayCount) {
    throw new Error('invalid_plan');
  }
  let total = 0;
  const days = [];
  for (let dayIndex = 0; dayIndex < input.days.length; dayIndex += 1) {
    const day = input.days[dayIndex];
    if (!day || !Array.isArray(day.exercises) || day.exercises.length > 20) throw new Error('invalid_plan');
    if (requireExercises && day.exercises.length === 0) throw new Error('empty_training_day');
    total += day.exercises.length;
    const slugs = [...new Set(day.exercises.map((item) => String(item.exerciseSlug || '')))].filter(Boolean);
    if (slugs.length !== day.exercises.length) throw new Error('duplicate_exercise_in_day');
    const exerciseRows = slugs.length ? await pool.query(
      `SELECT id, slug, name_zh, primary_muscle_zh, secondary_muscles_zh, equipment, equipment_zh, media_path, cue_zh
       FROM gym_exercises WHERE slug = ANY($1::text[]) AND is_active = TRUE`,
      [slugs],
    ) : { rows: [] };
    const bySlug = new Map(exerciseRows.rows.map((row) => [row.slug, row]));
    if (bySlug.size !== slugs.length) throw new Error('exercise_not_available');
    const exercises = day.exercises.map((item) => {
      const exercise = bySlug.get(String(item.exerciseSlug));
      const sets = Number(item.sets);
      const repMin = Number(item.repMin);
      const repMax = Number(item.repMax);
      const rir = Number(item.rir);
      const restSeconds = Number(item.restSeconds);
      const targetWeight = item.targetWeight === '' || item.targetWeight == null ? null : Number(item.targetWeight);
      if (!Number.isInteger(sets) || sets < 1 || sets > 10 || !Number.isInteger(repMin) || repMin < 1 || repMin > 100 ||
          !Number.isInteger(repMax) || repMax < repMin || repMax > 100 || !Number.isInteger(rir) || rir < 0 || rir > 5 ||
          !Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 600 ||
          (targetWeight !== null && (!Number.isFinite(targetWeight) || targetWeight < 0 || targetWeight > 1000))) {
        throw new Error('invalid_plan_target');
      }
      return {
        exerciseId: exercise.id,
        exerciseSlug: exercise.slug,
        exerciseNameZh: exercise.name_zh,
        primaryMuscleZh: exercise.primary_muscle_zh,
        secondaryMusclesZh: exercise.secondary_muscles_zh || [],
        equipment: exercise.equipment,
        equipmentZh: exercise.equipment_zh || exercise.equipment,
        mediaPath: exercise.media_path,
        cueZh: exercise.cue_zh,
        sets,
        repMin,
        repMax,
        rir,
        restSeconds,
        targetWeight,
        note: cleanText(item.note, 300),
      };
    });
    days.push({
      dayNo: dayIndex + 1,
      name: cleanText(day.name, 50) || `训练日 ${dayIndex + 1}`,
      focus: cleanText(day.focus, 120),
      exerciseFilterTag: VALID_EXERCISE_FILTERS.has(day.exerciseFilterTag) ? day.exerciseFilterTag : null,
      exercises,
    });
  }
  if (total > 60) throw new Error('too_many_exercises');
  return { splitType, days };
}

function toPlanResponse(plan, version) {
  return {
    id: plan.id,
    coachId: plan.coach_id,
    studentId: plan.student_id,
    templateCode: plan.template_code,
    splitType: plan.split_type,
    name: plan.name,
    status: plan.status,
    currentVersionNo: plan.current_version_no,
    version: version ? { versionNo: version.version_no, status: version.status, content: version.content, updatedAt: version.updated_at } : null,
  };
}

function mountCatalogPlanRoutes(app, { pool, auth, staticRoot }) {
  const members = [auth, requireRole('student', 'coach', 'admin')];
  const admins = [auth, requireRole('admin')];
  const coaches = [auth, requireRole('coach')];

  app.get('/api/gym/exercises', ...members, async (req, res) => {
    try {
      const q = cleanText(req.query.q, 80);
      const muscle = cleanText(req.query.muscle, 48);
      const equipment = cleanText(req.query.equipment, 48);
      const splitTag = cleanText(req.query.split, 40);
      const activeOnly = !req.user.roles.includes('admin') || req.query.includeInactive !== 'true';
      const result = await pool.query(
        `SELECT * FROM gym_exercises
         WHERE ($1::boolean = FALSE OR is_active = TRUE)
           AND ($2 = '' OR name_zh ILIKE '%' || $2 || '%' OR name_en ILIKE '%' || $2 || '%' OR primary_muscle_zh ILIKE '%' || $2 || '%')
           AND ($3 = '' OR primary_muscle = $3)
           AND ($4 = '' OR equipment = $4)
           AND ($5 = '' OR split_tags @> $5::jsonb)
         ORDER BY primary_muscle, name_zh LIMIT 200`,
        [activeOnly, q, muscle, equipment, splitTag ? JSON.stringify([splitTag]) : '[]'],
      );
      res.json({ exercises: result.rows.map(exerciseResponse) });
    } catch (err) {
      console.error('GET /api/gym/exercises', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.post('/api/admin/exercises', ...admins, async (req, res) => {
    try {
      const item = normalizeExercise(req.body || {}, staticRoot);
      const result = await pool.query(
        `INSERT INTO gym_exercises (
          slug, name_zh, name_en, primary_muscle, primary_muscle_zh, secondary_muscles,
          secondary_muscles_zh, equipment, equipment_zh, body_part, category, split_tags,
          cue_zh, media_path, is_active, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,now())
        RETURNING *`,
        [item.slug, item.nameZh, item.nameEn, item.primaryMuscle, item.primaryMuscleZh, JSON.stringify(item.secondaryMuscles), JSON.stringify(item.secondaryMusclesZh), item.equipment, item.equipmentZh, item.bodyPart, item.category, JSON.stringify(item.splitTags), item.cueZh, item.mediaPath, item.isActive],
      );
      res.status(201).json({ exercise: exerciseResponse(result.rows[0]) });
    } catch (err) {
      const invalid = ['invalid_exercise', 'invalid_media_path'].includes(err.message);
      if (err.code === '23505') return res.status(409).json({ error: 'exercise_exists' });
      if (invalid) return res.status(400).json({ error: err.message });
      console.error('POST /api/admin/exercises', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.put('/api/admin/exercises/:id', ...admins, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_exercise' });
    try {
      const item = normalizeExercise(req.body || {}, staticRoot);
      const result = await pool.query(
        `UPDATE gym_exercises SET slug=$2, name_zh=$3, name_en=$4, primary_muscle=$5, primary_muscle_zh=$6,
          secondary_muscles=$7::jsonb, secondary_muscles_zh=$8::jsonb, equipment=$9, equipment_zh=$10,
          body_part=$11, category=$12, split_tags=$13::jsonb, cue_zh=$14, media_path=$15,
          is_active=$16, updated_at=now() WHERE id=$1 RETURNING *`,
        [id, item.slug, item.nameZh, item.nameEn, item.primaryMuscle, item.primaryMuscleZh, JSON.stringify(item.secondaryMuscles), JSON.stringify(item.secondaryMusclesZh), item.equipment, item.equipmentZh, item.bodyPart, item.category, JSON.stringify(item.splitTags), item.cueZh, item.mediaPath, item.isActive],
      );
      if (!result.rowCount) return res.status(404).json({ error: 'exercise_not_found' });
      res.json({ exercise: exerciseResponse(result.rows[0]) });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'exercise_exists' });
      if (['invalid_exercise', 'invalid_media_path'].includes(err.message)) return res.status(400).json({ error: err.message });
      console.error('PUT /api/admin/exercises/:id', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.delete('/api/admin/exercises/:id', ...admins, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_exercise' });
    try {
      const result = await pool.query('UPDATE gym_exercises SET is_active=FALSE, updated_at=now() WHERE id=$1 RETURNING id', [id]);
      if (!result.rowCount) return res.status(404).json({ error: 'exercise_not_found' });
      res.json({ ok: true, id });
    } catch (err) {
      console.error('DELETE /api/admin/exercises/:id', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.get('/api/gym/templates', ...members, async (_req, res) => {
    try {
      const result = await pool.query('SELECT code, split_type, name, description, content FROM gym_templates WHERE is_active=TRUE ORDER BY code');
      res.json({ templates: result.rows.map((row) => ({ code: row.code, splitType: row.split_type, name: row.name, description: row.description, content: row.content })) });
    } catch (err) {
      console.error('GET /api/gym/templates', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.get('/api/gym/plan', ...members, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT p.*, v.version_no, v.status AS version_status, v.content, v.updated_at AS version_updated_at
         FROM gym_plans p LEFT JOIN gym_plan_versions v
           ON v.plan_id=p.id AND v.version_no=p.current_version_no AND v.status='published'
         WHERE p.student_id=$1 AND p.status='active' ORDER BY p.updated_at DESC LIMIT 1`,
        [req.user.user_id],
      );
      if (!result.rowCount) return res.json({ plan: null });
      const row = result.rows[0];
      res.json({ plan: toPlanResponse(row, row.version_no ? { version_no: row.version_no, status: row.version_status, content: row.content, updated_at: row.version_updated_at } : null) });
    } catch (err) {
      console.error('GET /api/gym/plan', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.get('/api/coach/students/:studentId/plan', ...coaches, async (req, res) => {
    const studentId = Number(req.params.studentId);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'invalid_student' });
    try {
      if (!await coachOwnsStudent(pool, req.user.user_id, studentId)) return res.status(404).json({ error: 'student_not_found' });
      const result = await pool.query(
        `SELECT p.*, v.version_no, v.status AS version_status, v.content, v.updated_at AS version_updated_at
         FROM gym_plans p LEFT JOIN gym_plan_versions v ON v.plan_id=p.id AND (
           (p.status='active' AND v.version_no=p.current_version_no AND v.status='published') OR
           (p.status='draft' AND v.status='draft')
         )
         WHERE p.student_id=$1 AND p.coach_id=$2 AND p.status IN ('active','draft')
         ORDER BY (p.status='active') DESC, p.updated_at DESC LIMIT 1`,
        [studentId, req.user.user_id],
      );
      if (!result.rowCount) return res.json({ plan: null });
      const row = result.rows[0];
      res.json({ plan: toPlanResponse(row, row.version_no ? { version_no: row.version_no, status: row.version_status, content: row.content, updated_at: row.version_updated_at } : null) });
    } catch (err) {
      console.error('GET /api/coach/students/:studentId/plan', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.get('/api/coach/students/:studentId/plans', ...coaches, async (req, res) => {
    const studentId = Number(req.params.studentId);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'invalid_student' });
    try {
      if (!await coachOwnsStudent(pool, req.user.user_id, studentId)) return res.status(404).json({ error: 'student_not_found' });
      const result = await pool.query(
        `SELECT p.*,v.version_no,v.status AS version_status,v.content,v.updated_at AS version_updated_at
         FROM gym_plans p LEFT JOIN LATERAL (
           SELECT * FROM gym_plan_versions WHERE plan_id=p.id ORDER BY (status='draft') DESC,version_no DESC LIMIT 1
         ) v ON TRUE
         WHERE p.student_id=$1 AND p.coach_id=$2 AND p.status IN ('active','draft','archived')
         ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,p.updated_at DESC`,
        [studentId, req.user.user_id],
      );
      res.json({ plans: result.rows.map((row) => toPlanResponse(row, row.version_no ? { version_no: row.version_no, status: row.version_status, content: row.content, updated_at: row.version_updated_at } : null)) });
    } catch (err) { console.error('GET coach plans', err.message); res.status(500).json({ error: 'db' }); }
  });

  app.post('/api/coach/students/:studentId/plans', ...coaches, async (req, res) => {
    const studentId = Number(req.params.studentId);
    const isCustomPlan = req.body?.splitType === 'custom';
    const templateCode = isCustomPlan ? '' : cleanText(req.body?.templateCode, 40);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'invalid_student' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!await coachOwnsStudent(client, req.user.user_id, studentId, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      let content;
      let splitType;
      let planTemplateCode = templateCode;
      let defaultName;
      if (isCustomPlan) {
        splitType = 'custom';
        planTemplateCode = null;
        defaultName = '自定义计划';
        content = await normalizePlanContent(client, req.body?.content, splitType);
      } else {
        const template = await client.query('SELECT * FROM gym_templates WHERE code=$1 AND is_active=TRUE', [templateCode]);
        if (!template.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'template_not_found' }); }
        splitType = template.rows[0].split_type;
        defaultName = template.rows[0].name;
        content = await normalizePlanContent(client, template.rows[0].content, splitType);
      }
      const name = cleanText(req.body?.name, 100) || defaultName;
      const plan = await client.query(
        `INSERT INTO gym_plans (coach_id,student_id,template_code,split_type,name,status)
         VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`,
        [req.user.user_id, studentId, planTemplateCode, splitType, name],
      );
      const version = await client.query(
        `INSERT INTO gym_plan_versions (plan_id,version_no,status,content,created_by)
         VALUES ($1,1,'draft',$2::jsonb,$3) RETURNING *`,
        [plan.rows[0].id, JSON.stringify(content), req.user.user_id],
      );
      await client.query('COMMIT');
      res.status(201).json({ plan: toPlanResponse(plan.rows[0], version.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') return res.status(409).json({ error: 'draft_plan_exists' });
      if (err.message.startsWith('invalid_') || err.message === 'exercise_not_available') return res.status(400).json({ error: err.message });
      console.error('POST /api/coach/students/:studentId/plans', err.message);
      res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.put('/api/coach/plans/:planId/draft', ...coaches, async (req, res) => {
    const planId = Number(req.params.planId);
    if (!Number.isSafeInteger(planId) || planId <= 0) return res.status(400).json({ error: 'invalid_plan' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT * FROM gym_plans WHERE id=$1 AND coach_id=$2 FOR UPDATE', [planId, req.user.user_id]);
      if (!selected.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'plan_not_found' }); }
      if (!await coachOwnsStudent(client, req.user.user_id, selected.rows[0].student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      const content = await normalizePlanContent(client, req.body?.content, selected.rows[0].split_type);
      const existing = await client.query("SELECT * FROM gym_plan_versions WHERE plan_id=$1 AND status='draft' FOR UPDATE", [planId]);
      let version;
      if (existing.rowCount) {
        version = await client.query('UPDATE gym_plan_versions SET content=$2::jsonb,created_by=$3,updated_at=now() WHERE id=$1 RETURNING *', [existing.rows[0].id, JSON.stringify(content), req.user.user_id]);
      } else {
        const next = await client.query('SELECT COALESCE(MAX(version_no),0)+1 AS next FROM gym_plan_versions WHERE plan_id=$1', [planId]);
        version = await client.query(
          `INSERT INTO gym_plan_versions (plan_id,version_no,status,content,created_by)
           VALUES ($1,$2,'draft',$3::jsonb,$4) RETURNING *`,
          [planId, next.rows[0].next, JSON.stringify(content), req.user.user_id],
        );
      }
      const planName = cleanText(req.body?.name, 100) || selected.rows[0].name;
      const planRow = await client.query('UPDATE gym_plans SET name=$2,updated_at=now() WHERE id=$1 RETURNING *', [planId, planName]);
      await client.query('COMMIT');
      res.json({ plan: toPlanResponse(planRow.rows[0], version.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.message.startsWith('invalid_') || ['exercise_not_available','duplicate_exercise_in_day','empty_training_day','too_many_exercises'].includes(err.message)) return res.status(400).json({ error: err.message });
      console.error('PUT /api/coach/plans/:planId/draft', err.message);
      res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.post('/api/coach/plans/:planId/publish', ...coaches, async (req, res) => {
    const planId = Number(req.params.planId);
    if (!Number.isSafeInteger(planId) || planId <= 0) return res.status(400).json({ error: 'invalid_plan' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const plan = await client.query('SELECT * FROM gym_plans WHERE id=$1 AND coach_id=$2 FOR UPDATE', [planId, req.user.user_id]);
      if (!plan.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'plan_not_found' }); }
      if (!await coachOwnsStudent(client, req.user.user_id, plan.rows[0].student_id, true)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'student_not_found' }); }
      const draft = await client.query("SELECT * FROM gym_plan_versions WHERE plan_id=$1 AND status='draft' FOR UPDATE", [planId]);
      if (!draft.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'draft_not_found' }); }
      const normalized = await normalizePlanContent(client, draft.rows[0].content, plan.rows[0].split_type, true);
      await client.query("UPDATE gym_plans SET status='archived',updated_at=now() WHERE student_id=$1 AND status='active' AND id<>$2", [plan.rows[0].student_id, planId]);
      const version = await client.query(
        `UPDATE gym_plan_versions SET status='published',published_at=now(),updated_at=now(),content=$2::jsonb
         WHERE id=$1 RETURNING *`,
        [draft.rows[0].id, JSON.stringify(normalized)],
      );
      const publishedPlan = await client.query(
        `UPDATE gym_plans SET status='active',current_version_no=$2,updated_at=now() WHERE id=$1 RETURNING *`,
        [planId, version.rows[0].version_no],
      );
      await client.query('COMMIT');
      res.json({ plan: toPlanResponse(publishedPlan.rows[0], version.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.message.startsWith('invalid_') || ['exercise_not_available','duplicate_exercise_in_day','empty_training_day','too_many_exercises'].includes(err.message)) return res.status(400).json({ error: err.message });
      console.error('POST /api/coach/plans/:planId/publish', err.message);
      res.status(500).json({ error: 'db' });
    } finally { client.release(); }
  });

  app.get('/api/admin/exercises', ...admins, async (_req, res) => {
    try {
      const result = await pool.query('SELECT * FROM gym_exercises ORDER BY primary_muscle,name_zh');
      res.json({ exercises: result.rows.map(exerciseResponse) });
    } catch (err) {
      console.error('GET /api/admin/exercises', err.message);
      res.status(500).json({ error: 'db' });
    }
  });
}

module.exports = { mountCatalogPlanRoutes, normalizePlanContent, normalizeExercise };
