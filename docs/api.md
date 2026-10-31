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
| `POST /auth/register` | `{email, password, displayName, inviteToken?, client?}` | Subject to the registration policy. With `inviteToken` the user joins that circle. |
| `POST /auth/login` | `{email, password, client?: "web"\|"native"}` | → `{user}` (+ `token` for native) or `{twoFactorRequired: true}`. |
| `POST /auth/2fa` | `{code}` | TOTP code or recovery code, using the pending session. |
| `POST /auth/logout` | | |
| `GET /auth/me` | | Current user (`Me`). |
| `POST /auth/verify-email` | `{token}` | |
| `POST /auth/resend-verification` | | |
| `POST /auth/forgot-password` | `{email}` | Always `200`. |
| `POST /auth/reset-password` | `{token, password}` | Signs out all sessions. |
| `POST /auth/password` | `{currentPassword, newPassword}` | Signs out other sessions. |
| `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `POST /auth/sessions/revoke-others` | | |
| `POST /auth/totp/setup` → `{secret, uri}` · `POST /auth/totp/enable {code}` → `{recoveryCodes}` · `POST /auth/totp/disable {password}` | | |
| `GET /auth/passkeys` · `DELETE /auth/passkeys/:id` | | |
| `POST /auth/passkeys/register/options` → `{challengeId, options}` · `POST /auth/passkeys/register/verify {challengeId, response, name}` | | |
| `POST /auth/passkeys/login/options` · `POST /auth/passkeys/login/verify {challengeId, response}` | | Discoverable-credential sign-in. |

## Account — `/me`

| Endpoint | Description |
|---|---|
| `PATCH /me` | `{displayName?, avatarColor?, preferences?}` — preferences: `units`, `theme`, `mapStyle`, `updateIntervalSec`, `adaptiveInterval`, `highAccuracy`, `retentionDays`, `notifyLowBattery`, `lowBatteryThreshold`, `notifications.{places,circle,sharing,lowBattery,deviceOffline}.{inApp,push}`. |
| `POST /me/sharing` | `{paused}` — global pause/resume. |
| `DELETE /me` | `{password, confirm: "DELETE"}` — delete the account and all data. |
| `GET /me/export?format=json\|geojson\|gpx\|csv&from&to` | Streamed export of your own data. |

## Devices — `/devices`

`GET /devices` · `POST /devices {name, kind}` → `{device, token}` (token for non-web kinds, shown once) · `PATCH /devices/:id {name}` · `POST /devices/:id/token` (rotate) · `DELETE /devices/:id` (revoke) · `PUT /devices/:id/push {subscription}` · `DELETE /devices/:id/push` · `PUT /devices/:id/native-push {token}` (Expo push token from the iOS app) · `DELETE /devices/:id/native-push` · `POST /devices/:id/push/test`.

## Locations

| Endpoint | Description |
|---|---|
| `POST /locations` | `{deviceId?, locations: Fix[≤1000]}` — see [clients.md](clients.md). Returns `{accepted, rejected, duplicates, latest, hint}`. |
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
| `DELETE /trips/:id` | Delete one of your trips (history is kept). |
| `POST /trips/rebuild` | Recompute your trips from history. |
| `GET /insights?userId&period=week\|month\|year&offset&tz&mode=driving\|all` | Totals, previous-period comparison and buckets. |

## Circles & invitations

| Endpoint | Description |
|---|---|
| `GET /circles` · `POST /circles {name, color}` | |
| `GET /circles/:id` | Detail with members (emails only for admins). |
| `PATCH /circles/:id` | Admin: `{name?, color?, settings?: {historyVisible, tripsVisible, membersCanInvite}}`. |
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

`GET /admin/overview` · `GET/POST /admin/users` · `PATCH /admin/users/:id {isAdmin?, disabled?}` · `POST /admin/users/:id/reset-link` · `DELETE /admin/users/:id` · `GET/PATCH /admin/settings` · `GET /admin/audit` · `GET /admin/retention/preview` · `POST /admin/retention/run` · `GET /admin/telemetry/preview` · `DELETE /admin/demo`.

## System

`GET /health` · `GET /version` · `GET /config` (public: instance name, registration policy, map styles, VAPID public key, feature flags).

## WebSocket — `GET /api/ws`

Authenticated by the session cookie (or bearer) during the upgrade. Server → client messages (JSON):

```ts
{ type: 'hello', userId }
{ type: 'location', userId, location: LocationFix }
{ type: 'sharing', userId, circleId | null, sharing }
{ type: 'notification', notification }
{ type: 'trip', userId, tripId, status }
{ type: 'presence', userId, placeId, inside }
{ type: 'circle', circleId }
```

The client may send the text `ping`; the server answers `{"type":"pong"}`. Type definitions: `packages/shared/src/types.ts`.
