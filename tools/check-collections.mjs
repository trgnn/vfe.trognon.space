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
const albumSlugs      = new Set((VFE.albums || []).map(a => a.slug));
const seriesSlugs     = new Set((VFE.series || []).map(s => s.slug));
const collections     = VFE.collections || [];
const collectionSlugs = new Set(collections.map(c => c.slug));
const starred         = VFE.starred || {};
const featured        = VFE.featured || {};

const warnings = [];

// Collections → album slugs.
for (const c of collections) {
  const id = c.slug || c.name || '(unnamed)';
  for (const slug of (c.albums || [])) {
    if (!albumSlugs.has(slug)) {
      warnings.push(`  ⚠ collection '${id}' references album '${slug}', absent from data.js.`);
    }
  }
}

// Starred mixes → custom source slug lists (arrays only; 'all'/'current'/'archive' are keywords).
for (const m of (starred.mixes || [])) {
  if (Array.isArray(m.source)) {
    for (const slug of m.source) {
      if (!albumSlugs.has(slug)) {
        warnings.push(`  ⚠ mix '${m.id || m.name}' source references album '${slug}', absent from data.js.`);
      }
    }
  }
}

// Starred pinned → album / series / collection by type.
const sets = { album: albumSlugs, series: seriesSlugs, collection: collectionSlugs };
for (const p of (starred.pinned || [])) {
  const set = sets[p.type];
  if (!set) {
    warnings.push(`  ⚠ pinned item has unknown type '${p.type}' (expected album/series/collection).`);
  } else if (!set.has(p.slug)) {
    warnings.push(`  ⚠ pinned ${p.type} '${p.slug}' does not exist.`);
  }
}

// Featured → keys are album slugs.
for (const slug of Object.keys(featured)) {
  if (!albumSlugs.has(slug)) {
    warnings.push(`  ⚠ featured references album '${slug}', absent from data.js.`);
  }
}

const checked = collections.length + (starred.mixes || []).length
  + (starred.pinned || []).length + Object.keys(featured).length;
if (warnings.length) {
  console.log('Curation reference check:');
  warnings.forEach(w => console.log(w));
  console.log('');
} else if (checked) {
  console.log(`✓ Curation references OK (collections, mixes, pinned, featured — ${checked} ref group(s)).`);
  console.log('');
}
