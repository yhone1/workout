const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePhotoData, canReadPhoto, photoResponse, mountPhotoFeedRoutes } = require('./photos-feed');

test('图像 MIME 由文件签名判定，不信任上传声明', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0]);
  assert.equal(parsePhotoData(png.toString('base64')).mime, 'image/png');
  assert.throws(() => parsePhotoData(Buffer.from('<svg></svg>').toString('base64')), { message: 'unsupported_photo_type' });
});

test('上传超过 5 MB 的图片会被拒绝', () => {
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString('base64');
  assert.throws(() => parsePhotoData(oversized), { message: 'photo_too_large' });
});

test('照片读取遵守撤回、私密和教练授权范围', async () => {
  const pool = { query: async (_sql, args) => ({ rowCount: args[0] === 9 && args[1] === 7 ? 1 : 0 }) };
  const pending = { user_id: 7, privacy: 'self', moderation_status: 'pending' };
  assert.equal(await canReadPhoto(pool, pending, { user_id: 7, roles: ['student'] }), true);
  assert.equal(await canReadPhoto(pool, pending, { user_id: 8, roles: ['student'] }), false);
  assert.equal(await canReadPhoto(pool, { ...pending, moderation_status: 'withdrawn' }, { user_id: 7, roles: ['student'] }), false);
  assert.equal(await canReadPhoto(pool, { ...pending, privacy: 'public', moderation_status: 'approved' }, { user_id: 8, roles: ['student'] }), true);
  assert.equal(await canReadPhoto(pool, { ...pending, privacy: 'coach', moderation_status: 'approved' }, { user_id: 9, roles: ['coach'] }), true);
});

test('仅有 superadmin 角色也能查看私密待审和已移除照片，普通账号仍无权查看', async () => {
  const pool = { query: async () => { throw new Error('admin_read_needs_no_coach_lookup'); } };
  for (const status of ['pending', 'rejected', 'removed']) {
    const photo = { user_id: 7, privacy: 'self', moderation_status: status };
    for (const role of ['admin', 'superadmin']) assert.equal(await canReadPhoto(pool, photo, { user_id: 1, roles: [role] }), true);
    assert.equal(await canReadPhoto(pool, photo, { user_id: 8, roles: ['student'] }), false);
  }
});

test('图片接口向超级管理员提供审核图片，撤回照片和普通账号仍被拒绝', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { PassThrough } = require('node:stream');
  const { once } = require('node:events');
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thin-muscle-photo-test-'));
  t.after(() => { fs.unlinkSync(path.join(privateRoot, 'test-photo.png')); fs.rmdirSync(privateRoot); });
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(path.join(privateRoot, 'test-photo.png'), bytes);
  for (const [role, status, expected] of [['superadmin', 'pending', 200], ['superadmin', 'removed', 200], ['admin', 'pending', 200], ['superadmin', 'withdrawn', 404], ['student', 'pending', 404]]) {
    const routes = new Map();
    const app = { get(route, ...handlers) { routes.set(route, handlers); }, post() {}, patch() {}, put() {} };
    mountPhotoFeedRoutes(app, { privateRoot, auth: (_req, _res, next) => next(), pool: { query: async () => ({ rowCount: 1, rows: [{ user_id: 7, privacy: 'self', moderation_status: status, mime_type: 'image/png', storage_key: 'test-photo', byte_size: bytes.length }] }) } });
    const res = new PassThrough();
    res.statusCode = 200; res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.end(); return res; };
    res.set = (headers) => { res.headers = headers; return res; };
    const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
    const finished = once(res, 'finish');
    const stack = routes.get('/api/gym/photos/:id/image');
    let index = 0;
    const req = { user: { user_id: 1, roles: [role] }, params: { id: '3' } };
    const next = () => { const handler = stack[index++]; return handler?.(req, res, next); };
    await next(); await finished;
    assert.equal(res.statusCode, expected, `${role}/${status}`);
    if (expected === 200) { assert.deepEqual(Buffer.concat(chunks), bytes); assert.equal(res.headers['Cache-Control'], 'private, no-store'); }
  }
});

test('照片公开响应不泄漏内部用户 ID，身体数据仅在用户选择展示时返回', () => {
  const row = {
    id: 3, user_id: 77, display_name: '训练伙伴', privacy: 'public', moderation_status: 'approved',
    show_metrics: false, weight_kg: 72.5, waist_cm: 84, body_fat_pct: null,
  };
  const hidden = photoResponse(row);
  assert.equal(Object.hasOwn(hidden, 'userId'), false);
  assert.equal(hidden.metricSnapshot, null);
  const visible = photoResponse({ ...row, show_metrics: true });
  assert.deepEqual(visible.metricSnapshot, { weightKg: 72.5, waistCm: 84, bodyFatPct: null });
});
