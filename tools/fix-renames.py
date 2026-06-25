#!/usr/bin/env python3
# Detect & fix media folders whose files no longer match the folder slug — i.e.
# the folder was renamed on disk but its files still carry the old slug prefix
# (e.g. assets/album/new/ holding old_01.avif …). The file prefix is the
# fingerprint of the old slug, so the rename is unambiguous.
#
# `apply` renames <oldPrefix>_NN.<ext> -> <folder>_NN.<ext> across downloads/,
# full/ and thumbs/. The (kind:old:new) pairs are emitted to <pairs_out> so the
# caller can migrate data.js (rename-slug) too.
#
# Usage:
#   fix-renames.py report <assets> <pairs_out>   list mismatches; exit 0 if any, 10 if none
#   fix-renames.py apply  <assets> <pairs_out>   rename the files to match folders
#
# Files are only ever renamed within their folder — never moved across folders.

import sys
import os
import re

TYPES = ('album', 'series')
SUBDIRS = ('downloads', 'full', 'thumbs')
# {prefix}_{NN}.{ext} — the prefix (slug) may itself contain '_', so anchor on the
# final _<digits> before the extension.
STEM_RE = re.compile(r'^(.+)_(\d+)\.([^.]+)$')


def folder_prefix(slug_path):
    """The single file-stem prefix used in downloads/, or None if empty or mixed."""
    downloads = os.path.join(slug_path, 'downloads')
    if not os.path.isdir(downloads):
        return None
    prefixes = {m.group(1) for f in os.listdir(downloads)
                if (m := STEM_RE.match(f))}
    return next(iter(prefixes)) if len(prefixes) == 1 else None


def scan(assets):
    """Return [(kind, folder, old_prefix)] for folders whose files don't match."""
    out = []
    for kind in TYPES:
        root = os.path.join(assets, kind)
        if not os.path.isdir(root):
            continue
        for folder in sorted(os.listdir(root)):
            slug_path = os.path.join(root, folder)
            if not os.path.isdir(slug_path):
                continue
            p = folder_prefix(slug_path)
            if p is not None and p != folder:
                out.append((kind, folder, p))
    return out


def rename_folder_files(slug_path, old, new):
    """Rename old_NN.* -> new_NN.* in every subdir. Collision-safe: checks all
    targets first and skips the folder (returns -1) if any already exists."""
    ops = []
    for sub in SUBDIRS:
        d = os.path.join(slug_path, sub)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            m = STEM_RE.match(f)
            if not m or m.group(1) != old:
                continue
            dst = f"{new}_{m.group(2)}.{m.group(3)}"
            ops.append((os.path.join(d, f), os.path.join(d, dst)))
    for _, dst in ops:
        if os.path.exists(dst):
            print(f"  ⚠ {os.path.relpath(dst, slug_path)} already exists — skipping {old} → {new}.")
            return -1
    for src, dst in ops:
        os.rename(src, dst)
    return len(ops)


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ('report', 'apply'):
        sys.exit("Usage: fix-renames.py <report|apply> <assets> <pairs_out>")
    mode, assets, pairs_out = sys.argv[1:4]

    items = scan(assets)
    with open(pairs_out, 'w') as f:
        for kind, folder, old in items:
            f.write(f"{kind}:{old}:{folder}\n")

    if not items:
        print("All media filenames already match their folder. Nothing to rename.")
        sys.exit(10)

    print("Renamed folders detected (files still carry the old slug):")
    for kind, folder, old in items:
        print(f"  {kind}/{folder}: files '{old}_NN' → '{folder}_NN'")
    print()

    if mode == 'report':
        sys.exit(0)

    total = 0
    for kind, folder, old in items:
        n = rename_folder_files(os.path.join(assets, kind, folder), old, folder)
        if n >= 0:
            total += n
            print(f"  {kind}/{folder}: {n} file(s) renamed.")
    print(f"{total} file(s) renamed.")
    print()


if __name__ == '__main__':
    main()
