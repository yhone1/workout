const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isSuperAdmin(user) {
  return Array.isArray(user?.roles) && user.roles.includes('superadmin');
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function hasActiveMembership({ grants, today }) {
  if (!isIsoDate(today) || !Array.isArray(grants)) return null;
  return grants.find((grant) => {
    const startsOn = grant.starts_on ?? grant.startsOn;
    const expiresOn = grant.expires_on ?? grant.expiresOn;
    const revokedAt = grant.revoked_at ?? grant.revokedAt ?? null;
    return !revokedAt
      && isIsoDate(startsOn)
      && isIsoDate(expiresOn)
      && startsOn <= expiresOn
      && startsOn <= today
      && expiresOn >= today;
  }) || null;
}

async function findActiveMembership(pool, userId) {
  const result = await pool.query(
    `SELECT id, user_id, starts_on::text AS starts_on, expires_on::text AS expires_on,
            granted_by, created_at, revoked_at, revoked_by, reason
     FROM membership_grants
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND starts_on <= (now() AT TIME ZONE 'Asia/Shanghai')::date
       AND expires_on >= (now() AT TIME ZONE 'Asia/Shanghai')::date
     ORDER BY expires_on DESC, id DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

function getAccessSnapshot({ user, grant = null }) {
  const superAdmin = isSuperAdmin(user);
  const membership = grant
    ? { active: true, startsOn: grant.starts_on ?? grant.startsOn, expiresOn: grant.expires_on ?? grant.expiresOn }
    : { active: false, startsOn: null, expiresOn: null };
  const entitled = superAdmin || membership.active;
  return {
    isSuperAdmin: superAdmin,
    membership,
    entitlements: { homeTraining: entitled, memberPlans: entitled },
  };
}

async function loadAccessSnapshot({ pool, user }) {
  const grant = isSuperAdmin(user) ? null : await findActiveMembership(pool, user.user_id);
  return getAccessSnapshot({ user, grant });
}

function requireMembership({ pool }) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (isSuperAdmin(req.user)) {
      req.user.isSuperAdmin = true;
      req.user.membership = null;
      return next();
    }
    try {
      const grant = await findActiveMembership(pool, req.user.user_id);
      if (!grant) return res.status(403).json({ error: 'membership_required' });
      req.user.membership = grant;
      return next();
    } catch (error) {
      console.error('membership access', error.message);
      return res.status(500).json({ error: 'db' });
    }
  };
}

module.exports = {
  findActiveMembership,
  getAccessSnapshot,
  hasActiveMembership,
  isSuperAdmin,
  loadAccessSnapshot,
  requireMembership,
};
