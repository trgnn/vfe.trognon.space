#!/usr/bin/env python3
# Repair an existing album/series' on-disk media from its downloads/ originals.
#
#   report      <assets> <out>            scan all items; list those with a numbering
#                                          gap and/or missing/orphaned derivatives.
#                                          Writes "kind:slug:flags" lines (flags ⊆
#                                          {gap,deriv}). Exit 0 if any, 10 if none.
#   derivatives <assets> <kind> <slug>    regenerate full/ + thumbs/ from downloads/
#                                          (current encode settings) and drop any
#                                          orphaned derivative. Fixes missing/stale
#                                          derivatives and re-encodes to today's q80.
#   renumber    <assets> <kind> <slug> [<map_out>]
#                                          compact filenames to contiguous {slug}_01..N
#                                          across downloads/ + full/ + thumbs/. Prints
#                                          the new count (caller updates data.js); if
#                                          <map_out> is given, writes "oldNN newNN"
#                                          lines so the caller can re-check featured.
#
# Encode settings MUST stay in sync with sync-and-push.sh generate_media.

import sys
import os
import re
from PIL import Image, ImageOps

FULL_Q = 80
THUMB_Q = 50
THUMB_SHORT = 760
TYPES = ('album', 'series')
STEM_RE = re.compile(r'^(.+)_(\d+)\.([^.]+)$')


def downloads_stems(base):
    """Sorted [(nn:int, stem:str)] from downloads/ (stem = '<prefix>_<NN>')."""
    d = os.path.join(base, 'downloads')
    out = []
    if os.path.isdir(d):
        for f in os.listdir(d):
            m = STEM_RE.match(f)
            if m:
                out.append((int(m.group(2)), f"{m.group(1)}_{m.group(2)}"))
    out.sort()
    return out


def diagnose(base):
    """Return a set of flags ⊆ {'gap','deriv'} for one item."""
    stems = downloads_stems(base)
    flags = set()
    if not stems:
        return flags
    nns = [nn for nn, _ in stems]
    if nns != list(range(1, len(nns) + 1)):
        flags.add('gap')
    want = {s for _, s in stems}
    for sub in ('full', 'thumbs'):
        d = os.path.join(base, sub)
        have = set()
        if os.path.isdir(d):
            have = {os.path.splitext(f)[0] for f in os.listdir(d)
                    if f.lower().endswith('.avif')}
        if want - have or have - want:   # missing OR orphaned
            flags.add('deriv')
    return flags


def encode_derivatives(src_jpg, full_out, thumb_out):
    img = ImageOps.exif_transpose(Image.open(src_jpg))  # honor EXIF orientation
    rgb = img.convert("RGB")                              # drop ICC → treated as sRGB
    rgb.save(full_out, "AVIF", quality=FULL_Q, speed=6)
    w, h = rgb.size
    scale = min(THUMB_SHORT / min(w, h), 1.0)
    thumb = rgb.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else rgb
    thumb.save(thumb_out, "AVIF", quality=THUMB_Q, speed=6)


def cmd_report(assets, out_path):
    rows = []
    for kind in TYPES:
        root = os.path.join(assets, kind)
        if not os.path.isdir(root):
            continue
        for slug in sorted(os.listdir(root)):
            base = os.path.join(root, slug)
            if not os.path.isdir(base):
                continue
            flags = diagnose(base)
            if flags:
                rows.append((kind, slug, ','.join(sorted(flags))))
    with open(out_path, 'w') as f:
        for kind, slug, flags in rows:
            f.write(f"{kind}:{slug}:{flags}\n")
    if not rows:
        print("Media is consistent (numbering + derivatives). Nothing to repair.")
        sys.exit(10)
    print("Media issues detected:")
    for kind, slug, flags in rows:
        what = []
        if 'gap' in flags:
            what.append("numbering gap")
        if 'deriv' in flags:
            what.append("missing/stale derivatives")
        print(f"  ⚠ {kind}/{slug}: {', '.join(what)}")
    print()
    sys.exit(0)


def cmd_derivatives(assets, kind, slug):
    base = os.path.join(assets, kind, slug)
    downloads = os.path.join(base, 'downloads')
    if not os.path.isdir(downloads):
        sys.exit(f"Error: {downloads} not found")
    os.makedirs(os.path.join(base, 'full'), exist_ok=True)
    os.makedirs(os.path.join(base, 'thumbs'), exist_ok=True)
    n = 0
    for f in sorted(os.listdir(downloads)):
        m = STEM_RE.match(f)
        if not m:
            continue
        stem = f"{m.group(1)}_{m.group(2)}"
        encode_derivatives(os.path.join(downloads, f),
                           os.path.join(base, 'full', stem + '.avif'),
                           os.path.join(base, 'thumbs', stem + '.avif'))
        n += 1
    # drop orphaned derivatives (no matching downloads stem)
    want = {f"{m.group(1)}_{m.group(2)}" for f in os.listdir(downloads)
            if (m := STEM_RE.match(f))}
    for sub in ('full', 'thumbs'):
        d = os.path.join(base, sub)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.lower().endswith('.avif') and os.path.splitext(f)[0] not in want:
                os.remove(os.path.join(d, f))
    print(f"Rebuilt derivatives for {n} image(s) in {kind}/{slug}.")


def cmd_renumber(assets, kind, slug, map_out=None):
    base = os.path.join(assets, kind, slug)
    if not os.path.isdir(os.path.join(base, 'downloads')):
        sys.exit(f"Error: {base}/downloads not found")
    olds = downloads_stems(base)  # sorted by NN
    mapping = []        # (oldstem, newstem) for file renames
    index_map = []      # (old_NN, new_NN) for featured/curation cross-checks
    for newi, (oldnn, oldstem) in enumerate(olds, start=1):
        mapping.append((oldstem, f"{slug}_{newi:02d}"))
        index_map.append((oldnn, newi))
    for sub, ext in (('downloads', 'jpg'), ('full', 'avif'), ('thumbs', 'avif')):
        d = os.path.join(base, sub)
        if not os.path.isdir(d):
            continue
        # two-phase (old → temp → new) so shifting indices never collide
        for i, (oldstem, _) in enumerate(mapping):
            src = os.path.join(d, f"{oldstem}.{ext}")
            if os.path.exists(src):
                os.rename(src, os.path.join(d, f".__renum_{i}.{ext}"))
        for i, (_, newstem) in enumerate(mapping):
            tmp = os.path.join(d, f".__renum_{i}.{ext}")
            if os.path.exists(tmp):
                os.rename(tmp, os.path.join(d, f"{newstem}.{ext}"))
    if map_out:
        with open(map_out, 'w') as f:
            for old, new in index_map:
                f.write(f"{old} {new}\n")
    print(len(mapping))


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit("Usage: rebuild-media.py <report|derivatives|renumber> ...")
    if a[0] == 'report':
        cmd_report(a[1], a[2])
    elif a[0] == 'derivatives':
        cmd_derivatives(a[1], a[2], a[3])
    elif a[0] == 'renumber':
        cmd_renumber(a[1], a[2], a[3], a[4] if len(a) > 4 else None)
    else:
        sys.exit(f"Unknown command: {a[0]!r}")


if __name__ == '__main__':
    main()
