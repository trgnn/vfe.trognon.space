#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE="$SCRIPT_DIR/site"
STAGING="$SCRIPT_DIR/album-staging"
ASSETS="$SITE/assets"          # holds album/ and series/ media roots
DATA="$SITE/js/data.js"
DATA_EDIT="$SCRIPT_DIR/tools/data_edit.py"

echo ""
echo "=== View From Elsewhere — Sync & Push ==="
echo ""

# Count source images. Live media keeps its originals in downloads/; staging
# units hold them flat at the unit root.
count_images() {
  local dir="$1"
  [ -d "$dir/downloads" ] && dir="$dir/downloads"
  find "$dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" \) | wc -l | tr -d ' '
}

# ── Album media uploads to Vercel Blob: fail fast on a missing token ─────────────
if ! node --env-file-if-exists="$SCRIPT_DIR/.env" -e 'process.exit(process.env.BLOB_READ_WRITE_TOKEN ? 0 : 1)' 2>/dev/null; then
  echo "Error: BLOB_READ_WRITE_TOKEN not found. Set it in .env at the project root."
  echo ""
  exit 1
fi

# ── 1. Reconcile assets/ → data.js ──────────────────────────────────────────────
# Fix count drift / vanished items (with confirmation) and resolve any orphan
# (present on disk, missing from data.js) by prompting for its info right away.
resolve_orphan() {
  local kind="$1" slug="$2"
  echo "  $kind '$slug' present on disk but missing from data.js."
  local action
  while true; do
    read -p "    Fill in its info (f) or delete it from assets/ (d)? : " action
    case "$action" in
      f) break ;;
      d)
        rm -rf "$ASSETS/$kind/$slug"
        echo "    assets/$kind/$slug/ removed."
        echo ""
        return ;;
      *) echo "      → answer 'f' (fill) or 'd' (delete)" ;;
    esac
  done

  local cnt name
  cnt=$(count_images "$ASSETS/$kind/$slug")
  read -p "    Display name [$slug]: " name
  [ -z "$name" ] && name="$slug"
  if [ "$kind" = "series" ]; then
    local desc
    read -p "    Description: " desc
    python3 "$DATA_EDIT" add-series "$DATA" "$slug" "$name" "$desc" "$cnt"
  else
    local dev pub era
    read -p "    Developer(s): " dev
    read -p "    Publisher(s) [Enter if same as developer]: " pub
    [ -z "$pub" ] && pub="$dev"
    while true; do
      read -p "    Current or Archive? (c/a): " era
      case "$era" in c) era=current; break ;; a) era=archive; break ;; *) echo "      → 'c' or 'a'" ;; esac
    done
    python3 "$DATA_EDIT" add-album "$DATA" "$slug" "$name" "$era" "$dev" "$pub" "$cnt"
  fi
  echo "  ✓ '$name' registered in data.js ($cnt image(s))."
  echo ""
}

sync_data_with_assets() {
  echo "=== Sync assets/ → data.js ==="
  echo ""
  local ORPHANS REMOVED
  ORPHANS="$(mktemp)"; REMOVED="$(mktemp)"
  trap 'rm -f "$ORPHANS" "$REMOVED"' RETURN

  set +e
  python3 "$DATA_EDIT" reconcile report "$ASSETS" "$DATA" "$ORPHANS" "$REMOVED"
  local STATUS=$?
  set -e

  if [ "$STATUS" -eq 0 ]; then
    local CONFIRM
    read -p "Apply these fixes? (y/n): " CONFIRM
    echo ""
    if [ "$CONFIRM" = "y" ]; then
      python3 "$DATA_EDIT" reconcile apply "$ASSETS" "$DATA" "$ORPHANS" "$REMOVED"
    else
      echo "Cancelled."; echo ""
    fi
  elif [ "$STATUS" -ne 10 ]; then
    return "$STATUS"
  fi

  # Resolve orphans (lines "kind:slug"). Don't redirect from the file: the
  # read -p prompts inside resolve_orphan must read the terminal.
  local LINES=() line
  if [ -s "$ORPHANS" ]; then
    while IFS= read -r line; do [ -n "$line" ] && LINES+=("$line"); done < "$ORPHANS"
  fi
  for line in "${LINES[@]}"; do
    resolve_orphan "${line%%:*}" "${line#*:}"
  done
}

sync_data_with_assets
echo ""

