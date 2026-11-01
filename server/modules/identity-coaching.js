const { endCoachRelationship } = require('./coach-invitations');

function requireRole(...roles) {
  return (req, res, next) => {
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (!userRoles.includes('superadmin') && !roles.some((role) => userRoles.includes(role))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  };
}

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

function mountIdentityCoachingRoutes(app, { pool, auth, inviteEncryptionKey = null }) {
  const adminOnly = [auth, requireRole('admin')];
  const coachOnly = [auth, requireRole('coach', 'admin')];

  app.get('/api/gym/me', auth, async (req, res) => {
    try {
      const relation = await pool.query(
        `SELECT r.id, r.coach_id, coach.username AS coach_username, r.student_id,
                student.username AS student_username, r.created_at
         FROM coach_student_relationships r
         JOIN users coach ON coach.id = r.coach_id
         JOIN users student ON student.id = r.student_id
         WHERE r.status = 'active' AND (r.coach_id = $1 OR r.student_id = $1)
         LIMIT 1`,
        [req.user.user_id],
      );
      const row = relation.rows[0];
      res.json({
        user: { id: req.user.user_id, username: req.user.username, roles: req.user.roles },
        relationship: row ? {
          id: row.id,
          coach: { id: row.coach_id, username: row.coach_username },
          student: { id: row.student_id, username: row.student_username },
          createdAt: row.created_at,
        } : null,
      });
    } catch (err) {
      console.error('GET /api/gym/me', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.get('/api/admin/users', ...adminOnly, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 64);
      const result = await pool.query(
        `SELECT u.id, u.username, u.created_at,
                COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]) AS roles
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
         WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%')
         GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`,
        [q],
      );
      res.json({ users: result.rows.map((row) => ({ ...publicUser(row), roles: row.roles })) });
    } catch (err) {
      console.error('GET /api/admin/users', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.post('/api/admin/users/:userId/coach', ...adminOnly, async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'invalid_user' });
    try {
      const result = await pool.query(
        `INSERT INTO user_roles (user_id, role, granted_by)
         SELECT id, 'coach', $2 FROM users WHERE id = $1
         ON CONFLICT (user_id, role) DO NOTHING
         RETURNING user_id`,
        [userId, req.user.user_id],
      );
      const exists = result.rowCount || (await pool.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role = \'coach\'', [userId])).rowCount;
      if (!exists) return res.status(404).json({ error: 'user_not_found' });
      res.json({ ok: true, userId, granted: Boolean(result.rowCount) });
    } catch (err) {
      console.error('POST /api/admin/users/:userId/coach', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.delete('/api/admin/users/:userId/coach', ...adminOnly, async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'invalid_user' });
    if (userId === req.user.user_id) return res.status(400).json({ error: 'cannot_revoke_self' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const active = await client.query(
        `SELECT 1 FROM coach_student_relationships WHERE coach_id = $1 AND status = 'active' LIMIT 1`,
        [userId],
      );
      if (active.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'coach_has_active_students' });
      }
      const removed = await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'coach'`, [userId]);
      await client.query('COMMIT');
      if (!removed.rowCount) return res.status(404).json({ error: 'coach_not_found' });
      res.json({ ok: true, userId });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('DELETE /api/admin/users/:userId/coach', err.message);
      res.status(500).json({ error: 'db' });
    } finally {
      client.release();
    }
  });

  app.get('/api/coach/students', ...coachOnly, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT r.id AS relationship_id, r.created_at, u.id, u.username, u.created_at AS account_created_at
         FROM coach_student_relationships r JOIN users u ON u.id = r.student_id
         WHERE r.coach_id = $1 AND r.status = 'active' ORDER BY r.created_at DESC`,
        [req.user.user_id],
      );
      res.json({ students: result.rows.map((row) => ({
        relationshipId: row.relationship_id,
        createdAt: row.created_at,
        ...publicUser({ id: row.id, username: row.username, created_at: row.account_created_at }),
      })) });
    } catch (err) {
      console.error('GET /api/coach/students', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.post('/api/coach/students/:studentId/end', ...coachOnly, async (req, res) => {
    const studentId = Number(req.params.studentId);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'invalid_student' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { coachCapacity } = await endCoachRelationship(client, {
        coachId: req.user.user_id,
        studentId,
        encryptionKey: inviteEncryptionKey,
      });
      await client.query('COMMIT');
      res.json({ ok: true, coachCapacity });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const code = err.code || 'db';
      console.error('POST /api/coach/students/:studentId/end', code);
      const status = code === 'relationship_not_found' ? 404 : code === 'invalid_student' ? 400 : 500;
      res.status(status).json({ error: code });
    } finally { client.release(); }
  });
}

module.exports = { mountIdentityCoachingRoutes, requireRole };
