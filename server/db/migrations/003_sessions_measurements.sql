CREATE TABLE IF NOT EXISTS gym_sessions (
  id BIGSERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  coach_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id BIGINT NOT NULL REFERENCES gym_plans(id) ON DELETE RESTRICT,
  plan_version_id BIGINT NOT NULL REFERENCES gym_plan_versions(id) ON DELETE RESTRICT,
  day_no INT NOT NULL CHECK (day_no > 0),
  day_name TEXT NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coach_id <> student_id),
  CHECK ((status = 'draft' AND ended_at IS NULL) OR (status <> 'draft' AND ended_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS gym_sessions_student_history ON gym_sessions (student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS gym_sessions_coach_student ON gym_sessions (coach_id, student_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS gym_sessions_one_open_per_student ON gym_sessions (student_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS gym_session_sets (
  session_id BIGINT NOT NULL REFERENCES gym_sessions(id) ON DELETE RESTRICT,
  exercise_index INT NOT NULL CHECK (exercise_index >= 0),
  set_no INT NOT NULL CHECK (set_no > 0),
  exercise_slug TEXT NOT NULL,
  exercise_name_zh TEXT NOT NULL,
  target_weight NUMERIC(7,2) CHECK (target_weight IS NULL OR target_weight >= 0),
  target_rep_min INT NOT NULL CHECK (target_rep_min > 0),
  target_rep_max INT NOT NULL CHECK (target_rep_max >= target_rep_min),
  target_rir INT NOT NULL CHECK (target_rir BETWEEN 0 AND 5),
  actual_weight NUMERIC(7,2) CHECK (actual_weight IS NULL OR actual_weight >= 0),
  actual_reps INT CHECK (actual_reps IS NULL OR actual_reps BETWEEN 0 AND 300),
  actual_rir INT CHECK (actual_rir IS NULL OR actual_rir BETWEEN 0 AND 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped', 'replaced')),
  replacement_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, exercise_index, set_no),
  CHECK ((status = 'replaced' AND replacement_name IS NOT NULL AND length(replacement_name) > 0) OR status <> 'replaced')
);
CREATE INDEX IF NOT EXISTS gym_session_sets_exercise ON gym_session_sets (exercise_slug, session_id);

CREATE TABLE IF NOT EXISTS gym_session_set_audit (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL,
  exercise_index INT NOT NULL,
  set_no INT NOT NULL,
  changed_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  before_value JSONB,
  after_value JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, exercise_index, set_no)
    REFERENCES gym_session_sets(session_id, exercise_index, set_no) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS gym_session_set_audit_history ON gym_session_set_audit (session_id, changed_at);

CREATE TABLE IF NOT EXISTS gym_progression_suggestions (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES gym_sessions(id) ON DELETE RESTRICT,
  student_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  coach_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  exercise_slug TEXT NOT NULL,
  exercise_name_zh TEXT NOT NULL,
  suggestion JSONB NOT NULL CHECK (jsonb_typeof(suggestion) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  decided_by INT REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'pending' AND decided_at IS NULL) OR (status <> 'pending' AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS gym_progression_coach_queue ON gym_progression_suggestions (coach_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS gym_measurements (
  id BIGSERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entered_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('initial', 'followup')),
  weight_kg NUMERIC(6,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 15 AND 500),
  waist_cm NUMERIC(6,2) CHECK (waist_cm IS NULL OR waist_cm BETWEEN 30 AND 300),
  body_fat_pct NUMERIC(5,2) CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 2 AND 70),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending_student_confirmation', 'confirmed')),
  confirmed_by INT REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (weight_kg IS NOT NULL OR waist_cm IS NOT NULL OR body_fat_pct IS NOT NULL),
  CHECK ((entry_type = 'initial' AND status IN ('pending_student_confirmation', 'confirmed')) OR (entry_type = 'followup' AND status = 'confirmed')),
  CHECK ((status = 'pending_student_confirmation' AND confirmed_by IS NULL AND confirmed_at IS NULL) OR
         (status = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS gym_measurements_one_initial ON gym_measurements (student_id) WHERE entry_type = 'initial';
CREATE INDEX IF NOT EXISTS gym_measurements_history ON gym_measurements (student_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS gym_measurement_events (
  id BIGSERIAL PRIMARY KEY,
  measurement_id BIGINT NOT NULL REFERENCES gym_measurements(id) ON DELETE RESTRICT,
  actor_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION gym_protect_confirmed_initial_measurement() RETURNS trigger AS $$
BEGIN
  IF OLD.entry_type = 'initial' AND OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed_initial_measurement_is_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gym_measurement_initial_immutable ON gym_measurements;
CREATE TRIGGER gym_measurement_initial_immutable
  BEFORE UPDATE OR DELETE ON gym_measurements
  FOR EACH ROW EXECUTE FUNCTION gym_protect_confirmed_initial_measurement();

INSERT INTO schema_migrations (version, applied_at)
VALUES ('003_sessions_measurements', now())
ON CONFLICT (version) DO NOTHING;
