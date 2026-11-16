# View From Elsewhere

A gallery of virtual photography: screenshots taken in the 2D and 3D worlds of video games, curated into albums, series and collections.

Live at https://vfe.trognon.space

## How it works

- `site/` is the whole site: static HTML, CSS and vanilla JS, no framework and no build step. One page (`index.html`) renders every view from query params (`?album=`, `?series=`, `?collection=`, `?mix=`).
- Images are not in the repo. They are served from `cdn.trognon.space/vfe` (Cloudflare R2), switched by `VFE_MEDIA_BASE` in `site/js/config.js`.
- Each image comes in three versions: a thumbnail for the grid (AVIF), a full-screen image (AVIF) and a download (JPEG).

## Run locally

```bash
npx serve -l 4322 site
```

With `VFE_MEDIA_BASE` set to the cdn, the local site shows the online images. Set it to `''` to use a local copy under `site/assets/{album,series}/`.

## Publish images

1. Export lossless masters (PNG or TIFF) with zero-padded names (`001.png`, `002.png`…): publish order follows the file names.
2. Drop them into `album-staging/`, one folder per album or series.
3. Run `./sync-and-push.sh` and answer the prompts. It reconciles `site/js/data.js` with the local media, generates the three versions, updates `data.js` and `dims.js`, then offers to mirror the local media to the cdn.
4. Commit and push the changed JS files.

Needs Python 3 with Pillow built with AVIF support, Node, and [rclone](https://rclone.org/) for the cdn mirror.

## Deploy

The site is a Cloudflare Worker serving static assets (`wrangler.jsonc`), deployed by Workers Builds on every push to `main`. Album media is excluded from the deploy (`site/.assetsignore`).

## Versions

`tools/tag-release.sh v2.2 "Short description"` bumps `VFE_VERSION` (shown in the footer), commits and tags. It never pushes: `git push --follow-tags`.
