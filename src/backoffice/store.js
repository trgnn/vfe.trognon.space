// Reads and writes site/data/vfe.json. A save is refused when the data would
// break the site (core/model.js `problems`), and is atomic (temp file, rename).
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { problems, emptyData } from "../core/model.js";

export const dataFile = (root) => join(root, "site", "data", "vfe.json");

export function load(root) {
  const file = dataFile(root);
  if (!existsSync(file)) return emptyData();
  return { ...emptyData(), ...JSON.parse(readFileSync(file, "utf8")) };
}

// Pretty JSON, but one line per image: the file stays short and diffs readable.
export function format(data) {
  return JSON.stringify(data, null, 2).replace(/\{\n\s+"file": [^{}]*?\n\s+\}/g, (m) => JSON.stringify(JSON.parse(m))) + "\n";
}

export function save(root, data) {
  const found = problems(data);
  if (found.length) throw new Error(found.join(" "));
  const file = dataFile(root);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, format(data));
  renameSync(tmp, file);
}
