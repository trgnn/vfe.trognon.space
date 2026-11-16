// Publishing: mirror the local media to cdn.trognon.space (tools/media-sync.sh),
// then commit and push site/ — Workers Builds deploys on push.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { load } from "./store.js";
import { problems } from "../core/model.js";

const run = (root, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\s+$/, "") };
};
const git = (root, ...args) => run(root, "git", args);

// What publishing would do: the media diff and the site files changed.
export function report(root) {
  const media = run(root, join(root, "tools", "media-sync.sh"), []);
  const status = git(root, "status", "--porcelain", "--", "site");
  const ahead = git(root, "rev-list", "--count", "@{u}..HEAD");
  return {
    problems: problems(load(root)),
    media: { pending: media.code === 0, error: media.code !== 0 && media.code !== 10, text: media.out },
    changes: status.out ? status.out.split("\n") : [],
    unpushed: Number(ahead.out) || 0,
  };
}

// Mirror the media, then commit site/ and push. Stops at the first failure.
export function publish(root, message = "Update the gallery") {
  const found = problems(load(root));
  if (found.length) throw new Error(found.join(" "));
  const log = [];
  const step = (label, r, ok = [0]) => {
    log.push(`${label}\n${r.out}`.trim());
    if (!ok.includes(r.code)) throw new Error(`${label} failed.\n${r.out}`);
    return r;
  };
  step("Media", run(root, join(root, "tools", "media-sync.sh"), ["--apply"]));
  step("Stage", git(root, "add", "--", "site"));
  const staged = git(root, "diff", "--cached", "--quiet", "--", "site");
  if (staged.code === 1) step("Commit", git(root, "commit", "-m", message, "--", "site"));
  else log.push("Commit\nNothing to commit in site/.");
  if (Number(git(root, "rev-list", "--count", "@{u}..HEAD").out) > 0) step("Push", git(root, "push"));
  else log.push("Push\nNothing to push.");
  return log.join("\n\n");
}
