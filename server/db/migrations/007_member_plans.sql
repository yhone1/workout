CREATE TABLE IF NOT EXISTS member_plans (
  id BIGSERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  split_type TEXT NOT NULL CHECK (split_type IN ('ppl', 'upper_lower', 'five_day')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  draft_content JSONB NOT NULL CHECK (jsonb_typeof(draft_content) = 'object'),
  current_version_no INT CHECK (current_version_no IS NULL OR current_version_no > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_plans_owner_updated
  ON member_plans (owner_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS member_plan_versions (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES member_plans(id) ON DELETE RESTRICT,
  version_no INT NOT NULL CHECK (version_no > 0),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_no),
  UNIQUE (plan_id, id)
);
CREATE INDEX IF NOT EXISTS member_plan_versions_history
  ON member_plan_versions (plan_id, version_no DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_plans_current_version_fk') THEN
    ALTER TABLE member_plans ADD CONSTRAINT member_plans_current_version_fk
      FOREIGN KEY (id, current_version_no)
      REFERENCES member_plan_versions (plan_id, version_no)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION member_plan_version_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'member_plan_versions_are_immutable';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_plan_version_immutable_trigger ON member_plan_versions;
CREATE TRIGGER member_plan_version_immutable_trigger
  BEFORE UPDATE OR DELETE ON member_plan_versions
  FOR EACH ROW EXECUTE FUNCTION member_plan_version_immutable();

INSERT INTO schema_migrations (version, applied_at)
VALUES ('007_member_plans', now())
ON CONFLICT (version) DO NOTHING;
