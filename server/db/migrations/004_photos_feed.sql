CREATE TABLE IF NOT EXISTS gym_profiles (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym_photos (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key UUID NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INT NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  privacy TEXT NOT NULL CHECK (privacy IN ('self', 'coach', 'public')),
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'withdrawn', 'removed')),
  caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 240),
  show_metrics BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by INT REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  moderation_note TEXT NOT NULL DEFAULT '',
  withdrawn_at TIMESTAMPTZ,
  CHECK ((moderation_status IN ('approved', 'rejected', 'removed') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND withdrawn_at IS NULL) OR
         (moderation_status = 'pending' AND withdrawn_at IS NULL) OR
         (moderation_status = 'withdrawn' AND withdrawn_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS gym_photos_user_history ON gym_photos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gym_photos_admin_queue ON gym_photos (moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS gym_photos_public_feed ON gym_photos (created_at DESC, id DESC)
  WHERE privacy = 'public' AND moderation_status = 'approved';

CREATE TABLE IF NOT EXISTS gym_photo_moderation_events (
  id BIGSERIAL PRIMARY KEY,
  photo_id BIGINT NOT NULL REFERENCES gym_photos(id) ON DELETE RESTRICT,
  actor_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('uploaded', 'approved', 'rejected', 'withdrawn', 'removed', 'privacy_changed')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_photo_moderation_history ON gym_photo_moderation_events (photo_id, created_at);

CREATE TABLE IF NOT EXISTS gym_photo_likes (
  photo_id BIGINT NOT NULL REFERENCES gym_photos(id) ON DELETE RESTRICT,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, user_id)
);
CREATE INDEX IF NOT EXISTS gym_photo_likes_by_user ON gym_photo_likes (user_id, created_at DESC);

INSERT INTO schema_migrations (version, applied_at)
VALUES ('004_photos_feed', now())
ON CONFLICT (version) DO NOTHING;
