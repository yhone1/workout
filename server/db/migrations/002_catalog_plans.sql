CREATE TABLE IF NOT EXISTS gym_exercises (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  primary_muscle TEXT NOT NULL,
  primary_muscle_zh TEXT NOT NULL,
  secondary_muscles JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(secondary_muscles) = 'array'),
  secondary_muscles_zh JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(secondary_muscles_zh) = 'array'),
  equipment TEXT NOT NULL,
  equipment_zh TEXT NOT NULL,
  body_part TEXT NOT NULL,
  category TEXT NOT NULL,
  split_tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(split_tags) = 'array'),
  cue_zh TEXT NOT NULL DEFAULT '',
  source_file TEXT,
  media_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_exercises_muscle_active ON gym_exercises (primary_muscle, is_active);
CREATE INDEX IF NOT EXISTS gym_exercises_equipment_active ON gym_exercises (equipment, is_active);
CREATE INDEX IF NOT EXISTS gym_exercises_split_tags ON gym_exercises USING GIN (split_tags);

CREATE TABLE IF NOT EXISTS gym_templates (
  code TEXT PRIMARY KEY,
  split_type TEXT NOT NULL CHECK (split_type IN ('ppl', 'upper_lower', 'five_day')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym_plans (
  id BIGSERIAL PRIMARY KEY,
  coach_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  student_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  template_code TEXT REFERENCES gym_templates(code) ON DELETE SET NULL,
  split_type TEXT NOT NULL CHECK (split_type IN ('ppl', 'upper_lower', 'five_day')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version_no INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coach_id <> student_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS gym_plans_one_active_per_student
  ON gym_plans (student_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS gym_plans_one_draft_per_student
  ON gym_plans (student_id) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS gym_plans_by_coach_student ON gym_plans (coach_id, student_id, status);

CREATE TABLE IF NOT EXISTS gym_plan_versions (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES gym_plans(id) ON DELETE RESTRICT,
  version_no INT NOT NULL CHECK (version_no > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (plan_id, version_no),
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS gym_plan_versions_one_draft
  ON gym_plan_versions (plan_id) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS gym_plan_versions_latest
  ON gym_plan_versions (plan_id, version_no DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_plans_current_version_fk') THEN
    ALTER TABLE gym_plans ADD CONSTRAINT gym_plans_current_version_fk
      FOREIGN KEY (id, current_version_no)
      REFERENCES gym_plan_versions (plan_id, version_no)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

INSERT INTO schema_migrations (version, applied_at)
VALUES ('002_catalog_plans', now())
ON CONFLICT (version) DO NOTHING;
