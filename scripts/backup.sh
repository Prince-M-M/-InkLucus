#!/usr/bin/env bash
# Daily backup of the database and uploaded covers. Keeps the last 14 days.
# Run from the project directory on the server:  ./scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y-%m-%d_%H%M)
docker compose exec -T db pg_dump -U inklucus -d inklucus --format=custom > "backups/db-$stamp.dump"
docker compose exec -T app tar -czf - -C /app uploads > "backups/uploads-$stamp.tar.gz"
find backups -type f -mtime +14 -delete
echo "Backup written: backups/db-$stamp.dump and backups/uploads-$stamp.tar.gz"
