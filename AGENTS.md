# View From Elsewhere — agent guide

The README covers what the project is and the commands. This file covers how it is built and what must not break. Project status, backlog and releases live in `../project.md`.

## Layout

```text
site/                    the deployed site (static, no build)
  index.html, about.html
  data/vfe.json          all the gallery's data, written by the back-office
  js/config.js           VFE_MEDIA_BASE (media source), VFE_VERSION (set by tag-release.sh)
  js/vfe.js              loads data/vfe.json (VFE_READY); header.js and gallery.js wait on it
  js/header.js           header and Explore nav
  js/gallery.js          query-param routing, justified grid, lightbox
  assets/album|series/   the images (gitignored; the source the cdn mirrors)
src/
  cli.js                 back-office commands (admin, list, show, check, import, reencode, publish)
  core/model.js          the data's rules, pure (no file system)
  backoffice/            store (vfe.json), media (sharp), actions, publish, server
  admin/                 the admin page (vanilla JS, same look as the trognon.space back-office)
test/                    node --test, on temporary copies
tools/media-sync.sh      mirrors site/assets/{album,series} to the R2 bucket (report, --apply)
tools/tag-release.sh     bumps VFE_VERSION and tags a milestone
wrangler.jsonc           Cloudflare Worker serving site/ on vfe.trognon.space
```

## Data model (`site/data/vfe.json`)

- **Album**: one game. `{ slug, name, subtitle, era, developer, publisher, images }`. Shown as `name · subtitle`. A missing publisher inherits the developer and vice versa; neither hides the credits. The albums' order is the site's "Latest albums" order, newest first.
- **Series**: a thematic selection with its own images. `{ slug, name, era, description, images }`.
- **Image**: `{ file, ratio, featured? }`. `file` names its three versions and never changes; the array order is the display order; `ratio` (width / height) lays out the grid before any pixel loads.
- **Collection**: `{ slug, name, era, description, albums }`, album slugs only, no images of its own.
- **Starred**: `{ mixes, pinned }`. A mix's `source` is `all`, `current`, `archive` or a list of album slugs; `random` shuffles, `count` caps. The first mix is the home page.
- **era**: `current` or `archive`. The nav splits Current / Archive when both exist.

`core/model.js` `problems()` lists what would break the site; a save is refused while there are any.

## Images

- `site/assets/{album,series}/{slug}/thumbs/{file}.avif` (AVIF q50, 760 px short side), `full/{file}.avif` (AVIF q80), `downloads/{file}.jpg` (JPEG q95 4:4:4 from a PNG/TIFF master; a JPEG master is copied as is). Encoded by `src/backoffice/media.js` with sharp; EXIF orientation applied, sRGB output.
- New names are `{slug}_{NN}` after the highest number in use. The slug can't change: it names the folder and the files.
- Online: R2 bucket `cdn`, prefix `vfe/assets/`, served at `https://cdn.trognon.space/vfe/assets/…`. The path after `VFE_MEDIA_BASE` is the same locally and online.
- Downloads are fetched cross-origin (`gallery.js` `download()`), which relies on the cdn's CORS header.

## Invariants

- `site/data/vfe.json` changes through the back-office (admin or CLI), which validates it. A hand edit must pass `npm run -s vfe -- check`.
- The local images are the source: `media-sync.sh --apply` deletes online what is missing locally. Never publish from a checkout without them.
- Images stay out of the Worker deploy (`site/.assetsignore`).
- `VFE_VERSION` changes only through `tools/tag-release.sh`.
- Publishing commits only `site/` and pushes; the push deploys.

## Checks

- `npm test` (rules and actions, on temporary copies).
- `npm run admin`, then the preview at `/`: grid, lightbox, download, Explore menu.
