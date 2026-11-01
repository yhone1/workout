ALTER TABLE gym_plans DROP CONSTRAINT IF EXISTS gym_plans_split_type_check;
ALTER TABLE gym_plans
  ADD CONSTRAINT gym_plans_split_type_check
  CHECK (split_type IN ('ppl', 'upper_lower', 'five_day', 'custom'));

INSERT INTO schema_migrations (version, applied_at)
VALUES ('010_custom_coach_plans', now())
ON CONFLICT (version) DO NOTHING;
