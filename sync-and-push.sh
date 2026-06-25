#!/bin/bash
set -e
set -o pipefail

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
  [ -d "$dir" ] || { echo 0; return 0; }
  find "$dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" \) | wc -l | tr -d ' '
}

# Highest image index (the NN in {slug}_NN) among an item's files, 0 if none.
# Appends continue after this, so a numbering gap never causes an overwrite.
max_index() {
  local dir="$1" max=0 base n
  [ -d "$dir/downloads" ] && dir="$dir/downloads"
  [ -d "$dir" ] || { echo 0; return 0; }
  for f in "$dir"/*_*.*; do
    [ -f "$f" ] || continue
    base=$(basename "$f"); n=${base##*_}; n=${n%%.*}
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    n=$((10#$n)); (( n > max )) && max=$n
  done
  echo "$max"
}

# Move a path to the macOS Trash (recoverable) rather than deleting it outright.
# Prefers the system `trash` (macOS 14+); falls back to Finder via osascript,
# then a timestamped move into ~/.Trash.
to_trash() {
  local target="$1"
  [ -e "$target" ] || return 0
  if command -v trash >/dev/null 2>&1; then
    trash "$target"
  elif command -v osascript >/dev/null 2>&1; then
    local abs; abs="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"
    osascript -e "tell application \"Finder\" to delete POSIX file \"$abs\"" >/dev/null
  else
    mkdir -p "$HOME/.Trash"
    mv "$target" "$HOME/.Trash/$(basename "$target")-$(date +%s)"
  fi
}

# ── Preflight: required tooling ─────────────────────────────────────────────────
for bin in python3 node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Error: '$bin' not found in PATH."; echo ""; exit 1; }
done
if ! python3 -c 'from PIL import features; import sys; sys.exit(0 if features.check("avif") else 1)' 2>/dev/null; then
  echo "Error: Pillow lacks AVIF support (needed to encode full/ and thumbs/)."
  echo "       Install a Pillow build with libavif (e.g. pip install 'pillow>=11')."
  echo ""
  exit 1
fi
command -v trash >/dev/null 2>&1 || \
  echo "Note: 'trash' CLI not found — deletions fall back to Finder / ~/.Trash."

# Everything up to the final "Mirror to Blob" step is LOCAL-only: sync, repairs and
# the staging push only mutate assets/ + data.js + dims.js on disk. The Blob is
# touched at exactly one place — the mirror at the very end — which needs the token.

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
        echo "    assets/$kind/$slug/ removed (its Blob copy is dropped by the mirror)."
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
    local desc era
    read -p "    Description: " desc
    while true; do
      read -p "    Current or Archive? (c/a): " era
      case "$era" in c) era=current; break ;; a) era=archive; break ;; *) echo "      → 'c' or 'a'" ;; esac
    done
    python3 "$DATA_EDIT" add-series "$DATA" "$slug" "$name" "$era" "$desc" "$cnt"
  else
    local subtitle dev pub era featured
    read -p "    Subtitle [Enter to skip]: " subtitle
    read -p "    Developer(s): " dev
    read -p "    Publisher(s) [Enter if same as developer]: " pub
    [ -z "$pub" ] && pub="$dev"
    while true; do
      read -p "    Current or Archive? (c/a): " era
      case "$era" in c) era=current; break ;; a) era=archive; break ;; *) echo "      → 'c' or 'a'" ;; esac
    done
    read -p "    Featured # among the $cnt image(s)? (e.g. 3,7 — Enter none): " featured
    python3 "$DATA_EDIT" add-album "$DATA" "$slug" "$name" "$subtitle" "$era" "$dev" "$pub" "$cnt" "$featured"
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

  # Vanished items (in data.js, gone from disk) are reported by reconcile as
  # candidates and kept in data.js. Confirm each one individually before removing
  # it — so approving an unrelated count fix can never drop an album you only moved
  # away temporarily. Its now-orphaned Blob media is cleared by the mirror at the
  # end. Read into an array first so the per-item prompt reads the terminal.
  local RLINES=() rline rkind rslug rans
  if [ -s "$REMOVED" ]; then
    while IFS= read -r rline; do [ -n "$rline" ] && RLINES+=("$rline"); done < "$REMOVED"
  fi
  for rline in "${RLINES[@]}"; do
    rkind="${rline%%:*}"; rslug="${rline#*:}"
    echo "  '$rslug' ($rkind) is in data.js but gone from disk."
    read -p "    Remove it from data.js? (y/n): " rans
    if [ "$rans" = "y" ]; then
      python3 "$DATA_EDIT" remove-item "$DATA" "$rkind" "$rslug" \
        && echo "    Removed from data.js." || echo "    ⚠ could not remove '$rslug' from data.js."
    else
      echo "    Kept (will be flagged again next run)."
    fi
    echo ""
  done

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

# ── 1a. Fix renamed folders (files still carrying the old slug) ─────────────────
# A folder renamed on disk but whose files keep the old slug prefix is a rename
# (the prefix is the old slug's fingerprint). Offer to rename the files to match,
# then migrate the data.js slug — keeping all metadata — so the reconcile below
# sees a clean state instead of an orphan. The Blob mirror at the end propagates
# the old→new paths automatically. curation.js is never auto-edited; we only warn.
RENAMES="$(mktemp)"; REPAIRS="$(mktemp)"
trap 'rm -f "$RENAMES" "$REPAIRS"' EXIT
echo "=== Fix renamed folders ==="
echo ""
set +e
python3 "$SCRIPT_DIR/tools/fix-renames.py" report "$ASSETS" "$RENAMES"
RENAME_STATUS=$?
set -e
if [ "$RENAME_STATUS" -eq 0 ]; then
  read -p "Rename files (and migrate data.js) to match the folders? (y/n): " RCONFIRM
  echo ""
  if [ "$RCONFIRM" = "y" ]; then
    python3 "$SCRIPT_DIR/tools/fix-renames.py" apply "$ASSETS" "$RENAMES"
    while IFS=: read -r rkind rold rnew; do
      [ -n "$rold" ] || continue
      if [ "$(python3 "$DATA_EDIT" type "$DATA" "$rold")" != "none" ]; then
        echo "  data.js: renaming slug '$rold' → '$rnew'..."
        python3 "$DATA_EDIT" rename-slug "$DATA" "$rold" "$rnew" \
          || echo "  ⚠ data.js: could not rename '$rold' → '$rnew' (resolve manually)."
      fi
      if grep -q "$rold" "$SITE/js/curation.js" 2>/dev/null; then
        echo "  ⚠ curation.js references '$rold' — update it to '$rnew' by hand (it is never auto-edited)."
      fi
    done < "$RENAMES"
    echo ""
  else
    echo "Rename skipped."; echo ""
  fi
elif [ "$RENAME_STATUS" -ne 10 ]; then
  exit "$RENAME_STATUS"
fi

sync_data_with_assets
echo ""

# ── 1e. Repair media (numbering gaps / missing or stale derivatives) ────────────
# For each flagged item, offer to regenerate derivatives from downloads/ and/or
# renumber to remove gaps (then update the count). The Blob mirror at the end
# propagates the result. Read into an array first so the prompts read the terminal.
echo "=== Repair media ==="
echo ""
set +e
python3 "$SCRIPT_DIR/tools/rebuild-media.py" report "$ASSETS" "$REPAIRS"
REPAIR_STATUS=$?
set -e
if [ "$REPAIR_STATUS" -eq 0 ]; then
  RPLINES=()
  while IFS= read -r rpl; do [ -n "$rpl" ] && RPLINES+=("$rpl"); done < "$REPAIRS"
  for rpl in "${RPLINES[@]}"; do
    rpkind="${rpl%%:*}"; rprest="${rpl#*:}"; rpslug="${rprest%%:*}"; rpflags="${rprest#*:}"
    if [[ ",$rpflags," == *",deriv,"* ]]; then
      read -p "  Regenerate full/ + thumbs/ for $rpkind/$rpslug from downloads/? (y/n): " ans
      [ "$ans" = "y" ] && python3 "$SCRIPT_DIR/tools/rebuild-media.py" derivatives "$ASSETS" "$rpkind" "$rpslug"
    fi
    if [[ ",$rpflags," == *",gap,"* ]]; then
      read -p "  Renumber $rpkind/$rpslug to remove gaps? (y/n): " ans
      if [ "$ans" = "y" ]; then
        rpmap="$(mktemp)"
        rpnew=$(python3 "$SCRIPT_DIR/tools/rebuild-media.py" renumber "$ASSETS" "$rpkind" "$rpslug" "$rpmap")
        python3 "$DATA_EDIT" set-count "$DATA" "$rpslug" "$rpnew"
        echo "  $rpkind/$rpslug renumbered → $rpnew image(s) (data.js updated)."
        # Featured indices live in data.js now — remap them automatically.
        python3 "$DATA_EDIT" remap-featured "$DATA" "$rpslug" "$rpmap"
        rm -f "$rpmap"
      fi
    fi
  done
  echo ""
elif [ "$REPAIR_STATUS" -ne 10 ]; then
  exit "$REPAIR_STATUS"
fi

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

# Warn about staging folders the collector would silently mishandle: root images
# coexisting with image subfolders (root images get dropped), or a non-empty folder
# with no supported image anywhere (it won't appear in the publish list at all).
preflight_staging() {
  local dir parent has_root has_sub sd leftover
  for dir in "$STAGING"/*/; do
    [ -d "$dir" ] || continue
    parent=$(basename "$dir")
    has_root=0; [ "$(count_images "$dir")" -gt 0 ] && has_root=1
    has_sub=0
    for sd in "$dir"*/; do
      [ -d "$sd" ] || continue
      [ "$(count_images "$sd")" -gt 0 ] && { has_sub=1; break; }
    done
    if [ "$has_root" -eq 1 ] && [ "$has_sub" -eq 1 ]; then
      echo "  ⚠ album-staging/$parent/ has images at its root AND in subfolders —"
      echo "    only the subfolders will publish; the root images are ignored. Flatten or move them."
    elif [ "$has_root" -eq 0 ] && [ "$has_sub" -eq 0 ]; then
      leftover=$(find "$dir" -type f ! -name '.DS_Store' -print -quit 2>/dev/null)
      [ -n "$leftover" ] && echo "  ⚠ album-staging/$parent/ has files but no supported image (jpg/jpeg/png/tif/tiff) — it will be skipped."
    fi
  done
}

