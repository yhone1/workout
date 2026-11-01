const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('./identity-coaching');

let access = null;
try {
  access = require('./membership-access');
} catch {
  // Keep the first red run an assertion failure when the production module is absent.
}

async function invoke(guard, user, pool = { query: async () => ({ rows: [] }) }) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let nextCalls = 0;
  await guard({ user, membership: null }, res, () => { nextCalls += 1; });
  return { res, nextCalls };
}

test('superadmin passes role guards while ordinary users do not gain implicit roles', async () => {
  const superadmin = await invoke(requireRole('admin'), { user_id: 1, roles: ['superadmin'] });
  assert.equal(superadmin.nextCalls, 1);
  const ordinary = await invoke(requireRole('admin'), { user_id: 2, roles: ['student'] });
  assert.equal(ordinary.res.statusCode, 403);
  assert.deepEqual(ordinary.res.body, { error: 'forbidden' });
});

test('membership access module exposes the planned helpers', () => {
  assert.ok(access, 'membership-access module should load');
  assert.equal(typeof access.isSuperAdmin, 'function');
  assert.equal(typeof access.hasActiveMembership, 'function');
  assert.equal(typeof access.requireMembership, 'function');
  assert.equal(typeof access.getAccessSnapshot, 'function');
});

test('membership is valid on both boundary dates and invalid before or after', () => {
  assert.ok(access, 'membership-access module should load');
  const grant = { starts_on: '2026-09-01', expires_on: '2026-09-29', revoked_at: null };
  assert.equal(access.hasActiveMembership({ grants: [grant], today: '2026-09-01' }), grant);
  assert.equal(access.hasActiveMembership({ grants: [grant], today: '2026-09-29' }), grant);
  assert.equal(access.hasActiveMembership({ grants: [grant], today: '2026-08-31' }), null);
  assert.equal(access.hasActiveMembership({ grants: [grant], today: '2026-09-30' }), null);
});

test('revoked and malformed-date grants never confer membership', () => {
  assert.ok(access, 'membership-access module should load');
  assert.equal(access.hasActiveMembership({
    grants: [{ starts_on: '2026-09-01', expires_on: '2026-09-30', revoked_at: '2026-09-02T00:00:00Z' }],
    today: '2026-09-10',
  }), null);
  assert.equal(access.hasActiveMembership({
    grants: [{ starts_on: '2026-99-01', expires_on: '2026-09-30', revoked_at: null }],
    today: '2026-09-10',
  }), null);
});

test('superadmin membership guard bypasses the database and gets every entitlement', async () => {
  assert.ok(access, 'membership-access module should load');
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: [] }; } };
  const user = { user_id: 1, username: 'yhone', roles: ['admin', 'superadmin'] };
  const guard = access.requireMembership({ pool });
  const result = await invoke(guard, user, pool);
  assert.equal(result.nextCalls, 1);
  assert.equal(queries, 0);
  assert.deepEqual(access.getAccessSnapshot({ user, grant: null }), {
    isSuperAdmin: true,
    membership: { active: false, startsOn: null, expiresOn: null },
    entitlements: { homeTraining: true, memberPlans: true },
  });
});

test('membership guard denies unentitled accounts without proceeding', async () => {
  assert.ok(access, 'membership-access module should load');
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: [] }; } };
  const result = await invoke(access.requireMembership({ pool }), { user_id: 22, roles: ['student'] }, pool);
  assert.equal(queries, 1);
  assert.equal(result.nextCalls, 0);
  assert.equal(result.res.statusCode, 403);
  assert.deepEqual(result.res.body, { error: 'membership_required' });
});

test('membership guard attaches a current grant for an entitled account', async () => {
  assert.ok(access, 'membership-access module should load');
  const grant = { id: 4, starts_on: '2026-09-01', expires_on: '2026-10-01', revoked_at: null };
  const pool = { query: async () => ({ rows: [grant] }) };
  const user = { user_id: 7, roles: ['student'] };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let nextCalls = 0;
  await access.requireMembership({ pool })({ user, membership: null }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.deepEqual(user.membership, grant);
});
