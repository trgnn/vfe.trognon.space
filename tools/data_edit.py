#!/usr/bin/env python3
# All read/write operations on site/js/data.js, centralized.
#
# data.js holds two machine-managed arrays — albums and series — of flat entries:
#   albums:  { slug, name, subtitle, era, developer, publisher, count, featured: [..] }
#   series:  { slug, name, era, description, count }
# (collections + starred live in curation.js and are never touched here.)
#
# Subcommands:
#   type   <data> <slug>                                  -> 'album' | 'series' | 'none'
#   count  <data> <slug>                                  -> current count, or -1
#   add-album  <data> <slug> <name> <sub> <era> <dev> <pub> <n> [<featured_csv>]  insert album
#   set-featured  <data> <slug> <csv>                     replace album's featured index list
#   add-featured  <data> <slug> <csv>                     merge indices into featured (append)
#   remap-featured <data> <slug> <mapfile>                apply renumber old→new map to featured
#   add-series <data> <slug> <name> <era> <desc> <n>     insert new series at top
#   set-count  <data> <slug> <n>                          set count of existing item + promote
#   rename-slug <data> <old> <new>                        rename an item's slug, keeping its data
#   remove-item <data> <kind> <slug>                      remove a single album/series entry
#   reconcile apply now defers removals (records candidates) — caller confirms each
#   reconcile  report|apply <assets> <data> <orphans> <removed>
#                                                          align data.js with assets/{album,series}/

import sys, os, re, tempfile


# ── data.js parse / render ──────────────────────────────────────────────────────

def read(p):
    with open(p) as f:
        return f.read()


def write(p, c):
    # Atomic: write to a temp file in the same dir, fsync, then os.replace so an
    # interrupt can never leave data.js half-written (it is the committed source).
    d = os.path.dirname(os.path.abspath(p))
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.data_edit-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(c)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def array_match(content, name):
    # Entries carry no nested braces, so the array closer is the first "\n  ]".
    return re.search(r'(' + name + r':\s*\[)(.*?)(\n  \])', content, re.DOTALL)


def parse_entries(body):
    out = []
    for block in re.findall(r'\{[^{}]*\}', body):
        d = {}
        # Values are a quoted string, an array [..], null, or an integer. The array
        # alternative lets per-album index fields (e.g. featured) round-trip intact.
        for k, v in re.findall(r"(\w+):\s*('(?:[^'\\]|\\.)*'|\[[^\]]*\]|null|-?\d+)", block):
            d[k] = v
        if 'slug' in d:
            out.append(d)
    return out


def tok(s):
    """Quote a string for JS, or 'null' when empty."""
    if s == '':
        return 'null'
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def parse_indices(csv):
    """'3, 7' / '3 7' → [3, 7] (sorted, unique)."""
    return sorted({int(t) for t in re.split(r'[,\s]+', (csv or '').strip()) if t.isdigit()})


def read_indices(s):
    """Stored array string '[7, 12]' → [7, 12]."""
    return [int(x) for x in re.findall(r'\d+', s or '')]


def fmt_indices(lst):
    """[7, 12] → '[7, 12]' (sorted, unique); empty → '[]'."""
    return '[' + ', '.join(str(i) for i in sorted(set(lst))) + ']'


def render_album(d):
    return ("    {\n"
            f"      slug: {d['slug']},\n"
            f"      name: {d['name']},\n"
            f"      subtitle: {d.get('subtitle', 'null')},\n"
            f"      era: {d['era']},\n"
            f"      developer: {d.get('developer', 'null')},\n"
            f"      publisher: {d.get('publisher', 'null')},\n"
            f"      count: {d['count']},\n"
            f"      featured: {d.get('featured', '[]')}\n"
            "    }")


def render_series(d):
    era = d.get('era', "'current'")
    return ("    {\n"
            f"      slug: {d['slug']},\n"
            f"      name: {d['name']},\n"
            f"      era: {era},\n"
            f"      description: {d.get('description', 'null')},\n"
            f"      count: {d['count']}\n"
            "    }")


