#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
runtime_env=${PLANE_CUSTOM_ENV_FILE:-.local/runtime.env}
if [[ ! -f "$runtime_env" ]]; then
  echo "Missing $runtime_env; see deploy/custom/README.md" >&2
  exit 1
fi
exec docker compose --project-name plane-custom --env-file "$runtime_env" \
  --file deploy/custom/compose.yaml "$@"
