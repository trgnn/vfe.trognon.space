#!/usr/bin/env node
// Upload local album/series media to Vercel Blob.
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
//
// Requires BLOB_READ_WRITE_TOKEN in the environment.

import { put } from '@vercel/blob';
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

const roots = resolveRoots(process.argv.slice(2));
const files = roots.flatMap(walk);

if (files.length === 0) {
  console.error('Error: nothing to upload (no media files found).');
  process.exit(1);
}

console.log(`Uploading ${files.length} file(s) to Vercel Blob...`);

let done = 0;
for (const file of files) {
  const pathname = relative(SITE_DIR, file).split(sep).join('/'); // assets/album/...
  const body = await readFile(file);
  const contentType = CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  await put(pathname, body, {
    access: 'public',
    token: TOKEN,
    addRandomSuffix: false, // deterministic paths so the front can reconstruct URLs
    allowOverwrite: true,   // re-uploading a published image replaces it in place
    contentType,
  });
  done++;
  if (done === 1 || done % 25 === 0 || done === files.length) {
    console.log(`  [${done}/${files.length}] ${pathname}`);
  }
}
console.log(`Done: ${done} file(s) uploaded.`);