def render_body(entries, render):
    if not entries:
        return ''
    return '\n' + ',\n'.join(render(d) for d in entries) + ','


def replace_array(content, name, entries, render):
    m = array_match(content, name)
    if not m:
        sys.exit(f"Error: '{name}' array not found in data.js")
    return content[:m.start()] + m.group(1) + render_body(entries, render) + m.group(3) + content[m.end():]


def get_entries(content, name):
    m = array_match(content, name)
    return parse_entries(m.group(2)) if m else []


# ── commands ────────────────────────────────────────────────────────────────────

def cmd_type(data, slug):
    content = read(data)
    if any(e['slug'] == tok(slug) for e in get_entries(content, 'albums')):
        print('album')
    elif any(e['slug'] == tok(slug) for e in get_entries(content, 'series')):
        print('series')
    else:
        print('none')


def cmd_count(data, slug):
    content = read(data)
    for name in ('albums', 'series'):
        for e in get_entries(content, name):
            if e['slug'] == tok(slug):
                print(e['count'])
                return
    print(-1)


def cmd_add_album(data, slug, name, subtitle, era, dev, pub, n, featured=''):
    content = read(data)
    entries = get_entries(content, 'albums')
    entries = [e for e in entries if e['slug'] != tok(slug)]
    entries.insert(0, {'slug': tok(slug), 'name': tok(name), 'subtitle': tok(subtitle),
                       'era': tok(era), 'developer': tok(dev), 'publisher': tok(pub),
                       'count': str(int(n)), 'featured': fmt_indices(parse_indices(featured))})
    write(data, replace_array(content, 'albums', entries, render_album))


def _featured_album(content, slug):
    entries = get_entries(content, 'albums')
    e = next((x for x in entries if x['slug'] == tok(slug)), None)
    return entries, e


def cmd_set_featured(data, slug, csv):
    content = read(data)
    entries, e = _featured_album(content, slug)
    if e is None:
        sys.exit(f"Error: album '{slug}' not found in data.js")
    e['featured'] = fmt_indices(parse_indices(csv))
    write(data, replace_array(content, 'albums', entries, render_album))


def cmd_add_featured(data, slug, csv):
    content = read(data)
    entries, e = _featured_album(content, slug)
    if e is None:
        sys.exit(f"Error: album '{slug}' not found in data.js")
    e['featured'] = fmt_indices(read_indices(e.get('featured')) + parse_indices(csv))
    write(data, replace_array(content, 'albums', entries, render_album))


def cmd_remap_featured(data, slug, mapfile):
    # Apply a renumber's old→new index map to this album's featured list; indices
    # with no new home (a gap that vanished) are dropped. Silent no-op if the album
    # has no featured.
    remap = {}
    with open(mapfile) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                remap[int(parts[0])] = int(parts[1])
    content = read(data)
    entries, e = _featured_album(content, slug)
    if e is None:
        return
    cur = read_indices(e.get('featured'))
    new = [remap[i] for i in cur if i in remap]
    if fmt_indices(new) == (e.get('featured') or '[]'):
        return  # unchanged
    e['featured'] = fmt_indices(new)
    write(data, replace_array(content, 'albums', entries, render_album))
    print(f"  data.js: featured for '{slug}' remapped → {fmt_indices(new)}")


def cmd_add_series(data, slug, name, era, desc, n):
    content = read(data)
    entries = get_entries(content, 'series')
    entries = [e for e in entries if e['slug'] != tok(slug)]
    entries.insert(0, {'slug': tok(slug), 'name': tok(name), 'era': tok(era),
                       'description': tok(desc), 'count': str(int(n))})
    write(data, replace_array(content, 'series', entries, render_series))


