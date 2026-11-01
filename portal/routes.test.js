const test = require('node:test');
const assert = require('node:assert/strict');

let routes = null;
try {
  routes = require('./routes');
} catch {
  // Keep the first red run assertion-based until the route helper is implemented.
}

test('portal return helpers are implemented', () => {
  assert.ok(routes, 'portal route helpers should load');
  assert.equal(typeof routes.sanitizeReturnTo, 'function');
  assert.equal(typeof routes.buildPortalUrl, 'function');
});

test('only known local destinations are accepted unchanged', () => {
  assert.ok(routes, 'portal route helpers should load');
  for (const path of ['/', '/home/', '/gym/', '/member/']) {
    assert.equal(routes.sanitizeReturnTo(path), path);
  }
});

test('external, protocol-relative, traversal, backslash, and unknown destinations fall back to portal', () => {
  assert.ok(routes, 'portal route helpers should load');
  for (const target of [
    'https://attacker.example/', '//attacker.example/', '/gym/../home/', '/gym/%2e%2e/home/',
    '/gym%2f..%2fhome/', '\\\\attacker.example\\\\', '/admin/', '', null,
  ]) {
    assert.equal(routes.sanitizeReturnTo(target), '/', String(target));
  }
});

test('invite token survives the portal return hop without becoming a redirect target', () => {
  assert.ok(routes, 'portal route helpers should load');
  const location = routes.buildPortalUrl('/gym/', 'token+with/safe?chars');
  const parsed = new URL(location, 'http://local.test');
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.searchParams.get('returnTo'), '/gym/');
  assert.equal(new URLSearchParams(parsed.hash.slice(1)).get('invite'), 'token+with/safe?chars');
});

test('邀请解析接受本站完整链接、本站路径片段和兼容的裸 token', () => {
  assert.ok(routes, 'portal route helpers should load');
  assert.equal(typeof routes.extractInviteToken, 'function');
  const token = 'AbCdEf0123456789_-'.repeat(2);
  const origin = 'https://thin-muscle.example';
  assert.equal(routes.extractInviteToken(`${origin}/?returnTo=%2Fgym%2F#invite=${token}`, origin), token);
  assert.equal(routes.extractInviteToken(`/gym/#invite=${token}`, origin), token);
  assert.equal(routes.extractInviteToken(token, origin), token);
});

test('邀请解析拒绝异站、畸形、缺失或非法 token', () => {
  assert.ok(routes, 'portal route helpers should load');
  assert.equal(typeof routes.extractInviteToken, 'function');
  const token = 'AbCdEf0123456789_-'.repeat(2);
  const origin = 'https://thin-muscle.example';
  for (const value of [
    `https://attacker.example/?invite=${token}#invite=${token}`,
    'http://[',
    `${origin}/#invite=`,
    `${origin}/#invite=too-short`,
    `${origin}/#invite=${token}!`,
    '', null,
  ]) {
    assert.equal(routes.extractInviteToken(value, origin), null, String(value));
  }
});
