#!/bin/sh
set -e
# Apply any pending database migrations, then start the app.
./node_modules/.bin/prisma migrate deploy
exec ./node_modules/.bin/next start -p "${PORT:-3000}" -H 0.0.0.0
