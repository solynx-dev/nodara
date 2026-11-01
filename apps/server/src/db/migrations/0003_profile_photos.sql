-- Profile photos. Stored in the database so they are covered by the same
-- backups as everything else; users.avatar_url points at the versioned URL.
CREATE TABLE user_avatars (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime       text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  data       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
