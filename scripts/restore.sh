#!/usr/bin/env bash
# Restore a backup made by backup.sh. This REPLACES the current database.
#   ./scripts/restore.sh backups/nodara-YYYYmmdd-HHMMSS.dump
set -euo pipefail
cd "$(dirname "$0")/.."
file=${1:?usage: restore.sh <backup.dump>}
read -r -p "This will overwrite the current Nodara database. Type 'restore' to continue: " ok
[ "$ok" = "restore" ] || { echo "Aborted"; exit 1; }
docker compose stop nodara
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < "$file"
docker compose start nodara
echo "Restored $file"
