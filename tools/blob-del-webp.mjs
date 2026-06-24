#!/usr/bin/env node
// Delete stale .webp objects from Vercel Blob under assets/album-live/.
// Used once by tools/migrate-to-avif.sh after the AVIF re-generation, since
// blob-sync.mjs only ever uploads and never removes obsolete objects.
//
// Requires BLOB_READ_WRITE_TOKEN in the environment.

import { list, del } from '@vercel/blob';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) {
  console.error('Error: BLOB_READ_WRITE_TOKEN is not set in the environment.');
  process.exit(1);
}

const urls = [];
let cursor;
do {
  const res = await list({ token: TOKEN, prefix: 'assets/album-live/', cursor, limit: 1000 });
  for (const b of res.blobs) {
    if (b.pathname.toLowerCase().endsWith('.webp')) urls.push(b.url);
  }
  cursor = res.hasMore ? res.cursor : undefined;
} while (cursor);

if (urls.length === 0) {
  console.log('No .webp blobs to delete.');
  process.exit(0);
}

console.log(`Deleting ${urls.length} stale .webp blob(s)...`);
for (let i = 0; i < urls.length; i += 1000) {
  await del(urls.slice(i, i + 1000), { token: TOKEN }); // del accepts up to 1000 urls per call
}
console.log(`Done: ${urls.length} .webp blob(s) deleted.`);
