// The back-office's rules and actions, on a temporary copy (never on site/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { nextFiles, naturalSort, reorder, removeItem, problems, emptyData, newItem } from "../src/core/model.js";
import { format, load } from "../src/backoffice/store.js";
import * as actions from "../src/backoffice/actions.js";

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "vfe-"));
  mkdirSync(join(root, "site", "data"), { recursive: true });
  return root;
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#c33" } }).png().toBuffer();
const jpg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#3c3" } }).jpeg().toBuffer();

test("image names continue after the highest number, padded", () => {
  const item = { slug: "gris", images: [{ file: "gris_01" }, { file: "gris_07" }] };
  assert.deepEqual(nextFiles(item, 2), ["gris_08", "gris_09"]);
  assert.deepEqual(nextFiles({ slug: "a", images: [{ file: "a_98" }] }, 3), ["a_099", "a_100", "a_101"]);
});

test("masters sort naturally, without zero-padding", () => {
  assert.deepEqual(naturalSort(["scorn (10).png", "scorn (2).png", "scorn (1).png"]), ["scorn (1).png", "scorn (2).png", "scorn (10).png"]);
});

test("a reorder must keep the same members", () => {
  const list = [{ slug: "a" }, { slug: "b" }];
  assert.deepEqual(reorder(list, ["b", "a"]).map((x) => x.slug), ["b", "a"]);
  assert.throws(() => reorder(list, ["a"]));
  assert.throws(() => reorder(list, ["a", "a"]));
});

test("removing an album drops its references", () => {
  const data = emptyData();
  newItem(data, "album", "a");
  newItem(data, "collection", "c", { albums: ["a"] });
  data.starred.pinned.push({ type: "album", slug: "a" });
  data.starred.mixes.push({ id: "m", name: "M", source: ["a"] });
  removeItem(data, "album", "a");
  assert.deepEqual(problems(data), []);
  assert.deepEqual(data.collections[0].albums, []);
  assert.deepEqual(data.starred.pinned, []);
});

test("problems catch broken references and slugs", () => {
  const data = emptyData();
  data.collections.push({ slug: "c", name: "C", era: "current", description: "", albums: ["ghost"] });
  data.starred.mixes.push({ id: "x", name: "X", source: "everything" });
  assert.equal(problems(data).length, 2);
  assert.throws(() => newItem(data, "album", "bad slug"));
});

test("the data file keeps one line per image", () => {
  const data = emptyData();
  data.albums.push({ slug: "a", name: "A", subtitle: "", era: "current", developer: "", publisher: "", images: [{ file: "a_01", ratio: 1.5 }] });
  const text = format(data);
  assert.match(text, /\{"file":"a_01","ratio":1.5\}/);
  assert.deepEqual(JSON.parse(text), data);
});

test("import, feature, reorder and delete images", async () => {
  const root = tempRoot();
  const masters = join(root, "masters");
  mkdirSync(masters);
  writeFileSync(join(masters, "shot (10).png"), await png(400, 200));
  writeFileSync(join(masters, "shot (2).png"), await png(300, 600));
  writeFileSync(join(masters, "shot (1).jpg"), await jpg(200, 200));

  actions.saveItem(root, { kind: "album", slug: "test", create: true, patch: { name: "Test", era: "archive" } });
  assert.equal(await actions.addFolder(root, { kind: "album", slug: "test", folder: masters }), 3);
  const album = () => load(root).albums[0];
  assert.deepEqual(album().images.map((i) => [i.file, i.ratio]), [["test_01", 1], ["test_02", 0.5], ["test_03", 2]]);

  const dir = join(root, "site", "assets", "album", "test");
  for (const v of ["thumbs/test_02.avif", "full/test_02.avif", "downloads/test_02.jpg"]) assert.ok(existsSync(join(dir, v)), v);
  // A JPEG master is kept byte for byte.
  assert.deepEqual(readFileSync(join(dir, "downloads", "test_01.jpg")), readFileSync(join(masters, "shot (1).jpg")));
  // Thumbnail: 760 px short side at most, never enlarged.
  assert.deepEqual(await sharp(join(dir, "thumbs", "test_02.avif")).metadata().then((m) => [m.width, m.height]), [300, 600]);

  actions.featureImage(root, { kind: "album", slug: "test", file: "test_02", featured: true });
  actions.orderImages(root, { kind: "album", slug: "test", files: ["test_03", "test_02", "test_01"] });
  assert.deepEqual(album().images.map((i) => i.file + (i.featured ? "*" : "")), ["test_03", "test_02*", "test_01"]);

  actions.deleteImage(root, { kind: "album", slug: "test", file: "test_03" });
  assert.equal(existsSync(join(dir, "full", "test_03.avif")), false);
  // Names follow the highest number in use.
  const added = await actions.addImage(root, { kind: "album", slug: "test", name: "x.png", input: await png(100, 100) });
  assert.equal(added.file, "test_03");
  assert.equal(await actions.reencodeItem(root, { kind: "album", slug: "test" }), 3);
});
