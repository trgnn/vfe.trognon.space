#!/bin/bash
# Mirror the live album/series media to cdn.trognon.space.
#
# The local copy under site/assets/{album,series}/ is the source of truth; online,
# it lives in the Cloudflare R2 bucket `cdn`, folder vfe/assets/ (the site prepends
# VFE_MEDIA_BASE, see site/js/config.js — the path after the base is the same).
#
#   tools/media-sync.sh            REPORT the diff (exit 0: changes pending, 10: in sync)
#   tools/media-sync.sh --apply    APPLY it: upload missing/changed, delete extras
#
# Only vfe/assets/album/ and vfe/assets/series/ are ever touched in the bucket.
# The mirror itself is the shared cdn script (~/Projects/trognon-space/cdn/sync.sh:
# rclone, the Cloudflare token from 1Password).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS="$SCRIPT_DIR/../site/assets"
SYNC="$HOME/Projects/trognon-space/cdn/sync.sh"

[ -x "$SYNC" ] || { echo "The cdn repo is missing: $SYNC" >&2; exit 1; }
# A checkout without its images would delete them online: refuse.
if [ -z "$(find "$ASSETS/album" "$ASSETS/series" -type f -name '*.avif' 2>/dev/null | head -1)" ]; then
  echo "No local images under site/assets/: nothing to mirror (this would delete them online)." >&2
  exit 1
fi
exec "$SYNC" "$ASSETS" vfe/assets album series "$@"
