#!/usr/bin/env bash
# Run one RADAR assessment pass (pipeline step 2) against the dev stack.
# Requires an inventory run first (scripts/dev-job.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="radar-dev"
DB_CONTAINER="radar-dev-db"
PG_USER="radar"
PG_PASSWORD="radar-dev"
PG_DB="radar_db"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "dev stack is not up — run scripts/dev-up.sh first" >&2
  exit 1
fi

echo "building job image..."
docker build -q -f "$ROOT/docker/job.Dockerfile" -t sunbeam-radar-job:dev "$ROOT" >/dev/null

# The job image's ENTRYPOINT is the inventory job; override it for the assessor.
docker volume create radar-dev-data >/dev/null
docker run --rm \
  --network "$NETWORK" \
  --entrypoint deno \
  -e STORAGE=postgres \
  -e DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@radar-dev-db:5432/${PG_DB}?sslmode=disable" \
  -e RADAR_SEED_PATH=./seed/component-versions.yaml \
  -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
  -e RADAR_OFFLINE="${RADAR_OFFLINE:-false}" \
  -e RADAR_ASSESS_UPDATES_ONLY="${RADAR_ASSESS_UPDATES_ONLY:-false}" \
  -e RADAR_JSON_PATH=/app/data/component-versions.json \
  -v radar-dev-data:/app/data \
  sunbeam-radar-job:dev \
  run --allow-env --allow-net --allow-read --allow-write src/assess/main.ts "$@"
