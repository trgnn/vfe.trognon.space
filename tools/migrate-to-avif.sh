#!/bin/bash
# One-shot migration of the album archive from WebP to AVIF.
#
# For every set under site/assets/album-live/, regenerate full/ + thumbs/ as AVIF
# from the downloads/*.jpg originals (the source of truth), fix the preload links in
# already-generated album pages, drop the stale local .webp, re-upload everything to
# Vercel Blob, and purge the obsolete .webp objects on Blob.
#
# Encode settings MUST stay in sync with sync-and-push.sh:
#   full/   → AVIF q55
#   thumbs/ → AVIF q50, 760px on the short side (no upscaling)
#
# Requires BLOB_READ_WRITE_TOKEN (read from .env at the project root).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$SCRIPT_DIR/site"
LIVE="$SITE/assets/album-live"

echo ""
echo "=== Album media migration: WebP → AVIF ==="
echo ""

# Fail fast if the Blob token is missing — we don't want to regenerate everything
# locally only to abort right before the upload.
if ! node --env-file-if-exists="$SCRIPT_DIR/.env" -e 'process.exit(process.env.BLOB_READ_WRITE_TOKEN ? 0 : 1)' 2>/dev/null; then
  echo "Error: BLOB_READ_WRITE_TOKEN not found. Set it in .env at the project root."
  echo ""
  exit 1
fi

if [ ! -d "$LIVE" ]; then
  echo "Error: $LIVE does not exist — nothing to migrate."
  exit 1
fi

# ── 1. Regenerate full/ + thumbs/ as AVIF from downloads/*.jpg ──────────────────
echo "Regenerating AVIF derivatives from downloads/*.jpg..."
python3 - "$LIVE" << 'PYEOF'
import os, sys
from PIL import Image

live = sys.argv[1]
total = 0
for root, _dirs, files in os.walk(live):
    if os.path.basename(root) != 'downloads':
        continue
    set_dir = os.path.dirname(root)
    full_dir = os.path.join(set_dir, 'full')
    thumb_dir = os.path.join(set_dir, 'thumbs')
    os.makedirs(full_dir, exist_ok=True)
    os.makedirs(thumb_dir, exist_ok=True)
    for f in sorted(files):
        if not f.lower().endswith(('.jpg', '.jpeg')):
            continue
        stem = os.path.splitext(f)[0]
        img = Image.open(os.path.join(root, f)).convert('RGB')
        # Full-screen: full resolution, AVIF q55.
        img.save(os.path.join(full_dir, stem + '.avif'), 'AVIF', quality=55, speed=6)
        # Thumbnail: 760px on the short side (retina-ready), AVIF q50. Never upscale.
        w, h = img.size
        scale = min(760 / min(w, h), 1.0)
        thumb = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else img
        thumb.save(os.path.join(thumb_dir, stem + '.avif'), 'AVIF', quality=50, speed=6)
        total += 1
print(f"  {total} image(s) regenerated as AVIF.")
PYEOF
echo ""

# ── 2. Fix preload links in already-generated album pages ───────────────────────
# The static preload must point where gallery.js actually fetches images
# (VFE_MEDIA_BASE) and at the .avif thumbnail. Older pages baked a same-origin
# "/assets/..." href with a .webp extension — both base and extension are fixed here.
MEDIA_BASE=$(grep -oE "^const VFE_MEDIA_BASE[[:space:]]*=[[:space:]]*'[^']*'" "$SITE/js/config.js" 2>/dev/null | sed "s/.*'\([^']*\)'.*/\1/")
echo "Fixing preload links in albums/*.html (base + .avif)..."
python3 - "$SITE/albums" "$MEDIA_BASE" << 'PYEOF'
import os, re, sys
albums_dir, base = sys.argv[1], sys.argv[2]
# Drop any existing origin/base before /assets/album-live/, force the .avif
# extension, and prepend VFE_MEDIA_BASE. Idempotent.
pat = re.compile(r'(<link rel="preload"[^>]*href=")[^"]*?(/assets/album-live/[^"]*?)\.(?:webp|avif)(")')
for name in sorted(os.listdir(albums_dir)):
    if not name.endswith('.html'):
        continue
    p = os.path.join(albums_dir, name)
    with open(p) as f:
        html = f.read()
    new = pat.sub(rf'\g<1>{base}\g<2>.avif\g<3>', html)
    if new != html:
        with open(p, 'w') as f:
            f.write(new)
        print(f"  {name}")
PYEOF
echo ""

# ── 3. Drop the stale local .webp derivatives ──────────────────────────────────
WEBP_COUNT=$(find "$LIVE" -type f -iname '*.webp' | wc -l | tr -d ' ')
find "$LIVE" -type f -iname '*.webp' -delete
echo "Removed $WEBP_COUNT local .webp file(s)."
echo ""

# ── 4. Re-upload everything to Vercel Blob (new .avif + existing downloads/.jpg) ─
echo "Uploading to Vercel Blob..."
node --env-file-if-exists="$SCRIPT_DIR/.env" "$SCRIPT_DIR/tools/blob-sync.mjs"
echo ""

# ── 5. Purge obsolete .webp objects on Blob ─────────────────────────────────────
echo "Purging stale .webp on Blob..."
node --env-file-if-exists="$SCRIPT_DIR/.env" "$SCRIPT_DIR/tools/blob-del-webp.mjs"

echo ""
echo "══════════════════════════════════════════"
echo "Migration complete. The archive now serves AVIF."
echo ""
