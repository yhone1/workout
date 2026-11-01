const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let invitations = null;
try {
  invitations = require('./coach-invitations');
} catch {
  // Keep the first red run focused on the missing invitation module.
}

test('邀请码加密密钥只接受 base64 编码的 32 字节', () => {
  assert.ok(invitations, 'coach-invitations module should load');
  const key = invitations.parseInviteEncryptionKey(Buffer.alloc(32, 7).toString('base64'));
  assert.equal(key.length, 32);
  for (const value of [undefined, '', 'not-base64', Buffer.alloc(31, 7).toString('base64')]) {
    assert.throws(() => invitations.parseInviteEncryptionKey(value), { code: 'invite_encryption_not_configured' });
  }
});

test('AES-256-GCM 邀请密文可还原且每次使用新的 nonce', () => {
  assert.ok(invitations, 'coach-invitations module should load');
  const key = Buffer.alloc(32, 9);
  const token = 'high-entropy-invitation-token-value';
  const first = invitations.encryptInviteToken(token, key);
  const second = invitations.encryptInviteToken(token, key);
  assert.equal(invitations.decryptInviteToken(first, key), token);
  assert.equal(first.keyVersion, 1);
  assert.equal(first.tokenHash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notDeepEqual(first.nonce, second.nonce);
});

test('密文、认证标签、错误密钥或未知密钥版本都不能还原邀请码', () => {
  assert.ok(invitations, 'coach-invitations module should load');
  const key = Buffer.alloc(32, 4);
  const token = 'another-high-entropy-token-value';
  const record = invitations.encryptInviteToken(token, key);
  const ciphertextTampered = { ...record, ciphertext: Buffer.from(record.ciphertext) };
  ciphertextTampered.ciphertext[0] ^= 0xff;
  const tagTampered = { ...record, authTag: Buffer.from(record.authTag) };
  tagTampered.authTag[0] ^= 0xff;
  assert.throws(() => invitations.decryptInviteToken(ciphertextTampered, key));
  assert.throws(() => invitations.decryptInviteToken(tagTampered, key));
  assert.throws(() => invitations.decryptInviteToken(record, Buffer.alloc(32, 5)));
  assert.throws(() => invitations.decryptInviteToken({ ...record, keyVersion: 99 }, key), { code: 'unsupported_invite_key_version' });
});

function makeAcceptanceClient({
  invite = { id: 44, coach_id: 9, expires_at: new Date(Date.now() + 60_000), accepted_at: null, revoked_at: null },
  roles = [{ role: 'coach' }],
  activeForStudent = false,
  capacity = { tier_limit: 4, override_limit: null, active_students: 0 },
} = {}) {
  const statements = [];
  const client = {
    async query(sql, args = []) {
      statements.push({ sql, args });
      if (sql.includes('FROM coach_invitations') && sql.includes('token_hash')) {
        return invite ? { rows: [{ ...invite }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
        return { rows: args[0].map((id) => ({ id })), rowCount: args[0].length };
      }
      if (sql.includes('FROM user_roles')) return { rows: roles, rowCount: roles.length };
      if (sql.includes('FROM coach_student_relationships') && sql.includes('student_id')) {
        return { rows: activeForStudent ? [{ id: 31 }] : [], rowCount: activeForStudent ? 1 : 0 };
      }
      if (sql.includes('coach_capacity_settings')) return { rows: [capacity], rowCount: 1 };
      if (sql.startsWith('INSERT INTO coach_student_relationships')) {
        return { rows: [{ id: 61, created_at: '2026-09-30T10:00:00.000Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { client, statements };
}

async function accept(client, token, studentId = 3, encryptionKey = Buffer.alloc(32, 2)) {
  assert.equal(typeof invitations.acceptInvitation, 'function', 'acceptInvitation transaction helper should be implemented');
  return invitations.acceptInvitation(client, { token, studentId, encryptionKey });
}

async function endRelationship(client, coachId = 9, studentId = 3, encryptionKey = Buffer.alloc(32, 2)) {
  assert.equal(typeof invitations.endCoachRelationship, 'function', 'endCoachRelationship transaction helper should be implemented');
  return invitations.endCoachRelationship(client, { coachId, studentId, encryptionKey });
}

test('接受邀请用 SHA-256 查找旧哈希码，按 ID 顺序锁用户且成功后不返回替代码', async () => {
  const token = 'legacy-hash-only-invitation-token';
  const { client, statements } = makeAcceptanceClient({ invite: {
    id: 44, coach_id: 9, expires_at: new Date(Date.now() + 60_000), accepted_at: null, revoked_at: null,
    token_ciphertext: null, token_nonce: null, token_auth_tag: null, token_key_version: null,
  } });
  const result = await accept(client, token);
  const invitationLookup = statements.find(({ sql }) => sql.includes('FROM coach_invitations') && sql.includes('token_hash'));
  assert.equal(invitationLookup.args[0], crypto.createHash('sha256').update(token).digest('hex'));
  const userLock = statements.find(({ sql }) => sql.includes('FROM users') && sql.includes('FOR UPDATE'));
  assert.deepEqual(userLock.args[0], [3, 9]);
  assert.match(userLock.sql, /ORDER BY id\s+FOR UPDATE/i);
  assert.deepEqual(result, {
    relationship: { id: 61, coachId: 9, studentId: 3, createdAt: '2026-09-30T10:00:00.000Z' },
    coachCapacity: { activeStudents: 1, maxStudents: 4, remaining: 3, canAccept: true },
  });
  assert.equal(JSON.stringify(result).includes('token'), false);
  assert.ok(statements.some(({ sql }) => sql.includes('token_ciphertext = NULL') && sql.includes('accepted_at')));
  assert.ok(statements.some(({ sql }) => sql.includes('revoked_at = now()') && sql.includes('coach_id')));
  assert.ok(statements.some(({ sql }) => sql.startsWith('INSERT INTO coach_invitations')));
});

test('邀请码不可用、教练资格失效、学员已有教练或名额未配置/已满时不发生关系或邀请码写入', async (t) => {
  const scenarios = [
    ['邀请码不存在', { invite: null }, 'invitation_not_found_or_expired'],
    ['邀请码过期', { invite: { id: 1, coach_id: 9, expires_at: new Date(Date.now() - 60_000), accepted_at: null, revoked_at: null } }, 'invitation_not_found_or_expired'],
    ['邀请码已使用', { invite: { id: 1, coach_id: 9, expires_at: new Date(Date.now() + 60_000), accepted_at: new Date(), revoked_at: null } }, 'invitation_not_found_or_expired'],
    ['邀请码已撤销', { invite: { id: 1, coach_id: 9, expires_at: new Date(Date.now() + 60_000), accepted_at: null, revoked_at: new Date() } }, 'invitation_not_found_or_expired'],
    ['教练资格失效', { roles: [] }, 'coach_role_inactive'],
    ['学员已有教练', { activeForStudent: true }, 'already_has_active_coach'],
    ['名额未配置', { capacity: { tier_limit: null, override_limit: null, active_students: 0 } }, 'coach_capacity_unconfigured'],
    ['名额已满', { capacity: { tier_limit: 2, override_limit: 2, active_students: 2 } }, 'coach_capacity_full'],
  ];
  for (const [name, options, code] of scenarios) {
    await t.test(name, async () => {
      const { client, statements } = makeAcceptanceClient(options);
      await assert.rejects(() => accept(client, 'valid-invitation-token-value-12345'), { code });
      assert.equal(statements.some(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim())), false);
    });
  }
});

test('缺少邀请加密密钥时在读取或修改邀请状态前拒绝绑定', async () => {
  const { client, statements } = makeAcceptanceClient();
  await assert.rejects(() => accept(client, 'valid-invitation-token-value-12345', 3, null), { code: 'invite_encryption_not_configured' });
  assert.equal(statements.length, 0);
});

test('并发竞争最后一个学员名额时仅一个邀请能够建立关系', async () => {
  let lockTail = Promise.resolve();
  const students = new Set();
  const inviteByHash = new Map();
  for (const [id, token] of [[44, 'first-concurrent-invite-token-extra'], [45, 'second-concurrent-invite-token-extra']]) {
    inviteByHash.set(crypto.createHash('sha256').update(token).digest('hex'), {
      id, coach_id: 9, expires_at: new Date(Date.now() + 60_000), accepted_at: null, revoked_at: null,
    });
  }
  function newClient() {
    let unlock = null;
    return {
      async query(sql, args = []) {
        if (sql.includes('FROM coach_invitations') && sql.includes('token_hash')) {
          const row = inviteByHash.get(args.length > 1 ? args[1] : args[0]);
          return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
          const previous = lockTail;
          let release;
          lockTail = new Promise((resolve) => { release = resolve; });
          await previous;
          unlock = release;
          return { rows: args[0].map((id) => ({ id })), rowCount: args[0].length };
        }
        if (sql.includes('FROM user_roles')) return { rows: [{ role: 'coach' }], rowCount: 1 };
        if (sql.includes('FROM coach_student_relationships') && sql.includes('student_id')) return { rows: [], rowCount: 0 };
        if (sql.includes('coach_capacity_settings')) return { rows: [{ tier_limit: 1, override_limit: null, active_students: students.size }], rowCount: 1 };
        if (sql.startsWith('INSERT INTO coach_student_relationships')) {
          students.add(args[1]);
          return { rows: [{ id: students.size, created_at: '2026-09-30T10:00:00.000Z' }], rowCount: 1 };
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.();
        return { rows: [], rowCount: 1 };
      },
    };
  }
  async function transact(token, studentId) {
    const client = newClient();
    try {
      await client.query('BEGIN');
      const result = await accept(client, token, studentId);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      return { error: error.code };
    }
  }
  const results = await Promise.all([
    transact('first-concurrent-invite-token-extra', 11),
    transact('second-concurrent-invite-token-extra', 12),
  ]);
  assert.equal(results.filter((result) => result.relationship).length, 1, JSON.stringify(results));
  assert.equal(results.filter((result) => result.error === 'coach_capacity_full').length, 1);
  assert.equal(students.size, 1);
});

function makeEndClient({ hasRelation = true, capacity = { tier_limit: 4, override_limit: null, active_students: 0 } } = {}) {
  const statements = [];
  const client = {
    async query(sql, args = []) {
      statements.push({ sql, args });
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: args[0].map((id) => ({ id })), rowCount: args[0].length };
      if (sql.includes('FROM coach_student_relationships') && sql.includes('coach_id')) {
        return hasRelation ? { rows: [{ id: 61 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('coach_capacity_settings')) return { rows: [capacity], rowCount: 1 };
      if (sql.includes('FROM coach_invitations') && sql.includes('is_current')) return { rows: [], rowCount: 0 };
      return { rows: [{ id: 91, created_at: '2026-09-30T10:00:00.000Z', expires_at: new Date(Date.now() + 7 * 86400_000) }], rowCount: 1 };
    },
  };
  return { client, statements };
}

test('结束关系释放名额并在仍有容量和密钥时恢复一个当前邀请码', async () => {
  const { client, statements } = makeEndClient();
  const result = await endRelationship(client);
  assert.equal(result.coachCapacity.activeStudents, 0);
  assert.equal(result.coachCapacity.canAccept, true);
  assert.ok(statements.some(({ sql }) => sql.includes("SET status='ended'")));
  assert.ok(statements.some(({ sql }) => sql.startsWith('INSERT INTO coach_invitations')));
});

test('缺少密钥时仍结束关系释放名额，但不生成不可恢复的邀请码', async () => {
  const { client, statements } = makeEndClient();
  const result = await endRelationship(client, 9, 3, null);
  assert.equal(result.coachCapacity.activeStudents, 0);
  assert.ok(statements.some(({ sql }) => sql.includes("SET status='ended'")));
  assert.equal(statements.some(({ sql }) => sql.startsWith('INSERT INTO coach_invitations')), false);
});

test('结束不存在的学员关系不会改写关系或邀请', async () => {
  const { client, statements } = makeEndClient({ hasRelation: false });
  await assert.rejects(() => endRelationship(client), { code: 'relationship_not_found' });
  assert.equal(statements.some(({ sql }) => /^(UPDATE|INSERT)\b/i.test(sql.trim())), false);
});

function fakeInvitationApp() {
  const routes = new Map(['GET', 'POST', 'DELETE'].map((method) => [method, new Map()]));
  return {
    routes,
    get(path, ...handlers) { routes.get('GET').set(path, handlers); },
    post(path, ...handlers) { routes.get('POST').set(path, handlers); },
    delete(path, ...handlers) { routes.get('DELETE').set(path, handlers); },
  };
}

async function invokeRoute(stack, req) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let index = 0;
  const next = async (err) => {
    if (err) throw err;
    const handler = stack[index++];
    if (handler) return handler(req, res, next);
  };
  await next();
  return res;
}

function installInvitationRoutes(pool, encryptionKey = Buffer.alloc(32, 2)) {
  assert.equal(typeof invitations.mountCoachInvitationRoutes, 'function', 'coach invitation routes should be implemented');
  const app = fakeInvitationApp();
  invitations.mountCoachInvitationRoutes(app, {
    pool,
    auth: async (_req, _res, next) => next(),
    encryptionKey,
  });
  return app;
}

function makeInvitationRoutePool({
  capacity = { tier_limit: 3, override_limit: null, active_students: 0 },
  current = null,
  history = [],
} = {}) {
  const statements = [];
  const state = { current, invitations: current ? [current] : [...history], inserted: 0 };
  const client = {
    async query(sql, args = []) {
      statements.push({ sql, args });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: args[0].map((id) => ({ id })), rowCount: args[0].length };
      if (sql.includes('FROM user_roles')) return { rows: [{ role: 'coach' }], rowCount: 1 };
      if (sql.includes('coach_capacity_settings')) return { rows: [capacity], rowCount: 1 };
      if (sql.includes('FROM coach_invitations') && sql.includes('is_current')) {
        return state.current ? { rows: [{ ...state.current }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO coach_invitations')) {
        state.inserted += 1;
        const row = {
          id: 100 + state.inserted,
          coach_id: args[0],
          token_hash: args[1],
          expires_at: new Date(Date.now() + args[2] * 86400_000),
          created_at: new Date('2026-09-30T10:00:00.000Z'),
          token_ciphertext: args[3], token_nonce: args[4], token_auth_tag: args[5], token_key_version: args[6],
          is_current: true, accepted_at: null, revoked_at: null,
        };
        state.current = row;
        state.invitations.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('UPDATE coach_invitations') && sql.includes('revoked_at = now()')) {
        if (state.current) {
          const revoked = { ...state.current, revoked_at: new Date(), is_current: false,
            token_ciphertext: null, token_nonce: null, token_auth_tag: null, token_key_version: null };
          state.invitations = state.invitations.map((row) => row.id === state.current.id ? revoked : row);
          state.current = revoked;
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM coach_invitations') && sql.includes('coach_id = $2')) {
        return state.current ? { rows: [{ ...state.current }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, args = []) {
      statements.push({ sql, args });
      if (sql.includes('coach_capacity_settings')) return { rows: [capacity], rowCount: 1 };
      if (sql.includes('FROM coach_invitations') && sql.includes('accepted_username')) {
        return { rows: state.invitations.map(({ id, created_at, expires_at, accepted_at, revoked_at, accepted_by, is_current }) => ({
          id, created_at, expires_at, accepted_at, revoked_at, accepted_by, is_current,
        })), rowCount: state.invitations.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, state, statements };
}

function storedInvitation(token, key = Buffer.alloc(32, 2)) {
  const encrypted = invitations.encryptInviteToken(token, key);
  return {
    id: 55, coach_id: 9, token_hash: encrypted.tokenHash,
    created_at: new Date('2026-09-30T10:00:00.000Z'), expires_at: new Date(Date.now() + 86400_000),
    token_ciphertext: encrypted.ciphertext, token_nonce: encrypted.nonce,
    token_auth_tag: encrypted.authTag, token_key_version: encrypted.keyVersion,
    is_current: true, accepted_at: null, revoked_at: null,
  };
}

test('教练刷新当前邀请会得到同一 token，旧端点仍是同一幂等 ensure', async () => {
  const { pool, state } = makeInvitationRoutePool();
  const app = installInvitationRoutes(pool);
  const req = { user: { user_id: 9, roles: ['coach'] }, body: {} };
  const first = await invokeRoute(app.routes.get('POST').get('/api/coach/invitations/current'), req);
  const legacyAlias = await invokeRoute(app.routes.get('POST').get('/api/coach/invitations'), req);
  assert.equal(first.statusCode, 200);
  assert.ok(first.body.invitation.token);
  assert.equal(legacyAlias.body.invitation.token, first.body.invitation.token);
  assert.equal(state.inserted, 1);
});

test('替换邀请会作废旧密文而生成新 token，名额未配置时则拒绝发码', async () => {
  const old = storedInvitation('current-invitation-token-to-be-replaced');
  const fixture = makeInvitationRoutePool({ current: old });
  const app = installInvitationRoutes(fixture.pool);
  const replaced = await invokeRoute(app.routes.get('POST').get('/api/coach/invitations/current/replace'), {
    user: { user_id: 9, roles: ['coach'] }, body: { validDays: 3 },
  });
  assert.equal(replaced.statusCode, 200);
  assert.notEqual(replaced.body.invitation.token, invitations.decryptInviteToken({
    ciphertext: old.token_ciphertext, nonce: old.token_nonce, authTag: old.token_auth_tag, keyVersion: old.token_key_version,
  }, Buffer.alloc(32, 2)));
  assert.equal(fixture.state.current.id, 101);
  assert.equal(fixture.state.invitations[0].token_ciphertext, null);

  const blocked = makeInvitationRoutePool({ capacity: { tier_limit: null, override_limit: null, active_students: 0 } });
  const blockedApp = installInvitationRoutes(blocked.pool);
  const res = await invokeRoute(blockedApp.routes.get('POST').get('/api/coach/invitations/current'), {
    user: { user_id: 9, roles: ['coach'] }, body: {},
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'coach_capacity_unconfigured' });
  assert.equal(blocked.state.inserted, 0);
});

test('密钥缺失时服务可工作但不访问数据库创建或展示邀请', async () => {
  let dbCalls = 0;
  const app = installInvitationRoutes({
    async query() { dbCalls += 1; return { rows: [], rowCount: 0 }; },
    async connect() { dbCalls += 1; throw new Error('must not connect'); },
  }, null);
  const res = await invokeRoute(app.routes.get('POST').get('/api/coach/invitations/current'), {
    user: { user_id: 9, roles: ['coach'] }, body: {},
  });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'invite_encryption_not_configured' });
  assert.equal(dbCalls, 0);
});

test('邀请历史响应不包含 token、哈希或加密材料', async () => {
  const fixture = makeInvitationRoutePool({ history: [storedInvitation('history-invitation-token-not-returned')] });
  const app = installInvitationRoutes(fixture.pool);
  const res = await invokeRoute(app.routes.get('GET').get('/api/coach/invitations'), {
    user: { user_id: 9, roles: ['coach'] }, query: {},
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.stringify(res.body);
  for (const secret of ['token', 'token_hash', 'ciphertext', 'nonce', 'auth_tag']) assert.equal(body.includes(secret), false);
});

test('教练邀请历史同时返回当前名额状态，便于满额或未配置时解释原因', async () => {
  const fixture = makeInvitationRoutePool({ capacity: { tier_limit: 6, override_limit: 3, active_students: 2 } });
  const app = installInvitationRoutes(fixture.pool);
  const res = await invokeRoute(app.routes.get('GET').get('/api/coach/invitations'), {
    user: { user_id: 9, roles: ['coach'] }, query: {},
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.coachCapacity, { activeStudents: 2, maxStudents: 3, remaining: 1, canAccept: true });
  assert.equal(res.body.encryptionConfigured, true);
});

test('已登录学员接受邀请返回关系但不返回教练的替代码', async () => {
  const { client } = makeAcceptanceClient();
  const app = installInvitationRoutes({ connect: async () => client });
  const res = await invokeRoute(app.routes.get('POST').get('/api/coach/invitations/accept'), {
    user: { user_id: 3, roles: ['student'] }, body: { token: 'valid-invitation-token-value-12345' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.relationship.coachId, 9);
  assert.equal(JSON.stringify(res.body).includes('token'), false);
});

test('邀请接口遇到数据库错误时只返回通用错误，不泄露 SQLSTATE', async () => {
  const client = {
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      throw Object.assign(new Error('internal database detail'), { code: '42P01' });
    },
    release() {},
  };
  const app = installInvitationRoutes({ connect: async () => client });
  const res = await invokeRoute(app.routes.get('POST').get('/api/coach/invitations/current'), {
    user: { user_id: 9, roles: ['coach'] }, body: {},
  });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'db' });
});
