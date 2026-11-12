const test = require('node:test');
const assert = require('node:assert/strict');

let createHomeAccess = null;
try { ({ createHomeAccess } = require('./home-access')); } catch {}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup({ token = 'token', profile, stateResponse, status = 200, fetchError, syncError, seed, now } = {}) {
  const storage = new Map([...(token ? [['thinMuscleAuthToken', token]] : []), ...(seed || [])]);
  const calls = [];
  const gates = [];
  const navigations = [];
  const access = createHomeAccess({
    windowRef: { location: { protocol: 'http:', origin: 'http://localhost:3001', replace: (url) => navigations.push(url) } },
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (fetchError) throw fetchError;
      return url === '/api/auth/me' ? response(profile, status) : response(stateResponse || {});
    },
    homeSync: {
      createHomeSync: () => ({
        prepareAccount: async () => {
          if (syncError) throw syncError;
          return { status: 'ready', userId: String(profile?.userId) };
        },
      }),
    },
    showGate: (message) => gates.push(message),
    clearPending: () => {},
    navigate: (url) => navigations.push(url),
    now: now || Date.now,
  });
  return { access, calls, gates, navigations, storage };
}

function accessCache(overrides = {}) {
  return JSON.stringify({
    version: 1,
    userId: '6',
    allowed: true,
    expiresOn: null,
    verifiedAt: Date.now(),
    ...overrides,
  });
}

test('home access module exposes a testable access bootstrap', () => {
  assert.equal(typeof createHomeAccess, 'function');
});

