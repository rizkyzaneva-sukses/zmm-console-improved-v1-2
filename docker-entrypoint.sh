#!/bin/sh
set -e

echo "⏳ Waiting for database to be ready..."

# Extract host and port from DATABASE_URL
# Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):\([0-9]*\)/.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):\([0-9]*\)/.*|\2|p')

echo "   Host: $DB_HOST:$DB_PORT"

# Wait up to 60 seconds for the database
retries=0
max_retries=30
until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    echo "❌ Database not reachable after ${max_retries} attempts. Exiting."
    exit 1
  fi
  echo "   Attempt $retries/$max_retries — DB not ready, retrying in 2s..."
  sleep 2
done

echo "✅ Database is ready!"

echo "🔄 Running Prisma migrations..."
npx prisma migrate deploy

echo "🚀 Starting application..."
exec npm run start
