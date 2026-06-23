#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE="$SCRIPT_DIR/site"
STAGING="$SCRIPT_DIR/album-staging"
LIVE="$SITE/assets/album-live"
DATA="$SITE/js/data.js"
# Media base URL (Vercel Blob, or empty for same-origin /assets), read from the front
# config so generated album pages preload from the same place gallery.js loads images.
MEDIA_BASE=$(grep -oE "^const VFE_MEDIA_BASE[[:space:]]*=[[:space:]]*'[^']*'" "$SITE/js/config.js" 2>/dev/null | sed "s/.*'\([^']*\)'.*/\1/")

echo ""
echo "=== View From Elsewhere — Sync & Push ==="
echo ""

count_images() {
  # Staging: originals sit at the set root.
  # Live: since the WebP rework, the originals (download) live in downloads/.
  local dir="$1"
  [ -d "$dir/downloads" ] && dir="$dir/downloads"
  find "$dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) | wc -l | tr -d ' '
}

in_data_js() {
  grep -q "slug: '$1'" "$DATA"
}

# Create albums/$slug.html if it doesn't already exist.
create_album_page() {
  local slug="$1" display_name="$2"
  [ -f "$SITE/albums/$slug.html" ] && return 0
  cat > "$SITE/albums/$slug.html" << HTMLEOF
<!DOCTYPE html>
<html lang="en">

<head>
    <link rel="icon" type="image/png" href="/assets/icon.png">

    <meta name="description"
        content="VFE is a gallery offering a fresh view on video games and virtual worlds with a large collection photograph albums.">

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="image" href="${MEDIA_BASE}/assets/album-live/$slug/set-1/thumbs/${slug}_set1_01.webp">
    <link rel="stylesheet" href="/styles/styles-galerie.css">
    <link rel="stylesheet" href="/styles/styles.css">
    <script src="/js/config.js" defer></script>
    <script src="/js/data.js" defer></script>
    <script src="/js/header.js" defer></script>
    <script src="/js/modal-filter.js" defer></script>
    <script src="/js/gallery.js" defer></script>
    <title>View From Elsewhere | ${display_name:-$slug}</title>
</head>

<body>

    <section id="nav"></section>

    <main>
        <section id="core-gallery" data-album="$slug">

            <div id="loading"><img src="/assets/logo_short.png"></div>

            <div class="m-p-g">
                <div class="m-p-g__thumbs" data-max-height="420"></div>
                <div class="m-p-g__fullscreen"></div>
            </div>

        </section>
    </main>

</body>

</html>
HTMLEOF
  echo "    Page created: albums/$slug.html"
}

# Insert an empty entry skeleton (sets: []) for a slug not yet present in data.js.
create_entry_skeleton() {
  local slug="$1" name="$2" publisher="$3" developer="$4" era="$5"
  python3 - "$DATA" "$slug" "$name" "$publisher" "$developer" "$era" << 'PYEOF'
import sys

data_path, slug, name, publisher, developer, era = sys.argv[1:]
developer_val = f"'{developer}'" if developer else 'null'
publisher_val = f"'{publisher}'" if publisher else 'null'

new_entry = f"""    {{
      slug: '{slug}',
      name: '{name}',
      era: '{era}',
      developer: {developer_val},
      publisher: {publisher_val},
      images: {{ sets: [
      ]}}
    }},"""

with open(data_path, 'r') as f:
    content = f.read()

content = content.replace('  albums: [\n', f'  albums: [\n{new_entry}\n', 1)

with open(data_path, 'w') as f:
    f.write(content)
PYEOF
}

