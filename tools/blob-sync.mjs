#!/usr/bin/env node
// Upload local album media to Vercel Blob.
//
// The Blob pathname mirrors the site path (e.g. assets/album-live/<slug>/set-1/full/x.webp),
// so the front end only needs to prepend VFE_MEDIA_BASE (see site/js/config.js):
// an empty base serves from the same origin (/assets), a Blob base serves from Blob —
// the path after the base is identical in both cases.
//
// Usage:
//   node tools/blob-sync.mjs            upload everything under site/assets/album-live/
//   node tools/blob-sync.mjs <slug>     upload only that album's folder
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

const SITE_DIR = join(import.meta.dirname, '..', 'site');
const LIVE_DIR = join(SITE_DIR, 'assets', 'album-live');

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

const slug = process.argv[2];
const root = slug ? join(LIVE_DIR, slug) : LIVE_DIR;

if (!existsSync(root)) {
  console.error(`Error: nothing to upload, '${relative(process.cwd(), root)}' does not exist.`);
  process.exit(1);
}

const files = walk(root);
console.log(`Uploading ${files.length} file(s) to Vercel Blob${slug ? ` for '${slug}'` : ''}...`);

let done = 0;
for (const file of files) {
  const pathname = relative(SITE_DIR, file).split(sep).join('/'); // assets/album-live/...
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
