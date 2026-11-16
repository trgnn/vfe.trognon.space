// The local back-office: the admin page (/admin/), its API (/admin/api/…), and
// a preview of the site at / that reads the local media instead of the cdn, so
// what isn't published yet shows. Never online.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as actions from "./actions.js";
import { report, publish } from "./publish.js";

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "admin");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const readRaw = (req) =>
  new Promise((ok, ko) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", ko);
  });
const readJson = async (req) => {
  const raw = await readRaw(req);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
};

function serveFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: "Not found." });
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}

// One change at a time: two requests never save over each other.
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

const ROUTES = {
  "item": (root, b) => actions.saveItem(root, b),
  "item/delete": (root, b) => actions.deleteItem(root, b),
  "items/order": (root, b) => actions.orderItems(root, b),
  "images/order": (root, b) => actions.orderImages(root, b),
  "images/feature": (root, b) => actions.featureImage(root, b),
  "images/delete": (root, b) => actions.deleteImage(root, b),
  "images/reencode": (root, b) => actions.reencodeItem(root, b),
  "starred": (root, b) => actions.saveStarred(root, b),
  "publish": (root, b) => publish(root, b.message || undefined),
};

export function startServer(root, port) {
  const site = join(root, "site");
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    try {
      if (p === "/admin") {
        res.writeHead(301, { location: "/admin/" });
        return res.end();
      }
      if (p === "/admin/api/state" && req.method === "GET") return send(res, 200, actions.state(root));
      if (p === "/admin/api/publish" && req.method === "GET") return send(res, 200, { ok: true, result: report(root) });
      if (p === "/admin/api/images/add" && req.method === "POST") {
        const q = url.searchParams;
        const input = await readRaw(req);
        const image = await serial(() => actions.addImage(root, { kind: q.get("kind"), slug: q.get("slug"), name: q.get("name") ?? "", input }));
        return send(res, 200, { ok: true, result: image });
      }
      if (p.startsWith("/admin/api/") && req.method === "POST") {
        const route = ROUTES[p.slice("/admin/api/".length)];
        if (!route) return send(res, 404, { error: "Unknown route." });
        const body = await readJson(req);
        const result = await serial(() => route(root, body));
        return send(res, 200, { ok: true, result: result ?? null });
      }
      if (p.startsWith("/admin/")) {
        const file = normalize(join(UI, p.slice("/admin/".length) || "index.html"));
        return file.startsWith(UI) ? serveFile(res, file) : send(res, 404, { error: "Not found." });
      }
      // The site, reading the local media.
      if (p === "/js/config.js") {
        const config = readFileSync(join(site, "js", "config.js"), "utf8").replace(/const VFE_MEDIA_BASE = .*;/, "const VFE_MEDIA_BASE = '';") + "\n// Served by the back-office: the footer links to it.\nconst VFE_ADMIN = true;\n";
        res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
        return res.end(config);
      }
      const file = normalize(join(site, p === "/" ? "index.html" : p));
      return file.startsWith(site) ? serveFile(res, file) : send(res, 404, { error: "Not found." });
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