# ── 1b. Validate collection references (curation.js → data.js) ──────────────────
node "$SCRIPT_DIR/tools/check-collections.mjs"

# ── 1c. Regenerate dims.js (image ratios) from disk ─────────────────────────────
# Keeps the gallery's pre-layout data aligned even on a sync-only run.
python3 "$SCRIPT_DIR/tools/gen-dims.py"
echo ""

# ── 2. Collect staging units ────────────────────────────────────────────────────
# A staged slug folder is either one album (images at its root) or several albums
# (one per image-bearing subdirectory → default slug "{parent}-{N}").
# Fills the parallel arrays UNIT_DIRS / UNIT_SLUGS for a given parent.
collect_units() {
  local parent_dir="$1" parent
  parent=$(basename "$parent_dir")
  UNIT_DIRS=(); UNIT_SLUGS=()

  local subdirs=() sd
  for sd in "$parent_dir"/*/; do
    [ -d "$sd" ] || continue
    [ "$(count_images "$sd")" -gt 0 ] && subdirs+=("$sd")
  done

  if [ ${#subdirs[@]} -gt 0 ]; then
    local i=1
    for sd in "${subdirs[@]}"; do
      UNIT_DIRS+=("${sd%/}")
      UNIT_SLUGS+=("${parent}-${i}")
      i=$((i + 1))
    done
  elif [ "$(count_images "$parent_dir")" -gt 0 ]; then
    UNIT_DIRS+=("$parent_dir")
    UNIT_SLUGS+=("$parent")
  fi
}

PARENTS=()
for dir in "$STAGING"/*/; do
  [ -d "$dir" ] || continue
  collect_units "$dir"
  [ ${#UNIT_DIRS[@]} -gt 0 ] && PARENTS+=("$(basename "$dir")")
done

if [ ${#PARENTS[@]} -eq 0 ]; then
  echo "No images found in album-staging/."
  echo ""
  exit 0
fi

echo "${#PARENTS[@]} staged folder(s) to publish: ${PARENTS[*]}"
echo ""

# ── 3. Publish one unit (= one album or series) ─────────────────────────────────
# Generate downloads/ + full/ + thumbs/ for the images in SRC_DIR under slug SLUG,
# appending after START-1 existing images. Echoes the new total count.
generate_media() {
  local SRC_DIR="$1" TYPE="$2" SLUG="$3" START="$4"
  local DST="$ASSETS/$TYPE/$SLUG"
  mkdir -p "$DST/thumbs" "$DST/full" "$DST/downloads"

  local j="$START"
  while IFS= read -r img; do
    local stem="${SLUG}_$(printf '%02d' "$j")"

    # downloads/: faithful copy if the master is already JPEG (never re-encode
    # JPEG→JPEG); otherwise the Python below encodes JPEG q95/4:4:4 from the master.
    local ext_lc jpg_arg
    ext_lc=$(printf '%s' "${img##*.}" | tr '[:upper:]' '[:lower:]')
    if [ "$ext_lc" = "jpg" ] || [ "$ext_lc" = "jpeg" ]; then
      cp "$img" "$DST/downloads/$stem.jpg"
      jpg_arg="-"
    else
      jpg_arg="$DST/downloads/$stem.jpg"
    fi

    # full/: full-res AVIF q55. thumbs/: AVIF q50, 760px short side (no upscaling).
    # NOTE: keep these encode settings consistent across the project.
    python3 - "$img" "$jpg_arg" "$DST/full/$stem.avif" "$DST/thumbs/$stem.avif" << 'PYEOF'
import sys
from PIL import Image
src, jpg_out, full_out, thumb_out = sys.argv[1:5]
img = Image.open(src)
rgb = img.convert("RGB")  # flatten alpha (JPEG-safe, consistent with AVIF)
if jpg_out != "-":
    rgb.save(jpg_out, "JPEG", quality=95, subsampling=0, optimize=True)
rgb.save(full_out, "AVIF", quality=55, speed=6)
w, h = rgb.size
scale = min(760 / min(w, h), 1.0)
thumb = rgb.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else rgb
thumb.save(thumb_out, "AVIF", quality=50, speed=6)
PYEOF
    j=$((j + 1))
  done < <(find "$SRC_DIR" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.jpg" -o -iname "*.jpeg" \) | sort)
  echo $((j - 1))
}

publish_unit() {
  local SRC_DIR="$1" DEFAULT_SLUG="$2"
  local IMG_COUNT
  IMG_COUNT=$(count_images "$SRC_DIR")

  echo "──────────────────────────────────────────"
  echo "  $(basename "$SRC_DIR")  ($IMG_COUNT image(s))"
  echo ""

  # Confirm/fix the slug: folder name in assets/<type>/, file prefix and data.js key.
  local SLUG
  while true; do
    read -p "  Slug [$DEFAULT_SLUG]: " SLUG
    [ -z "$SLUG" ] && SLUG="$DEFAULT_SLUG"
    [[ "$SLUG" =~ ^[A-Za-z][A-Za-z0-9_-]*$ ]] && break
    echo "    → invalid: letters/digits/-/_ , must start with a letter (e.g. haloInfinite)."
  done
  echo ""

  # Determine type + mode from existing state.
  local EXISTING_TYPE TYPE MODE START
  EXISTING_TYPE=$(python3 "$DATA_EDIT" type "$DATA" "$SLUG")

  if [ "$EXISTING_TYPE" != "none" ]; then
    TYPE="$EXISTING_TYPE"; MODE="append"
    START=$(( $(count_images "$ASSETS/$TYPE/$SLUG") + 1 ))
    echo "  '$SLUG' already exists ($TYPE) → appending $IMG_COUNT image(s)."
  else
    MODE="new"; START=1
    local KIND
    while true; do
      read -p "  Publish as album (a) or series (s)? : " KIND
      case "$KIND" in a) TYPE=album; break ;; s) TYPE=series; break ;; *) echo "    → 'a' or 's'" ;; esac
    done
    local DISPLAY_NAME
    read -p "  Display name [$SLUG]: " DISPLAY_NAME
    [ -z "$DISPLAY_NAME" ] && DISPLAY_NAME="$SLUG"
    if [ "$TYPE" = "series" ]; then
      local DESC
      read -p "  Description: " DESC
    else
      local DEVELOPER PUBLISHER ERA
      read -p "  Developer(s): " DEVELOPER
      read -p "  Publisher(s) [Enter if same as developer]: " PUBLISHER
      [ -z "$PUBLISHER" ] && PUBLISHER="$DEVELOPER"
      while true; do
        read -p "  Current or Archive? (c/a): " ERA
        case "$ERA" in c) ERA=current; break ;; a) ERA=archive; break ;; *) echo "    → 'c' or 'a'" ;; esac
      done
    fi
  fi
  echo ""

  echo "  Generating media (downloads/ + full/ + thumbs/)..."
  local FINAL
  FINAL=$(generate_media "$SRC_DIR" "$TYPE" "$SLUG" "$START")
  echo "  Total: $FINAL image(s) in assets/$TYPE/$SLUG/."

  echo "  Updating data.js..."
  if [ "$MODE" = "append" ]; then
    python3 "$DATA_EDIT" set-count "$DATA" "$SLUG" "$FINAL"
  elif [ "$TYPE" = "series" ]; then
    python3 "$DATA_EDIT" add-series "$DATA" "$SLUG" "$DISPLAY_NAME" "$DESC" "$FINAL"
  else
    python3 "$DATA_EDIT" add-album "$DATA" "$SLUG" "$DISPLAY_NAME" "$ERA" "$DEVELOPER" "$PUBLISHER" "$FINAL"
  fi

  echo "  Uploading media to Vercel Blob..."
  node --env-file-if-exists="$SCRIPT_DIR/.env" "$SCRIPT_DIR/tools/blob-sync.mjs" "$TYPE" "$SLUG"

  echo ""
  echo "  ✓ '$SLUG' ($TYPE) published — $FINAL image(s) total."
  echo ""
}

for PARENT in "${PARENTS[@]}"; do
  collect_units "$STAGING/$PARENT"
  for i in "${!UNIT_DIRS[@]}"; do
    publish_unit "${UNIT_DIRS[$i]}" "${UNIT_SLUGS[$i]}"
  done
  rm -rf "$STAGING/$PARENT"
  echo "  album-staging/$PARENT/ removed."
  echo ""
done

# Refresh image ratios now that new media exists on disk.
python3 "$SCRIPT_DIR/tools/gen-dims.py"
echo ""

echo "══════════════════════════════════════════"
echo "Staging push complete."
echo ""
