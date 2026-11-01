(function exposePortalRoutes(root, createApi) {
  const api = createApi();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PortalRoutes = api;
})(globalThis, () => {
  const destinations = new Set(['/', '/home/', '/gym/', '/member/']);

  function sanitizeReturnTo(value) {
    return typeof value === 'string' && destinations.has(value) ? value : '/';
  }

  function buildPortalUrl(returnTo = '/gym/', inviteToken = '') {
    const params = new URLSearchParams({ returnTo: sanitizeReturnTo(returnTo) });
    const invite = String(inviteToken || '').trim();
    return `/?${params.toString()}${invite ? `#invite=${encodeURIComponent(invite)}` : ''}`;
  }

  function extractInviteToken(value, origin) {
    if (typeof value !== 'string' || typeof origin !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    let base;
    try {
      base = new URL(origin);
    } catch {
      return null;
    }
    if (!['http:', 'https:'].includes(base.protocol) || base.origin === 'null') return null;

    const isValidToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);
    if (isValidToken(raw)) return raw;

    try {
      const inviteUrl = new URL(raw, base.origin);
      if (inviteUrl.origin !== base.origin) return null;
      const token = new URLSearchParams(inviteUrl.hash.slice(1)).get('invite');
      return isValidToken(token) ? token : null;
    } catch {
      return null;
    }
  }

  return { sanitizeReturnTo, buildPortalUrl, extractInviteToken };
});
