(function exposeGymCapacityView(root, createApi) {
  const api = createApi();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GymCapacityView = api;
})(globalThis, () => {
  function canManageCapacity(roles) {
    return Array.isArray(roles) && roles.includes('superadmin');
  }

  function getCoachCapacityView({ activeStudents = 0, maxStudents = null, encryptionConfigured = false } = {}) {
    const active = Number.isSafeInteger(activeStudents) && activeStudents >= 0 ? activeStudents : 0;
    const max = Number.isSafeInteger(maxStudents) && maxStudents >= 0 ? maxStudents : null;
    const remaining = max === null ? 0 : Math.max(0, max - active);
    const status = !encryptionConfigured ? 'key_missing'
      : max === null ? 'unconfigured'
        : active >= max ? 'full' : 'ready';
    return {
      status,
      activeStudents: active,
      maxStudents: max,
      remaining,
      canInvite: status === 'ready',
    };
  }

  return { canManageCapacity, getCoachCapacityView };
});
