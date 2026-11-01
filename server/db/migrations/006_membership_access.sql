ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check CHECK (role IN ('student', 'coach', 'admin', 'superadmin'));

INSERT INTO user_roles (user_id, role, granted_by)
SELECT id, 'superadmin', id FROM users WHERE username = 'yhone'
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TABLE IF NOT EXISTS membership_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  starts_on DATE NOT NULL,
  expires_on DATE NOT NULL,
  granted_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by INT REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  CHECK (expires_on >= starts_on),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS membership_grants_by_user_dates
  ON membership_grants (user_id, starts_on, expires_on DESC);
CREATE INDEX IF NOT EXISTS membership_grants_active_by_user
  ON membership_grants (user_id, expires_on DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS membership_events (
  id BIGSERIAL PRIMARY KEY,
  grant_id BIGINT NOT NULL REFERENCES membership_grants(id) ON DELETE RESTRICT,
  actor_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('granted', 'revoked')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_events_by_grant
  ON membership_events (grant_id, created_at DESC, id DESC);

INSERT INTO schema_migrations (version, applied_at)
VALUES ('006_membership_access', now())
ON CONFLICT (version) DO NOTHING;