def cmd_set_count(data, slug, n):
    content = read(data)
    for name, render in (('albums', render_album), ('series', render_series)):
        entries = get_entries(content, name)
        idx = next((i for i, e in enumerate(entries) if e['slug'] == tok(slug)), None)
        if idx is not None:
            e = entries.pop(idx)
            e['count'] = str(int(n))
            entries.insert(0, e)  # promote to top
            write(data, replace_array(content, name, entries, render))
            return
    sys.exit(f"Error: slug '{slug}' not found in data.js")


def cmd_rename_slug(data, old, new):
    content = read(data)
    # The new slug must be free across both arrays.
    for name in ('albums', 'series'):
        if any(e['slug'] == tok(new) for e in get_entries(content, name)):
            sys.exit(f"Error: slug '{new}' already exists in data.js")
    for name, render in (('albums', render_album), ('series', render_series)):
        entries = get_entries(content, name)
        idx = next((i for i, e in enumerate(entries) if e['slug'] == tok(old)), None)
        if idx is not None:
            entries[idx]['slug'] = tok(new)  # everything else (and position) is kept
            write(data, replace_array(content, name, entries, render))
            return
    sys.exit(f"Error: slug '{old}' not found in data.js")


def cmd_remove_item(data, kind, slug):
    content = read(data)
    name = 'albums' if kind == 'album' else 'series'
    render = render_album if kind == 'album' else render_series
    entries = get_entries(content, name)
    kept = [e for e in entries if e['slug'] != tok(slug)]
    if len(kept) == len(entries):
        sys.exit(f"Error: {kind} '{slug}' not found in data.js")
    write(data, replace_array(content, name, kept, render))


# ── reconcile ───────────────────────────────────────────────────────────────────

IMG_EXT = ('.jpg', '.jpeg', '.png')


def scan_disk(assets):
    """Return {('album'|'series', slug): count} and a list of integrity warnings."""
    live = {}
    warnings = []
    for kind in ('album', 'series'):
        root = os.path.join(assets, kind)
        if not os.path.isdir(root):
            continue
        for slug in sorted(os.listdir(root)):
            slug_path = os.path.join(root, slug)
            if not os.path.isdir(slug_path):
                continue
            downloads = os.path.join(slug_path, 'downloads')
            imgs = []
            if os.path.isdir(downloads):
                imgs = [f for f in os.listdir(downloads)
                        if f.lower().endswith(IMG_EXT)
                        and os.path.isfile(os.path.join(downloads, f))]
            count = len(imgs)
            live[(kind, slug)] = count

            # Naming continuity: {slug}_01.jpg .. {slug}_{count}.jpg
            expected = {f'{slug}_{str(i).zfill(2)}.jpg' for i in range(1, count + 1)}
            actual = set(imgs)
            missing, extra = sorted(expected - actual), sorted(actual - expected)
            if missing or extra:
                detail = []
                if missing:
                    detail.append(f"missing: {', '.join(missing)}")
                if extra:
                    detail.append(f"unexpected: {', '.join(extra)}")
                warnings.append(f"  ⚠ {kind}/{slug}: inconsistent naming in downloads/ ({'; '.join(detail)})")

            # Pairing original ↔ full ↔ thumb: each downloads JPG needs its .avif in both.
            expected_avif = {os.path.splitext(f)[0] + '.avif' for f in actual}
            for sub in ('full', 'thumbs'):
                sub_path = os.path.join(slug_path, sub)
                files = set()
                if os.path.isdir(sub_path):
                    files = {f for f in os.listdir(sub_path)
                             if f.lower().endswith('.avif')
                             and os.path.isfile(os.path.join(sub_path, f))}
                miss = sorted(expected_avif - files)
                orph = sorted(files - expected_avif)
                if miss:
                    warnings.append(f"  ⚠ {kind}/{slug}: {sub}/ missing for {', '.join(miss)}")
                if orph:
                    warnings.append(f"  ⚠ {kind}/{slug}: {sub}/ orphaned (no original): {', '.join(orph)}")
    return live, warnings


