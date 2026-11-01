const test = require('node:test');
const assert = require('node:assert/strict');

let registration = null;
try {
  registration = require('./invitation-registration');
} catch {
  // Keep the red run focused on the not-yet-implemented transaction service.
}

const invitationToken = 'registration-invitation-token-0123456789';
const encryptionKey = Buffer.alloc(32, 7);

function makePool({ invalidInvite = false, activeForStudent = false, activeStudents = 0, usernameExists = false } = {}) {
  const statements = [];
  const state = { committedWrites: [], rollbackCount: 0, commitCount: 0, released: 0 };
  let transactionWrites = [];
  const client = {
    async query(sql, args = []) {
      statements.push({ sql, args });
      if (sql === 'BEGIN') { transactionWrites = []; return { rows: [], rowCount: 0 }; }
      if (sql === 'COMMIT') { state.commitCount += 1; state.committedWrites = [...transactionWrites]; return { rows: [], rowCount: 0 }; }
      if (sql === 'ROLLBACK') { state.rollbackCount += 1; transactionWrites = []; return { rows: [], rowCount: 0 }; }
      if (/^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim())) transactionWrites.push({ sql, args });
      if (sql.startsWith('INSERT INTO users')) {
        if (usernameExists) { const error = new Error('duplicate'); error.code = '23505'; throw error; }
        return { rows: [{ id: 12, username: args[0] }], rowCount: 1 };
      }
      if (sql.includes('FROM coach_invitations') && sql.includes('token_hash')) {
        if (invalidInvite) return { rows: [], rowCount: 0 };
        return { rows: [{ id: 88, coach_id: 9, expires_at: new Date(Date.now() + 60_000), accepted_at: null, revoked_at: null }], rowCount: 1 };
      }
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
        return { rows: args[0].map((id) => ({ id })), rowCount: args[0].length };
      }
      if (sql.includes('FROM user_roles')) return { rows: [{ role: 'coach' }], rowCount: 1 };
      if (sql.includes('FROM coach_student_relationships') && sql.includes('student_id')) {
        return activeForStudent ? { rows: [{ id: 21 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('coach_capacity_settings')) {
        return { rows: [{ tier_limit: 3, override_limit: null, active_students: activeStudents }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO coach_student_relationships')) {
        return { rows: [{ id: 31, created_at: '2026-09-30T12:00:00.000Z' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO coach_invitations')) {
        return { rows: [{ id: 99, created_at: '2026-09-30T12:00:00.000Z', expires_at: new Date(Date.now() + 7 * 86400_000) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { state.released += 1; },
  };
  return { pool: { async connect() { return client; } }, state, statements };
}

function register(pool, key = encryptionKey) {
  assert.equal(typeof registration?.registerWithInvitation, 'function', 'registration transaction service should be implemented');
  return registration.registerWithInvitation({
    pool,
    username: 'new-student',
    passwordHash: 'bcrypt-hash',
    sessionToken: 'session-token',
    sessionExpiresAt: new Date('2027-03-29T00:00:00.000Z'),
    invitationToken,
    encryptionKey: key,
  });
}

test('受邀注册把用户、角色、教练关系、邀请码轮换和会话放在同一事务中', async () => {
  assert.ok(registration, 'invitation registration module should load');
  const { pool, state, statements } = makePool();
  const result = await register(pool);
  assert.equal(state.commitCount, 1);
  assert.equal(state.rollbackCount, 0);
  assert.equal(state.released, 1);
  assert.deepEqual(result, {
    token: 'session-token', username: 'new-student', userId: 12, roles: ['student'],
    relationship: { id: 31, coachId: 9, studentId: 12, createdAt: '2026-09-30T12:00:00.000Z' },
  });
  assert.equal(JSON.stringify(result).includes(invitationToken), false);
  const writes = state.committedWrites.map(({ sql }) => sql);
  const userInsert = writes.findIndex((sql) => sql.startsWith('INSERT INTO users'));
  const roleInsert = writes.findIndex((sql) => sql.includes("INSERT INTO user_roles (user_id, role) VALUES ($1, 'student')"));
  const relationshipInsert = writes.findIndex((sql) => sql.startsWith('INSERT INTO coach_student_relationships'));
  const replacementInsert = writes.findIndex((sql) => sql.startsWith('INSERT INTO coach_invitations'));
  const sessionInsert = writes.findIndex((sql) => sql.startsWith('INSERT INTO auth_sessions'));
  assert.ok(userInsert >= 0 && relationshipInsert > userInsert && roleInsert > relationshipInsert && replacementInsert > roleInsert && sessionInsert > replacementInsert);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('无效邀请、已有关联或名额已满时整笔受邀注册回滚，不留下账号或会话', async (t) => {
  for (const [name, options, code] of [
    ['无效邀请', { invalidInvite: true }, 'invitation_not_found_or_expired'],
    ['已有教练', { activeForStudent: true }, 'already_has_active_coach'],
    ['名额已满', { activeStudents: 3 }, 'coach_capacity_full'],
  ]) {
    await t.test(name, async () => {
      const { pool, state, statements } = makePool(options);
      await assert.rejects(() => register(pool), { code });
      assert.equal(state.commitCount, 0);
      assert.equal(state.rollbackCount, 1);
      assert.equal(state.committedWrites.length, 0);
      assert.equal(statements.some(({ sql }) => sql.startsWith('INSERT INTO auth_sessions')), false);
      assert.equal(state.released, 1);
    });
  }
});

test('缺少加密密钥时回滚新账号，不留下登录会话', async () => {
  const { pool, state, statements } = makePool();
  await assert.rejects(() => register(pool, null), { code: 'invite_encryption_not_configured' });
  assert.equal(state.commitCount, 0);
  assert.equal(state.rollbackCount, 1);
  assert.equal(state.committedWrites.length, 0);
  assert.equal(statements.some(({ sql }) => sql.startsWith('INSERT INTO auth_sessions')), false);
});

test('用户名冲突不覆盖原账号并按 exists 返回，且不会建立会话', async () => {
  const { pool, state, statements } = makePool({ usernameExists: true });
  await assert.rejects(() => register(pool), { code: 'exists' });
  assert.equal(state.commitCount, 0);
  assert.equal(state.rollbackCount, 1);
  assert.equal(state.committedWrites.length, 0);
  assert.equal(statements.some(({ sql }) => sql.startsWith('INSERT INTO auth_sessions')), false);
  assert.equal(state.released, 1);
});
