const crypto = require('node:crypto');
const { capacitySnapshot, resolveCoachLimit } = require('./coach-capacity');

const INVITE_KEY_VERSION = 1;
const INVITE_TOKEN_BYTES = 32;
const INVITE_TOKEN_DAYS = 7;

function inviteError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertInviteKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw inviteError('invite_encryption_not_configured');
}

function parseInviteEncryptionKey(encoded) {
  const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (typeof encoded !== 'string' || !base64.test(encoded)) throw inviteError('invite_encryption_not_configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw inviteError('invite_encryption_not_configured');
  return key;
}

function encryptInviteToken(token, key) {
  assertInviteKey(key);
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw inviteError('invalid_invitation');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: INVITE_KEY_VERSION,
  };
}

function decryptInviteToken(record, key) {
  assertInviteKey(key);
  if (record?.keyVersion !== INVITE_KEY_VERSION) throw inviteError('unsupported_invite_key_version');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, record.nonce);
    decipher.setAuthTag(record.authTag);
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw inviteError('invite_decryption_failed');
  }
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function inviteIsUsable(row, now = Date.now()) {
  return Boolean(row)
    && !row.accepted_at
    && !row.revoked_at
    && Number.isFinite(new Date(row.expires_at).getTime())
    && new Date(row.expires_at).getTime() > now;
}

function requireToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw inviteError('invalid_invitation');
  return token;
}

async function lockUsers(client, ids) {
  const orderedIds = [...new Set(ids)].sort((a, b) => a - b);
  const result = await client.query(
    'SELECT id FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
    [orderedIds],
  );
  if (result.rowCount !== orderedIds.length) throw inviteError('user_not_found');
  return orderedIds;
}

async function hasCoachRole(client, coachId) {
  const result = await client.query(
    `SELECT role FROM user_roles WHERE user_id = $1 AND role IN ('coach', 'admin')`,
    [coachId],
  );
  return Boolean(result.rowCount);
}

async function readCoachCapacity(client, coachId) {
  const result = await client.query(
    `SELECT t.max_students AS tier_limit, s.max_students_override AS override_limit,
            COUNT(r.id)::int AS active_students
     FROM users u
     LEFT JOIN coach_capacity_settings s ON s.coach_id = u.id
     LEFT JOIN coach_capacity_tiers t ON t.id = s.tier_id
     LEFT JOIN coach_student_relationships r ON r.coach_id = u.id AND r.status = 'active'
     WHERE u.id = $1
     GROUP BY t.max_students, s.max_students_override`,
    [coachId],
  );
  const row = result.rows[0] || {};
  const maxStudents = resolveCoachLimit({
    tierLimit: row.tier_limit == null ? null : Number(row.tier_limit),
    overrideLimit: row.override_limit == null ? null : Number(row.override_limit),
  });
  return capacitySnapshot({
    activeStudents: Number(row.active_students) || 0,
    maxStudents: Number.isSafeInteger(maxStudents) && maxStudents >= 0 ? maxStudents : null,
  });
}

