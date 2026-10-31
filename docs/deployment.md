# Deploying Nodara

Nodara ships as a single Docker image (API server + web app) plus PostgreSQL with PostGIS. A family instance runs comfortably on a 1 vCPU / 1 GB VPS, a home server or a Raspberry Pi 4/5 (arm64 images build from the same Dockerfile).

> Nodara handles sensitive location data. Read [the threat model](security.md) and always serve it over HTTPS.

## 1. Requirements

- Docker Engine 24+ with the Compose plugin
- A domain name pointing at the server (for HTTPS) — or a private network with your own certificates
- Ports 80/443 open if you use the bundled Caddy profile

## 2. Configure

```bash
git clone https://github.com/solynx-dev/nodara.git
cd nodara
cp .env.example .env
```

Edit `.env` — at minimum:

| Variable | Why |
|---|---|
| `PUBLIC_URL` | The exact URL people use, e.g. `https://nodara.example.com`. Used for links, cookies and passkeys. |
| `SESSION_SECRET` | Long random string: `openssl rand -base64 32`. Required in production. |
| `POSTGRES_PASSWORD` | Database password (the database is not exposed outside Docker). |
| `TRUST_PROXY=true` | When running behind a reverse proxy, so rate limits and audit logs see real client IPs. |

All options: [configuration.md](configuration.md).

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f nodara      # migrations run automatically on start
curl -s http://127.0.0.1:8080/api/health
```

By default Nodara binds to `127.0.0.1:8080` so it is only reachable through your reverse proxy. Change `NODARA_BIND`/`NODARA_PORT` in `.env` if needed.

## 4. HTTPS

Browsers only expose geolocation, service workers, push and passkeys on secure origins (`https://` or `http://localhost`). Pick one:

### Option A — bundled Caddy (simplest)

Set `NODARA_DOMAIN=nodara.example.com` in `.env`, point DNS at the server, then:

```bash
docker compose --profile caddy up -d
```

Caddy obtains and renews Let's Encrypt certificates automatically (`docker/Caddyfile`).

### Option B — your own Caddy

```caddy
nodara.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}
```

### Option C — nginx

```nginx
server {
    listen 443 ssl http2;
    server_name nodara.example.com;
    ssl_certificate     /etc/letsencrypt/live/nodara.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nodara.example.com/privkey.pem;

    client_max_body_size 6m;   # Overland batches can be large

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSockets for live updates
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

### Option D — Traefik (labels on the `nodara` service)

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.nodara.rule=Host(`nodara.example.com`)
  - traefik.http.routers.nodara.entrypoints=websecure
  - traefik.http.routers.nodara.tls.certresolver=letsencrypt
  - traefik.http.services.nodara.loadbalancer.server.port=8080
```

WebSockets work through Traefik without extra configuration.

## 5. First run

1. Open `PUBLIC_URL`. You'll see **Set up your Nodara server** — create the administrator account. (Set `SETUP_TOKEN` in `.env` if the server is reachable by others before you finish setup.)
2. Create a circle and send an invite link.
3. On phones: open Nodara in the browser → **Share → Add to Home Screen** (iOS) or **Install app** (Android/Chrome).
4. For continuous background sharing, connect [OwnTracks or Overland](clients.md).

Alternatively create the first admin from the CLI:

```bash
docker compose exec -e NODARA_ADMIN_PASSWORD='a long passphrase' nodara \
  node dist/cli/create-admin.js --email you@example.com --name "Your Name"
# Promote an existing user:
docker compose exec nodara node dist/cli/create-admin.js --email them@example.com --promote
```

## 6. Updating

```bash
git pull
docker compose up -d --build
```

Database migrations are applied automatically at startup inside a transaction with an advisory lock. **Take a backup before upgrading** (`./scripts/backup.sh`). The running version is shown in **Administration → System** and at `/api/version`.

## 7. Backups

See [backup-restore.md](backup-restore.md). Short version: `./scripts/backup.sh` nightly via cron, copy `backups/` off the machine.

## 8. Health & monitoring

- `GET /api/health` → `200 {"status":"ok"}` when the database is reachable, `503` otherwise. The Docker image has a built-in `HEALTHCHECK`.
- `GET /api/version` → running version.
- Logs go to stdout (JSON). Per-request logging is off by default because request logs would reveal who looked at whose location; set `LOG_LEVEL=debug` temporarily if you need it.

## 9. Running without Docker

```bash
pnpm install --frozen-lockfile
pnpm build
cd apps/server
DATABASE_URL=postgres://… PUBLIC_URL=https://… SESSION_SECRET=… NODE_ENV=production \
  WEB_DIST=../web/dist node dist/index.js
```

Use a process manager (systemd, pm2) and the reverse-proxy examples above.
