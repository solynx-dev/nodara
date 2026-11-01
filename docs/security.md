# Threat model & security design

## Assets

1. **Live locations** — where someone is right now.
2. **Location history & trips** — patterns of life (home, school, work, routines).
3. **Account credentials** — passwords, sessions, TOTP secrets, passkeys, device tokens.
4. **Circle membership & places** — who belongs together and where they live.

## Actors

| Actor | Capability |
|---|---|
| Anonymous internet user | Can reach the public endpoints of an exposed instance. |
| Registered user outside your circles | Has a valid session on the same server. |
| Circle member | Legitimately sees what you share with that circle. |
| Circle admin/owner | Manages membership and circle settings. |
| Server administrator | Operates the server and database. **Fully trusted** — they can read the database. Choose your administrator carefully (self-hosting exists precisely so this can be you). |
| Network attacker | Can observe/modify traffic without HTTPS. |
| Stolen/lost phone | Has the device token or a session cookie. |

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| **Cross-circle data access via API manipulation** (changing IDs) | Every endpoint resolves visibility through `services/access.ts` from the authenticated user, never from client-supplied relationships. Non-visible resources return `404`. Covered by isolation tests. |
| **Over-sharing in time** (seeing history from before someone joined or while paused) | `sharing_since` per membership (reset on re-enable), `locations.shared` flag for paused periods; enforced in live view, history, trips, timeline and place events. |
| **Credential stuffing / brute force** | Argon2id (19 MiB, t=2), constant-time-ish failure path with a dummy hash, identical error for unknown users, per-IP rate limits on auth endpoints, optional TOTP and passkeys. |
| **Session theft** | Opaque 256-bit tokens; only SHA-256 stored server-side; HttpOnly + SameSite=Lax + Secure cookies; session list with remote revoke; all sessions revoked on password reset; disabled users are rejected immediately. |
| **CSRF** | Cookie-authenticated unsafe requests require the custom `X-Nodara-Request` header (not sendable cross-origin without a CORS preflight, which Nodara never grants) and a same-origin `Origin`. WebSocket upgrades check `Origin`. |
| **XSS** | React output encoding, no `dangerouslySetInnerHTML`, strict CSP (`script-src 'self'`), theme bootstrap script served as a file. |
| **SQL injection** | All queries use `postgres.js` tagged templates (parameterised). Dynamic fragments are composed only from server-side constants. |
| **Input abuse** | zod validation on every body/query; coordinate bounds; batch and body size limits; future timestamps rejected; global and per-route rate limits. |
| **Malicious profile photo uploads** | Only JPEG, PNG and WebP are accepted, identified by their magic bytes (never by a client-supplied type), ≤ 2 MB, rate-limited. Photos are served with the detected type, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, and only to the person and people who share a circle with them. SVG and anything scriptable are refused. |
| **Leaked device token** | Tokens only authorise *writing* locations for that device (no reads); hashed at rest; shown once; revocable/rotatable. Worst case: fake locations for that user, visible in the device list. |
| **Leaked invite link** | 192-bit random, hashed at rest, expiry (default 72 h), use limits (default 1), revocable, preview shows only circle name and inviter. |
| **Location leakage to third parties** | No analytics; geocoding is proxied and cached by the server (browsers never contact the geocoder); map tiles are the only direct third-party requests by default and can be self-hosted (`MAP_STYLES`). Telemetry is off, requires admin opt-in + endpoint, and the exact payload is previewable and contains no personal data. |
| **Sensitive data in logs** | Per-request logging disabled unless `LOG_LEVEL=debug`; emails/coordinates are not logged by the ingestion path. |
| **Silent data loss** | Retention never runs silently: users choose it, are notified with counts, and runs are audited. |
| **Privilege escalation in circles** | Role ranks enforced server-side: admins can't remove/demote owners or peers; only owners transfer ownership; owners can't leave without transferring. |
| **Administrator actions** | Audit log for setup, user creation/deletion/role changes, settings, retention runs, exports, device and 2FA changes. |
| **Push payload exposure** | Web Push payloads are encrypted end-to-end to the browser (RFC 8291); they contain only the notification title/body. |

## Known limitations / future work

- No independent security audit yet.
- No encryption at rest inside Postgres (use disk/volume encryption).
- Rate limiting is per process and in-memory.
- TOTP secrets are stored in plaintext in the database (protected by DB access controls); consider encrypting with a key derived from `SESSION_SECRET`.
- No account lockout beyond rate limiting; no breached-password check (to avoid third-party calls).
- Email change flow is not implemented yet (email is fixed at registration).
- The server administrator is fully trusted by design.
