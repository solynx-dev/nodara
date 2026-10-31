#!/usr/bin/env bash
# Back up the Nodara database to ./backups (compressed custom-format dump).
#   ./scripts/backup.sh            # uses docker compose
# Restore with ./scripts/restore.sh <file>
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
out="backups/nodara-${stamp}.dump"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6' > "$out"
echo "Wrote $out ($(du -h "$out" | cut -f1))"
# Keep the 14 most recent backups.
ls -1t backups/nodara-*.dump | tail -n +15 | xargs -r rm --
