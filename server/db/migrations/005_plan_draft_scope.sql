DROP INDEX IF EXISTS gym_plans_one_draft_per_student;
CREATE UNIQUE INDEX IF NOT EXISTS gym_plans_one_draft_per_coach_student
  ON gym_plans (student_id, coach_id) WHERE status = 'draft';

INSERT INTO schema_migrations (version, applied_at)
VALUES ('005_plan_draft_scope', now())
ON CONFLICT (version) DO NOTHING;
