function mountWorkoutStateRoutes(app, { pool, auth, requireMembership }) {
  const memberOnly = requireMembership({ pool });

  app.get('/api/state', auth, memberOnly, async (req, res) => {
    try {
      const result = await pool.query('SELECT key, value FROM workout_records WHERE user_id = $1', [req.user.user_id]);
      const state = {};
      result.rows.forEach((row) => { state[row.key] = row.value; });
      res.json(state);
    } catch (err) {
      console.error('GET /api/state', err.message);
      res.status(500).json({ error: 'db' });
    }
  });

  app.post('/api/state', auth, memberOnly, async (req, res) => {
    try {
      const payload = req.body || {};
      const entries = Object.entries(payload).filter(([, value]) => value !== undefined && value !== null);
      for (const [key, value] of entries) {
        await pool.query(
          `INSERT INTO workout_records (key, value, user_id, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = now()`,
          [key, String(value), req.user.user_id],
        );
      }
      res.json({ ok: true, count: entries.length });
    } catch (err) {
      console.error('POST /api/state', err.message);
      res.status(500).json({ error: 'db' });
    }
  });
}

module.exports = { mountWorkoutStateRoutes };
