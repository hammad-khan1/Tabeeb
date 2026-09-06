#!/usr/bin/env bash
#
# Pull, rebuild, migrate, restart. Safe to run repeatedly.
#
#   bash /opt/tabeeb/deploy/redeploy.sh
#
# Expects /opt/tabeeb/.env to exist — see .env.example for what goes in it.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tabeeb}"
BRANCH="${BRANCH:-main}"
IMAGE=tabeeb
CONTAINER=tabeeb
ENV_FILE="$APP_DIR/.env"

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example and fill it in first." >&2
  exit 1
fi

# The Clerk publishable key must be a BUILD argument, not only a runtime variable:
# Next inlines NEXT_PUBLIC_* into the client bundle at build time. Supplying it only
# at runtime produces an image that builds cleanly and then returns 500 on every
# request, with nothing in the logs pointing at the cause.
PUBLISHABLE_KEY="$(grep -E '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
APP_URL="$(grep -E '^NEXT_PUBLIC_APP_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"

if [ -z "$PUBLISHABLE_KEY" ]; then
  echo "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set in $ENV_FILE." >&2
  echo "It is required at build time, not just at runtime." >&2
  exit 1
fi

echo "==> Pulling $BRANCH"
git fetch origin
git reset --hard "origin/$BRANCH"

echo "==> Building the image"
docker build \
  --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$PUBLISHABLE_KEY" \
  --build-arg "NEXT_PUBLIC_APP_URL=$APP_URL" \
  -t "$IMAGE:latest" .

echo "==> Applying migrations"
# Run against the new image before switching traffic, so a failed migration stops the
# deploy rather than leaving a running container talking to a half-migrated database.
docker run --rm --env-file "$ENV_FILE" \
  --entrypoint node "$IMAGE:latest" drizzle/migrate.mjs \
  || { echo "Migration failed — not restarting the app." >&2; exit 1; }

echo "==> Restarting"
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -p 127.0.0.1:3000:3000 \
  "$IMAGE:latest"

echo "==> Waiting for it to answer"
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null http://127.0.0.1:3000/sign-in; then
    echo "Up."
    docker image prune -f > /dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done

echo "It did not come up. Logs:" >&2
docker logs --tail 40 "$CONTAINER" >&2
exit 1