# Append a set to the end of a slug's sets[] array when already present in data.js
# (empty or already populated). dir = physical number of the set-N/ folder.
append_set_to_data() {
  local slug="$1" set_title="$2" count="$3" dir="$4"
  python3 - "$DATA" "$slug" "$set_title" "$count" "$dir" << 'PYEOF'
import sys, re

data_path, slug, set_title, count, dir_num = sys.argv[1:]

with open(data_path, 'r') as f:
    content = f.read()

dir_part = f", dir: {dir_num}" if dir_num else ''
new_set = f"        {{ title: '{set_title}', count: {count}{dir_part} }}"
pattern = rf"(slug: '{re.escape(slug)}'.*?sets: \[)(.*?)(\s*\]}}\s*\}})"
match = re.search(pattern, content, re.DOTALL)
if not match:
    print(f"Error: slug '{slug}' not found in data.js", file=sys.stderr)
    sys.exit(1)

existing = match.group(2)
closing = match.group(3)
if existing.strip():
    replacement = match.group(1) + existing.rstrip() + ',\n' + new_set + '\n      ' + closing.lstrip()
else:
    replacement = match.group(1) + '\n' + new_set + '\n      ' + closing.lstrip()
content = content[:match.start()] + replacement + content[match.end():]

with open(data_path, 'w') as f:
    f.write(content)
PYEOF
}

# Insert a set at the FRONT of a slug's sets[] array (reverse-chronological order).
prepend_set_to_data() {
  local slug="$1" set_title="$2" count="$3" dir="$4"
  python3 - "$DATA" "$slug" "$set_title" "$count" "$dir" << 'PYEOF'
import sys, re

data_path, slug, set_title, count, dir_num = sys.argv[1:]

with open(data_path, 'r') as f:
    content = f.read()

dir_part = f", dir: {dir_num}" if dir_num else ''
new_set = f"        {{ title: '{set_title}', count: {count}{dir_part} }}"
pattern = rf"(slug: '{re.escape(slug)}'.*?sets: \[)(.*?)(\s*\]}}\s*\}})"
match = re.search(pattern, content, re.DOTALL)
if not match:
    print(f"Error: slug '{slug}' not found in data.js", file=sys.stderr)
    sys.exit(1)

existing = match.group(2)
closing = match.group(3)
if existing.strip():
    replacement = (match.group(1) + '\n' + new_set + ',\n'
                   + existing.lstrip('\n').rstrip() + '\n      ' + closing.lstrip())
else:
    replacement = match.group(1) + '\n' + new_set + '\n      ' + closing.lstrip()
content = content[:match.start()] + replacement + content[match.end():]

with open(data_path, 'w') as f:
    f.write(content)
PYEOF
}

# Move an album's block to the top of data.js's albums[] array (promote it).
promote_album_to_top() {
  local slug="$1"
  python3 - "$DATA" "$slug" << 'PYEOF'
import sys, re

data_path, slug = sys.argv[1:]

with open(data_path, 'r') as f:
    content = f.read()

# Capture the full block including the preceding \n (present except for the 1st album)
album_re = re.compile(
    r'\n    \{\n      slug: \'' + re.escape(slug) + r'\'.*?\n    \},',
    re.DOTALL
)
m = album_re.search(content)
if not m:
    print(f"Error: slug '{slug}' not found in data.js", file=sys.stderr)
    sys.exit(1)

block = m.group(0)  # starts with \n
content = content[:m.start()] + content[m.end():]
content = content.replace('  albums: [', '  albums: [' + block, 1)

with open(data_path, 'w') as f:
    f.write(content)
PYEOF
}

