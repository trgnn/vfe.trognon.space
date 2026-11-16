// The three versions of each image, under site/assets/<album|series>/<slug>/:
//   thumbs/<file>.avif     AVIF q50, 760 px on the short side (the grid)
//   full/<file>.avif       AVIF q80, full resolution (the lightbox)
//   downloads/<file>.jpg   JPEG q95 4:4:4 from a PNG/TIFF master; a JPEG master
//                          is copied as is, never re-encoded (the download)
// Orientation from EXIF is applied; output is sRGB (sharp's default).
import sharp from "sharp";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const SETTINGS = { thumbShort: 760, thumbQuality: 50, fullQuality: 80, jpegQuality: 95 };
const VERSIONS = { thumbs: "avif", full: "avif", downloads: "jpg" };

export const itemDir = (root, kind, slug) => join(root, "site", "assets", kind === "album" ? "album" : "series", slug);
const pathOf = (dir, version, file) => join(dir, version, `${file}.${VERSIONS[version]}`);

// Width and height once oriented (EXIF orientations 5 to 8 swap them).
async function sizeOf(input) {
  const m = await sharp(input).metadata();
  const swap = (m.orientation ?? 1) >= 5;
  return swap ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}
const ratio = ({ width, height }) => Math.round((width / height) * 10000) / 10000;

async function derive(input, dir, file) {
  const { thumbShort, thumbQuality, fullQuality } = SETTINGS;
  await sharp(input).rotate().avif({ quality: fullQuality }).toFile(pathOf(dir, "full", file));
  const size = await sizeOf(input);
  const portrait = size.width <= size.height;
  await sharp(input)
    .rotate()
    .resize({ width: portrait ? thumbShort : undefined, height: portrait ? undefined : thumbShort, withoutEnlargement: true })
    .avif({ quality: thumbQuality })
    .toFile(pathOf(dir, "thumbs", file));
}

// Encode one master (a path, or a buffer with its original name) into the
// three versions. Returns the image entry for vfe.json.
export async function encode(input, originalName, dir, file) {
  for (const v of Object.keys(VERSIONS)) mkdirSync(join(dir, v), { recursive: true });
  const download = pathOf(dir, "downloads", file);
  if (/\.jpe?g$/i.test(originalName)) {
    if (Buffer.isBuffer(input)) writeFileSync(download, input);
    else copyFileSync(input, download);
  } else {
    await sharp(input).rotate().jpeg({ quality: SETTINGS.jpegQuality, chromaSubsampling: "4:4:4" }).toFile(download);
  }
  await derive(input, dir, file);
  return { file, ratio: ratio(await sizeOf(input)) };
}

// Regenerate thumbs/ and full/ from the download (after a change of settings).
export async function reencode(dir, file) {
  const download = pathOf(dir, "downloads", file);
  if (!existsSync(download)) throw new Error(`Missing ${download}.`);
  await derive(download, dir, file);
}

export const filesOf = (dir, file) => Object.keys(VERSIONS).map((v) => pathOf(dir, v, file));

// To the macOS Trash when possible (recoverable), else deleted.
export function trash(paths) {
  const present = paths.filter((p) => existsSync(p));
  if (!present.length) return;
  try {
    execFileSync("trash", present);
  } catch {
    for (const p of present) rmSync(p, { recursive: true, force: true });
  }
}
