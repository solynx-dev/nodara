# Backup & restore

All Nodara state lives in PostgreSQL: accounts, circles, location history, trips, places, notifications, settings and the generated Web Push keys. Backing up the database backs up everything.

## Back up

```bash
./scripts/backup.sh
# → backups/nodara-20260131-020000.dump   (keeps the 14 most recent)
```

The script runs `pg_dump --format=custom` inside the `db` container. Schedule it, e.g. nightly with cron:

```cron
15 2 * * *  cd /opt/nodara && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**Copy backups off the machine** (restic, borg, rclone, another disk). A backup on the same disk as the database protects against mistakes, not hardware failure. Backups contain everyone's location history — encrypt them at rest.

## Restore

```bash
./scripts/restore.sh backups/nodara-20260131-020000.dump
```

This stops Nodara, recreates the database from the dump and starts Nodara again. Users stay signed in (sessions are in the database).

## Manual equivalents

```bash
# Backup
docker compose exec -T db pg_dump -U nodara -d nodara -Fc > nodara.dump
# Restore into an empty database
docker compose exec -T db pg_restore -U nodara -d nodara --no-owner < nodara.dump
```

## Moving to a new server (or from Nodara Cloud to self-hosting)

1. Back up the old instance (or download the database export provided by the host).
2. Deploy Nodara on the new server ([deployment.md](deployment.md)) with the **same `PUBLIC_URL`** if you can — passkeys are bound to the domain.
3. `./scripts/restore.sh <dump>`.
4. Update DNS. Phones reconnect automatically; OwnTracks/Overland keep working if the URL is unchanged.

Individual users can also download their own data at any time from **Settings → Your data** (JSON, GeoJSON, GPX, CSV).
