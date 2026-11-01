const test = require('node:test');
const assert = require('node:assert/strict');

let createHomeAccess = null;
try { ({ createHomeAccess } = require('./home-access')); } catch {}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup({ token = 'token', profile, stateResponse, status = 200, fetchError, syncError } = {}) {
  const storage = new Map(token ? [['thinMuscleAuthToken', token]] : []);
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
  });
  return { access, calls, gates, navigations, storage };
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
