# View From Elsewhere — agent guide

The README covers what the project is and the commands. This file covers how it is built and what must not break. Project status, backlog and releases live in the vault note: `grep -rl "local_folder: ~/Projects/VFE" ~/Documents/vault/projects`.

## Layout

```text
site/                    the deployed site (static, no build)
  index.html, about.html
  js/config.js           VFE_MEDIA_BASE (media source), VFE_VERSION (set by tag-release.sh)
  js/data.js             albums + series metadata — machine-managed (data_edit.py)
  js/curation.js         collections + Starred — hand-edited, never touched by scripts
  js/dims.js             image aspect ratios — generated (gen-dims.py)
  js/header.js           header and Explore nav, built from data.js + curation.js
  js/gallery.js          query-param routing, justified grid, lightbox
  assets/album|series/   local media mirror (gitignored, source of truth for the cdn)
album-staging/           drop zone for masters (contents gitignored)
album-archive/           archived source albums (contents gitignored)
sync-and-push.sh         the publish pipeline
tools/                   pipeline helpers (see below)
wrangler.jsonc           Cloudflare Worker serving site/ on vfe.trognon.space
```

## Data model

- **Album**: one game, its own media. `{ slug, name, subtitle, era, developer, publisher, count, featured }`. `name · subtitle` is shown (`Halo Infinite · Campaign`). Missing publisher inherits the developer and vice versa; neither hides the credits.
- **Series**: a thematic selection with its own media. `{ slug, name, era, description, count }`.
- **Collection**: a grouping of album slugs, no media of its own (`curation.js`, declared `era`).
- **Starred**: the Explore menu, mixes then pinned items (`curation.js`). No `pinned` flag on items.
- **era**: `current` or `archive`, asked explicitly at creation. The nav splits Current / Archive when both exist.
- **featured**: 1-based image indices per album, in `data.js` because it is coupled to the numbering. A renumber remaps it. Applied once in `imgTag()` (`gallery.js`), styled in `styles-galerie.css`.

## Media

- Files: `assets/{album,series}/{slug}/{thumbs,full,downloads}/{slug}_{NN}.{avif,jpg}`.
  - `thumbs/`: AVIF q50, 760 px short side.
  - `full/`: AVIF q80, full resolution.
  - `downloads/`: JPEG q95 4:4:4 from a PNG/TIFF master; a JPEG master is copied as is, never re-encoded.
- Online: R2 bucket `cdn`, prefix `vfe/assets/`, served at `https://cdn.trognon.space/vfe/assets/…`. The path after `VFE_MEDIA_BASE` is the same locally and online.
- Downloads are fetched cross-origin (`gallery.js` `download()`), which relies on the cdn's CORS header.

## Pipeline (`sync-and-push.sh`)

Local-first: every step changes only `site/assets/`, `data.js` and `dims.js`. The cdn is touched once, by the mirror at the very end, after confirmation.

1. Sync: renamed folders (`fix-renames.py`), count drift, vanished items (confirmed one by one), orphans (fill in or delete), repairs (`rebuild-media.py`: renumber gaps, regenerate derivatives), curation refs (`check-collections.mjs`), `dims.js` (`gen-dims.py`).
2. Push: each staging unit (a folder of images, or a folder of image folders) is confirmed, given a slug (collision: append, replace or new slug), published as album or series, and moved to the Trash.
3. Mirror: `tools/media-sync.sh` reports the diff, `--apply` uploads and deletes. Needs rclone and the Cloudflare token in the keychain (`cloudflare-deploy-trognon`).

All `data.js` writes go through `tools/data_edit.py` (atomic write).

## Invariants

- Never edit `data.js` or `dims.js` by hand when a tool can do it; `curation.js` is the hand-edited file.
- Publish order is the lexicographic order of master names: zero-pad them. `featured` depends on it.
- The mirror deletes online what is missing locally. Never run `media-sync.sh --apply` from a checkout without the local media.
- Album media must stay out of the Worker deploy (`site/.assetsignore`).
- `VFE_VERSION` changes only through `tools/tag-release.sh`.

## Checks

No test suite. After a change:

- `node tools/check-collections.mjs` for curation refs.
- `bash -n sync-and-push.sh` for the pipeline.
- Serve `site/` (`npx serve -l 4322 site`) and check the grid, lightbox and download in a browser.
