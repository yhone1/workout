const { requireRole: defaultRequireRole } = require('./identity-coaching');
const { hasActiveMembership } = require('./membership-access');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shanghaiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function membershipGrant(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    startsOn: row.starts_on,
    expiresOn: row.expires_on,
    grantedBy: Number(row.granted_by),
    createdAt: row.created_at,
    revokedAt: row.revoked_at || null,
    revokedBy: row.revoked_by == null ? null : Number(row.revoked_by),
    reason: row.reason || '',
  };
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function mountMembershipRoutes(app, { pool, auth, requireRole = defaultRequireRole }) {
  const adminOnly = [auth, requireRole('admin')];

  app.get('/api/admin/users/:userId/membership', ...adminOnly, async (req, res) => {
    const userId = validId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'invalid_user' });
    try {
      const user = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (!user.rowCount) return res.status(404).json({ error: 'user_not_found' });
      const grants = await pool.query(
        `SELECT id, user_id, starts_on::text AS starts_on, expires_on::text AS expires_on,
                granted_by, created_at, revoked_at, revoked_by, reason
         FROM membership_grants WHERE user_id = $1 ORDER BY starts_on DESC, id DESC`,
        [userId],
      );
      const events = await pool.query(
        `SELECT e.grant_id, e.actor_id, e.event_type, e.reason, e.created_at
         FROM membership_events e JOIN membership_grants g ON g.id = e.grant_id
         WHERE g.user_id = $1 ORDER BY e.created_at DESC, e.id DESC`,
        [userId],
      );
      const eventMap = new Map();
      for (const event of events.rows) {
        const list = eventMap.get(Number(event.grant_id)) || [];
        list.push({
          actorId: Number(event.actor_id), eventType: event.event_type,
          reason: event.reason || '', createdAt: event.created_at,
        });
        eventMap.set(Number(event.grant_id), list);
      }
      const history = grants.rows.map((row) => ({
        ...membershipGrant(row),
        events: eventMap.get(Number(row.id)) || [],
      }));
      const active = hasActiveMembership({ grants: grants.rows, today: shanghaiToday() });
      res.json({ current: active ? membershipGrant(active) : null, history });
    } catch (err) {
      console.error('GET /api/admin/users/:userId/membership', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.post('/api/admin/users/:userId/membership', ...adminOnly, async (req, res) => {
    const userId = validId(req.params.userId);
    const { startsOn, expiresOn } = req.body || {};
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!userId) return res.status(400).json({ error: 'invalid_user' });
    if (!isIsoDate(startsOn) || !isIsoDate(expiresOn) || startsOn > expiresOn) {
      return res.status(400).json({ error: 'invalid_membership_dates' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!user.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'user_not_found' });
      }
      const inserted = await client.query(
        `INSERT INTO membership_grants (user_id, starts_on, expires_on, granted_by, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, starts_on::text AS starts_on, expires_on::text AS expires_on,
                   granted_by, created_at, revoked_at, revoked_by, reason`,
        [userId, startsOn, expiresOn, req.user.user_id, reason],
      );
      const grant = inserted.rows[0];
      await client.query(
        `INSERT INTO membership_events (grant_id, actor_id, event_type, reason)
         VALUES ($1, $2, $3, $4)`,
        [grant.id, req.user.user_id, 'granted', reason],
      );
      await client.query('COMMIT');
      res.status(201).json({ grant: membershipGrant(grant) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('POST /api/admin/users/:userId/membership', err.message);
      res.status(500).json({ error: 'db' });
    } finally {
      client.release();
    }
  });

  app.post('/api/admin/memberships/:grantId/revoke', ...adminOnly, async (req, res) => {
    const grantId = validId(req.params.grantId);
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!grantId) return res.status(400).json({ error: 'invalid_membership' });
    if (!reason) return res.status(400).json({ error: 'membership_revoke_reason_required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query('SELECT * FROM membership_grants WHERE id = $1 FOR UPDATE', [grantId]);
      if (!selected.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'membership_not_found' });
      }
      if (selected.rows[0].revoked_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'membership_already_revoked' });
      }
      const updated = await client.query(
        `UPDATE membership_grants SET revoked_at = now(), revoked_by = $2
         WHERE id = $1 RETURNING id, user_id, starts_on::text AS starts_on, expires_on::text AS expires_on,
                            granted_by, created_at, revoked_at, revoked_by, reason`,
        [grantId, req.user.user_id],
      );
      await client.query(
        `INSERT INTO membership_events (grant_id, actor_id, event_type, reason)
         VALUES ($1, $2, $3, $4)`,
        [grantId, req.user.user_id, 'revoked', reason],
      );
      await client.query('COMMIT');
      res.json({ grant: membershipGrant(updated.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('POST /api/admin/memberships/:grantId/revoke', err.message);
      res.status(500).json({ error: 'db' });
    } finally {
      client.release();
    }
  });
}

module.exports = { mountMembershipRoutes };
