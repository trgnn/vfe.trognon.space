#!/usr/bin/env node
// Sync local album/series media with Vercel Blob.
//
// The Blob pathname mirrors the site path (e.g. assets/album/<slug>/full/x.avif),
// so the front end only needs to prepend VFE_MEDIA_BASE (see site/js/config.js):
// an empty base serves from the same origin (/assets), a Blob base serves from Blob —
// the path after the base is identical in both cases.
//
// Usage:
//   node tools/blob-sync.mjs                  upload everything under assets/{album,series}/
//   node tools/blob-sync.mjs <slug>           upload that slug (auto-detect album vs series)
//   node tools/blob-sync.mjs <type> <slug>    upload assets/<type>/<slug> (type = album|series)
//   node tools/blob-sync.mjs mirror           REPORT the diff to make Blob match local assets/
//   node tools/blob-sync.mjs mirror --apply   APPLY that mirror (upload missing/changed, delete extra)
//
// `mirror` makes Blob bit-for-bit identical to the local mirror: it uploads files
// that are missing or changed (diff by path + size) and deletes Blob objects with
// no local counterpart — the catch-all for drift the event-driven upload/delete
// can't see (re-encodes, partial uploads, single-image deletions). Report mode
// exits 0 when changes are pending, 10 when already in sync.
//
// Requires BLOB_READ_WRITE_TOKEN in the environment.

import { put, list, del } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) {
  console.error('Error: BLOB_READ_WRITE_TOKEN is not set in the environment.');
  process.exit(1);
}

const SITE_DIR  = join(import.meta.dirname, '..', 'site');
const ASSETS_DIR = join(SITE_DIR, 'assets');
const TYPES = ['album', 'series'];

const CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Blob pathname for a local file: the site-relative path with forward slashes.
function blobPath(file) {
  return relative(SITE_DIR, file).split(sep).join('/'); // assets/album/...
}

async function uploadFile(file, pathname) {
  const body = await readFile(file);
  const contentType = CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  await put(pathname, body, {
    access: 'public',
    token: TOKEN,
    addRandomSuffix: false, // deterministic paths so the front can reconstruct URLs
    allowOverwrite: true,   // re-uploading a published image replaces it in place
    contentType,
  });
}

// ── upload mode ─────────────────────────────────────────────────────────────────

// Resolve which root directories to upload from the CLI arguments.
function resolveRoots(argv) {
  const [a, b] = argv;
  if (a && b) {
    if (!TYPES.includes(a)) {
      console.error(`Error: type must be one of ${TYPES.join(' | ')}, got '${a}'.`);
      process.exit(1);
    }
    return [join(ASSETS_DIR, a, b)];
  }
  if (a) {
    const matches = TYPES
      .map(t => join(ASSETS_DIR, t, a))
      .filter(p => existsSync(p));
    if (matches.length === 0) {
      console.error(`Error: '${a}' not found under assets/{${TYPES.join(',')}}/.`);
      process.exit(1);
    }
    return matches;
  }
  return TYPES.map(t => join(ASSETS_DIR, t)).filter(p => existsSync(p));
}

async function runUpload(argv) {
  const roots = resolveRoots(argv);
  const files = roots.flatMap(walk);

  if (files.length === 0) {
    console.error('Error: nothing to upload (no media files found).');
    process.exit(1);
  }

  console.log(`Uploading ${files.length} file(s) to Vercel Blob...`);
  let done = 0;
  for (const file of files) {
    const pathname = blobPath(file);
    await uploadFile(file, pathname);
    done++;
    if (done === 1 || done % 25 === 0 || done === files.length) {
      console.log(`  [${done}/${files.length}] ${pathname}`);
    }
  }
  console.log(`Done: ${done} file(s) uploaded.`);
}

// ── mirror mode ─────────────────────────────────────────────────────────────────

// Local media: pathname -> { abs, size }, scoped to assets/{album,series}/.
function localIndex() {
  const m = new Map();
  for (const t of TYPES) {
    const root = join(ASSETS_DIR, t);
    if (!existsSync(root)) continue;
    for (const f of walk(root)) m.set(blobPath(f), { abs: f, size: statSync(f).size });
  }
  return m;
}

// Blob media: pathname -> { size, url }, scoped to the same two prefixes so the
// mirror only ever touches album/series objects, never anything else on the store.
async function blobIndex() {
  const m = new Map();
  for (const t of TYPES) {
    let cursor;
    do {
      const res = await list({ prefix: `assets/${t}/`, cursor, token: TOKEN, limit: 1000 });
      for (const b of res.blobs) m.set(b.pathname, { size: b.size, url: b.url });
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
  }
  return m;
}

function computeDiff(local, blob) {
  const toUpload = []; // missing on Blob, or size differs
  const toDelete = []; // on Blob, no local counterpart
  for (const [p, l] of local) {
    const b = blob.get(p);
    if (!b) toUpload.push({ pathname: p, abs: l.abs, reason: 'new' });
    else if (b.size !== l.size) toUpload.push({ pathname: p, abs: l.abs, reason: 'changed' });
  }
  for (const [p, b] of blob) {
    if (!local.has(p)) toDelete.push({ pathname: p, url: b.url });
  }
  return { toUpload, toDelete };
}

function printList(label, items, fmt) {
  if (!items.length) return;
  console.log(`  ${label}:`);
  items.slice(0, 20).forEach(it => console.log(`    ${fmt(it)}`));
  if (items.length > 20) console.log(`    … and ${items.length - 20} more`);
}

async function runMirror(apply) {
  const local = localIndex();
  const blob = await blobIndex();

  // Safety: an empty local mirror almost always means an unsynced checkout
  // (assets/ is gitignored), not an intent to wipe Blob. Refuse to delete.
  if (local.size === 0) {
    console.log('Local assets/ mirror is empty — refusing to mirror (would delete all Blob media).');
    console.log('Populate the local mirror first (or run a full upload) before mirroring.');
    process.exit(10);
  }

  const { toUpload, toDelete } = computeDiff(local, blob);

  if (toUpload.length === 0 && toDelete.length === 0) {
    console.log('Blob already in sync with assets/. Nothing to do.');
    process.exit(10);
  }

  console.log(`Blob mirror plan: ${toUpload.length} to upload (missing/changed), `
    + `${toDelete.length} to delete (no local counterpart).`);
  printList('Upload', toUpload, u => `+ ${u.pathname} (${u.reason})`);
  printList('Delete', toDelete, d => `- ${d.pathname}`);
  console.log('');

  if (!apply) process.exit(0); // report only — caller confirms, then re-runs with --apply

  let n = 0;
  for (const u of toUpload) {
    await uploadFile(u.abs, u.pathname);
    n++;
    if (n === 1 || n % 25 === 0 || n === toUpload.length) {
      console.log(`  uploaded [${n}/${toUpload.length}]`);
    }
  }
  if (toDelete.length) {
    const urls = toDelete.map(d => d.url);
    const BATCH = 100;
    for (let i = 0; i < urls.length; i += BATCH) {
      await del(urls.slice(i, i + BATCH), { token: TOKEN });
    }
    console.log(`  deleted ${toDelete.length} object(s).`);
  }
  console.log(`Mirror complete: ${toUpload.length} uploaded, ${toDelete.length} deleted.`);
}

// ── dispatch ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv[0] === 'mirror') {
  await runMirror(argv.includes('--apply'));
} else {
  await runUpload(argv);
}
