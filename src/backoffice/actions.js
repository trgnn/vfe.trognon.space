// What the back-office can do, shared by the server (the admin page) and the
// CLI. Each action loads the data, changes it, and saves it (refused if the
// result would break the site).
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { load, save } from "./store.js";
import { encode, reencode, itemDir, filesOf, trash } from "./media.js";
import { find, listOf, newItem, patchItem, removeItem, reorder, nextFiles, naturalSort, problems, MASTER } from "../core/model.js";

const media = (kind) => kind === "album" || kind === "series";

export function state(root) {
  const data = load(root);
  return { data, problems: problems(data) };
}

export function saveItem(root, { kind, slug, patch = {}, create = false }) {
  const data = load(root);
  const item = create ? newItem(data, kind, slug, patch) : patchItem(find(data, kind, slug), kind, patch);
  save(root, data);
  return item;
}

export function deleteItem(root, { kind, slug }) {
  const data = load(root);
  removeItem(data, kind, slug);
  save(root, data);
  if (media(kind)) trash([itemDir(root, kind, slug)]);
}

export function orderItems(root, { kind, slugs }) {
  const data = load(root);
  reorder(listOf(data, kind), slugs);
  save(root, data);
}

export function orderImages(root, { kind, slug, files }) {
  const data = load(root);
  reorder(find(data, kind, slug).images, files, "file");
  save(root, data);
}

export function featureImage(root, { kind, slug, file, featured }) {
  const data = load(root);
  const img = find(data, kind, slug).images.find((i) => i.file === file);
  if (!img) throw new Error(`No image “${file}”.`);
  if (featured) img.featured = true;
  else delete img.featured;
  save(root, data);
}

export function deleteImage(root, { kind, slug, file }) {
  const data = load(root);
  const item = find(data, kind, slug);
  const i = item.images.findIndex((x) => x.file === file);
  if (i < 0) throw new Error(`No image “${file}”.`);
  item.images.splice(i, 1);
  save(root, data);
  trash(filesOf(itemDir(root, kind, slug), file));
}

// One master, appended to the item. `input` is a path or a buffer.
export async function addImage(root, { kind, slug, name, input }) {
  if (!MASTER.test(name)) throw new Error(`“${name}” isn't a PNG, TIFF or JPEG.`);
  const data = load(root);
  const item = find(data, kind, slug);
  const [file] = nextFiles(item, 1);
  const image = await encode(input, name, itemDir(root, kind, slug), file);
  item.images.push(image);
  save(root, data);
  return image;
}

// Every master of a folder, in the natural order of their names.
export async function addFolder(root, { kind, slug, folder }, onImage = () => {}) {
  const names = naturalSort(readdirSync(folder).filter((f) => MASTER.test(f) && statSync(join(folder, f)).isFile()));
  if (!names.length) throw new Error(`No PNG, TIFF or JPEG in ${folder}.`);
  for (const [k, name] of names.entries()) {
    const image = await addImage(root, { kind, slug, name, input: join(folder, name) });
    onImage(k + 1, names.length, basename(name), image);
  }
  return names.length;
}

// Regenerate thumbs/ and full/ from the downloads, with today's settings.
export async function reencodeItem(root, { kind, slug }, onImage = () => {}) {
  const item = find(load(root), kind, slug);
  const dir = itemDir(root, kind, slug);
  for (const [k, img] of item.images.entries()) {
    await reencode(dir, img.file);
    onImage(k + 1, item.images.length, img.file);
  }
  return item.images.length;
}

export function saveStarred(root, { starred }) {
  const data = load(root);
  const mixes = (starred?.mixes ?? []).map((m) => {
    const mix = { id: String(m.id ?? "").trim(), name: String(m.name ?? "").trim() || String(m.id), random: !!m.random, source: m.source };
    const count = Number(m.count);
    if (count > 0) mix.count = Math.round(count);
    return mix;
  });
  const pinned = (starred?.pinned ?? []).map((p) => ({ type: p.type, slug: p.slug }));
  data.starred = { mixes, pinned };
  save(root, data);
}
