#!/usr/bin/env bash
# Tear down the RADAR dev stack. Pass --volumes to also drop the data volumes.
set -euo pipefail

docker rm -f radar-dev-api radar-dev-db >/dev/null 2>&1 || true
docker network rm radar-dev >/dev/null 2>&1 || true

if [[ "${1:-}" == "--volumes" ]]; then
  docker volume rm radar-dev-pgdata radar-dev-data >/dev/null 2>&1 || true
  echo "stack and volumes removed"
else
  echo "stack removed (volumes kept; pass --volumes to drop them)"
fi
