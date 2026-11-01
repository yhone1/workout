function defaultRequireRole(...roles) {
  return (req, res, next) => {
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (!userRoles.includes('superadmin') && !roles.some((role) => userRoles.includes(role))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  };
}

function resolveCoachLimit({ tierLimit = null, overrideLimit = null } = {}) {
  return overrideLimit !== null ? overrideLimit : tierLimit;
}

function capacitySnapshot({ activeStudents, maxStudents }) {
  const remaining = maxStudents === null ? 0 : Math.max(0, maxStudents - activeStudents);
  return {
    activeStudents,
    maxStudents,
    remaining,
    canAccept: maxStudents !== null && activeStudents < maxStudents,
  };
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validLimit(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2147483647;
}

function validSortOrder(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

function tierPayload(row) {
  return {
    id: Number(row.id),
    name: row.name,
    maxStudents: Number(row.max_students),
    sortOrder: Number(row.sort_order),
  };
}

function coachPayload(row) {
  const tierLimit = row.tier_limit == null ? null : Number(row.tier_limit);
  const overrideLimit = row.override_limit == null ? null : Number(row.override_limit);
  const maxStudents = resolveCoachLimit({ tierLimit, overrideLimit });
  const snapshot = capacitySnapshot({
    activeStudents: Number(row.active_students) || 0,
    maxStudents,
  });
  return {
    id: Number(row.id),
    username: row.username,
    tierId: row.tier_id == null ? null : Number(row.tier_id),
    tierName: row.tier_name || null,
    tierLimit,
    maxStudentsOverride: overrideLimit,
    maxStudents: snapshot.maxStudents,
    activeStudents: snapshot.activeStudents,
    remaining: snapshot.remaining,
  };
}

async function writeEvent(client, { actorId, coachId = null, eventType, beforeState = null, afterState = null }) {
  await client.query(
    `INSERT INTO coach_capacity_events (actor_user_id, coach_id, event_type, before_state, after_state)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [actorId, coachId, eventType, beforeState == null ? null : JSON.stringify(beforeState), afterState == null ? null : JSON.stringify(afterState)],
  );
}

function reportAdminError(res, route, err) {
  if (err.code === '23505') return res.status(409).json({ error: 'duplicate_tier' });
  console.error(route, err.message);
  return res.status(500).json({ error: 'db' });
}

function mountCoachCapacityRoutes(app, { pool, auth, requireRole = defaultRequireRole }) {
  const superadminOnly = [auth, requireRole('superadmin')];

  app.get('/api/admin/coach-capacity', ...superadminOnly, async (req, res) => {
    try {
      const q = String(req.query?.q || '').trim().slice(0, 64);
      const [tiers, coaches, events] = await Promise.all([
        pool.query(`SELECT id, name, max_students, sort_order
                    FROM coach_capacity_tiers ORDER BY sort_order, id`),
        pool.query(
          `SELECT u.id, u.username, s.tier_id, t.name AS tier_name, t.max_students AS tier_limit,
                  s.max_students_override AS override_limit, COUNT(DISTINCT r.id)::int AS active_students
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id AND ur.role IN ('coach', 'admin')
           LEFT JOIN coach_capacity_settings s ON s.coach_id = u.id
           LEFT JOIN coach_capacity_tiers t ON t.id = s.tier_id
           LEFT JOIN coach_student_relationships r ON r.coach_id = u.id AND r.status = 'active'
           WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%')
           GROUP BY u.id, u.username, s.tier_id, t.name, t.max_students, s.max_students_override
           ORDER BY u.username, u.id`,
          [q],
        ),
        pool.query(
          `SELECT e.id, e.actor_user_id, actor.username AS actor_username,
                  e.coach_id, coach.username AS coach_username, e.event_type,
                  e.before_state, e.after_state, e.created_at
           FROM coach_capacity_events e
           LEFT JOIN users actor ON actor.id = e.actor_user_id
           LEFT JOIN users coach ON coach.id = e.coach_id
           ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
        ),
      ]);
      res.json({
        tiers: tiers.rows.map(tierPayload),
        coaches: coaches.rows.map(coachPayload),
        events: events.rows.map((event) => ({
          id: Number(event.id),
          actorId: event.actor_user_id == null ? null : Number(event.actor_user_id),
          actorUsername: event.actor_username || null,
          coachId: event.coach_id == null ? null : Number(event.coach_id),
          coachUsername: event.coach_username || null,
          eventType: event.event_type,
          beforeState: event.before_state,
          afterState: event.after_state,
          createdAt: event.created_at,
        })),
      });
    } catch (err) {
      return reportAdminError(res, 'GET /api/admin/coach-capacity', err);
    }
  });

  app.post('/api/admin/coach-capacity/tiers', ...superadminOnly, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const maxStudents = req.body?.maxStudents;
    const sortOrder = req.body?.sortOrder ?? 0;
    if (!name || name.length > 80 || !validLimit(maxStudents) || !validSortOrder(sortOrder)) {
      return res.status(400).json({ error: 'invalid_tier' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO coach_capacity_tiers (name, max_students, sort_order)
         VALUES ($1, $2, $3) RETURNING id, name, max_students, sort_order`,
        [name, maxStudents, sortOrder],
      );
      const tier = tierPayload(result.rows[0]);
      await writeEvent(client, {
        actorId: req.user.user_id,
        eventType: 'tier_created',
        afterState: tier,
      });
      await client.query('COMMIT');
      return res.status(201).json({ tier });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return reportAdminError(res, 'POST /api/admin/coach-capacity/tiers', err);
    } finally {
      client.release();
    }
  });

  app.patch('/api/admin/coach-capacity/tiers/:tierId', ...superadminOnly, async (req, res) => {
    const tierId = validId(req.params.tierId);
    const name = String(req.body?.name || '').trim();
    const maxStudents = req.body?.maxStudents;
    const sortOrder = req.body?.sortOrder ?? 0;
    if (!tierId) return res.status(400).json({ error: 'invalid_tier' });
    if (!name || name.length > 80 || !validLimit(maxStudents) || !validSortOrder(sortOrder)) {
      return res.status(400).json({ error: 'invalid_tier' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT u.id FROM users u
         JOIN coach_capacity_settings s ON s.coach_id = u.id
         WHERE s.tier_id = $1 ORDER BY u.id FOR UPDATE OF u`,
        [tierId],
      );
      const current = await client.query(
        `SELECT id, name, max_students, sort_order FROM coach_capacity_tiers WHERE id = $1 FOR UPDATE`,
        [tierId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'tier_not_found' });
      }
      // Re-read assignments after taking the tier lock. A coach concurrently
      // assigned to this tier may have committed while we waited for the lock.
      await client.query(
        `SELECT u.id FROM users u
         JOIN coach_capacity_settings s ON s.coach_id = u.id
         WHERE s.tier_id = $1 ORDER BY u.id FOR UPDATE OF u`,
        [tierId],
      );
      const updated = await client.query(
        `UPDATE coach_capacity_tiers SET name = $2, max_students = $3, sort_order = $4, updated_at = now()
         WHERE id = $1 RETURNING id, name, max_students, sort_order`,
        [tierId, name, maxStudents, sortOrder],
      );
      const beforeState = tierPayload(current.rows[0]);
      const afterState = tierPayload(updated.rows[0]);
      await writeEvent(client, {
        actorId: req.user.user_id,
        eventType: 'tier_updated',
        beforeState,
        afterState,
      });
      await client.query('COMMIT');
      return res.json({ tier: afterState });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return reportAdminError(res, 'PATCH /api/admin/coach-capacity/tiers/:tierId', err);
    } finally {
      client.release();
    }
  });

  app.delete('/api/admin/coach-capacity/tiers/:tierId', ...superadminOnly, async (req, res) => {
    const tierId = validId(req.params.tierId);
    if (!tierId) return res.status(400).json({ error: 'invalid_tier' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, name, max_students, sort_order FROM coach_capacity_tiers WHERE id = $1 FOR UPDATE`,
        [tierId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'tier_not_found' });
      }
      const assigned = await client.query(
        `SELECT coach_id FROM coach_capacity_settings WHERE tier_id = $1 ORDER BY coach_id FOR UPDATE`,
        [tierId],
      );
      if (assigned.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'tier_in_use' });
      }
      await client.query('DELETE FROM coach_capacity_tiers WHERE id = $1', [tierId]);
      await writeEvent(client, {
        actorId: req.user.user_id,
        eventType: 'tier_deleted',
        beforeState: tierPayload(current.rows[0]),
      });
      await client.query('COMMIT');
      return res.json({ ok: true, tierId });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return reportAdminError(res, 'DELETE /api/admin/coach-capacity/tiers/:tierId', err);
    } finally {
      client.release();
    }
  });

  app.put('/api/admin/coach-capacity/coaches/:coachId', ...superadminOnly, async (req, res) => {
    const coachId = validId(req.params.coachId);
    const { tierId: tierValue, maxStudentsOverride } = req.body || {};
    const tierId = tierValue == null ? null : validId(tierValue);
    if (!coachId) return res.status(400).json({ error: 'invalid_coach' });
    if ((tierValue != null && !tierId)
        || (maxStudentsOverride != null && !validLimit(maxStudentsOverride))) {
      return res.status(400).json({ error: 'invalid_capacity' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [coachId]);
      if (!user.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'coach_not_found' });
      }
      const roles = await client.query(
        `SELECT role FROM user_roles WHERE user_id = $1 AND role IN ('coach', 'admin') ORDER BY role`,
        [coachId],
      );
      if (!roles.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'coach_qualification_required' });
      }
      if (tierId !== null) {
        const tier = await client.query('SELECT id FROM coach_capacity_tiers WHERE id = $1 FOR SHARE', [tierId]);
        if (!tier.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'tier_not_found' });
        }
      }
      const current = await client.query(
        `SELECT s.coach_id, s.tier_id, t.name AS tier_name, t.max_students AS tier_limit,
                s.max_students_override AS override_limit
         FROM coach_capacity_settings s LEFT JOIN coach_capacity_tiers t ON t.id = s.tier_id
         WHERE s.coach_id = $1 FOR UPDATE OF s`,
        [coachId],
      );
      const before = current.rows[0] ? {
        coachId,
        tierId: current.rows[0].tier_id == null ? null : Number(current.rows[0].tier_id),
        tierName: current.rows[0].tier_name || null,
        tierLimit: current.rows[0].tier_limit == null ? null : Number(current.rows[0].tier_limit),
        maxStudentsOverride: current.rows[0].override_limit == null ? null : Number(current.rows[0].override_limit),
      } : null;
      const saved = await client.query(
        `INSERT INTO coach_capacity_settings (coach_id, tier_id, max_students_override, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (coach_id) DO UPDATE SET tier_id = EXCLUDED.tier_id,
           max_students_override = EXCLUDED.max_students_override, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING coach_id, tier_id, max_students_override`,
        [coachId, tierId, maxStudentsOverride ?? null, req.user.user_id],
      );
      const after = {
        coachId,
        tierId: saved.rows[0].tier_id == null ? null : Number(saved.rows[0].tier_id),
        maxStudentsOverride: saved.rows[0].max_students_override == null ? null : Number(saved.rows[0].max_students_override),
      };
      await writeEvent(client, {
        actorId: req.user.user_id,
        coachId,
        eventType: 'coach_capacity_updated',
        beforeState: before,
        afterState: after,
      });
      await client.query('COMMIT');
      return res.json({ coach: after });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return reportAdminError(res, 'PUT /api/admin/coach-capacity/coaches/:coachId', err);
    } finally {
      client.release();
    }
  });
}

module.exports = { capacitySnapshot, mountCoachCapacityRoutes, resolveCoachLimit };
