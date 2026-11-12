CREATE TABLE IF NOT EXISTS ai_coach_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_coach_messages_user_created
  ON ai_coach_messages (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_coach_reviews (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_coach_reviews_user_created
  ON ai_coach_reviews (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_coach_proposals (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  operations JSONB NOT NULL,
  base_revision INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_coach_proposals_user_created
  ON ai_coach_proposals (user_id, created_at DESC, id DESC);
