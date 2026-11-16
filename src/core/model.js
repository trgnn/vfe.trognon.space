// The gallery's data (site/data/vfe.json): pure rules, no file system.
//
// {
//   albums:      [{ slug, name, subtitle, era, developer, publisher, images }]
//   series:      [{ slug, name, era, description, images }]
//   collections: [{ slug, name, era, description, albums: [album slug] }]
//   starred:     { mixes: [{ id, name, source, random, count }],
//                  pinned: [{ type: "album" | "series" | "collection", slug }] }
// }
//
// An image is { file, ratio, featured? }: `file` names its three versions
// (thumbs/<file>.avif, full/<file>.avif, downloads/<file>.jpg) and never changes;
// the array order is the display order. The albums' order is the site's
// "Latest albums" order, newest first.

export const KINDS = { album: "albums", series: "series" };
export const ERAS = ["current", "archive"];
export const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const FIELDS = {
  album: ["name", "subtitle", "era", "developer", "publisher"],
  series: ["name", "era", "description"],
  collection: ["name", "era", "description"],
};

export function listOf(data, kind) {
  if (kind === "collection") return data.collections;
  const key = KINDS[kind];
  if (!key) throw new Error(`Unknown kind: ${kind}.`);
  return data[key];
}

export function find(data, kind, slug) {
  const item = listOf(data, kind).find((x) => x.slug === slug);
  if (!item) throw new Error(`No ${kind} “${slug}”.`);
  return item;
}

export function emptyData() {
  return { albums: [], series: [], collections: [], starred: { mixes: [], pinned: [] } };
}

export function newItem(data, kind, slug, fields = {}) {
  if (!SLUG.test(slug ?? "")) throw new Error("A slug uses letters, digits, “-” and “_”, and starts with a letter or a digit.");
  if (listOf(data, kind).some((x) => x.slug === slug)) throw new Error(`The ${kind} “${slug}” already exists.`);
  const base =
    kind === "album"
      ? { slug, name: slug, subtitle: "", era: "current", developer: "", publisher: "", images: [] }
      : kind === "series"
        ? { slug, name: slug, era: "current", description: "", images: [] }
        : { slug, name: slug, era: "current", description: "", albums: [] };
  const item = patchItem(base, kind, fields);
  listOf(data, kind).unshift(item);
  return item;
}

// Only the editable fields; the slug never changes (it names the media folder).
export function patchItem(item, kind, patch = {}) {
  for (const key of FIELDS[kind]) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? "").trim();
    if (key === "era" && !ERAS.includes(value)) throw new Error("The era is “current” or “archive”.");
    if (key === "name" && !value) throw new Error("A name can't be empty.");
    item[key] = value;
  }
  if (kind === "collection" && Array.isArray(patch.albums)) item.albums = [...patch.albums];
  return item;
}

export function removeItem(data, kind, slug) {
  const list = listOf(data, kind);
  const i = list.findIndex((x) => x.slug === slug);
  if (i < 0) throw new Error(`No ${kind} “${slug}”.`);
  const [item] = list.splice(i, 1);
  // Drop the references to it, so the data stays valid.
  if (kind === "album") {
    for (const c of data.collections) c.albums = c.albums.filter((s) => s !== slug);
    for (const m of data.starred.mixes) if (Array.isArray(m.source)) m.source = m.source.filter((s) => s !== slug);
  }
  data.starred.pinned = data.starred.pinned.filter((p) => !(p.type === kind && p.slug === slug));
  return item;
}

export function move(list, from, to) {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) throw new Error("Out of range.");
  list.splice(to, 0, list.splice(from, 1)[0]);
  return list;
}

// Reorder by a full list of keys (slugs or image files): same members, new order.
export function reorder(list, keys, key = "slug") {
  const byKey = new Map(list.map((x) => [x[key], x]));
  if (keys.length !== list.length || keys.some((k) => !byKey.has(k)) || new Set(keys).size !== keys.length) {
    throw new Error("The new order doesn't match the current list. Reload the page.");
  }
  list.splice(0, list.length, ...keys.map((k) => byKey.get(k)));
  return list;
}

// The next `n` image names of an item: `<slug>_<NN>`, after the highest number
// in use. Names are unique within the item; they don't follow the order.
export function nextFiles(item, n) {
  const re = new RegExp(`^${item.slug}_(\\d+)$`);
  let max = 0;
  for (const img of item.images) {
    const m = re.exec(img.file);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const width = Math.max(2, String(max + n).length);
  return Array.from({ length: n }, (_, k) => `${item.slug}_${String(max + k + 1).padStart(width, "0")}`);
}

// Masters in the order they should be published: natural order of the file
// names, so “scorn (2).png” comes before “scorn (10).png” without zero-padding.
export function naturalSort(names) {
  return [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

export const MASTER = /\.(png|tiff?|jpe?g)$/i;

// What would break the site. Empty when the data is sound.
export function problems(data) {
  const out = [];
  for (const kind of ["album", "series", "collection"]) {
    const seen = new Set();
    for (const item of listOf(data, kind)) {
      if (!SLUG.test(item.slug ?? "")) out.push(`Invalid ${kind} slug “${item.slug}”.`);
      if (seen.has(item.slug)) out.push(`Two ${kind}s are “${item.slug}”.`);
      seen.add(item.slug);
      if (!ERAS.includes(item.era)) out.push(`${item.slug}: era “${item.era}”.`);
      if (!item.name) out.push(`${item.slug}: no name.`);
      if (kind !== "collection") {
        const files = new Set();
        for (const img of item.images) {
          if (!img.file || files.has(img.file)) out.push(`${item.slug}: duplicate or empty image “${img.file}”.`);
          files.add(img.file);
          if (!(img.ratio > 0)) out.push(`${item.slug}: no ratio for “${img.file}”.`);
        }
      }
    }
  }
  const albums = new Set(data.albums.map((a) => a.slug));
  for (const c of data.collections) for (const s of c.albums) if (!albums.has(s)) out.push(`Collection ${c.slug}: no album “${s}”.`);
  const mixIds = new Set();
  for (const m of data.starred.mixes) {
    if (!m.id || mixIds.has(m.id)) out.push(`Mix “${m.id}”: missing or duplicate id.`);
    mixIds.add(m.id);
    if (Array.isArray(m.source)) {
      for (const s of m.source) if (!albums.has(s)) out.push(`Mix ${m.id}: no album “${s}”.`);
    } else if (!["all", "current", "archive"].includes(m.source)) {
      out.push(`Mix ${m.id}: source “${m.source}”.`);
    }
  }
  for (const p of data.starred.pinned) {
    if (!["album", "series", "collection"].includes(p.type) || !listOf(data, p.type).some((x) => x.slug === p.slug)) out.push(`Pinned: no ${p.type} “${p.slug}”.`);
  }
  return out;
}
