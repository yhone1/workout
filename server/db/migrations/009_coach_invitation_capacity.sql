CREATE TABLE IF NOT EXISTS coach_capacity_tiers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  max_students INTEGER NOT NULL CHECK (max_students >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_capacity_tiers_name_ci
  ON coach_capacity_tiers (lower(name));

CREATE TABLE IF NOT EXISTS coach_capacity_settings (
  coach_id INT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  tier_id BIGINT REFERENCES coach_capacity_tiers(id) ON DELETE RESTRICT,
  max_students_override INTEGER CHECK (max_students_override IS NULL OR max_students_override >= 0),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coach_capacity_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  coach_id INT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_capacity_events_recent
  ON coach_capacity_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS coach_capacity_events_by_coach
  ON coach_capacity_events (coach_id, created_at DESC, id DESC);

ALTER TABLE coach_invitations
  ADD COLUMN IF NOT EXISTS token_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS token_nonce BYTEA,
  ADD COLUMN IF NOT EXISTS token_auth_tag BYTEA,
  ADD COLUMN IF NOT EXISTS token_key_version SMALLINT,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'coach_invitations_ciphertext_fields_complete'
      AND conrelid = 'coach_invitations'::regclass
  ) THEN
    ALTER TABLE coach_invitations
      ADD CONSTRAINT coach_invitations_ciphertext_fields_complete CHECK (
        (token_ciphertext IS NULL AND token_nonce IS NULL AND token_auth_tag IS NULL AND token_key_version IS NULL)
        OR
        (token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL AND token_auth_tag IS NOT NULL AND token_key_version IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS coach_invitations_one_current_per_coach
  ON coach_invitations (coach_id)
  WHERE is_current AND accepted_at IS NULL AND revoked_at IS NULL;

INSERT INTO schema_migrations (version, applied_at)
VALUES ('009_coach_invitation_capacity', now())
ON CONFLICT (version) DO NOTHING;
