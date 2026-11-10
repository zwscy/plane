#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
runtime_env=${PLANE_DEV2_ENV_FILE:-/home/plane/plane.env}
project_name=${PLANE_DEV2_PROJECT_NAME:-plane-dev2}

if [[ ! -r "$runtime_env" ]]; then
  echo "Missing readable Plane dev2 environment file: $runtime_env" >&2
  exit 1
fi

exec docker compose --project-name "$project_name" --env-file "$runtime_env" \
  --file "$script_dir/compose.yaml" "$@"
