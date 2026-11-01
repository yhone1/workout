const test = require('node:test');
const assert = require('node:assert/strict');

let view = null;
try {
  view = require('./capacity-view');
} catch {
  // First run should fail on the missing view helpers, not module loading.
}

test('只有 superadmin 可以显示并管理全局教练名额', () => {
  assert.ok(view, 'capacity view helper should load');
  assert.equal(view.canManageCapacity(['superadmin']), true);
  assert.equal(view.canManageCapacity(['admin']), false);
  assert.equal(view.canManageCapacity(['coach', 'student']), false);
  assert.equal(view.canManageCapacity([]), false);
});

test('名额状态按密钥、未配置、满额、可招收顺序计算', () => {
  assert.ok(view, 'capacity view helper should load');
  assert.deepEqual(view.getCoachCapacityView({ activeStudents: 2, maxStudents: 8, encryptionConfigured: false }), {
    status: 'key_missing', activeStudents: 2, maxStudents: 8, remaining: 6, canInvite: false,
  });
  assert.deepEqual(view.getCoachCapacityView({ activeStudents: 0, maxStudents: null, encryptionConfigured: true }), {
    status: 'unconfigured', activeStudents: 0, maxStudents: null, remaining: 0, canInvite: false,
  });
  assert.deepEqual(view.getCoachCapacityView({ activeStudents: 4, maxStudents: 4, encryptionConfigured: true }), {
    status: 'full', activeStudents: 4, maxStudents: 4, remaining: 0, canInvite: false,
  });
  assert.deepEqual(view.getCoachCapacityView({ activeStudents: 3, maxStudents: 5, encryptionConfigured: true }), {
    status: 'ready', activeStudents: 3, maxStudents: 5, remaining: 2, canInvite: true,
  });
});
