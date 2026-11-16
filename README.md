# View From Elsewhere

A gallery of virtual photography: screenshots taken in the 2D and 3D worlds of video games, curated into albums, series and collections.

Live at https://vfe.trognon.space

## How it works

- `site/` is the whole site: static HTML, CSS and vanilla JS, no framework and no build step. One page (`index.html`) renders every view from query params (`?album=`, `?series=`, `?collection=`, `?mix=`), from the data in `site/data/vfe.json`.
- Images are not in the repo. They are served from `cdn.trognon.space/vfe` (Cloudflare R2), switched by `VFE_MEDIA_BASE` in `site/js/config.js`.
- Each image comes in three versions: a thumbnail for the grid (AVIF), a full-screen image (AVIF) and a download (JPEG).

## The back-office

```bash
npm install
npm run admin    # http://localhost:4340/admin/ — and a preview of the site at /, with the local images
                 # (its footer links back to the back-office; Preview in the admin goes to the site)
```

- **Albums, Series**: create one, fill in its name, era and credits, then drop the masters (PNG, TIFF or JPEG) on its page. They're added in the natural order of their names (`shot (2)` before `shot (10)`), then drag them into place. The star marks a featured image.
- **Collections**: groups of albums.
- **Starred**: the Explore menu's mixes (the first one is the home page) and pinned items.
- **Publish…**: shows what changed, then mirrors the images to the cdn, commits `site/` and pushes. The push deploys the site.

The same actions from the command line:

```bash
npm run -s vfe -- list
npm run -s vfe -- import album metroExodus ~/Exports/metro    # create if needed, add a folder of masters
npm run -s vfe -- publish            # what would be published; --apply to publish
```

Needs Node 22 or later. Publishing needs [rclone](https://rclone.org/) and the Cloudflare token in the macOS keychain (see `tools/media-sync.sh`).

## Deploy

The site is a Cloudflare Worker serving static assets (`wrangler.jsonc`), deployed by Workers Builds on every push to `main`. Album media is excluded from the deploy (`site/.assetsignore`).

## Versions

`tools/tag-release.sh v2.2 "Short description"` bumps `VFE_VERSION` (shown in the footer), commits and tags. It never pushes: `git push --follow-tags`.
