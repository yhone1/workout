/* 轻健身本地后端
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
const { runMigrations } = require('./db/migrate');
const { seedGym } = require('./db/seed-gym');
const { mountIdentityCoachingRoutes } = require('./modules/identity-coaching');
const { loadAccessSnapshot, requireMembership } = require('./modules/membership-access');
const { mountWorkoutStateRoutes } = require('./modules/workout-state');
const { mountCatalogPlanRoutes } = require('./modules/catalog-plans');
const { mountWorkoutMeasurementRoutes } = require('./modules/workouts-measurements');
const { mountPhotoFeedRoutes } = require('./modules/photos-feed');
const { mountMembershipRoutes } = require('./modules/memberships');
const { mountMemberPlanRoutes } = require('./modules/member-plans');
const { mountMemberTrainingRoutes } = require('./modules/member-training');
const { mountCoachCapacityRoutes } = require('./modules/coach-capacity');
const { mountCoachInvitationRoutes, parseInviteEncryptionKey } = require('./modules/coach-invitations');
const { registerWithInvitation } = require('./modules/invitation-registration');
const { slashlessAlias } = require('./modules/page-paths');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STATIC_ROOT = process.env.STATIC_ROOT || (fs.existsSync(path.join(__dirname, '..', 'public')) ? path.join(__dirname, '..', 'public') : path.join(__dirname, '..'));
const PRIVATE_MEDIA_ROOT = path.resolve(process.env.PRIVATE_MEDIA_ROOT || path.join(__dirname, '..', 'private-media'));
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 180;
let inviteEncryptionKey = null;
try {
  inviteEncryptionKey = parseInviteEncryptionKey(process.env.COACH_INVITE_ENCRYPTION_KEY);
} catch {
  // Missing or invalid encryption configuration must not prevent the site from starting.
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://thin:thin@localhost:5432/thinmuscle',
});

app.use(express.json({ limit: '8mb' }));

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
    const roles = await pool.query('SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role', [r.rows[0].user_id]);
    req.user = { ...r.rows[0], roles: roles.rows.map((row) => row.role) };
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
    const { username, password, invitationToken } = req.body || {};
    if (!username || !password || password.length < 6) return res.status(400).json({ error: 'invalid' });
    const hash = await bcrypt.hash(password, 10);
    if (invitationToken !== undefined && invitationToken !== null) {
      if (typeof invitationToken !== 'string' || !invitationToken.trim()) return res.status(400).json({ error: 'invalid_invitation' });
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
      const result = await registerWithInvitation({
        pool,
        username,
        passwordHash: hash,
        sessionToken: token,
        sessionExpiresAt: expiresAt,
        invitationToken: invitationToken.trim(),
        encryptionKey: inviteEncryptionKey,
      });
      return res.status(201).json(result);
    }
    const r = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, hash])
      .catch((err) => { if (err.code === '23505') return null; throw err; });
    if (!r) return res.status(409).json({ error: 'exists' });
    await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'student') ON CONFLICT DO NOTHING`, [r.rows[0].id]);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
    await pool.query('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, r.rows[0].id, expiresAt]);
    res.json({ token, username: r.rows[0].username, userId: r.rows[0].id, roles: ['student'] });
  } catch (err) {
    const codes = {
      exists: 409,
      invalid: 400,
      invalid_invitation: 400,
      invalid_student: 400,
      cannot_accept_own_invitation: 400,
      invite_encryption_not_configured: 503,
      unsupported_invite_key_version: 503,
      invitation_not_found_or_expired: 404,
      coach_not_found: 404,
      user_not_found: 404,
      coach_role_inactive: 409,
      already_has_active_coach: 409,
      coach_capacity_unconfigured: 409,
      coach_capacity_full: 409,
    };
    const code = Object.hasOwn(codes, err.code) ? err.code : 'db';
    if (code === 'db') console.error('register', code);
    res.status(codes[code] || 500).json({ error: code });
  }
});

/* 当前用户与会员能力（token 校验） */
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const access = await loadAccessSnapshot({ pool, user: req.user });
    res.json({ userId: req.user.user_id, username: req.user.username, roles: req.user.roles, ...access });
  } catch (err) {
    console.error('GET /api/auth/me', err.message);
    res.status(500).json({ error: 'db' });
  }
});

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

mountIdentityCoachingRoutes(app, { pool, auth, inviteEncryptionKey });
mountCoachInvitationRoutes(app, { pool, auth, encryptionKey: inviteEncryptionKey });
mountCoachCapacityRoutes(app, { pool, auth });
mountMembershipRoutes(app, { pool, auth });
mountWorkoutStateRoutes(app, { pool, auth, requireMembership });
mountMemberPlanRoutes(app, { pool, auth, requireMembership });
mountMemberTrainingRoutes(app, { pool, auth, requireMembership });
mountCatalogPlanRoutes(app, { pool, auth, staticRoot: STATIC_ROOT });
mountWorkoutMeasurementRoutes(app, { pool, auth });
mountPhotoFeedRoutes(app, { pool, auth, privateRoot: PRIVATE_MEDIA_ROOT });

app.get('/', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'portal', 'index.html')));
app.get('/index.html', (req, res) => res.redirect(302, '/home/'));
app.get(slashlessAlias('/home'), (req, res) => res.redirect(308, '/home/'));
app.get('/home/', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'index.html')));
app.get('/home/media-config.js', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'media-config.js')));
app.get('/home/gif-links.js', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'gif-links.js')));
app.use('/home/IMG', express.static(path.join(STATIC_ROOT, 'IMG')));
app.use('/home/VIDEO', express.static(path.join(STATIC_ROOT, 'VIDEO')));
app.get(slashlessAlias('/gym'), (req, res) => res.redirect(308, '/gym/'));
app.use('/gym', express.static(path.join(STATIC_ROOT, 'gym'), { index: 'index.html' }));
app.get(slashlessAlias('/member'), (req, res) => res.redirect(308, '/member/'));
app.get('/member/', (req, res, next) => {
  const memberIndex = path.join(STATIC_ROOT, 'member', 'index.html');
  if (!fs.existsSync(memberIndex)) return res.status(503).send('会员自助计划模块尚未部署。');
  return res.sendFile(memberIndex, (err) => { if (err) next(err); });
});
app.use('/member', express.static(path.join(STATIC_ROOT, 'member'), { index: 'index.html' }));
app.use('/portal', express.static(path.join(STATIC_ROOT, 'portal'), { index: 'index.html' }));

// Unknown API paths must remain API errors, never fall through to a page document.
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use(express.static(STATIC_ROOT, { index: false }));
app.use((req, res) => res.status(404).send('未找到页面。'));

ensureSchema()
  .then(() => runMigrations(pool))
  .then(() => seedGym(pool))
  .then(() => {
    app.listen(PORT, () => console.log(`thin-muscle-server ready at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('数据库初始化失败：', err.message);
    process.exit(1);
  });