function issueInviteToken() {
  return crypto.randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

async function insertInvitation(client, { coachId, encryptionKey, validDays = INVITE_TOKEN_DAYS }) {
  assertInviteKey(encryptionKey);
  const token = issueInviteToken();
  const encrypted = encryptInviteToken(token, encryptionKey);
  const result = await client.query(
    `INSERT INTO coach_invitations
       (coach_id, token_hash, expires_at, token_ciphertext, token_nonce, token_auth_tag, token_key_version, is_current)
     VALUES ($1, $2, now() + ($3 * interval '1 day'), $4, $5, $6, $7, true)
     RETURNING id, created_at, expires_at`,
    [coachId, encrypted.tokenHash, validDays, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.keyVersion],
  );
  const row = result.rows[0] || {};
  return {
    id: row.id == null ? null : Number(row.id),
    createdAt: row.created_at || null,
    expiresAt: row.expires_at || null,
    token,
  };
}

async function createCurrentIfMissing(client, { coachId, encryptionKey, validDays = INVITE_TOKEN_DAYS }) {
  const existing = await client.query(
    `SELECT id, expires_at, token_ciphertext, token_nonce, token_auth_tag, token_key_version
     FROM coach_invitations
     WHERE coach_id = $1 AND is_current AND accepted_at IS NULL AND revoked_at IS NULL
     FOR UPDATE`,
    [coachId],
  );
  const row = existing.rows[0];
  if (row && inviteIsUsable(row)) return null;
  if (row) {
    await client.query(
      `UPDATE coach_invitations SET revoked_at = now(), is_current = false,
         token_ciphertext = NULL, token_nonce = NULL, token_auth_tag = NULL, token_key_version = NULL
       WHERE id = $1`,
      [row.id],
    );
  }
  return insertInvitation(client, { coachId, encryptionKey, validDays });
}

async function acceptInvitation(client, { token, studentId, encryptionKey }) {
  assertInviteKey(encryptionKey);
  requireToken(token);
  const validStudentId = validId(studentId);
  if (!validStudentId) throw inviteError('invalid_student');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const found = await client.query(
    `SELECT id, coach_id, expires_at, accepted_at, revoked_at
     FROM coach_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  const candidate = found.rows[0];
  if (!inviteIsUsable(candidate)) throw inviteError('invitation_not_found_or_expired');
  const coachId = Number(candidate.coach_id);
  if (!validId(coachId)) throw inviteError('coach_not_found');
  if (coachId === validStudentId) throw inviteError('cannot_accept_own_invitation');

  await lockUsers(client, [coachId, validStudentId]);
  const locked = await client.query(
    `SELECT id, coach_id, expires_at, accepted_at, revoked_at
     FROM coach_invitations WHERE id = $1 AND token_hash = $2 FOR UPDATE`,
    [candidate.id, tokenHash],
  );
  const invitation = locked.rows[0];
  if (!inviteIsUsable(invitation)) throw inviteError('invitation_not_found_or_expired');
  if (!await hasCoachRole(client, coachId)) throw inviteError('coach_role_inactive');

  const existingRelationship = await client.query(
    `SELECT id FROM coach_student_relationships WHERE student_id = $1 AND status = 'active' LIMIT 1`,
    [validStudentId],
  );
  if (existingRelationship.rowCount) throw inviteError('already_has_active_coach');
  const beforeCapacity = await readCoachCapacity(client, coachId);
  if (beforeCapacity.maxStudents === null) throw inviteError('coach_capacity_unconfigured');
  if (!beforeCapacity.canAccept) throw inviteError('coach_capacity_full');

  const relationshipResult = await client.query(
    `INSERT INTO coach_student_relationships (coach_id, student_id)
     VALUES ($1, $2) RETURNING id, created_at`,
    [coachId, validStudentId],
  );
  const relationship = relationshipResult.rows[0];
  await client.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'student') ON CONFLICT DO NOTHING`,
    [validStudentId],
  );
  await client.query(
    `UPDATE coach_invitations SET accepted_by = $1, accepted_at = now(), is_current = false,
       token_ciphertext = NULL, token_nonce = NULL, token_auth_tag = NULL, token_key_version = NULL
     WHERE id = $2`,
    [validStudentId, invitation.id],
  );
  await client.query(
    `UPDATE coach_invitations SET revoked_at = now(), is_current = false,
       token_ciphertext = NULL, token_nonce = NULL, token_auth_tag = NULL, token_key_version = NULL
     WHERE coach_id = $1 AND id <> $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [coachId, invitation.id],
  );
  const activeStudents = beforeCapacity.activeStudents + 1;
  const coachCapacity = capacitySnapshot({ activeStudents, maxStudents: beforeCapacity.maxStudents });
  if (coachCapacity.canAccept) {
    await insertInvitation(client, { coachId, encryptionKey });
  }
  return {
    relationship: {
      id: Number(relationship.id),
      coachId,
      studentId: validStudentId,
      createdAt: relationship.created_at,
    },
    coachCapacity,
  };
}

async function endCoachRelationship(client, { coachId, studentId, encryptionKey }) {
  const validCoachId = validId(coachId);
  const validStudentId = validId(studentId);
  if (!validCoachId || !validStudentId) throw inviteError('invalid_student');
  await lockUsers(client, [validCoachId, validStudentId]);
  const relation = await client.query(
    `SELECT id FROM coach_student_relationships
     WHERE coach_id = $1 AND student_id = $2 AND status = 'active' FOR UPDATE`,
    [validCoachId, validStudentId],
  );
  if (!relation.rowCount) throw inviteError('relationship_not_found');
  await client.query(
    `UPDATE gym_sessions SET status='abandoned', ended_at=now(), updated_at=now()
     WHERE coach_id = $1 AND student_id = $2 AND status = 'draft'`,
    [validCoachId, validStudentId],
  );
  await client.query(
    `UPDATE coach_student_relationships SET status='ended', ended_at=now() WHERE id = $1`,
    [relation.rows[0].id],
  );
  const coachCapacity = await readCoachCapacity(client, validCoachId);
  if (coachCapacity.canAccept && Buffer.isBuffer(encryptionKey) && encryptionKey.length === 32
      && await hasCoachRole(client, validCoachId)) {
    await createCurrentIfMissing(client, { coachId: validCoachId, encryptionKey });
  }
  return { coachCapacity };
}

async function ensureCurrentInvitation(client, { coachId, encryptionKey, validDays = INVITE_TOKEN_DAYS, replace = false }) {
  assertInviteKey(encryptionKey);
  await lockUsers(client, [coachId]);
  if (!await hasCoachRole(client, coachId)) throw inviteError('coach_role_inactive');
  const coachCapacity = await readCoachCapacity(client, coachId);
  if (coachCapacity.maxStudents === null) throw inviteError('coach_capacity_unconfigured');
  if (!coachCapacity.canAccept) throw inviteError('coach_capacity_full');

  if (replace) {
    await client.query(
      `UPDATE coach_invitations SET revoked_at = now(), is_current = false,
         token_ciphertext = NULL, token_nonce = NULL, token_auth_tag = NULL, token_key_version = NULL
       WHERE coach_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [coachId],
    );
  } else {
    const current = await client.query(
      `SELECT id, created_at, expires_at, token_ciphertext, token_nonce, token_auth_tag, token_key_version
       FROM coach_invitations
       WHERE coach_id = $1 AND is_current AND accepted_at IS NULL AND revoked_at IS NULL
       FOR UPDATE`,
      [coachId],
    );
    const row = current.rows[0];
    if (row && inviteIsUsable(row) && row.token_ciphertext && row.token_nonce && row.token_auth_tag && row.token_key_version) {
      const token = decryptInviteToken({
        ciphertext: row.token_ciphertext,
        nonce: row.token_nonce,
        authTag: row.token_auth_tag,
        keyVersion: Number(row.token_key_version),
      }, encryptionKey);
      return {
        invitation: { id: Number(row.id), createdAt: row.created_at, expiresAt: row.expires_at, token },
        coachCapacity,
      };
    }
    if (row) {
      await client.query(
        `UPDATE coach_invitations SET revoked_at = now(), is_current = false,
           token_ciphertext = NULL, token_nonce = NULL, token_auth_tag = NULL, token_key_version = NULL
         WHERE id = $1`,
        [row.id],
      );
    }
  }

  const invitation = await insertInvitation(client, { coachId, encryptionKey, validDays });
  return { invitation, coachCapacity };
}