# Loose images dropped directly in album-staging/ (not inside a folder) are treated
# as ONE album — exactly like a subfolder whose images sit at its root. They're moved
# into a single folder so they flow through the normal per-folder publish path (skip,
# slug, album/series, append/replace if the slug already exists, …). The default slug
# is the images' common name prefix when they share one (e.g. cloudClimber_001…),
# otherwise "new-album" — you set the real slug at the prompt. Numeric names
# (001, 002…) work too; they just have no prefix to suggest a slug.
fold_root_images() {
  local f base ext dest moved=0 has=0
  for f in "$STAGING"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f"); case "$base" in .*) continue ;; esac
    case "$(printf '%s' "${base##*.}" | tr '[:upper:]' '[:lower:]')" in
      png|jpg|jpeg|tif|tiff) has=1; break ;;
    esac
  done
  [ "$has" -eq 1 ] || return 0

  dest=$(python3 -c '
import sys, os, re
d = sys.argv[1]
exts = (".png", ".jpg", ".jpeg", ".tif", ".tiff")
pfx = set()
for f in os.listdir(d):
    p = os.path.join(d, f)
    if f.startswith(".") or not os.path.isfile(p) or not f.lower().endswith(exts):
        continue
    m = re.match(r"^(.*?)_?\d+\.[^.]+$", f)
    pfx.add(m.group(1) if m else os.path.splitext(f)[0])
print((pfx.pop() if len(pfx) == 1 else "") or "new-album")
' "$STAGING")
  [ -n "$dest" ] || dest="new-album"

  mkdir -p "$STAGING/$dest"
  for f in "$STAGING"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f"); case "$base" in .*) continue ;; esac
    case "$(printf '%s' "${base##*.}" | tr '[:upper:]' '[:lower:]')" in
      png|jpg|jpeg|tif|tiff) ;;
      *) continue ;;
    esac
    if [ -e "$STAGING/$dest/$base" ]; then
      echo "  ⚠ '$base' already exists in album-staging/$dest/ — left at the root."
    else
      mv "$f" "$STAGING/$dest/"; moved=$((moved + 1))
    fi
  done
  [ "$moved" -gt 0 ] && { echo "  Grouped $moved loose root image(s) → album-staging/$dest/ (one album; set the slug at the prompt)."; echo ""; }
}

