#!/usr/bin/env node
// View From Elsewhere's back-office, from the command line (same code as the
// admin page; for agents and scripts).
//
//   npm run admin                                   the admin page, http://localhost:4340/admin/
//   npm run -s vfe -- list                          albums, series, collections
//   npm run -s vfe -- show <album|series|collection> <slug>
//   npm run -s vfe -- check                         what would break the site (exit 1 if any)
//   npm run -s vfe -- import <album|series> <slug> <folder>   encode a folder of masters (natural order),
//                                                    creating the album or series if needed
//   npm run -s vfe -- reencode <album|series> <slug>           regenerate thumbs/ and full/
//   npm run -s vfe -- publish [--apply] [-m "message"]         media to the cdn, commit and push site/
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as actions from "./backoffice/actions.js";
import { report, publish } from "./backoffice/publish.js";
import { startServer } from "./backoffice/server.js";
import { find } from "./core/model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const progress = (k, n, name) => process.stdout.write(`\r  ${k}/${n} ${name}`.padEnd(60) + (k === n ? "\n" : ""));

async function main() {
  switch (cmd) {
    case "admin": {
      const port = Number(flag("--port") ?? 4340);
      startServer(ROOT, port);
      console.log(`Back-office: http://localhost:${port}/admin/  ·  site preview (local media): http://localhost:${port}/`);
      return;
    }
    case "list": {
      const { data, problems } = actions.state(ROOT);
      for (const a of data.albums) console.log(`album       ${a.slug.padEnd(32)} ${String(a.images.length).padStart(4)}  ${a.era}  ${a.name}${a.subtitle ? ` · ${a.subtitle}` : ""}`);
      for (const s of data.series) console.log(`series      ${s.slug.padEnd(32)} ${String(s.images.length).padStart(4)}  ${s.era}  ${s.name}`);
      for (const c of data.collections) console.log(`collection  ${c.slug.padEnd(32)} ${String(c.albums.length).padStart(4)}  ${c.era}  ${c.name}`);
      if (problems.length) console.log(`\n${problems.length} problem(s): npm run -s vfe -- check`);
      return;
    }
    case "show": {
      console.log(JSON.stringify(find(actions.state(ROOT).data, args[0], args[1]), null, 2));
      return;
    }
    case "check": {
      const { problems } = actions.state(ROOT);
      console.log(problems.length ? problems.join("\n") : "No problems.");
      process.exitCode = problems.length ? 1 : 0;
      return;
    }
    case "import": {
      const [kind, slug, folder] = args;
      if (!kind || !slug || !folder) throw new Error("Usage: import <album|series> <slug> <folder>");
      const exists = actions.state(ROOT).data[kind === "album" ? "albums" : "series"].some((x) => x.slug === slug);
      if (!exists) actions.saveItem(ROOT, { kind, slug, create: true });
      const n = await actions.addFolder(ROOT, { kind, slug, folder: resolve(folder) }, progress);
      console.log(`${n} image(s) added to ${kind} “${slug}”${exists ? "" : " (new, era “current”: set its name and era in the admin)"}.`);
      return;
    }
    case "reencode": {
      const n = await actions.reencodeItem(ROOT, { kind: args[0], slug: args[1] }, progress);
      console.log(`${n} image(s) re-encoded.`);
      return;
    }
    case "publish": {
      const message = flag("-m");
      if (!args.includes("--apply")) {
        const r = report(ROOT);
        if (r.problems.length) console.log(`Problems:\n${r.problems.join("\n")}\n`);
        console.log(`Media:\n${r.media.text}\n`);
        console.log(r.changes.length ? `Site changes:\n${r.changes.join("\n")}` : "Site changes: none.");
        if (r.unpushed) console.log(`${r.unpushed} commit(s) not pushed yet.`);
        console.log("\nNothing published. Run with --apply to publish.");
        return;
      }
      console.log(publish(ROOT, message));
      return;
    }
    default:
      console.log("Commands: admin, list, show, check, import, reencode, publish. See src/cli.js.");
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
