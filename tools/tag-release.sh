#!/usr/bin/env bash
#
# tag-release.sh — close a milestone: bump VFE_VERSION and lay an annotated tag.
#
# Usage:
#   tools/tag-release.sh v1.2 "Short milestone description"
#
# What it does, in order:
#   1. Validates the version (v{major}.{minor}) and that the tag is free.
#   2. Requires a clean working tree, so the release commit only carries the bump.
#   3. Rewrites VFE_VERSION in site/js/config.js (the UI source of truth).
#   4. Commits that bump as the commit that closes the phase.
#   5. Lays an annotated tag on it.
#
# It never pushes. Send the milestone up yourself when ready:
#   git push --follow-tags
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/site/js/config.js"

VERSION="${1:-}"
MESSAGE="${2:-}"

if [[ -z "$VERSION" || -z "$MESSAGE" ]]; then
  echo "usage: tools/tag-release.sh v<major>.<minor> \"milestone description\"" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must look like v1.2 (got '$VERSION')" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  echo "error: tag $VERSION already exists" >&2
  exit 1
fi

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "error: working tree not clean — commit or stash first so the" >&2
  echo "       release commit only contains the version bump." >&2
  exit 1
fi

# Rewrite the VFE_VERSION literal in place (BSD/macOS sed).
sed -i '' -E "s/^const VFE_VERSION = '[^']*';/const VFE_VERSION = '$VERSION';/" "$CONFIG"

if ! grep -q "const VFE_VERSION = '$VERSION';" "$CONFIG"; then
  echo "error: failed to update VFE_VERSION in $CONFIG" >&2
  git -C "$ROOT" checkout -- "$CONFIG"
  exit 1
fi

git -C "$ROOT" add "$CONFIG"
git -C "$ROOT" commit -m "Release $VERSION"
git -C "$ROOT" tag -a "$VERSION" -m "$MESSAGE"

echo "Tagged $VERSION on $(git -C "$ROOT" rev-parse --short HEAD)."
echo "Push when ready:  git push --follow-tags"
