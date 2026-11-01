# Architecture

Nodara is a **modular monolith**: one Node.js process serving the REST API, WebSocket updates, background jobs and the built web app, backed by one PostgreSQL + PostGIS database. No Redis, no queue, no microservices — a family server should be boring to run.

```
┌──────────────── browser / PWA ─────────────────┐     ┌── OwnTracks / Overland / native apps ──┐
│ React · TanStack Query · MapLibre GL · SW/push │     │      device token (ingest only)        │
└──────────┬──────────────────────┬──────────────┘     └──────────────────┬─────────────────────┘
     HTTPS REST (cookie + CSRF hdr)   WebSocket /api/ws                   │ HTTPS
           ▼                          ▼                                    ▼
┌──────────────────────────────── Fastify (apps/server) ─────────────────────────────────────────┐
│ auth · circles · locations/ingest · history · trips · places · notifications · devices · admin │
│ services: ingest → speed filter → trips (segmenter) → geofences → notify (in-app/WS/push)      │
│ realtime hub (in-memory fan-out) · jobs (retention, offline devices, idle trips, cleanup)      │
└──────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                               ▼
                                PostgreSQL 16 + PostGIS 3 (SQL migrations)
```

## Repository layout

| Path | Contents |
|---|---|
| `apps/server/src/app.ts` | Builds the Fastify app and wires services (also used by tests and CLIs). |
| `apps/server/src/auth.ts` | Session/bearer/device-token resolution, CSRF, `requireUser`/`requireAdmin`, audit. |
| `apps/server/src/modules/*` | HTTP routes per domain. |
| `apps/server/src/services/*` | Domain logic: `ingest`, `speed`, `trip-detect` (pure), `trips` (DB), `geofence-eval` (pure), `geofence`, `access` (authorization queries), `notify`, `push`, `geocoder`, `jobs`, `realtime`. |
| `apps/server/src/db/migrations` | Plain SQL migrations, applied in order at startup. |
| `apps/server/src/cli` | `migrate`, `create-admin`, `seed-demo`. |
| `apps/web/src/pages` | One file per screen. |
| `apps/web/src/features` | Map (MapLibre wrapper + layers), tracking engine, history playback, members, trips. |
| `apps/web/src/sw.ts` | Service worker: precache app shell, tile cache, push handling. |
| `packages/shared` | API types, geo math (haversine, bearing, circle polygons), unit formatting. |

## Data model

| Table | Purpose |
|---|---|
| `users` | Accounts, Argon2id hash, TOTP secret + hashed recovery codes, preferences (JSON), `sharing_paused`, `is_demo`. |
| `user_avatars` | Profile photos (JPEG/PNG/WebP bytes, ≤ 2 MB), stored in the database so normal backups include them. `users.avatar_url` holds the versioned URL. |
| `sessions` | Server-side sessions; only SHA-256 of the token stored. `state` = `active` / `pending_2fa`. |
| `auth_tokens` | Hashed one-time tokens (verify email, reset password, admin setup link). |
| `passkeys`, `webauthn_challenges` | WebAuthn credentials and short-lived challenges. |
| `devices` | Location sources (web, ios, android, owntracks, overland…). Hashed device token, push subscription, incremental trip-detector state. |
| `circles`, `circle_members` | Groups, roles, per-member `sharing` flag and **`sharing_since`**, notification settings. |
| `invitations` | Hashed invite tokens with expiry and use limits. |
| `locations` | High-volume fixes: `lat`/`lon` + generated `geography(Point)`, accuracy, filtered speed + source, heading, battery, `shared` flag. Indexed by `(user_id, recorded_at)`, `(device_id, recorded_at)`, BRIN on time, GiST on geography; unique on `(user_id, device_id, recorded_at)` for idempotent retries. |
| `latest_locations` | One row per user pointing at the newest fix → O(1) live map. |
| `trips` | Detected trips with stats, `geography(LineString)` route, stops (JSON), confidence. One `in_progress` row per device max. |
| `places`, `place_alerts`, `place_presence`, `place_events` | Geofences, who wants alerts about whom, current inside/outside state (hysteresis), arrival/departure log. |
| `notifications` | In-app notifications with dedupe keys. |
| `geocode_cache` | Reverse-geocoding results at ~11 m resolution. |
| `audit_log`, `ingest_stats`, `system_settings` | Audit trail, hourly ingest counters, admin settings + VAPID keys. |

**Scaling notes.** At 30 s intervals one phone produces ~2 900 fixes/day ≈ 1 M/year. With 20 users that's ~20 M rows/year — comfortable for Postgres with these indexes. History queries are always time-bounded, ranges are decimated server-side (`maxPoints`), and the live map never touches `locations` beyond a primary-key lookup. If an instance grows much larger, `locations` can be range-partitioned by month without API changes.

## Authorization model

All rules live in `services/access.ts` and are enforced on every endpoint; anything a caller may not see returns `404`, never `403`, so existence isn't leaked.

