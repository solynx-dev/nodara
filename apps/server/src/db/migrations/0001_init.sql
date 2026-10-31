-- Nodara initial schema.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- System-wide settings editable by administrators (key/value JSON).
CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Users & authentication
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  display_name      text NOT NULL,
  password_hash     text,
  email_verified_at timestamptz,
  is_admin          boolean NOT NULL DEFAULT false,
  is_demo           boolean NOT NULL DEFAULT false,
  disabled_at       timestamptz,
  avatar_color      text NOT NULL DEFAULT '#FF7A45',
  avatar_url        text,
  sharing_paused    boolean NOT NULL DEFAULT false,
  totp_secret       text,
  totp_enabled_at   timestamptz,
  recovery_codes    text[] NOT NULL DEFAULT '{}',
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  -- 'pending_2fa' sessions only grant access to the 2FA challenge endpoint.
  state         text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending_2fa')),
  user_agent    text,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- One-time tokens for email verification, password reset, etc. Only hashes are stored.
CREATE TABLE auth_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'admin_invite')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens(user_id);

CREATE TABLE passkeys (
  id             text PRIMARY KEY, -- base64url credential id
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key     bytea NOT NULL,
  counter        bigint NOT NULL DEFAULT 0,
  transports     text[] NOT NULL DEFAULT '{}',
  name           text NOT NULL DEFAULT 'Passkey',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys(user_id);

-- Short-lived WebAuthn challenges.
CREATE TABLE webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  challenge   text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('register', 'login')),
  expires_at  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Devices: anything that reports locations (a browser/PWA install, a native
-- app, OwnTracks, Overland...). Devices authenticate ingestion with a token.
CREATE TABLE devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'ios', 'android', 'owntracks', 'overland', 'other')),
  token_hash      text UNIQUE,
  token_hint      text,
  push_subscription jsonb,
  last_seen_at    timestamptz,
  last_location_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  offline_notified_at timestamptz,
  -- Incremental trip-detection state (see services/trips.ts).
  trip_state      jsonb
);
CREATE INDEX devices_user_idx ON devices(user_id);

-- ---------------------------------------------------------------------------
-- Circles
CREATE TABLE circles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#FF7A45',
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE circle_members (
  circle_id       uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  sharing         boolean NOT NULL DEFAULT true,
  -- Others in the circle can only see this member's history from this moment on.
  sharing_since   timestamptz NOT NULL DEFAULT now(),
  notify_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX circle_members_user_idx ON circle_members(user_id);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id   uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  max_uses    int NOT NULL DEFAULT 1,
  uses        int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_circle_idx ON invitations(circle_id);

-- ---------------------------------------------------------------------------
-- Locations: the high-volume table. lat/lon are kept as plain columns for fast
-- reads; geog is a generated PostGIS geography for spatial queries.
CREATE TABLE locations (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     uuid REFERENCES devices(id) ON DELETE SET NULL,
  recorded_at   timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  lat           double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon           double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  geog          geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  accuracy      real,
  altitude      real,
  altitude_accuracy real,
  speed         real,          -- metres/second (filtered)
  raw_speed     real,          -- as reported by the device
  speed_source  text NOT NULL DEFAULT 'none' CHECK (speed_source IN ('gps', 'derived', 'none')),
  heading       real,
  battery       smallint CHECK (battery BETWEEN 0 AND 100),
  charging      boolean,
  activity      text,
  -- false when recorded while the user had sharing paused: visible to the owner only.
  shared        boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false
);
CREATE INDEX locations_user_time_idx ON locations(user_id, recorded_at DESC);
CREATE INDEX locations_device_time_idx ON locations(device_id, recorded_at);
CREATE INDEX locations_time_brin ON locations USING brin(recorded_at);
CREATE INDEX locations_geog_idx ON locations USING gist(geog);
-- Prevent exact duplicate fixes (offline queues retrying).
CREATE UNIQUE INDEX locations_dedupe_idx ON locations(user_id, device_id, recorded_at);

-- Latest fix per user, maintained on ingestion for O(1) live map reads.
CREATE TABLE latest_locations (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  location_id  bigint NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  recorded_at  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Trips
CREATE TABLE trips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id        uuid REFERENCES devices(id) ON DELETE SET NULL,
  status           text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  duration_sec     int NOT NULL DEFAULT 0,
  moving_sec       int NOT NULL DEFAULT 0,
  distance_m       double precision NOT NULL DEFAULT 0,
  max_speed        real,
  avg_moving_speed real,
  avg_speed        real,
  start_lat        double precision NOT NULL,
  start_lon        double precision NOT NULL,
  end_lat          double precision NOT NULL,
  end_lon          double precision NOT NULL,
  start_label      text,
  end_label        text,
  start_place_id   uuid,
  end_place_id     uuid,
  route            geography(LineString, 4326),
  stops            jsonb NOT NULL DEFAULT '[]'::jsonb,
  point_count      int NOT NULL DEFAULT 0,
  low_confidence   boolean NOT NULL DEFAULT false,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trips_user_time_idx ON trips(user_id, started_at DESC);
CREATE UNIQUE INDEX trips_one_active_per_device ON trips(device_id) WHERE status = 'in_progress';

-- ---------------------------------------------------------------------------
-- Places & geofences
CREATE TABLE places (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id   uuid REFERENCES circles(id) ON DELETE CASCADE, -- NULL = private place
  name        text NOT NULL,
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  geog        geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  radius_m    real NOT NULL CHECK (radius_m BETWEEN 25 AND 50000),
  icon        text NOT NULL DEFAULT 'pin',
  color       text NOT NULL DEFAULT '#FF7A45',
  address     text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_circle_idx ON places(circle_id);
CREATE INDEX places_owner_idx ON places(owner_id);
CREATE INDEX places_geog_idx ON places USING gist(geog);

-- Who wants to be told about arrivals/departures at a place.
CREATE TABLE place_alerts (
  place_id        uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  subscriber_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL member_id = every member of the place's circle.
  member_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  on_arrive       boolean NOT NULL DEFAULT true,
  on_depart       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX place_alerts_uniq ON place_alerts(place_id, subscriber_id, COALESCE(member_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Current inside/outside state for each (place, user) pair — gives hysteresis
-- and duplicate-event prevention.
CREATE TABLE place_presence (
  place_id      uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inside        boolean NOT NULL,
  changed_at    timestamptz NOT NULL,
  last_event_at timestamptz,
  PRIMARY KEY (place_id, user_id)
);

CREATE TABLE place_events (
  id          bigserial PRIMARY KEY,
  place_id    uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('arrive', 'depart')),
  occurred_at timestamptz NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false
);
CREATE INDEX place_events_user_time_idx ON place_events(user_id, occurred_at DESC);
CREATE INDEX place_events_place_time_idx ON place_events(place_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Notifications
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_time_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_dedupe_idx ON notifications(user_id, dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reverse-geocoding cache (rounded coordinates → label). Keeps external
-- geocoder traffic minimal and lets the server work offline once warmed.
CREATE TABLE geocode_cache (
  key         text PRIMARY KEY,
  label       text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit log for sensitive actions.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON audit_log(created_at DESC);

-- Ingestion counters per hour (for admin statistics without scanning locations).
CREATE TABLE ingest_stats (
  hour        timestamptz PRIMARY KEY,
  accepted    int NOT NULL DEFAULT 0,
  rejected    int NOT NULL DEFAULT 0
);