# Prompt for the info of an album missing from data.js, create its entry, register
# the sets already present on disk (asking each one's title), and the associated page.
resolve_orphan() {
  local slug="$1"
  echo "  Album '$slug' present in album-live/ but missing from data.js."
  local action
  while true; do
    read -p "    Fill in its info (f) or delete it from album-live/ (d)? : " action
    case "$action" in
      f) break ;;
      d)
        rm -rf "$LIVE/$slug"
        rm -f "$SITE/albums/$slug.html"
        echo "    album-live/$slug/ and albums/$slug.html removed."
        echo ""
        return
        ;;
      *) echo "      → answer 'f' (fill) or 'd' (delete)" ;;
    esac
  done

  echo "  Information to fill in for '$slug':"
  local display_name publisher developer era
  read -p "    Display name [$slug]: " display_name
  [ -z "$display_name" ] && display_name="$slug"
  read -p "    Developer(s): " developer
  read -p "    Publisher(s) [Enter if same as developer]: " publisher
  [ -z "$publisher" ] && publisher="$developer"
  while true; do
    read -p "    Current or Archive? (c/a): " era
    case "$era" in
      c) era="current"; break ;;
      a) era="archive"; break ;;
      *) echo "      → answer 'c' (current) or 'a' (archive)" ;;
    esac
  done

  create_entry_skeleton "$slug" "$display_name" "$publisher" "$developer" "$era"

  local existing_count=0 probe=1
  while [ -d "$LIVE/$slug/set-$probe" ]; do
    existing_count=$probe
    probe=$((probe + 1))
  done

  local n cnt set_title
  for ((n = 1; n <= existing_count; n++)); do
    cnt=$(count_images "$LIVE/$slug/set-$n")
    if [ "$existing_count" -gt 1 ]; then
      read -p "    Set title $n/$existing_count ($cnt image(s)) [set-$n]: " set_title
    else
      read -p "    Set title ($cnt image(s)) [set-1]: " set_title
    fi
    [ -z "$set_title" ] && set_title="set-$n"
    append_set_to_data "$slug" "$set_title" "$cnt" "$n"
    echo "    existing set-$n registered in data.js ($cnt image(s))."
  done

  create_album_page "$slug" "$display_name"
  echo "  ✓ '$display_name' registered in data.js."
  echo ""
}

