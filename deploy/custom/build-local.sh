#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

source_revision=$(git rev-parse HEAD)
pnpm install --frozen-lockfile
# The example .env targets development ports. Packaged deployments use the proxy.
VITE_API_BASE_URL="" VITE_WEB_BASE_URL="" VITE_ADMIN_BASE_URL="" \
  VITE_SPACE_BASE_URL="" VITE_LIVE_BASE_URL="" \
  VITE_ADMIN_BASE_PATH="/god-mode" VITE_SPACE_BASE_PATH="/spaces" VITE_LIVE_BASE_PATH="/live" \
  pnpm turbo run build --filter=web --concurrency=2
docker build --file deploy/custom/Dockerfile.web-local \
  --build-arg "SOURCE_REVISION=$source_revision" \
  --tag "${PLANE_FRONTEND_IMAGE:-plane-custom/frontend:local}" apps/web/build/client
docker build --file apps/api/Dockerfile.api \
  --label "org.opencontainers.image.revision=$source_revision" \
  --label org.opencontainers.image.source=https://github.com/zwscy/plane \
  --tag "${PLANE_BACKEND_IMAGE:-plane-custom/backend:local}" apps/api
