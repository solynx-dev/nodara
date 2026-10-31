# Roadmap & implementation checklist

Status legend: ✅ done · 🟡 partial / limited · ⬜ planned

## Implementation checklist (v0.1)

### Foundation
- ✅ pnpm monorepo (`apps/server`, `apps/web`, `packages/shared`), strict TypeScript
- ✅ PostgreSQL + PostGIS schema with SQL migrations (auto-applied, locked, transactional)
- ✅ Docker image, Docker Compose (PostGIS, optional Caddy/HTTPS), health checks, persistent volumes
- ✅ Environment-based configuration with validation

### Accounts & security
- ✅ Registration, login/logout, Argon2id, server-side sessions, session management
- ✅ Configurable registration policy (open / invite / closed), first-run setup, admin-created accounts with one-time setup links, CLI admin creation
- ✅ Email verification & password reset (SMTP optional; falls back to server log)
- ✅ TOTP two-factor with recovery codes; passkeys (WebAuthn)
- ✅ Account deletion, data export (JSON / GeoJSON / GPX / CSV)
- ✅ Rate limiting, CSRF protection, CSP and security headers, input validation, audit log
- 🟡 Email address change (not yet)

### Circles
- ✅ Multiple circles, roles, ownership transfer, member removal, leave
- ✅ Secure expiring invitation links with use limits, public preview, register-via-invite
- ✅ Per-circle sharing, notification mute, history/trips visibility, members-can-invite
- ✅ Isolation enforced server-side and covered by tests

### Live location
- ✅ Ingestion API (batch, idempotent), device tokens, OwnTracks & Overland adapters
- ✅ Realtime WebSocket updates, latest-location index
- ✅ Speed filtering, heading, altitude, battery, charging, accuracy, activity
- ✅ Freshness indicators, stale warnings, online/offline, global pause & per-circle sharing
- ✅ Browser foreground tracking with adaptive intervals, offline queue, wake lock
- 🟡 Background tracking — not possible in browsers; available today via OwnTracks/Overland

### Map
- ✅ MapLibre GL, configurable OSM-compatible styles, light/dark styles
- ✅ Member markers with grouping, accuracy circles, direction, follow mode, selected-member panel
- ✅ Geofence overlays, saved places, legend, full-screen, style switcher
- ✅ Route and history playback layers

### History, trips & insights
- ✅ Calendar with activity heat, day/week/month, timeline (stays & trips), playback with speed & scrubbing, point inspection
- ✅ Server-side decimation, distance totals, retention (user + admin), deletion of ranges
- ✅ Incremental trip detection with stops, confidence flags, rebuild
- ✅ Trip reports: route, speed graph, stats; driving insights (week/month/year, comparisons)
- ✅ km/h and mph

### Places & notifications
- ✅ Places: search (optional geocoder), drop pin, radius, icon, colour, private or circle-shared
- ✅ Arrive/depart detection with hysteresis, cooldown, dedupe; per-member alert subscriptions
- ✅ Notification centre (read/unread), realtime toasts, Web Push, per-type preferences
- ✅ Circle joins, sharing changes, low battery, device offline, retention notices

### PWA
- ✅ Manifest, icons, installability, offline shell, tile cache, push
- ✅ Responsive phone/tablet/desktop layouts, permission onboarding, sharing status

### Administration
- ✅ System status, DB/storage/ingestion/notification stats, user management, settings, retention, telemetry opt-in with payload preview, audit log, demo data removal

### Quality
- ✅ Unit tests (trip detection, speed, geofence, geo/units, formatting)
- ✅ API integration tests (auth, 2FA, reset, circles, isolation, ingestion, adapters, trips, geofences, retention, export)
- ✅ Playwright e2e (desktop + mobile) for the core journey
- ✅ CI workflow
- ⬜ Independent security review
- ⬜ Accessibility audit (keyboard and screen reader passes were done informally)
- ⬜ Load testing beyond family scale

## Next

### Native apps
- ⬜ iOS app (Swift): significant-change + standard location in background, region monitoring for places, APNs push — posting to `/api/locations` with device tokens
- ⬜ Android app (Kotlin): fused location foreground service, geofencing API, FCM / UnifiedPush
- ⬜ Device-level battery optimisation and motion activity

### Product
- ⬜ SOS / emergency alert with emergency contacts
- ⬜ Temporary location sharing (time-limited links), trip sharing ("I'm on my way")
- ⬜ Scheduled sharing (e.g. only during school hours)
- ⬜ Email notifications channel
- ⬜ Custom map layers, more providers, offline vector packs
- ⬜ Multiple-device merge rules per user (choose the best source)
- ⬜ Import history (Google Takeout, GPX, OwnTracks recorder)
- ⬜ Wearable integrations where practical
- ⬜ Optional crash-detection integrations — only with reliable native sensors; never claimed from GPS alone
- ⬜ Roadside-assistance integrations (provider-agnostic, opt-in)

### Platform
- ⬜ Postgres `LISTEN/NOTIFY` realtime for multi-process deployments
- ⬜ Monthly partitioning for very large `locations` tables
- ⬜ Encrypt TOTP secrets at rest
- ⬜ Prebuilt multi-arch images on GHCR
- ⬜ Optional Nodara Cloud control plane (separate project) — see [cloud-edition.md](cloud-edition.md)