# Reconcile data.js with the actual contents of album-live/: fix count
# discrepancies / vanished albums (with confirmation), and immediately resolve
# any orphan album (present in live, missing from data.js) by prompting for its
# info right away — no need to wait for a push for that slug.
sync_data_with_live() {
  echo "=== Sync album-live → data.js ==="
  echo ""

  local PY_SCRIPT ORPHANS_FILE REMOVED_FILE
  PY_SCRIPT="$(mktemp)"
  ORPHANS_FILE="$(mktemp)"
  REMOVED_FILE="$(mktemp)"
  trap 'rm -f "$PY_SCRIPT" "$ORPHANS_FILE" "$REMOVED_FILE"' RETURN

  cat > "$PY_SCRIPT" << 'PYEOF'
import sys, os, re

mode = sys.argv[1]
live_dir, data_path, orphans_path, removed_path = sys.argv[2:]

# ── 1. Scan album-live ────────────────────────────────────────────────────────

live = {}  # slug → [count_set1, count_set2, ...]
integrity = []  # human-readable warnings about naming / thumbnail mismatches

for slug in sorted(os.listdir(live_dir)):
    slug_path = os.path.join(live_dir, slug)
    if not os.path.isdir(slug_path):
        continue
    sets = []
    n = 1
    while True:
        set_path = os.path.join(slug_path, f'set-{n}')
        if not os.path.isdir(set_path):
            break
        # The source of truth is downloads/: each image's original JPG.
        downloads_path = os.path.join(set_path, 'downloads')
        imgs = []
        if os.path.isdir(downloads_path):
            imgs = [f for f in os.listdir(downloads_path)
                    if f.lower().endswith(('.jpg', '.jpeg', '.png'))
                    and os.path.isfile(os.path.join(downloads_path, f))]
        count = len(imgs)
        sets.append(count)

        # Naming continuity: expect {prefix}_01.jpg .. {prefix}_{count}.jpg
        # with no gap or unexpected name (the prefix follows the
        # sync-and-push.sh convention: slug_setN).
        prefix = f'{slug}_set{n}'
        expected = {f'{prefix}_{str(i).zfill(2)}.jpg' for i in range(1, count + 1)}
        actual = set(imgs)
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        if missing or extra:
            detail = []
            if missing:
                detail.append(f"missing: {', '.join(missing)}")
            if extra:
                detail.append(f"unexpected: {', '.join(extra)}")
            integrity.append(f"  ⚠ '{slug}' set-{n}: inconsistent naming in downloads/ ({'; '.join(detail)})")

        # Pairing original ↔ full-screen ↔ thumbnail: each downloads/ JPG must
        # have its .webp in full/ and in thumbs/, and vice versa.
        expected_webp = {os.path.splitext(f)[0] + '.webp' for f in actual}
        for kind in ('full', 'thumbs'):
            kind_path = os.path.join(set_path, kind)
            kind_files = set()
            if os.path.isdir(kind_path):
                kind_files = {f for f in os.listdir(kind_path)
                              if f.lower().endswith('.webp')
                              and os.path.isfile(os.path.join(kind_path, f))}
            label = 'full-screen' if kind == 'full' else 'thumbnail(s)'
            missing_webp = sorted(expected_webp - kind_files)
            orphan_webp = sorted(kind_files - expected_webp)
            if missing_webp:
                integrity.append(f"  ⚠ '{slug}' set-{n}: {kind}/ — {label} missing for {', '.join(missing_webp)}")
            if orphan_webp:
                integrity.append(f"  ⚠ '{slug}' set-{n}: {kind}/ — {label} orphaned with no matching original: {', '.join(orphan_webp)}")

        n += 1
    if sets:
        live[slug] = sets

# ── 2. Parse data.js ─────────────────────────────────────────────────────────

with open(data_path, 'r') as f:
    content = f.read()

album_pattern = re.compile(
    r"\{\s*\n\s*slug:\s*'([^']+)'.*?images:\s*\{\s*sets:\s*\[(.*?)\]\s*\}\s*\}",
    re.DOTALL
)

data_slugs = []  # ordered list of slugs in data.js
data_sets  = {}  # slug → [{'title': ..., 'count': ...}, ...]

for m in album_pattern.finditer(content):
    slug = m.group(1)
    sets_str = m.group(2)
    sets = []
    for sm in re.finditer(r"\{\s*title:\s*'([^']*)',\s*count:\s*(\d+)(?:,\s*dir:\s*(\d+))?\s*\}", sets_str):
        sets.append({'title': sm.group(1), 'count': int(sm.group(2)),
                     'dir': int(sm.group(3)) if sm.group(3) else None})
    data_slugs.append(slug)
    data_sets[slug] = sets

# ── 3. Compute diff ───────────────────────────────────────────────────────────

fixes = []   # list of dicts describing each fix
orphans = []  # slugs present in album-live/ but absent from data.js

# Albums in data.js but missing from album-live
for slug in data_slugs:
    if slug not in live:
        fixes.append({'type': 'remove_album', 'slug': slug})

# Albums in album-live
for slug, live_counts in live.items():
    if slug not in data_sets:
        orphans.append(slug)
        continue

    d_sets = data_sets[slug]
    live_n = len(live_counts)
    data_n = len(d_sets)

    for i in range(live_n, data_n):
        fixes.append({'type': 'remove_set', 'slug': slug, 'set_index': i,
                      'title': d_sets[i]['title']})

    for i, live_count in enumerate(live_counts):
        if i >= data_n:
            fixes.append({'type': 'add_set', 'slug': slug, 'set_index': i,
                          'count': live_count})
        elif d_sets[i]['count'] != live_count:
            fixes.append({'type': 'update_count', 'slug': slug, 'set_index': i,
                          'old': d_sets[i]['count'], 'new': live_count,
                          'title': d_sets[i]['title']})

with open(orphans_path, 'w') as f:
    for slug in orphans:
        f.write(slug + '\n')

with open(removed_path, 'w') as f:
    pass  # filled in apply mode

if orphans:
    print("Orphan albums detected (present in album-live/, missing from data.js):")
    for slug in orphans:
        print(f"  ⚠ '{slug}'")
    print()

if integrity:
    print("Inconsistencies detected (report only, fix manually):")
    for w in integrity:
        print(w)
    print()

if not fixes:
    if not orphans and not integrity:
        print("data.js is already aligned with album-live/. Nothing to do.")
        print()
    sys.exit(10)  # no count fix to apply (orphans may remain)

print("Fixes to apply:")
for f in fixes:
    t = f['type']
    if t == 'remove_album':
        print(f"  - Remove album   '{f['slug']}' (missing from album-live/)")
    elif t == 'remove_set':
        label = f"'{f['title']}'" if f['title'] else '(untitled)'
        print(f"  - Remove set-{f['set_index']+1} {label} from '{f['slug']}' (missing from disk)")
    elif t == 'add_set':
        print(f"  - Add set-{f['set_index']+1} to '{f['slug']}' ({f['count']} images)")
    elif t == 'update_count':
        label = f"'{f['title']}'" if f['title'] else '(untitled)'
        print(f"  - Update count of '{f['slug']}' set-{f['set_index']+1} {label}: {f['old']} → {f['new']}")
print()

if mode == 'report':
    sys.exit(0)  # exit 0 means "there are fixes pending, ask the user"

# ── mode == 'apply' ─────────────────────────────────────────────────────────

removed_slugs = []
for f in fixes:
    t = f['type']
    slug = f['slug']
    if t == 'remove_album':
        if slug in data_sets:
            del data_sets[slug]
        data_slugs.remove(slug)
        removed_slugs.append(slug)
    elif t == 'remove_set':
        data_sets[slug].pop(f['set_index'])
    elif t == 'add_set':
        data_sets[slug].append({'title': '', 'count': f['count']})
    elif t == 'update_count':
        data_sets[slug][f['set_index']]['count'] = f['new']

def build_sets_str(sets):
    parts = []
    for s in sets:
        dir_part = f", dir: {s['dir']}" if s.get('dir') is not None else ''
        parts.append(f"        {{ title: '{s['title']}', count: {s['count']}{dir_part} }}")
    return '\n' + ',\n'.join(parts) + '\n      '

new_albums_str = ''
for slug in data_slugs:
    m = re.search(
        rf"\{{\s*\n\s*slug:\s*'{re.escape(slug)}'(.*?)images:\s*\{{\s*sets:\s*\[.*?\]\s*\}}\s*\}}",
        content, re.DOTALL
    )
    if not m:
        continue
    sets_str = build_sets_str(data_sets[slug])
    block = content[m.start():m.end()]
    block = re.sub(r'(sets:\s*\[).*?(\])', rf'\g<1>{sets_str}\g<2>', block, flags=re.DOTALL)
    new_albums_str += '\n' + block + ','

updated = re.sub(
    r'albums:\s*\[.*\n  \]\n\};',
    'albums: [' + new_albums_str.replace('\\', '\\\\') + '\n  ]\n};',
    content, flags=re.DOTALL
)

with open(data_path, 'w') as f:
    f.write(updated)

with open(removed_path, 'w') as f:
    for slug in removed_slugs:
        f.write(slug + '\n')

print(f"{len(fixes)} fix(es) applied. data.js updated.")
print()
PYEOF

  set +e
  python3 "$PY_SCRIPT" report "$LIVE" "$DATA" "$ORPHANS_FILE" "$REMOVED_FILE"
  local STATUS=$?
  set -e

  if [ "$STATUS" -eq 0 ]; then
    read -p "Apply these fixes? (y/n): " CONFIRM
    echo ""
    if [ "$CONFIRM" = "y" ]; then
      python3 "$PY_SCRIPT" apply "$LIVE" "$DATA" "$ORPHANS_FILE" "$REMOVED_FILE"
      # Remove the HTML pages of albums dropped from data.js
      while IFS= read -r removed_slug; do
        [ -n "$removed_slug" ] || continue
        if [ -f "$SITE/albums/$removed_slug.html" ]; then
          rm -f "$SITE/albums/$removed_slug.html"
          echo "  Page albums/$removed_slug.html removed."
        fi
      done < "$REMOVED_FILE"
    else
      echo "Cancelled."
      echo ""
    fi
  elif [ "$STATUS" -ne 10 ]; then
    return "$STATUS"
  fi

  local ORPHAN_SLUGS=() orphan_slug
  if [ -s "$ORPHANS_FILE" ]; then
    while IFS= read -r orphan_slug; do
      [ -n "$orphan_slug" ] && ORPHAN_SLUGS+=("$orphan_slug")
    done < "$ORPHANS_FILE"
  fi
  # Loop without redirecting from that file: resolve_orphan's read -p prompts
  # must read the terminal, not the file we just iterated over.
  for orphan_slug in "${ORPHAN_SLUGS[@]}"; do
    resolve_orphan "$orphan_slug"
  done
}

