#!/usr/bin/env bash
# Run one RADAR dry-run preview pass (pipeline step 3) against the dev stack.
# Requires inventory + assessment runs first (scripts/dev-job.sh, scripts/dev-assess.sh).
# Dev kubeconfig is opt-in via RADAR_DRYRUN_KUBECONFIG (mounted read-only).
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

echo "building dry-run job image..."
docker build -q -f "$ROOT/docker/dryrun.Dockerfile" -t sunbeam-radar-dryrun:dev "$ROOT" >/dev/null

KUBECONFIG_MOUNT=""
KUBECONFIG_ENV=""
if [[ -n "${RADAR_DRYRUN_KUBECONFIG:-}" ]]; then
  KUBECONFIG_MOUNT="-v ${RADAR_DRYRUN_KUBECONFIG}:/tmp/kubeconfig:ro"
  KUBECONFIG_ENV="-e RADAR_DRYRUN_KUBECONFIG=/tmp/kubeconfig"
fi

docker volume create radar-dev-data >/dev/null
docker run --rm \
  --network "$NETWORK" \
  $KUBECONFIG_MOUNT \
  $KUBECONFIG_ENV \
  -e STORAGE=postgres \
  -e DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@radar-dev-db:5432/${PG_DB}?sslmode=disable" \
  -e RADAR_SEED_PATH=./seed/component-versions.yaml \
  -e GIT_BASE_URL="${GIT_BASE_URL:-https://github.com/sunbeamdotpt/sbbb.git}" \
  -e GIT_BASE_REF="${GIT_BASE_REF:-mainline}" \
  -e RADAR_DRYRUN_BUILD_ONLY="${RADAR_DRYRUN_BUILD_ONLY:-false}" \
  -e RADAR_JSON_PATH=/app/data/component-versions.json \
  -v radar-dev-data:/app/data \
  sunbeam-radar-dryrun:dev \
  "$@"
