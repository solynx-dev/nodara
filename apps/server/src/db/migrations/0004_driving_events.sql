-- Driving events for weekly driving reports: speeding, hard braking, rapid
-- acceleration (all estimated from GPS speed) and phone use while moving
-- (phone unlocks reported by the iOS app). Speeding spans several fixes, so it
-- has a start and an end; the others are instants (started_at = ended_at).
CREATE TABLE driving_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('speeding', 'hard_brake', 'rapid_accel', 'phone_use')),
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  speed       real,               -- m/s: top speed while speeding, otherwise the speed at the time
  value       real,               -- m/s² for hard braking / rapid acceleration
  samples     int NOT NULL DEFAULT 1,
  shared      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driving_events_user_time_idx ON driving_events (user_id, started_at DESC);
CREATE INDEX driving_events_device_kind_idx ON driving_events (device_id, kind, ended_at DESC);