test('missing login returns to the central portal without requesting or exposing workout state', async () => {
  const { access, calls, navigations } = setup({ token: '' });
  const result = await access.bootstrap();
  assert.equal(result.allowed, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(navigations, ['/?returnTo=%2Fhome%2F']);
});

test('a logged-in account without home entitlement is blocked before legacy state is loaded', async () => {
  const { access, calls, gates } = setup({ profile: { userId: 4, entitlements: { homeTraining: false } } });
  const result = await access.bootstrap();
  assert.equal(result.allowed, false);
  assert.equal(calls.some(({ url }) => url === '/api/state'), false);
  assert.match(gates[0].message, /会员/);
});

test('authorized account is allowed only after owned state sync succeeds', async () => {
  const { access, calls } = setup({ profile: { userId: 6, entitlements: { homeTraining: true } } });
  const result = await access.bootstrap();
  assert.equal(result.allowed, true);
  assert.equal(result.userId, '6');
  assert.equal(calls.some(({ url }) => url === '/api/auth/me'), true);
});

test('regular administrator does not bypass membership while superadmin does', async () => {
  const ordinary = setup({ profile: { userId: 1, roles: ['admin'], entitlements: { homeTraining: false } } });
  assert.equal((await ordinary.access.bootstrap()).allowed, false);
  const superadmin = setup({ profile: { userId: 1, roles: ['superadmin'], entitlements: { homeTraining: false } } });
  assert.equal((await superadmin.access.bootstrap()).allowed, true);
});

test('membership denial or unavailable service cannot fall through to the workout UI', async () => {
  for (const options of [
    { profile: { userId: 7, entitlements: { homeTraining: true } }, syncError: Object.assign(new Error('membership_required'), { status: 403 }) },
    { profile: { userId: 7, entitlements: { homeTraining: true } }, fetchError: new Error('offline') },
  ]) {
    const { access } = setup(options);
    const result = await access.bootstrap();
    assert.equal(result.allowed, false);
  }
});

test('file URL never receives account entitlement and remains locked', async () => {
  const { createHomeAccess } = require('./home-access');
  const gates = [];
  const access = createHomeAccess({
    windowRef: { location: { protocol: 'file:', origin: 'null', replace() {} } },
    storage: { getItem() { throw new Error('must not read local data'); } },
    fetchImpl: async () => { throw new Error('must not fetch'); },
    showGate: (view) => gates.push(view),
  });
  const result = await access.bootstrap();
  assert.equal(result.allowed, false);
  assert.match(gates[0].message, /离线打开不会授予访问权限/);
});

test('successful verification records a bounded offline access cache', async () => {
  const { access, storage } = setup({
    profile: { userId: 6, entitlements: { homeTraining: true }, membership: { active: true, expiresOn: '2099-12-31' } },
  });
  assert.equal((await access.bootstrap()).allowed, true);
  const cached = JSON.parse(storage.get('thinMuscleHomeAccessV1'));
  assert.equal(cached.userId, '6');
  assert.equal(cached.allowed, true);
  assert.equal(cached.expiresOn, '2099-12-31');
  assert.ok(Number(cached.verifiedAt) > 0);
});

test('denied membership is cached as denied so offline cannot reuse an old grant', async () => {
  const { access, storage } = setup({
    token: 'token',
    profile: { userId: 6, entitlements: { homeTraining: false }, membership: { active: false } },
    seed: [['thinMuscleStateOwnerV1', '6']],
  });
  assert.equal((await access.bootstrap()).allowed, false);
  assert.equal(JSON.parse(storage.get('thinMuscleHomeAccessV1')).allowed, false);
  const offline = setup({
    fetchError: new Error('offline'),
    seed: [...storage].filter(([key]) => key !== 'thinMuscleAuthToken'),
  });
  assert.equal((await offline.access.bootstrap()).allowed, false);
});

test('offline fallback enters with a recent verification when local data belongs to the same account', async () => {
  const { access, calls, gates } = setup({
    fetchError: new Error('offline'),
    seed: [
      ['thinMuscleStateOwnerV1', '6'],
      ['thinMuscleHomeAccessV1', accessCache()],
    ],
  });
  const result = await access.bootstrap();
  assert.equal(result.allowed, true);
  assert.equal(result.offline, true);
  assert.equal(result.userId, '6');
  assert.equal(gates.some((view) => view.title === '暂时无法验证权限'), false);
  assert.deepEqual(calls.map(({ url }) => url), ['/api/auth/me']);
});

test('offline fallback refuses stale verification, expired membership, foreign local data or non-network errors', async () => {
  const old = setup({
    fetchError: new Error('offline'),
    seed: [['thinMuscleStateOwnerV1', '6'], ['thinMuscleHomeAccessV1', accessCache({ verifiedAt: Date.now() - 73 * 60 * 60 * 1000 })]],
  });
  assert.equal((await old.access.bootstrap()).allowed, false);

  const expired = setup({
    fetchError: new Error('offline'),
    seed: [['thinMuscleStateOwnerV1', '6'], ['thinMuscleHomeAccessV1', accessCache({ expiresOn: '2020-01-01' })]],
  });
  assert.equal((await expired.access.bootstrap()).allowed, false);

  const foreign = setup({
    fetchError: new Error('offline'),
    seed: [['thinMuscleStateOwnerV1', '7'], ['thinMuscleHomeAccessV1', accessCache()]],
  });
  assert.equal((await foreign.access.bootstrap()).allowed, false);

  const deniedByServer = setup({
    status: 403,
    profile: { error: 'forbidden' },
    seed: [['thinMuscleStateOwnerV1', '6'], ['thinMuscleHomeAccessV1', accessCache()]],
  });
  assert.equal((await deniedByServer.access.bootstrap()).allowed, false);
});

test('expired login clears the offline access cache', async () => {
  const { access, storage } = setup({
    status: 401,
    profile: { error: 'unauthorized' },
    seed: [['thinMuscleStateOwnerV1', '6'], ['thinMuscleHomeAccessV1', accessCache()]],
  });
  assert.equal((await access.bootstrap()).allowed, false);
  assert.equal(storage.has('thinMuscleHomeAccessV1'), false);
  assert.equal(storage.has('thinMuscleAuthToken'), false);
});

test('unowned legacy-data prompt waits for an explicit user choice before unlocking', async () => {
  const { createHomeAccess } = require('./home-access');
  const storage = new Map([['thinMuscleAuthToken', 'token']]);
  const gates = [];
  const imports = [];
  const access = createHomeAccess({
    windowRef: { location: { protocol: 'http:', origin: 'http://localhost:3001', replace() {} } },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    fetchImpl: async () => response({ userId: 15, entitlements: { homeTraining: true } }),
    homeSync: { createHomeSync: () => ({
      prepareAccount: async () => ({ status: 'legacy_import_confirmation', userId: '15', localValues: { thinMuscleDoneV8: 'old' } }),
      completeLegacyImport: async ({ importLegacy }) => { imports.push(importLegacy); return { status: 'ready', userId: '15', imported: importLegacy }; },
    }) },
    showGate: (view) => gates.push(view),
    clearPending: () => {},
    navigate: () => {},
  });
  const pending = access.bootstrap();
  await new Promise((resolve) => setImmediate(resolve));
  const choice = gates.find((view) => view.title === '发现未归属账号的旧训练数据');
  assert.ok(choice);
  assert.deepEqual(imports, []);
  choice.actions[1].onClick();
  const result = await pending;
  assert.equal(result.allowed, true);
  assert.deepEqual(imports, [false]);
});