sync_data_with_live
echo ""

# Populates the global array STAGED_DIRS with the ordered list of directories
# holding images for a given staged slug directory. Either:
#   - one or more set-N/ subdirectories (sorted numerically), or
#   - the slug directory itself, if images sit directly at its root.
collect_staged_dirs() {
  local slug_dir="$1"
  STAGED_DIRS=()
  local nums=()
  local sd base n
  for sd in "$slug_dir"/set-*/; do
    [ -d "$sd" ] || continue
    base=$(basename "$sd")
    n="${base#set-}"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    [ "$(count_images "$sd")" -gt 0 ] || continue
    nums+=("$n")
  done
  if [ ${#nums[@]} -gt 0 ]; then
    local sorted
    sorted=$(printf '%s\n' "${nums[@]}" | sort -n)
    while IFS= read -r n; do
      STAGED_DIRS+=("$slug_dir/set-$n")
    done <<< "$sorted"
  elif [ "$(count_images "$slug_dir")" -gt 0 ]; then
    STAGED_DIRS=("$slug_dir")
  fi
}

# Collect slugs that have images (either flat or in set-N/ subfolders)
SLUGS=()
for dir in "$STAGING"/*/; do
  [ -d "$dir" ] || continue
  slug=$(basename "$dir")
  collect_staged_dirs "$dir"
  [ ${#STAGED_DIRS[@]} -gt 0 ] && SLUGS+=("$slug")
done

if [ ${#SLUGS[@]} -eq 0 ]; then
  echo "No images found in album-staging/."
  echo ""
  exit 0
fi

echo "${#SLUGS[@]} album(s) / set(s) to publish: ${SLUGS[*]}"
echo ""

publish_slug() {
  local STAGE_NAME="$1"
  collect_staged_dirs "$STAGING/$STAGE_NAME"
  local STAGED_COUNT=${#STAGED_DIRS[@]}

  local TOTAL_IMAGES=0
  local d
  for d in "${STAGED_DIRS[@]}"; do
    TOTAL_IMAGES=$((TOTAL_IMAGES + $(count_images "$d")))
  done

  echo "──────────────────────────────────────────"
  if [ "$STAGED_COUNT" -gt 1 ]; then
    echo "  $STAGE_NAME  ($STAGED_COUNT set(s), $TOTAL_IMAGES image(s) total)"
  else
    echo "  $STAGE_NAME  ($TOTAL_IMAGES image(s))"
  fi
  echo ""

  # Confirm (or fix) the slug: name of the folder created in assets/album-live/,
  # also used as the file prefix, the data.js key and the HTML page name.
  # Avoids propagating a badly-named folder (typo, generic name like "jpeg"...).
  local SLUG
  while true; do
    read -p "  Folder name in assets/album-live/ [$STAGE_NAME]: " SLUG
    [ -z "$SLUG" ] && SLUG="$STAGE_NAME"
    [[ "$SLUG" =~ ^[A-Za-z][A-Za-z0-9_-]*$ ]] && break
    echo "    → invalid name: letters/digits only, starting with a letter (e.g. haloInfinite)."
  done
  [ "$SLUG" != "$STAGE_NAME" ] && echo "    → '$STAGE_NAME' will be published under the name '$SLUG'."
  echo ""

  local LIVE_EXISTS=false IN_DATA=false
  [ -d "$LIVE/$SLUG" ] && LIVE_EXISTS=true
  in_data_js "$SLUG" && IN_DATA=true

  local MODE DISPLAY_NAME PUBLISHER DEVELOPER ERA

  if [ "$LIVE_EXISTS" = true ] && [ "$IN_DATA" = true ]; then
    MODE="append"
    echo "  Album already in album-live/ → adding $STAGED_COUNT set(s)."
  else
    # Should normally no longer happen: the sync above already resolves any
    # orphan present in live before we reach the push. We keep this safety
    # net in case the disk changes between the two steps.
    if [ "$LIVE_EXISTS" = true ]; then
      MODE="orphan"
      echo "  Album present in album-live/ but missing from data.js → information to fill in."
    else
      MODE="new"
    fi
    read -p "  Display name [$SLUG]: " DISPLAY_NAME
    [ -z "$DISPLAY_NAME" ] && DISPLAY_NAME="$SLUG"
    read -p "  Developer(s): " DEVELOPER
    read -p "  Publisher(s) [Enter if same as developer]: " PUBLISHER
    [ -z "$PUBLISHER" ] && PUBLISHER="$DEVELOPER"
    while true; do
      read -p "  Current or Archive? (c/a): " ERA
      case "$ERA" in
        c) ERA="current"; break ;;
        a) ERA="archive"; break ;;
        *) echo "    → answer 'c' (current) or 'a' (archive)" ;;
      esac
    done
  fi
  echo ""

  local SET_TITLES=()
  local i img_count prompt_label title
  for ((i = 0; i < STAGED_COUNT; i++)); do
    img_count=$(count_images "${STAGED_DIRS[$i]}")
    local default_title
    default_title=$(basename "${STAGED_DIRS[$i]}")
    if [ "$STAGED_COUNT" -gt 1 ]; then
      prompt_label="Set title $((i + 1))/$STAGED_COUNT ($img_count image(s)) [$default_title]: "
    else
      prompt_label="Set title ($img_count image(s)) [$default_title]: "
    fi
    read -p "  $prompt_label" title
    [ -z "$title" ] && title="$default_title"
    SET_TITLES+=("$title")
  done

  echo ""

  if [ "$MODE" = "new" ] || [ "$MODE" = "orphan" ]; then
    create_entry_skeleton "$SLUG" "$DISPLAY_NAME" "$PUBLISHER" "$DEVELOPER" "$ERA"
  fi

  if [ "$MODE" = "orphan" ]; then
    # Sets already exist on disk without being referenced in data.js:
    # register them (unknown titles) before adding the newly pushed sets.
    local n=1 cnt
    while [ -d "$LIVE/$SLUG/set-$n" ]; do
      cnt=$(count_images "$LIVE/$SLUG/set-$n")
      append_set_to_data "$SLUG" "" "$cnt" "$n"
      echo "  existing set-$n registered in data.js ($cnt image(s), unknown title)."
      n=$((n + 1))
    done
  fi

  # For MODE=append/orphan: collect the new sets' info during generation,
  # then prepend them in reverse order + promote the album to the top.
  local NEW_SET_TITLES=() NEW_SET_COUNTS=() NEW_SET_NUMS=()

  for ((i = 0; i < STAGED_COUNT; i++)); do
    local SRC_DIR="${STAGED_DIRS[$i]}"
    local SET_TITLE="${SET_TITLES[$i]}"

    local SET_NUM=1
    while [ -d "$LIVE/$SLUG/set-$SET_NUM" ]; do
      SET_NUM=$((SET_NUM + 1))
    done

    local PREFIX="${SLUG}_set${SET_NUM}"

    local SET_DIR="$LIVE/$SLUG/set-$SET_NUM"
    local THUMBS_DIR="$SET_DIR/thumbs"
    local FULL_DIR="$SET_DIR/full"
    local DOWNLOADS_DIR="$SET_DIR/downloads"
    mkdir -p "$THUMBS_DIR" "$FULL_DIR" "$DOWNLOADS_DIR"

    echo ""
    echo "  Set $((i + 1))/$STAGED_COUNT → set-$SET_NUM: generating from masters (PNG → encoded JPEG, JPG → copied) + full-screen WebP + thumbnail..."
    local j=1
    while IFS= read -r img; do
      local stem="${PREFIX}_$(printf '%02d' $j)"

      # Download (downloads/) depending on the master's nature:
      #   - master already JPEG → faithful copy (never re-encode JPEG→JPEG, which would degrade).
      #   - lossless master (PNG…) → JPEG q95/4:4:4 encoded by Python below.
      local ext_lc jpg_arg
      ext_lc=$(printf '%s' "${img##*.}" | tr '[:upper:]' '[:lower:]')
      if [ "$ext_lc" = "jpg" ] || [ "$ext_lc" = "jpeg" ]; then
        cp "$img" "$DOWNLOADS_DIR/$stem.jpg"
        jpg_arg="-"   # download already done: Python only generates full/ + thumbs/
      else
        jpg_arg="$DOWNLOADS_DIR/$stem.jpg"
      fi

      # full/: full-resolution WebP q88 (display). thumbs/: downscaled WebP q75 (min side 500px).
      python3 - "$img" "$jpg_arg" "$FULL_DIR/$stem.webp" "$THUMBS_DIR/$stem.webp" << 'PYEOF'
import sys
from PIL import Image
src, jpg_out, full_out, thumb_out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
img = Image.open(src)
rgb = img.convert("RGB")  # flatten any alpha channel (required for JPEG, consistent with the WebP)
# Download: JPEG q95/4:4:4 from a lossless master ('-' = master already JPEG, already copied).
if jpg_out != "-":
    rgb.save(jpg_out, "JPEG", quality=95, subsampling=0, optimize=True)
# Full-screen: full resolution, WebP q88 (method=6 = best compression).
rgb.save(full_out, "WEBP", quality=88, method=6)
# Thumbnail: downscaled to 500px on the short side, WebP q75.
w, h = rgb.size
scale = 500 / min(w, h)
rgb.resize((int(w * scale), int(h * scale)), Image.LANCZOS).save(thumb_out, "WEBP", quality=75)
PYEOF
      j=$((j + 1))
    done < <(find "$SRC_DIR" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \) | sort)
    local FINAL_COUNT=$((j - 1))
    echo "  $FINAL_COUNT image(s): original (downloads/) + full-screen WebP (full/) + thumbnail (thumbs/)."

    if [ "$MODE" = "new" ]; then
      echo "  Updating data.js..."
      append_set_to_data "$SLUG" "$SET_TITLE" "$FINAL_COUNT" "$SET_NUM"
      echo "  data.js updated."
    else
      NEW_SET_TITLES+=("$SET_TITLE")
      NEW_SET_COUNTS+=("$FINAL_COUNT")
      NEW_SET_NUMS+=("$SET_NUM")
    fi
  done

  if [ "$MODE" != "new" ]; then
    echo "  Updating data.js (prepend + promote)..."
    for ((i = STAGED_COUNT - 1; i >= 0; i--)); do
      prepend_set_to_data "$SLUG" "${NEW_SET_TITLES[$i]}" "${NEW_SET_COUNTS[$i]}" "${NEW_SET_NUMS[$i]}"
    done
    promote_album_to_top "$SLUG"
    echo "  data.js updated."
  fi

  create_album_page "$SLUG" "$DISPLAY_NAME"

  # Mirror the freshly generated media to Vercel Blob (the front serves from there).
  # The local copy under site/assets/album-live/ stays as a gitignored mirror/backup.
  echo "  Uploading media to Vercel Blob..."
  node --env-file-if-exists="$SCRIPT_DIR/.env" "$SCRIPT_DIR/tools/blob-sync.mjs" "$SLUG"

  rm -rf "$STAGING/$STAGE_NAME"
  echo "  album-staging/$STAGE_NAME/ removed."

  echo ""
  if [ "$MODE" = "new" ] || [ "$MODE" = "orphan" ]; then
    echo "  ✓ Album '$DISPLAY_NAME' published ($STAGED_COUNT set(s) added, $TOTAL_IMAGES image(s))."
  else
    echo "  ✓ $STAGED_COUNT set(s) added to '$SLUG' ($TOTAL_IMAGES image(s))."
  fi
  echo ""
}

# Album media uploads to Vercel Blob — make sure the token is available before
# generating anything (avoids aborting mid-publish on a missing credential).
if ! node --env-file-if-exists="$SCRIPT_DIR/.env" -e 'process.exit(process.env.BLOB_READ_WRITE_TOKEN ? 0 : 1)' 2>/dev/null; then
  echo "Error: BLOB_READ_WRITE_TOKEN not found. Set it in .env at the project root."
  echo ""
  exit 1
fi

for STAGE in "${SLUGS[@]}"; do
  publish_slug "$STAGE"
done

echo "══════════════════════════════════════════"
echo "Staging push complete."
echo ""