fold_root_images
preflight_staging

PARENTS=()
for dir in "$STAGING"/*/; do
  [ -d "$dir" ] || continue
  collect_units "$dir"
  [ ${#UNIT_DIRS[@]} -gt 0 ] && PARENTS+=("$(basename "$dir")")
done

# Don't exit when staging is empty — a sync-only run (rename, repair, deletion)
# still has local changes to mirror at the end. The publish loop below simply
# doesn't iterate when PARENTS is empty.
if [ ${#PARENTS[@]} -gt 0 ]; then
  echo "${#PARENTS[@]} staged folder(s) to publish: ${PARENTS[*]}"
else
  echo "No images in album-staging/ to publish."
fi
echo ""

# ── 3. Publish one unit (= one album or series) ─────────────────────────────────
# Generate downloads/ + full/ + thumbs/ for the images in SRC_DIR under slug SLUG,
# appending after START-1 existing images. Echoes the new total count.
generate_media() {
  # Sets the global GEN_FINAL to the new highest index (-1 if the user aborted).
  # Nothing goes to stdout (callers don't capture it); progress/prompts → stderr.
  # DST (5th arg) lets the caller generate into a temp dir (used by replace).
  local SRC_DIR="$1" TYPE="$2" SLUG="$3" START="$4" DST="$5"
  [ -n "$DST" ] || DST="$ASSETS/$TYPE/$SLUG"
  mkdir -p "$DST/thumbs" "$DST/full" "$DST/downloads"

  local j="$START" img ext_lc jpg_arg stem rc ch
  while IFS= read -r img; do
    stem="${SLUG}_$(printf '%02d' "$j")"

    # downloads/: faithful copy if the master is already JPEG (never re-encode
    # JPEG→JPEG); otherwise the Python below encodes JPEG q95/4:4:4 from the master.
    ext_lc=$(printf '%s' "${img##*.}" | tr '[:upper:]' '[:lower:]')
    if [ "$ext_lc" = "jpg" ] || [ "$ext_lc" = "jpeg" ]; then
      jpg_arg="-"
    else
      jpg_arg="$DST/downloads/$stem.jpg"
    fi

    # Convert, capturing failure so one bad master doesn't abort the whole album.
    # full/: full-res AVIF q80. thumbs/: AVIF q50, 760px short side (no upscaling).
    # EXIF orientation honored; ICC dropped (everything treated as sRGB).
    # NOTE: keep these encode settings in sync with tools/rebuild-media.py.
    set +e
    rc=0
    [ "$jpg_arg" = "-" ] && { cp "$img" "$DST/downloads/$stem.jpg" || rc=1; }
    if [ "$rc" -eq 0 ]; then
      python3 - "$img" "$jpg_arg" "$DST/full/$stem.avif" "$DST/thumbs/$stem.avif" << 'PYEOF'
import sys
from PIL import Image, ImageOps
src, jpg_out, full_out, thumb_out = sys.argv[1:5]
img = ImageOps.exif_transpose(Image.open(src))  # honor EXIF orientation
rgb = img.convert("RGB")  # flatten alpha + drop ICC → treated as sRGB
if jpg_out != "-":
    rgb.save(jpg_out, "JPEG", quality=95, subsampling=0, optimize=True)
rgb.save(full_out, "AVIF", quality=80, speed=6)
w, h = rgb.size
scale = min(760 / min(w, h), 1.0)
thumb = rgb.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else rgb
thumb.save(thumb_out, "AVIF", quality=50, speed=6)
PYEOF
      rc=$?
    fi
    set -e

    if [ "$rc" -ne 0 ]; then
      echo "  ⚠ failed to convert: $(basename "$img")" >&2
      rm -f "$DST/downloads/$stem.jpg" "$DST/full/$stem.avif" "$DST/thumbs/$stem.avif"
      while true; do
        read -p "    Skip this image (s) or abort this album (a)? " ch < /dev/tty
        case "$ch" in
          s) break ;;
          a) echo "  Aborting '$SLUG'." >&2; GEN_FINAL=-1; return 0 ;;
        esac
      done
      continue   # numbering stays contiguous (j not incremented for a skip)
    fi
    j=$((j + 1))
  done < <(find "$SRC_DIR" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.jpg" -o -iname "*.jpeg" \) | sort)
  GEN_FINAL=$((j - 1))
}

publish_unit() {
  local SRC_DIR="$1" DEFAULT_SLUG="$2"
  local IMG_COUNT
  IMG_COUNT=$(count_images "$SRC_DIR")

  echo "──────────────────────────────────────────"
  echo "  $(basename "$SRC_DIR")  ($IMG_COUNT image(s))"
  echo ""

  # Skip option: decline before any form. The folder is left untouched in
  # album-staging/ (not trashed) so it can be handled on a later run.
  local PUSH
  read -p "  Publish this folder? (Y/n): " PUSH
  case "$PUSH" in
    n|N|no|No) echo "  Skipped — left in album-staging/."; echo ""; return 0 ;;
  esac
  echo ""

  # Resolve the slug + publish mode. The slug is the folder in assets/<type>/, the
  # file prefix and the data.js key. If it already exists, publishing here MERGES
  # (appends) into it — confirm that explicitly BEFORE any conversion/upload, so an
  # unintended collision can be redirected to a different slug instead of silently
  # merging.
  local SLUG EXISTING_TYPE TYPE MODE START MERGE
  while true; do
    while true; do
      read -p "  Slug [$DEFAULT_SLUG]: " SLUG
      [ -z "$SLUG" ] && SLUG="$DEFAULT_SLUG"
      [[ "$SLUG" =~ ^[A-Za-z][A-Za-z0-9_-]*$ ]] && break
      echo "    → invalid: letters/digits/-/_ , must start with a letter (e.g. haloInfinite)."
    done

    EXISTING_TYPE=$(python3 "$DATA_EDIT" type "$DATA" "$SLUG")
    if [ "$EXISTING_TYPE" = "none" ]; then
      MODE="new"; START=1
      break
    fi

    echo ""
    echo "  ⚠ '$SLUG' already exists ($EXISTING_TYPE, $(count_images "$ASSETS/$EXISTING_TYPE/$SLUG") image(s) on disk)."
    echo "    What to do with these $IMG_COUNT staged image(s)?"
    echo "      a) append  — add them to '$SLUG' (existing images kept)"
    echo "      r) replace — wipe '$SLUG' (old images → Trash + Blob cleared), publish these instead (metadata kept)"
    echo "      n) no      — pick a different slug"
    read -p "    Choose (a/r/n): " MERGE
    case "$MERGE" in
      a)
        TYPE="$EXISTING_TYPE"; MODE="append"
        START=$(( $(max_index "$ASSETS/$EXISTING_TYPE/$SLUG") + 1 ))
        break ;;
      r)
        TYPE="$EXISTING_TYPE"; MODE="replace"; START=1
        break ;;
      *)
        echo "    → enter a different slug (or answer a / r)."
        echo "" ;;
    esac
  done
  echo ""

  if [ "$MODE" = "new" ]; then
    local KIND
    while true; do
      read -p "  Publish as album (a) or series (s)? : " KIND
      case "$KIND" in a) TYPE=album; break ;; s) TYPE=series; break ;; *) echo "    → 'a' or 's'" ;; esac
    done
    local DISPLAY_NAME
    read -p "  Display name [$SLUG]: " DISPLAY_NAME
    [ -z "$DISPLAY_NAME" ] && DISPLAY_NAME="$SLUG"
    if [ "$TYPE" = "series" ]; then
      local DESC ERA
      read -p "  Description: " DESC
      while true; do
        read -p "  Current or Archive? (c/a): " ERA
        case "$ERA" in c) ERA=current; break ;; a) ERA=archive; break ;; *) echo "    → 'c' or 'a'" ;; esac
      done
    else
      local SUBTITLE DEVELOPER PUBLISHER ERA
      read -p "  Subtitle [Enter to skip]: " SUBTITLE
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
  local FINAL GEN_DST=""
  if [ "$MODE" = "replace" ]; then
    # Build the new set in a temp dir first, so the existing album stays intact
    # until the new media is fully generated; swap it in only on success.
    GEN_DST="$ASSETS/$TYPE/.__new_${SLUG}.$$"
    rm -rf "$GEN_DST"
  fi
  GEN_FINAL=0
  generate_media "$SRC_DIR" "$TYPE" "$SLUG" "$START" "$GEN_DST"
  FINAL=$GEN_FINAL
  if [ "$FINAL" -lt 1 ]; then
    echo "  ✗ Nothing published for '$SLUG' — left in album-staging/ for a retry."
    [ -n "$GEN_DST" ] && rm -rf "$GEN_DST"
    echo ""
    return 0
  fi

  # Replace swap: old images → Trash (recoverable), new set moved into place. The
  # data.js entry + metadata are kept; set-count updates below. The mirror at the
  # end reconciles the Blob (old image objects deleted, new ones uploaded).
  if [ "$MODE" = "replace" ]; then
    echo "  Replacing '$SLUG': existing $(count_images "$ASSETS/$TYPE/$SLUG") image(s) → Trash, new set swapped in..."
    to_trash "$ASSETS/$TYPE/$SLUG"
    mv "$GEN_DST" "$ASSETS/$TYPE/$SLUG"
  fi
  echo "  Total: $FINAL image(s) in assets/$TYPE/$SLUG/."

  # Featured declaration (albums only): which of the just-published images stand
  # out. 1-based indices; for an append they're relative to the NEW images and
  # converted to absolute. Stored in data.js (album.featured).
  local FEATURED_CSV="" FEAT_REL
  if [ "$TYPE" = "album" ]; then
    if [ "$MODE" = "append" ]; then
      read -p "  Featured # among the $((FINAL - START + 1)) new image(s)? (e.g. 1,3 — Enter none): " FEAT_REL
      FEATURED_CSV=$(python3 -c 'import sys,re; s=int(sys.argv[1]); print(",".join(str(s-1+int(t)) for t in re.split(r"[,\s]+", sys.argv[2].strip()) if t.isdigit()))' "$START" "$FEAT_REL")
    else
      read -p "  Featured # among these $FINAL image(s)? (e.g. 3,7 — Enter none): " FEATURED_CSV
    fi
  fi

  # Commit the unit into data.js (the source of truth the front reads). This stays
  # local — the Blob is updated once, by the mirror at the end.
  echo "  Updating data.js..."
  if [ "$MODE" = "append" ]; then
    python3 "$DATA_EDIT" set-count "$DATA" "$SLUG" "$FINAL"
    [ -n "$FEATURED_CSV" ] && python3 "$DATA_EDIT" add-featured "$DATA" "$SLUG" "$FEATURED_CSV"
  elif [ "$MODE" = "replace" ]; then
    python3 "$DATA_EDIT" set-count "$DATA" "$SLUG" "$FINAL"
    # featured is album-only; replace clears the now-stale list (series have none).
    [ "$TYPE" = "album" ] && python3 "$DATA_EDIT" set-featured "$DATA" "$SLUG" "$FEATURED_CSV"
  elif [ "$TYPE" = "series" ]; then
    python3 "$DATA_EDIT" add-series "$DATA" "$SLUG" "$DISPLAY_NAME" "$ERA" "$DESC" "$FINAL"
  else
    python3 "$DATA_EDIT" add-album "$DATA" "$SLUG" "$DISPLAY_NAME" "$SUBTITLE" "$ERA" "$DEVELOPER" "$PUBLISHER" "$FINAL" "$FEATURED_CSV"
  fi

  # Finalize this unit locally so it's self-contained on disk (assets + data.js)
  # regardless of whether the script continues; the Blob is reconciled by the mirror:
  #   - send its staging source to the Trash (recoverable, not a hard delete) so
  #     an interrupted re-run never re-appends it;
  #   - refresh dims.js from disk (full rescan) so this album's ratios are in place.
  # dims.js is also regenerated by the sync step on the next run, so an interrupt
  # between these two lines self-heals.
  to_trash "$SRC_DIR"
  echo "  Staging source moved to Trash."
  echo "  Refreshing dims.js..."
  python3 "$SCRIPT_DIR/tools/gen-dims.py" >/dev/null

  echo ""
  echo "  ✓ '$SLUG' ($TYPE) published — $FINAL image(s) total."
  echo ""
}

for PARENT in "${PARENTS[@]}"; do
  collect_units "$STAGING/$PARENT"
  for i in "${!UNIT_DIRS[@]}"; do
    publish_unit "${UNIT_DIRS[$i]}" "${UNIT_SLUGS[$i]}"
  done
  # Published units already moved their own source to the Trash. Drop the parent
  # only if no images remain under it — a single-album folder is already gone, and
  # an emptied multi-album shell just holds leftovers. If a unit was skipped, its
  # images are still there, so the folder is kept in album-staging/ for later.
  if [ -z "$(find "$STAGING/$PARENT" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.tif' -o -iname '*.tiff' \) -print -quit 2>/dev/null)" ]; then
    rm -rf "$STAGING/$PARENT"
    echo "  album-staging/$PARENT/ cleared."
  else
    echo "  album-staging/$PARENT/ kept (skipped / not fully published)."
  fi
  echo ""
done

echo "══════════════════════════════════════════"
echo "Local changes complete."
echo ""

# ── Mirror to Vercel Blob — the ONLY step that touches the Blob ──────────────────
# A full local↔Blob diff: upload missing/changed (by path + size), delete extras.
# Reported first, applied only on your confirmation — say no to keep batching
# locally, yes when you're about to deploy. Needs BLOB_READ_WRITE_TOKEN (.env).
if ! node --env-file-if-exists="$SCRIPT_DIR/.env" -e 'process.exit(process.env.BLOB_READ_WRITE_TOKEN ? 0 : 1)' 2>/dev/null; then
  echo "Blob mirror skipped: BLOB_READ_WRITE_TOKEN not set (.env)."
  echo "Local changes are saved; set the token and re-run to mirror before deploying."
  echo ""
else
  echo "=== Mirror Blob ↔ assets/ ==="
  echo ""
  set +e
  node --env-file-if-exists="$SCRIPT_DIR/.env" "$SCRIPT_DIR/tools/blob-sync.mjs" mirror
  MIRROR_STATUS=$?
  set -e
  if [ "$MIRROR_STATUS" -eq 0 ]; then
    read -p "Mirror these changes to Vercel Blob now? (y/n): " MIRROR_CONFIRM
    echo ""
    if [ "$MIRROR_CONFIRM" = "y" ]; then
      node --env-file-if-exists="$SCRIPT_DIR/.env" "$SCRIPT_DIR/tools/blob-sync.mjs" mirror --apply
    else
      echo "Mirror skipped — Blob not updated this run."
    fi
    echo ""
  elif [ "$MIRROR_STATUS" -ne 10 ]; then
    exit "$MIRROR_STATUS"
  fi
fi

echo "══════════════════════════════════════════"
echo "Reminder: commit & push site/js/data.js and site/js/dims.js to deploy."
echo "The deployed site serves media from Vercel Blob — make sure you mirrored"
echo "(above) before deploying, or new/changed media will 404."
echo ""