def cmd_reconcile(mode, assets, data, orphans_path, removed_path):
    live, warnings = scan_disk(assets)
    content = read(data)

    data_items = {}  # (kind, slug) -> count (int)
    for kind, name in (('album', 'albums'), ('series', 'series')):
        for e in get_entries(content, name):
            slug = e['slug'].strip("'")
            data_items[(kind, slug)] = int(e['count'])

    fixes = []   # (kind, slug, old, new)  — new=None means remove
    orphans = [] # (kind, slug)

    for key, count in data_items.items():
        if key not in live:
            fixes.append((key[0], key[1], count, None))
        elif live[key] != count:
            fixes.append((key[0], key[1], count, live[key]))

    for key, count in live.items():
        if key not in data_items:
            orphans.append(key)

    with open(orphans_path, 'w') as f:
        for kind, slug in orphans:
            f.write(f'{kind}:{slug}\n')
    open(removed_path, 'w').close()

    if orphans:
        print("Orphans detected (on disk, missing from data.js):")
        for kind, slug in orphans:
            print(f"  ⚠ {kind}/{slug}")
        print()

    if warnings:
        print("Inconsistencies detected (report only, fix manually):")
        for w in warnings:
            print(w)
        print()

    if not fixes:
        if not orphans and not warnings:
            print("data.js is already aligned with assets/. Nothing to do.")
            print()
        sys.exit(10)

    count_fixes = [f for f in fixes if f[3] is not None]
    removals    = [f for f in fixes if f[3] is None]
    if count_fixes:
        print("Count updates (applied together):")
        for kind, slug, old, new in count_fixes:
            print(f"  - Update count of {kind} '{slug}': {old} → {new}")
        print()
    if removals:
        print("Vanished from disk (each confirmed individually before removal):")
        for kind, slug, old, _ in removals:
            print(f"  - {kind} '{slug}' (was {old} image(s))")
        print()

    if mode == 'report':
        sys.exit(0)

    # apply: count updates only. Removals are NOT applied here — they are recorded
    # as candidates (removed_path) so the caller can confirm each one (and its Blob
    # deletion) individually. A vanished item is kept in data.js until confirmed.
    removed = []
    for kind, name, render in (('album', 'albums', render_album), ('series', 'series', render_series)):
        entries = get_entries(content, name)
        for e in entries:
            slug = e['slug'].strip("'")
            fix = next((f for f in fixes if f[0] == kind and f[1] == slug), None)
            if not fix:
                continue
            if fix[3] is None:
                removed.append((kind, slug))   # candidate; entry kept for now
            else:
                e['count'] = str(fix[3])
        content = replace_array(content, name, entries, render)
    write(data, content)

    with open(removed_path, 'w') as f:
        for kind, slug in removed:
            f.write(f'{kind}:{slug}\n')

    print(f"{len(count_fixes)} count update(s) applied; "
          f"{len(removals)} vanished item(s) pending individual confirmation.")
    print()


# ── dispatch ────────────────────────────────────────────────────────────────────

def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ''
    if cmd == 'type':
        cmd_type(a[1], a[2])
    elif cmd == 'count':
        cmd_count(a[1], a[2])
    elif cmd == 'add-album':
        cmd_add_album(a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9] if len(a) > 9 else '')
    elif cmd == 'set-featured':
        cmd_set_featured(a[1], a[2], a[3])
    elif cmd == 'add-featured':
        cmd_add_featured(a[1], a[2], a[3])
    elif cmd == 'remap-featured':
        cmd_remap_featured(a[1], a[2], a[3])
    elif cmd == 'add-series':
        cmd_add_series(a[1], a[2], a[3], a[4], a[5], a[6])
    elif cmd == 'set-count':
        cmd_set_count(a[1], a[2], a[3])
    elif cmd == 'rename-slug':
        cmd_rename_slug(a[1], a[2], a[3])
    elif cmd == 'remove-item':
        cmd_remove_item(a[1], a[2], a[3])
    elif cmd == 'reconcile':
        cmd_reconcile(a[1], a[2], a[3], a[4], a[5])
    else:
        sys.exit(f"Unknown command: {cmd!r}")


if __name__ == '__main__':
    main()
