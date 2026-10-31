# Development

## Prerequisites

- Node.js 22+, pnpm 10 (`corepack enable`)
- PostgreSQL 16 with PostGIS 3 — locally, or `docker compose up -d db` (then use `DATABASE_URL=postgres://nodara:<POSTGRES_PASSWORD>@localhost:5432/nodara` after publishing port 5432, or run Postgres yourself)

```bash
createuser -s nodara && createdb -O nodara nodara && createdb -O nodara nodara_test
psql nodara -c 'CREATE EXTENSION postgis'
```

## Run

```bash
pnpm install
pnpm --filter @nodara/server dev     # http://localhost:8080 (tsx watch, migrations on start)
pnpm --filter @nodara/web dev        # http://localhost:5173, proxies /api (incl. WebSocket) to :8080
```

The API defaults to `PUBLIC_URL=http://localhost:5173`, so open the Vite URL. Geolocation works on `localhost` without HTTPS. To test on a phone, use an HTTPS tunnel or a reverse proxy with a real certificate.

Demo data:

```bash
pnpm seed:demo -- --join you@example.com    # demo family + 14 days of history, adds you to the demo circle
pnpm seed:demo -- --live                     # keep "Sam" driving around in real time via the HTTP API
pnpm seed:demo -- --purge                    # remove all demo data
```

## Tests

| Command | What |
|---|---|
| `pnpm test` | Unit tests (trip detection, speed filter, geofence hysteresis, geo/units) and API integration tests against `TEST_DATABASE_URL` (default `postgres://nodara:nodara@localhost:5432/nodara_test`, schema is wiped). |
| `pnpm --filter @nodara/web build && pnpm test:e2e` | Playwright end-to-end: first-run setup → circle → invitation → second user registers and shares location → first user sees it on the map and in history; desktop and mobile viewports. Uses `E2E_DATABASE_URL` (default `…/nodara_e2e`, wiped). Set `CHROMIUM_PATH` to use a preinstalled Chromium. |
| `pnpm typecheck` | TypeScript across all packages (including the service worker). |

## Project conventions

- **Server:** Fastify plugins per domain in `src/modules`, business logic in `src/services`. Validate every input with zod via `parse()`. Authorization goes through `services/access.ts`. Use `postgres.js` tagged templates only.
- **Migrations:** add `src/db/migrations/NNNN_description.sql`. They run in a transaction at startup.
- **Web:** pages in `src/pages`, reusable UI in `src/components/ui.tsx`, domain features in `src/features`. Server state via TanStack Query; realtime events patch the cache in `lib/realtime.ts`. Design tokens are CSS variables in `styles.css` (light + dark).
- **Shared types:** API shapes live in `packages/shared/src/types.ts`.

## Production build

```bash
pnpm build                                       # web → apps/web/dist, server → apps/server/dist
cd apps/server && WEB_DIST=../web/dist node dist/index.js
docker build -t nodara .                          # or the full image
```
