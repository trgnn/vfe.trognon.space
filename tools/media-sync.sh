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
# Needs rclone (brew install rclone) and the Cloudflare API token in the macOS
# keychain (service `cloudflare-deploy-trognon`, Workers R2 Storage: Edit). R2
# accepts it as S3 credentials: access key = the token's ID, secret = its SHA-256.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS="$SCRIPT_DIR/../site/assets"
ACCOUNT=821b62927872e6831a76b86ca69c6886
DEST="r2:cdn/vfe/assets"

command -v rclone >/dev/null || { echo "rclone is missing: brew install rclone" >&2; exit 1; }
TOKEN="$(security find-generic-password -s cloudflare-deploy-trognon -w 2>/dev/null)" \
  || { echo "Cloudflare token not found in the keychain (cloudflare-deploy-trognon)." >&2; exit 1; }
TOKEN_ID="$(curl -s -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["result"]["id"])')" \
  || { echo "Cloudflare token rejected (expired?)." >&2; exit 1; }

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$TOKEN_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)"
export RCLONE_CONFIG_R2_ENDPOINT="https://$ACCOUNT.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

ARGS=(sync "$ASSETS" "$DEST" --filter "- .DS_Store" --filter "+ album/**" --filter "+ series/**" --filter "- **"
      --checksum --fast-list --transfers 16)

if [ "${1:-}" = "--apply" ]; then
  rclone "${ARGS[@]}" --stats-one-line --stats 10s -v
  echo "cdn mirror applied."
  exit 0
fi

REPORT="$(rclone "${ARGS[@]}" --dry-run 2>&1 | grep -E "Skipped (copy|delete)" || true)"
if [ -z "$REPORT" ]; then
  echo "cdn already in sync with assets/. Nothing to do."
  exit 10
fi
UPLOADS="$(grep -c "Skipped copy" <<<"$REPORT" || true)"
DELETES="$(grep -c "Skipped delete" <<<"$REPORT" || true)"
sed -E 's/^.*NOTICE: ([^:]+): Skipped (copy|delete).*$/  \2  \1/; s/  copy  /  upload  /' <<<"$REPORT" | head -40
[ "$((UPLOADS + DELETES))" -gt 40 ] && echo "  … and $((UPLOADS + DELETES - 40)) more"
echo "To mirror: $UPLOADS upload(s), $DELETES deletion(s)."
exit 0
