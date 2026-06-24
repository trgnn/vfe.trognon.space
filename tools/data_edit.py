#!/usr/bin/env python3
# All read/write operations on site/js/data.js, centralized.
#
# data.js holds two machine-managed arrays — albums and series — of flat entries:
#   albums:  { slug, name, era, developer, publisher, count }
#   series:  { slug, name, description, count }
# (collections + starred live in curation.js and are never touched here.)
#
# Subcommands:
#   type   <data> <slug>                                  -> 'album' | 'series' | 'none'
#   count  <data> <slug>                                  -> current count, or -1
#   add-album  <data> <slug> <name> <era> <dev> <pub> <n> insert new album at top
#   add-series <data> <slug> <name> <desc> <n>           insert new series at top
#   set-count  <data> <slug> <n>                          set count of existing item + promote
#   reconcile  report|apply <assets> <data> <orphans> <removed>
#                                                          align data.js with assets/{album,series}/

import sys, os, re


# ── data.js parse / render ──────────────────────────────────────────────────────

def read(p):
    with open(p) as f:
        return f.read()


def write(p, c):
    with open(p, 'w') as f:
        f.write(c)


def array_match(content, name):
    # Entries carry no nested braces, so the array closer is the first "\n  ]".
    return re.search(r'(' + name + r':\s*\[)(.*?)(\n  \])', content, re.DOTALL)


def parse_entries(body):
    out = []
    for block in re.findall(r'\{[^{}]*\}', body):
        d = {}
        for k, v in re.findall(r"(\w+):\s*('(?:[^'\\]|\\.)*'|null|-?\d+)", block):
            d[k] = v
        if 'slug' in d:
            out.append(d)
    return out


def tok(s):
    """Quote a string for JS, or 'null' when empty."""
    if s == '':
        return 'null'
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def render_album(d):
    return ("    {\n"
            f"      slug: {d['slug']},\n"
            f"      name: {d['name']},\n"
            f"      era: {d['era']},\n"
            f"      developer: {d.get('developer', 'null')},\n"
            f"      publisher: {d.get('publisher', 'null')},\n"
            f"      count: {d['count']}\n"
            "    }")


def render_series(d):
    return ("    {\n"
            f"      slug: {d['slug']},\n"
            f"      name: {d['name']},\n"
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


def cmd_add_album(data, slug, name, era, dev, pub, n):
    content = read(data)
    entries = get_entries(content, 'albums')
    entries = [e for e in entries if e['slug'] != tok(slug)]
    entries.insert(0, {'slug': tok(slug), 'name': tok(name), 'era': tok(era),
                       'developer': tok(dev), 'publisher': tok(pub), 'count': str(int(n))})
    write(data, replace_array(content, 'albums', entries, render_album))


def cmd_add_series(data, slug, name, desc, n):
    content = read(data)
    entries = get_entries(content, 'series')
    entries = [e for e in entries if e['slug'] != tok(slug)]
    entries.insert(0, {'slug': tok(slug), 'name': tok(name),
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

    print("Fixes to apply:")
    for kind, slug, old, new in fixes:
        if new is None:
            print(f"  - Remove {kind} '{slug}' (missing from disk)")
        else:
            print(f"  - Update count of {kind} '{slug}': {old} → {new}")
    print()

    if mode == 'report':
        sys.exit(0)

    # apply
    removed = []
    for kind, name, render in (('album', 'albums', render_album), ('series', 'series', render_series)):
        entries = get_entries(content, name)
        new_entries = []
        for e in entries:
            slug = e['slug'].strip("'")
            fix = next((f for f in fixes if f[0] == kind and f[1] == slug), None)
            if fix and fix[3] is None:
                removed.append((kind, slug))
                continue
            if fix:
                e['count'] = str(fix[3])
            new_entries.append(e)
        content = replace_array(content, name, new_entries, render)
    write(data, content)

    with open(removed_path, 'w') as f:
        for kind, slug in removed:
            f.write(f'{kind}:{slug}\n')

    print(f"{len(fixes)} fix(es) applied. data.js updated.")
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
        cmd_add_album(a[1], a[2], a[3], a[4], a[5], a[6], a[7])
    elif cmd == 'add-series':
        cmd_add_series(a[1], a[2], a[3], a[4], a[5])
    elif cmd == 'set-count':
        cmd_set_count(a[1], a[2], a[3])
    elif cmd == 'reconcile':
        cmd_reconcile(a[1], a[2], a[3], a[4], a[5])
    else:
        sys.exit(f"Unknown command: {cmd!r}")


if __name__ == '__main__':
    main()
