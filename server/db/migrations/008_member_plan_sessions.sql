ALTER TABLE gym_sessions ALTER COLUMN coach_id DROP NOT NULL;
ALTER TABLE gym_sessions ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE gym_sessions ALTER COLUMN plan_version_id DROP NOT NULL;

ALTER TABLE gym_sessions ADD COLUMN IF NOT EXISTS member_plan_id BIGINT;
ALTER TABLE gym_sessions ADD COLUMN IF NOT EXISTS member_plan_version_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_sessions_single_plan_origin') THEN
    ALTER TABLE gym_sessions ADD CONSTRAINT gym_sessions_single_plan_origin CHECK (
      (coach_id IS NOT NULL AND plan_id IS NOT NULL AND plan_version_id IS NOT NULL
        AND member_plan_id IS NULL AND member_plan_version_id IS NULL AND coach_id <> student_id)
      OR
      (coach_id IS NULL AND plan_id IS NULL AND plan_version_id IS NULL
        AND member_plan_id IS NOT NULL AND member_plan_version_id IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_sessions_member_plan_version_fk') THEN
    ALTER TABLE gym_sessions ADD CONSTRAINT gym_sessions_member_plan_version_fk
      FOREIGN KEY (member_plan_id,member_plan_version_id)
      REFERENCES member_plan_versions (plan_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS gym_member_sessions_history
  ON gym_sessions (student_id, started_at DESC) WHERE member_plan_id IS NOT NULL;

INSERT INTO schema_migrations (version, applied_at)
VALUES ('008_member_plan_sessions', now())
ON CONFLICT (version) DO NOTHING;
