ALTER TABLE member_plans
  DROP CONSTRAINT IF EXISTS member_plans_split_type_check;

ALTER TABLE member_plans
  ADD CONSTRAINT member_plans_split_type_check
  CHECK (split_type IN ('ppl', 'upper_lower', 'five_day', 'custom'));

INSERT INTO schema_migrations (version, applied_at)
VALUES ('011_member_custom_plans', now())
ON CONFLICT (version) DO NOTHING;
