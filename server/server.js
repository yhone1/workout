/* 薄肌计划本地后端
 * - 静态托管 + 用户登录（用户名/密码，bcrypt 哈希）
 * - /api/state 按登录用户读写训练记录，持久化到 Postgres
 * - 纯本地自用工具：未做找回密码、限流等生产级功能
 */
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STATIC_ROOT = process.env.STATIC_ROOT || (fs.existsSync(path.join(__dirname, '..', 'public')) ? path.join(__dirname, '..', 'public') : path.join(__dirname, '..'));
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 180;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://thin:thin@localhost:5432/thinmuscle',
});

app.use(express.json({ limit: '2mb' }));

async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS workout_records (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`ALTER TABLE workout_records ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE`);

    const seedUser = process.env.SEED_USERNAME || 'yhone';
    const seedPass = process.env.SEED_USER_PASSWORD || 'yh159951';
    let userId = null;
    const existing = await client.query('SELECT id FROM users WHERE username = $1', [seedUser]);
    if (existing.rows.length) {
      userId = existing.rows[0].id;
    } else {
      const hash = await bcrypt.hash(seedPass, 10);
      const ins = await client.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [seedUser, hash]);
      userId = ins.rows[0].id;
    }

    // 把历史记录（无 user_id）归到种子用户，避免丢数据
    await client.query('UPDATE workout_records SET user_id = $1 WHERE user_id IS NULL', [userId]);

    const pk = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'workout_records'::regclass AND contype = 'p'`);
    if (pk.rows.length) await client.query(`ALTER TABLE workout_records DROP CONSTRAINT "${pk.rows[0].conname}"`);
    await client.query('ALTER TABLE workout_records ALTER COLUMN user_id SET NOT NULL');
    await client.query('ALTER TABLE workout_records ADD PRIMARY KEY (user_id, key)');

    await client.query('COMMIT');
    console.log(`初始化完成，种子用户：${seedUser}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const r = await pool.query(
      `SELECT s.user_id, u.username FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (!r.rows.length) return res.status(401).json({ error: 'unauthorized' });
    req.user = r.rows[0];
    next();
  } catch (err) {
    console.error('auth', err.message);
    res.status(500).json({ error: 'db' });
  }
}

/* 登录：成功返回会话 token */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'missing' });
    const r = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'bad_credentials' });
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'bad_credentials' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
    await pool.query('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, r.rows[0].id, expiresAt]);
    res.json({ token, username: r.rows[0].username });
  } catch (err) {
    console.error('login', err.message);
    res.status(500).json({ error: 'db' });
  }
});

/* 注册：创建账号并直接登录 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 6) return res.status(400).json({ error: 'invalid' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, hash])
      .catch((err) => { if (err.code === '23505') return null; throw err; });
    if (!r) return res.status(409).json({ error: 'exists' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
    await pool.query('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, r.rows[0].id, expiresAt]);
    res.json({ token, username: r.rows[0].username });
  } catch (err) {
    console.error('register', err.message);
    res.status(500).json({ error: 'db' });
  }
});

/* 当前用户（token 校验） */
app.get('/api/auth/me', auth, (req, res) => res.json({ username: req.user.username }));

/* 登出：删除会话 */
app.post('/api/auth/logout', auth, async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    await pool.query('DELETE FROM auth_sessions WHERE token = $1', [token]);
    res.json({ ok: true });
  } catch (err) {
    console.error('logout', err.message);
    res.status(500).json({ error: 'db' });
  }
});

/* 读记录（仅当前用户） */
app.get('/api/state', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM workout_records WHERE user_id = $1', [req.user.user_id]);
    const out = {};
    r.rows.forEach((row) => { out[row.key] = row.value; });
    res.json(out);
  } catch (err) {
    console.error('GET /api/state', err.message);
    res.status(500).json({ error: 'db' });
  }
});

/* 写记录（仅当前用户，批量 upsert） */
app.post('/api/state', auth, async (req, res) => {
  try {
    const payload = req.body || {};
    const entries = Object.entries(payload).filter(([, v]) => v !== undefined && v !== null);
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO workout_records (key, value, user_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, String(value), req.user.user_id]
      );
    }
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    console.error('POST /api/state', err.message);
    res.status(500).json({ error: 'db' });
  }
});

app.use(express.static(STATIC_ROOT, { index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'index.html')));

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`thin-muscle-server ready at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('数据库初始化失败：', err.message);
    process.exit(1);
  });
