#!/usr/bin/env node
// Validate that every album slug referenced by a collection (in curation.js)
// actually exists in data.js. Report-only: prints warnings, never fails the build.
//
// It evaluates the real data.js + curation.js in a sandbox (so it tolerates JS
// comments, trailing commas, etc.) and inspects the resulting VFE object.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const JS_DIR = join(import.meta.dirname, '..', 'site', 'js');
const data     = readFileSync(join(JS_DIR, 'data.js'), 'utf8');
const curation = readFileSync(join(JS_DIR, 'curation.js'), 'utf8');

const ctx = {};
vm.createContext(ctx);
// Concatenate both classic scripts so curation.js sees the `const VFE` from
// data.js, then hand the object back through the context's global.
vm.runInContext(`${data}\n${curation}\nglobalThis.__VFE = VFE;`, ctx);

const VFE = ctx.__VFE || {};
const albumSlugs = new Set((VFE.albums || []).map(a => a.slug));
const collections = VFE.collections || [];

const warnings = [];
for (const c of collections) {
  const id = c.slug || c.name || '(unnamed)';
  for (const slug of (c.albums || [])) {
    if (!albumSlugs.has(slug)) {
      warnings.push(`  ⚠ collection '${id}' references album '${slug}', but that album does not exist in data.js.`);
    }
  }
}

if (warnings.length) {
  console.log('Collection reference check:');
  warnings.forEach(w => console.log(w));
  console.log('');
} else if (collections.length) {
  console.log(`✓ Collection references OK (${collections.length} collection(s) checked).`);
  console.log('');
}
