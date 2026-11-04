# API reference

Base path: `/api`. JSON in, JSON out. Errors use `{ "error": "<code>", "message": "…", "details"?: … }` with the usual HTTP status codes (`400` validation, `401` unauthenticated, `403` forbidden/CSRF, `404` not found **or not visible to you**, `409` conflict, `429` rate limited).

## Authentication

| Method | How | Notes |
|---|---|---|
| Browser session | `nodara_session` cookie (HttpOnly, SameSite=Lax, Secure on HTTPS) | Unsafe methods (POST/PUT/PATCH/DELETE) **must** send `X-Nodara-Request: 1` and a same-origin `Origin`. |
| Native session | `Authorization: Bearer nds_…` from `POST /auth/login` with `"client": "native"` | No CSRF header needed. |
| Device token | `Authorization: Bearer ndd_…`, HTTP Basic password, or `?token=` (Overland) | Only ingestion endpoints. |

Rate limits: 600 req/min/IP globally; auth endpoints ~10/min; ingestion 240/min.

## Auth — `/auth`

| Endpoint | Body | Description |
|---|---|---|
| `POST /auth/setup` | `{email, password, displayName, setupToken?}` | First-run: create the administrator (only when no users exist). |
| `POST /auth/register` | `{email, password, displayName, inviteToken?, client?}` | Subject to the registration policy. With `inviteToken` the user joins that circle. When the server requires email confirmation, → `{verificationRequired: true, email}` and no session (confirm with the emailed code, then log in). |
| `POST /auth/login` | `{email, password, client?: "web"\|"native"}` | → `{user}` (+ `token` for native) or `{twoFactorRequired: true}`. `403 email_unverified` when the account must confirm its email first (a fresh code is emailed, at most every 2 minutes). |
| `POST /auth/2fa` | `{code}` | TOTP code or recovery code, using the pending session. |
| `POST /auth/logout` | | |
| `GET /auth/me` | | Current user (`Me`). |
| `POST /auth/verify-email` | `{token}` \| `{code}` (signed in) \| `{email, code}` | Confirm an email with the link's token or the emailed 6-digit code. |
| `POST /auth/resend-verification` | `{email?}` | New code + link: to yourself when signed in, or to `email` from the sign-in screen. |
| `POST /auth/forgot-password` | `{email}` | Always `200` → `{emailEnabled}`. Emails a link and a 6-digit code (2 hours). |
| `POST /auth/reset-password/check` | `{email, code}` | Checks a reset code without using it (the app's second step). |
| `POST /auth/reset-password` | `{token, password}` \| `{email, code, password}` | Signs out all sessions and emails a notice. |
| `POST /auth/confirm-email` | `{token}` | Confirms an email change from its link (no sign-in needed). |
| `POST /auth/password` | `{currentPassword, newPassword}` | Signs out other sessions and emails a notice. |
| `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `POST /auth/sessions/revoke-others` | | |
| `POST /auth/totp/setup` → `{secret, uri, qr}` (`qr`: PNG data URL) · `POST /auth/totp/enable {code}` → `{recoveryCodes}` · `POST /auth/totp/disable {password}` | | |
| `GET /auth/passkeys` · `PATCH /auth/passkeys/:id {name}` · `DELETE /auth/passkeys/:id` | | |
| `POST /auth/passkeys/register/options` → `{challengeId, options}` · `POST /auth/passkeys/register/verify {challengeId, response, name}` | | |
| `POST /auth/passkeys/login/options` · `POST /auth/passkeys/login/verify {challengeId, response, client?}` | | Discoverable-credential sign-in. `client: "native"` returns a bearer `token`. |

Emailed codes are 6 digits, stored hashed, and only the newest code of each kind works. Five wrong tries use a code up. Codes are accepted with spaces (`123 456`).

## Account — `/me`

| Endpoint | Description |
|---|---|
| `PATCH /me` | `{displayName?, avatarColor?, preferences?}` — preferences: `units`, `theme`, `mapStyle`, `updateIntervalSec`, `adaptiveInterval`, `highAccuracy`, `retentionDays`, `notifyLowBattery`, `lowBatteryThreshold`, `notifications.{places,circle,sharing,lowBattery,deviceOffline}.{inApp,push}`. |
| `POST /me/sharing` | `{paused}` — global pause/resume. |
| `PUT /me/avatar` | `{image}` — base64 JPEG, PNG or WebP (≤ 2 MB; data URLs accepted). Anything else, including SVG, is refused. Returns the updated profile with a versioned `avatarUrl`. Clients should shrink photos first (the apps send 512×512 JPEG). |
| `DELETE /me/avatar` | Remove the profile photo. |
| `GET /users/:id/avatar?v=…` | The photo itself. Only for yourself and people who share a circle with you (404 otherwise). Cached forever per version; served with `nosniff` and a sandboxing CSP. |
| `POST /me/email` | `{email, password}` — move the account to a new address. With email set up, the new address gets a code and link (24 hours) and the old one a heads-up; `Me.pendingEmail` shows it until confirmed. Without email the change is immediate. → `{changed, user}`. |
| `POST /me/email/confirm` | `{code}` — confirm the change; the old address is told. → `{user}`. |
| `DELETE /me/email/pending` | Cancel a pending change. |
| `GET /bubble` | `{bubble: Bubble \| null, circles: [{id, name, color, allowed, sharing}]}` — your bubble and which circles it hides you from. |
| `POST /bubble` | `{radiusM (500–100000), hours (0.25–24), lat?, lon?}` — start (or replace) a bubble around where you are. Refused when every circle has bubbles off. |
| `DELETE /bubble` | End it now. |
| `DELETE /me` | `{password, confirm: "DELETE"}` — delete the account and all data. |
| `GET /me/export?format=json\|geojson\|gpx\|csv&from&to` | Streamed export of your own data. |

## Devices — `/devices`

`GET /devices` · `POST /devices {name, kind}` → `{device, token}` (token for non-web kinds, shown once) · `PATCH /devices/:id {name}` · `POST /devices/:id/token` (rotate) · `DELETE /devices/:id` (revoke) · `PUT /devices/:id/push {subscription}` · `DELETE /devices/:id/push` · `PUT /devices/:id/native-push {token}` (Expo push token from the iOS app) · `DELETE /devices/:id/native-push` · `POST /devices/:id/push/test`.

## Locations

| Endpoint | Description |
|---|---|
| `POST /locations` | `{deviceId?, locations: Fix[≤1000]}` — see [clients.md](clients.md). Returns `{accepted, rejected, duplicates, latest, hint}`. |
| `POST /checkins` | `{deviceId, circleId?, message?, location: Fix}` — records the fix and notifies circle-mates (“Alex checked in at Home”). |
| `POST /ingest/owntracks` | OwnTracks HTTP payload. |
| `POST /ingest/overland` | Overland GeoJSON batch. |
| `GET /live` | Everyone visible to you across all circles (`MemberLocation[]`). |
| `GET /circles/:id/live` | Members of one circle. |

## History — `/history/:userId`

| Endpoint | Query | Description |
|---|---|---|
| `GET …/points` | `from`, `to` (ISO, ≤ 31 days), `maxPoints` (≤ 10 000) | Fixes, evenly decimated if needed; `total`, `distanceM`, `visibleSince`. |
| `GET …/points/:id` | | One fix with reverse-geocoded address. |
| `GET …/days` | `from`, `to` (≤ 400 days), `tz` | Per-day point count, distance, trip count (calendar). |
| `GET …/timeline` | `from`, `to` | Alternating `stay` / `trip` items with place names or addresses. |
| `DELETE /history/points` | `from`, `to` | Delete **your own** history (and trips) in a range. |

## Trips & insights

| Endpoint | Description |
|---|---|
| `GET /trips?userId&from&to&before&limit` | Trips, newest first (cursor: `before` = last `startedAt`). Includes estimated `mode`. |
| `GET /trips/:id` | Trip with simplified `route` coordinates, `stops`, decimated speed `samples`. |
| `PATCH /trips/:id` | Your own completed trips only: `{mode?: "driving"\|"walking", role?: "driver"\|"passenger"}`. Passenger rides and walks (and their driving events) don't count in driving reports or driving insights. Trips are only ever `driving` or `walking`. |
| `DELETE /trips/:id` | Delete one of your trips (history is kept). |
| `POST /trips/rebuild` | Recompute your trips from history. Drive/walk and driver/passenger corrections are carried over to the recomputed trip that overlaps them most. |
| `GET /insights?userId&period=week\|month\|year&offset&tz&mode=driving\|all` | Totals, previous-period comparison and buckets. |

## Driving reports

Events are detected on the server from uploaded fixes (speeding, hard braking, rapid acceleration) and from phone unlocks sent by the iOS app (phone use). They follow the same visibility rules as trips (`tripsVisible`, `sharing_since`, paused periods).

| Endpoint | Description |
|---|---|
| `POST /driving/phone-use` | `{deviceId?, times: (ISO \| epoch ms)[]}` — device token or session. Each time becomes a `phone_use` event only if your own fixes show you moving faster than ~16 km/h within 45 s of it. → `{recorded}`. |
| `GET /driving/events?userId&from&to` | Events for a person: `{id, kind, startedAt, endedAt, lat, lon, speed, value, tripId}`. `kind` is `speeding` (top `speed`, m/s), `hard_brake` / `rapid_accel` (`value` = m/s²) or `phone_use`. Speeding needs at least two fixes over the limit. |
| `GET /driving/report?circleId&offset&tz` | Monday–Sunday week in `tz` (`offset` 0 = this week). Totals and per-person drives, distance, duration, top speed, event counts and last week's counts. People whose drives you can't see come back as `{user, hidden: true}`. |

`GET /trips/:id` also includes `events` for that trip.

## Circles & invitations

| Endpoint | Description |
|---|---|
| `GET /circles` · `POST /circles {name, color}` | |
| `GET /circles/:id` | Detail with members (emails only for admins). |
| `GET /live` · `GET /circles/:id/live` | Members with their latest visible location, `currentPlace`, `inTrip`, and `stay: {since, atLeast} \| null` — when they arrived where they are now (geofence arrival, else the end of their last trip if it ended within 1 km). `atLeast` is true when the real arrival is earlier than what you're allowed to see. Someone in a bubble has `location: null` and `bubble: {lat, lon, radiusM, label, startedAt, endsAt, battery, charging, seenAt}` (a randomised centre); your own entry carries your active `bubble` alongside your location. |
| `PATCH /circles/:id` | Admin: `{name?, color?, settings?: {historyVisible, tripsVisible, membersCanInvite, bubblesAllowed}}`. Turning `bubblesAllowed` off shows members' exact locations to this circle even during a bubble. |
| `DELETE /circles/:id` | Owner only. |
| `PATCH /circles/:id/me` | `{sharing?, notify?: {muted}}`. |
| `PATCH /circles/:id/members/:userId` | `{role}` (owner can transfer ownership). |
| `DELETE /circles/:id/members/:userId` | Remove (admin) or leave (self). |
| `GET/POST /circles/:id/invitations` · `DELETE /circles/:id/invitations/:inviteId` | `POST {role, expiresInHours, maxUses, note}` → `{url, token, expiresAt}` (shown once). |
| `GET /invitations/:token` | Public preview. |
| `POST /invitations/:token/accept` | Join as the signed-in user. |

## Places

`GET /places` · `POST /places {name, lat, lon, radiusM, icon, color, circleId|null, address?}` · `PATCH /places/:id` · `DELETE /places/:id` · `GET/PUT /places/:id/alerts {alerts: [{memberId|null, onArrive, onDepart}]}` · `GET /place-events?placeId&userId&limit` · `GET /geocode/search?q&lat&lon` · `GET /geocode/reverse?lat&lon`.

## Notifications

`GET /notifications?before&unread&limit` → `{items, unread}` · `POST /notifications/read {ids? | all: true}` · `DELETE /notifications/:id` · `DELETE /notifications` (clear read).

## Administration (admins only)

`GET /admin/overview` · `GET/POST /admin/users` · `PATCH /admin/users/:id {isAdmin?, disabled?}` · `POST /admin/users/:id/reset-link` · `DELETE /admin/users/:id` · `GET/PATCH /admin/settings` (includes `requireEmailVerification`) · `POST /admin/email/test` → `{ok, to?, error?}` (emails the admin) · `GET /admin/audit` · `GET /admin/retention/preview` · `POST /admin/retention/run` · `GET /admin/telemetry/preview` · `DELETE /admin/demo`.

## System

`GET /health` · `GET /version` · `GET /config` (public: instance name, registration policy, map styles, VAPID public key, feature flags, `emailEnabled`, `passkeyRpId`) · `GET /.well-known/apple-app-site-association` (lets the iOS app use passkeys for this domain; see `APPLE_APP_IDS`).

## WebSocket — `GET /api/ws`

Authenticated by the session cookie (or bearer) during the upgrade. Server → client messages (JSON):

```ts
{ type: 'hello', userId }
{ type: 'location', userId, location: LocationFix, trail?: TrailPoint[] }   // trail: the fixes from that upload, for smooth live movement
{ type: 'sharing', userId, circleId | null, sharing }
{ type: 'bubble', userId }   // someone's bubble started, ended or changed: refetch /live
{ type: 'notification', notification }
{ type: 'trip', userId, tripId, status }
{ type: 'presence', userId, placeId, inside }
{ type: 'circle', circleId }
{ type: 'profile', userId }   // name, colour or photo changed
```

The client may send the text `ping`; the server answers `{"type":"pong"}`. Type definitions: `packages/shared/src/types.ts`.
