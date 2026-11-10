#!/usr/bin/env bash
# Run off-host. Reuse the SPA built and verified from the exact source revision.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo_root"
source_revision=$(git rev-parse HEAD)
web_revision=${PLANE_DEV2_WEB_SOURCE_REVISION:-}

if [[ -z "$web_revision" ]] || ! web_revision=$(git rev-parse --verify "$web_revision^{commit}" 2>/dev/null); then
  echo "Set PLANE_DEV2_WEB_SOURCE_REVISION to the verified prebuilt SPA source commit." >&2
  exit 1
fi
if ! git diff --quiet "$web_revision" "$source_revision" -- apps/web packages package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json; then
  echo "Prebuilt SPA source differs from the current application/build inputs." >&2
  exit 1
fi
if [[ ! -f apps/web/build/client/index.html ]]; then
  echo "Missing prebuilt apps/web/build/client/index.html." >&2
  exit 1
fi
if ! git diff --quiet "$source_revision" -- apps packages package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json; then
  echo "Application/build inputs differ from the verified source revision." >&2
  exit 1
fi

build_id="dev2-${source_revision:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
frontend_image="plane-dev2/frontend:$build_id"
backend_image="plane-dev2/backend:$build_id"
output_dir="$repo_root/.local/dev2-deploy/build-$build_id"
mkdir -p -- "$output_dir"

docker buildx build --platform linux/amd64 --load \
  --file deploy/custom/Dockerfile.web-local \
  --build-arg "SOURCE_REVISION=$source_revision" \
  --tag "$frontend_image" apps/web/build/client
docker buildx build --platform linux/amd64 --load \
  --file apps/api/Dockerfile.api \
  --label "org.opencontainers.image.revision=$source_revision" \
  --label org.opencontainers.image.source=https://github.com/zwscy/plane \
  --tag "$backend_image" apps/api

for image in "$frontend_image" "$backend_image"; do
  image_metadata=$(docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  read -r image_id image_platform image_revision <<< "$image_metadata"
  if [[ "$image_platform" != linux/amd64 || "$image_revision" != "$source_revision" ]]; then
    echo "Unexpected architecture or source label for $image; refusing to export." >&2
    exit 1
  fi
  printf '%s %s\n' "$image" "$image_metadata" >> "$output_dir/images.txt"
done

printf 'PLANE_FRONTEND_IMAGE=%s\nPLANE_BACKEND_IMAGE=%s\n' \
  "$frontend_image" "$backend_image" > "$output_dir/images.env"
printf '%s\n' "$source_revision" > "$output_dir/source-revision"
printf '%s\n' "$web_revision" > "$output_dir/web-source-revision"
# Id refers to different digest layers across classic/containerd image stores.
# Keep full content evidence; do not use images.txt Id alone for remote acceptance.
docker image inspect "$frontend_image" "$backend_image" > "$output_dir/images.inspect.json"
docker save --output "$output_dir/app-images.tar" "$frontend_image" "$backend_image"
python3 - "$output_dir/app-images.tar" <<'PY'
import hashlib
from pathlib import Path
import sys

archive = Path(sys.argv[1])
digest = hashlib.sha256()
with archive.open("rb") as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
archive.with_suffix(archive.suffix + ".sha256").write_text(f"{digest.hexdigest()}  {archive.name}\n")
PY
echo "Exported linux/amd64 application images to $output_dir"