function defaultRequireRole(...roles) {
  return (req, res, next) => {
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (!userRoles.includes('superadmin') && !roles.some((role) => userRoles.includes(role))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  };
}

function responseForInvitationError(res, route, error) {
  const code = error.code || 'db';
  const statuses = {
    invalid_invitation: 400,
    invalid_invitation_days: 400,
    invalid_student: 400,
    cannot_accept_own_invitation: 400,
    invite_encryption_not_configured: 503,
    unsupported_invite_key_version: 503,
    invitation_not_found_or_expired: 404,
    relationship_not_found: 404,
    coach_not_found: 404,
    user_not_found: 404,
    coach_role_inactive: 409,
    already_has_active_coach: 409,
    coach_capacity_unconfigured: 409,
    coach_capacity_full: 409,
    invitation_conflict: 409,
    invite_decryption_failed: 500,
  };
  const publicCode = Object.hasOwn(statuses, code) ? code : 'db';
  const status = statuses[publicCode] || 500;
  if (status >= 500 && publicCode !== 'invite_encryption_not_configured' && publicCode !== 'unsupported_invite_key_version') {
    console.error(route, publicCode);
  }
  return res.status(status).json({ error: publicCode });
}

function validInvitationDays(value) {
  const days = value == null ? INVITE_TOKEN_DAYS : value;
  if (!Number.isSafeInteger(days) || days < 1 || days > 14) throw inviteError('invalid_invitation_days');
  return days;
}

function mountCoachInvitationRoutes(app, { pool, auth, encryptionKey, requireRole = defaultRequireRole }) {
  const coachOnly = [auth, requireRole('coach', 'admin')];

  async function runTransaction(req, res, route, operation, successStatus = 200) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return res.status(successStatus).json(result);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') error.code = route.includes('/accept') ? 'already_has_active_coach' : 'invitation_conflict';
      return responseForInvitationError(res, route, error);
    } finally {
      client?.release();
    }
  }

  const ensure = (route, replace) => async (req, res) => {
    try {
      assertInviteKey(encryptionKey);
      const validDays = validInvitationDays(req.body?.validDays);
      return runTransaction(req, res, route, (client) => ensureCurrentInvitation(client, {
        coachId: req.user.user_id, encryptionKey, validDays, replace,
      }));
    } catch (error) {
      return responseForInvitationError(res, route, error);
    }
  };
  const currentHandler = ensure('/api/coach/invitations/current', false);
  app.post('/api/coach/invitations/current', ...coachOnly, currentHandler);
  app.post('/api/coach/invitations/current/replace', ...coachOnly, ensure('/api/coach/invitations/current/replace', true));
  app.post('/api/coach/invitations', ...coachOnly, ensure('/api/coach/invitations', false));

  app.get('/api/coach/invitations', ...coachOnly, async (req, res) => {
    try {
      const [result, coachCapacity] = await Promise.all([
        pool.query(
          `SELECT i.id, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.accepted_by, i.is_current,
                  accepted.username AS accepted_username
           FROM coach_invitations i LEFT JOIN users accepted ON accepted.id = i.accepted_by
           WHERE i.coach_id = $1 ORDER BY i.created_at DESC LIMIT 100`,
          [req.user.user_id],
        ),
        readCoachCapacity(pool, req.user.user_id),
      ]);
      return res.json({
        invitations: result.rows.map((row) => ({
          id: Number(row.id),
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          acceptedAt: row.accepted_at,
          revokedAt: row.revoked_at,
          acceptedBy: row.accepted_by == null ? null : Number(row.accepted_by),
          acceptedUsername: row.accepted_username || null,
          isCurrent: Boolean(row.is_current),
        })),
        coachCapacity,
        encryptionConfigured: Buffer.isBuffer(encryptionKey) && encryptionKey.length === 32,
      });
    } catch (error) {
      return responseForInvitationError(res, 'GET /api/coach/invitations', error);
    }
  });

  app.delete('/api/coach/invitations/:id', ...coachOnly, async (req, res) => {
    const id = validId(req.params.id);
    const coachId = validId(req.user.user_id);
    if (!id) return res.status(400).json({ error: 'invalid_invitation' });
    if (!coachId) return res.status(401).json({ error: 'unauthorized' });
    return runTransaction(req, res, 'DELETE /api/coach/invitations/:id', async (client) => {
      await lockUsers(client, [coachId]);
      const invitation = await client.query(
        `SELECT id FROM coach_invitations
         WHERE id = $1 AND coach_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`,
        [id, coachId],
      );
      if (!invitation.rowCount) throw inviteError('invitation_not_found_or_expired');
      await client.query(
        `UPDATE coach_invitations SET revoked_at = now(), is_current = false,
           token_ciphertext = NULL, token_nonce = NULL, token_auth_tag = NULL, token_key_version = NULL
         WHERE id = $1`,
        [id],
      );
      return { ok: true };
    });
  });

  app.post('/api/coach/invitations/accept', auth, async (req, res) => {
    try {
      assertInviteKey(encryptionKey);
      const token = String(req.body?.token || '').trim();
      requireToken(token);
      return runTransaction(req, res, 'POST /api/coach/invitations/accept', async (client) => {
        const result = await acceptInvitation(client, {
          token,
          studentId: req.user?.user_id,
          encryptionKey,
        });
        return { relationship: result.relationship, coachCapacity: result.coachCapacity };
      }, 201);
    } catch (error) {
      return responseForInvitationError(res, 'POST /api/coach/invitations/accept', error);
    }
  });
}

module.exports = {
  acceptInvitation,
  decryptInviteToken,
  endCoachRelationship,
  encryptInviteToken,
  ensureCurrentInvitation,
  mountCoachInvitationRoutes,
  parseInviteEncryptionKey,
};
