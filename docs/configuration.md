# Configuration

Nodara is configured with environment variables (in Docker, via `.env`). Settings marked **admin UI** can also be changed at runtime in **Administration → Settings**; the environment value is the default until an administrator changes it.

## Core

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:5173` | Public URL of the instance (no trailing slash). Determines secure cookies, links in emails, the WebAuthn relying party and the allowed `Origin`. |
| `SESSION_SECRET` | — | **Required in production** (≥ 16 chars). Reserved for signing; generate with `openssl rand -base64 32`. |
| `DATABASE_URL` | `postgres://nodara:nodara@localhost:5432/nodara` | PostgreSQL connection string. The database needs the PostGIS extension available (migrations run `CREATE EXTENSION postgis`). |
| `DATABASE_POOL_SIZE` | `10` | Max connections. |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Listen address. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers. Set `true` behind a reverse proxy. |
| `INSTANCE_NAME` | `Nodara` | Shown on sign-in, in emails and in authenticator apps. |
| `SESSION_TTL_DAYS` | `30` | Session lifetime. |
| `LOG_LEVEL` | `info` | `fatal`…`trace`. Per-request logs only at `debug`/`trace`. |
| `WEB_DIST` | `../web/dist` | Directory with the built web app (set in the Docker image). |

## Accounts

| Variable | Default | Description |
|---|---|---|
| `REGISTRATION_POLICY` | `invite` | **admin UI.** `open` (anyone), `invite` (needs a circle invitation link), `closed` (administrators create accounts). |
| `SETUP_TOKEN` | — | If set, the first-run setup screen requires it. Recommended when the server is publicly reachable before setup. |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Block sign-in until the email is verified. Only enforced when SMTP is configured. |
| `SMTP_URL` | — | e.g. `smtp://user:pass@smtp.example.com:587` or `smtps://…:465`. Without it, emails (verification, reset) are written to the server log. |
| `SMTP_FROM` | `Nodara <nodara@localhost>` | Sender address. |

## Maps & geocoding

| Variable | Default | Description |
|---|---|---|
| `MAP_STYLES` | OpenFreeMap styles + OSM raster | JSON array of `{ "id", "name", "url", "dark" }`. `url` is a MapLibre style JSON URL, or `builtin:osm-raster`. Point this at your own tile server (e.g. [OpenFreeMap self-hosted](https://openfreemap.org), [Protomaps](https://protomaps.com), [TileServer GL](https://github.com/maptiler/tileserver-gl)) to remove all third-party map requests. |
| `GEOCODER_URL` | — (disabled) | Nominatim-compatible base URL for address lookup and place search, e.g. a self-hosted Nominatim or `https://nominatim.openstreetmap.org/` (respect its [usage policy](https://operations.osmfoundation.org/policies/nominatim/)). Requests are proxied, throttled to 1/s and cached in the database. **admin UI** can switch lookups off. |
| `GEOCODER_USER_AGENT` | `Nodara self-hosted (https://nodara.ca)` | Identify your instance to the geocoder. |

Example `MAP_STYLES`:

```env
MAP_STYLES=[{"id":"streets","name":"Streets","url":"https://tiles.example.com/styles/liberty/style.json","dark":false},{"id":"night","name":"Night","url":"https://tiles.example.com/styles/dark/style.json","dark":true}]
```

## Push notifications

| Variable | Default | Description |
|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Web Push keys. Generated on first start and stored in the database; set them to pin the keys across fresh databases. Generate with `npx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Contact for push services (`mailto:` or `https:`). |
| `EXPO_PUSH_ENABLED` | `true` | Deliver notifications to the Nodara iOS/Android apps through Expo's push service (which relays to Apple/Google). Only used for phones where someone turned notifications on in the app; the relay sees only the notification text. |
| `EXPO_PUSH_URL` | `https://exp.host/--/api/v2/push/send` | Override the Expo push endpoint (testing). |

## Data & privacy

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_RETENTION_DAYS` | `0` (forever) | **admin UI.** Default history retention. Users can choose their own. Deletions are notified to the user and audited — never silent. |
| `DRIVING_SPEEDING_KMH` | `130` | Speed counted as "speeding" in driving reports. Nodara has no speed-limit data, so this is one fixed "very fast" threshold for everyone on the server. |
| `PRIVACY_POLICY_FILE` | *(PRIVACY.md)* | Markdown file shown at `/privacy-policy`. By default the server shows the project's PRIVACY.md (built into the Docker image). If you run Nodara for other people, point this at your own policy. |
| `TELEMETRY_ENDPOINT` | — | Where anonymous statistics would be sent **if** an administrator also enables telemetry in the UI. With no endpoint nothing is ever sent. |

## Runtime settings (admin UI only)

- Device-offline alert threshold (default 120 min)
- Geofence cooldown (default 180 s)
- Trip detection: departure distance (200 m), stop duration that ends a trip (5 min), minimum trip distance (400 m)

## Development / tests

| Variable | Description |
|---|---|
| `DISABLE_JOBS` | Disable background schedulers. |
| `MIGRATIONS_DIR` | Override the SQL migrations directory. |
| `TEST_DATABASE_URL` | Database used (and wiped) by `pnpm test`. |
| `E2E_DATABASE_URL`, `E2E_PORT`, `CHROMIUM_PATH` | Playwright end-to-end tests. |
