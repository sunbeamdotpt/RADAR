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
KUBECONFIG_TMP=""
NETWORK_ARGS=("--network" "$NETWORK")
DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@radar-dev-db:5432/${PG_DB}?sslmode=disable"

# Auto-detect a local kubeconfig when none is explicitly provided so dev dry-runs
# work out of the box against kind/minikube/k3d clusters.
if [[ -z "${RADAR_DRYRUN_KUBECONFIG:-}" && -f "${HOME}/.kube/config" ]]; then
  RADAR_DRYRUN_KUBECONFIG="${HOME}/.kube/config"
fi

if [[ -n "${RADAR_DRYRUN_KUBECONFIG:-}" ]]; then
  # Copy the kubeconfig to a world-readable temp file so the container's deno
  # user can read it regardless of host ownership. The original file is untouched.
  KUBECONFIG_TMP=$(mktemp)
  cp "${RADAR_DRYRUN_KUBECONFIG}" "${KUBECONFIG_TMP}"
  chmod 644 "${KUBECONFIG_TMP}"
  KUBECONFIG_MOUNT="-v ${KUBECONFIG_TMP}:/tmp/kubeconfig:ro"
  KUBECONFIG_ENV="-e RADAR_DRYRUN_KUBECONFIG=/tmp/kubeconfig"
  # Kubeconfigs that point to 127.0.0.1 (e.g. kubectl port-forward) only resolve
  # from the host network namespace. Switch to host networking and point Postgres
  # at the host-mapped port so both the cluster and the dev DB remain reachable.
  NETWORK_ARGS=("--network" "host")
  DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:5432/${PG_DB}?sslmode=disable"
fi

cleanup() {
  if [[ -n "${KUBECONFIG_TMP:-}" && -f "${KUBECONFIG_TMP}" ]]; then
    rm -f "${KUBECONFIG_TMP}"
  fi
}
trap cleanup EXIT

docker volume create radar-dev-data >/dev/null
docker run --rm \
  "${NETWORK_ARGS[@]}" \
  $KUBECONFIG_MOUNT \
  $KUBECONFIG_ENV \
  -e STORAGE=postgres \
  -e DATABASE_URL="$DATABASE_URL" \
  -e RADAR_SEED_PATH=./seed/component-versions.yaml \
  -e GIT_BASE_URL="${GIT_BASE_URL:-https://github.com/sunbeamdotpt/sbbb.git}" \
  -e GIT_BASE_REF="${GIT_BASE_REF:-mainline}" \
  -e RADAR_DRYRUN_BUILD_ONLY="${RADAR_DRYRUN_BUILD_ONLY:-false}" \
  -e RADAR_JSON_PATH=/app/data/component-versions.json \
  -v radar-dev-data:/app/data \
  sunbeam-radar-dryrun:dev \
  "$@"
