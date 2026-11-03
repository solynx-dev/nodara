-- Bubbles: for a while, a person's circles see only a general area instead of
-- their exact location. Ended bubbles are kept so the time inside them stays
-- hidden from history, trips and place events for those circles.
CREATE TABLE bubbles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Centre shown to circles: a random point near the person, not where they are.
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  radius_m    integer NOT NULL CHECK (radius_m BETWEEN 500 AND 100000),
  label       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  end_reason  text CHECK (end_reason IN ('ended', 'expired', 'left_area', 'replaced'))
);
CREATE INDEX bubbles_user_idx ON bubbles(user_id, started_at DESC);
CREATE INDEX bubbles_open_idx ON bubbles(expires_at) WHERE ended_at IS NULL;
