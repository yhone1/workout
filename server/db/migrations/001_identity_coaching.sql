CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student', 'coach', 'admin')),
  granted_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

INSERT INTO user_roles (user_id, role)
SELECT id, 'student' FROM users
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO user_roles (user_id, role, granted_by)
SELECT id, 'admin', id FROM users WHERE username = 'yhone'
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TABLE IF NOT EXISTS coach_student_relationships (
  id BIGSERIAL PRIMARY KEY,
  coach_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  student_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (coach_id <> student_id),
  CHECK ((status = 'active' AND ended_at IS NULL) OR (status = 'ended' AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_student_one_active_coach_per_student
  ON coach_student_relationships (student_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS coach_student_by_coach_status
  ON coach_student_relationships (coach_id, status, student_id);

CREATE TABLE IF NOT EXISTS coach_invitations (
  id BIGSERIAL PRIMARY KEY,
  coach_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by INT REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK ((accepted_by IS NULL AND accepted_at IS NULL) OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS coach_invitations_by_coach
  ON coach_invitations (coach_id, created_at DESC);

INSERT INTO schema_migrations (version, applied_at)
VALUES ('001_identity_coaching', now())
ON CONFLICT (version) DO NOTHING;