- You always see your own data.
- **Live:** you see someone's current location only if you share a circle where they have `sharing = true`, they haven't paused globally, and the fix was recorded after they started sharing with that circle.
- **History/trips:** only from `min(sharing_since)` across circles you share with them (minus a 2-minute clock-skew grace), only if the circle allows it (`historyVisible` / `tripsVisible`), and only fixes recorded while they weren't paused (`locations.shared`).
- Re-enabling sharing resets `sharing_since`, so the gap stays private.
- Device tokens can only call ingestion endpoints.

Circle isolation is covered by integration tests (`apps/server/test/circles.test.ts`).

## Location ingestion pipeline (`services/ingest.ts`)

1. Validate (zod), drop fixes > 5 min in the future, sort by time.
2. **Speed filtering** (`services/speed.ts`): prefer GNSS speed when accuracy ≤ 50 m; else derive from the previous fix only when the displacement exceeds the combined accuracy radii (otherwise speed = 0 — GPS jitter is not movement); reject > 324 km/h spikes; record the source (`gps` / `derived` / `none`).
3. Batch insert with `ON CONFLICT DO NOTHING` (safe retries from offline queues).
4. Update `latest_locations` only if newer; broadcast to every viewer over WebSocket.
5. Geofence evaluation for each new fix (`services/geofence.ts`).
6. Low-battery transition check → notify circle-mates once per 6 h.
7. Incremental trip detection for the device (serialised per device).

## Trip detection (`services/trip-detect.ts`)

A pure, unit-tested two-state machine:

- **Stationary**: remember an *anchor*. Fixes within 100 m keep you "at rest"; fixes between 100 m and 200 m are buffered as drift. Moving beyond 200 m starts a trip at the last at-rest fix (including the drift fixes).
- **Moving**: track a *dwell anchor*. Staying within 100 m for 5 min ends the trip at the dwell anchor; shorter dwells (≥ 90 s) become *stops*. A data gap > 20 min ends the trip at the last fix.
- Candidate trips under 400 m, 2 min, or with < 30 s of actual movement are discarded as noise.
- Stats: distance (sum of segments), moving time (segments faster than 0.7 m/s), max speed (median-of-3 smoothed so one spike can't dominate), averages, stops, and a **low-confidence** flag for sparse/imprecise data.

The detector is incremental: its state (`devices.trip_state`) is persisted after each run and the next run only reads fixes after `state.last`. An open trip is re-segmented from its start each run and stored as one `in_progress` row. A job closes trips whose device went silent. `POST /api/trips/rebuild` recomputes everything from history. Thresholds are admin-configurable.

## Geofencing (`services/geofence-eval.ts`, `services/geofence.ts`)

- Places apply to a user if they're in a circle the user **shares with**, or are the user's own private places.
- Hysteresis: enter when inside the radius; leave only beyond radius + max(25 m, min(accuracy, 100 m)). Fixes whose accuracy is much larger than the fence are ignored. The first observation initialises state silently.
- State lives in `place_presence`; every transition is logged in `place_events`.
- Notifications go to subscribers in `place_alerts` who can currently see the person, only for fresh fixes (< 30 min old, so uploading an offline queue doesn't spam), never for movements before the person started sharing, with a configurable cooldown against edge flapping and a dedupe key.

## Realtime

`/api/ws` authenticates with the session during the upgrade and checks `Origin`. The server pushes typed events (`location`, `notification`, `trip`, `presence`, `sharing`, `circle`) only to users entitled to them; the client patches its query cache in place (no refetch for location updates) and reconnects with exponential backoff. The hub is in-memory; multiple processes would need Postgres `LISTEN/NOTIFY` behind the same interface.

## Web client

- **TanStack Query** for server state; the WebSocket keeps it fresh.
- **MapLibre GL** with admin-configured styles; members are HTML markers rendered through React portals, grouped when they overlap on screen; places, accuracy circles and routes are GeoJSON layers re-added after style switches.
- **Tracking engine** (`features/tracking/TrackingProvider.tsx`): `watchPosition` + heartbeat, adaptive interval, battery, persistent offline queue, optional wake lock, honest status (`active` / `background` / `paused`).
- **Service worker**: precached shell (offline start), cache-first tile cache (1 500 entries / 14 days), push + notification click routing. API responses are never cached.

## Background jobs (`services/jobs.ts`)

| Job | Interval |
|---|---|
| Close idle trips | 1 min |
| Device offline alerts | 5 min |
| Retention (notifies users, audited) | 6 h |
| Cleanup (expired sessions/tokens/challenges/invites) | 1 h |
| Telemetry (only if enabled + endpoint set) | 7 days |

## Key trade-offs

- **Monolith + Postgres only** — fewer moving parts for self-hosters; Redis would add little at family scale.
- **Server-side sessions** over JWTs — instant revocation, simple logout-everywhere.
- **Plain SQL migrations** with `postgres.js` tagged templates (parameterised, injection-safe) instead of an ORM — PostGIS features are first-class and queries are explicit.
- **Instance-per-family** for a future hosted edition instead of row-level multi-tenancy — see [cloud-edition.md](cloud-edition.md).
