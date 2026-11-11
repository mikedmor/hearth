#!/usr/bin/env node
/**
 * Deploy the committed HEAD to the NAS over SSH and rebuild Hearth's own container.
 *
 *   npm run deploy:nas                     # reads HEARTH_DEPLOY_* from .env (git-ignored)
 *   npm run deploy:nas -- --working-tree   # what's here now, uncommitted changes included
 *
 * --working-tree ships exactly what a commit of everything would hold (.gitignore applies, so
 * data/, .env and docs/ still stay here), through a throwaway index: no commit, no branch change.
 *
 * Env:
 *   HEARTH_DEPLOY_HOST    ssh target, e.g. user@192.168.1.20 (required)
 *   HEARTH_DEPLOY_PATH    folder on the NAS holding compose.yaml (default /volume1/docker/hearth)
 *   HEARTH_DEPLOY_SSH     ssh binary (default: Windows OpenSSH on win32 so ssh-agent works)
 *   HEARTH_DEPLOY_DOCKER  docker binary on the NAS (default /usr/local/bin/docker)
 *
 * Only files git would commit are shipped (git archive), so data/ and .env never leave this machine.
 * This touches the `hearth` container only. It never restarts DSM or any other container.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workingTree = process.argv.includes("--working-tree");

const host = process.env.HEARTH_DEPLOY_HOST;
if (!host) {
  console.error("Set HEARTH_DEPLOY_HOST (e.g. in .env) to the ssh target, like user@192.168.1.20");
  process.exit(1);
}
const path = process.env.HEARTH_DEPLOY_PATH ?? "/volume1/docker/hearth";
const docker = process.env.HEARTH_DEPLOY_DOCKER ?? "/usr/local/bin/docker";
const winSsh = String.raw`C:\Windows\System32\OpenSSH\ssh.exe`;
const ssh =
  process.env.HEARTH_DEPLOY_SSH ??
  (process.platform === "win32" && existsSync(winSsh) ? winSsh : "ssh");

if (!/^[\w@.-]+$/.test(host) || !/^[\w/.-]+$/.test(path)) {
  console.error("Refusing suspicious HEARTH_DEPLOY_HOST / HEARTH_DEPLOY_PATH");
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(" ")} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const git = (args, env) =>
  spawnSync("git", args, { encoding: "utf8", env: env ? { ...process.env, ...env } : process.env });
const hasHead = git(["rev-parse", "HEAD"]).status === 0;
if (!hasHead && !workingTree) {
  console.error("✖ No commits yet. Commit first, or deploy with --working-tree.");
  process.exit(1);
}
let tree = "HEAD";
// The version the update check compares: package.json, with the commit as build metadata.
const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
let rev = `${pkgVersion}+${hasHead ? git(["rev-parse", "--short", "HEAD"]).stdout.trim() : "new"}`;
if (workingTree) {
  // Stage everything into a throwaway index and write its tree: the real index, HEAD and the
  // branch are untouched, and .gitignore decides what's left out, as for a commit.
  const index = join(tmpdir(), `hearth-deploy-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    if (hasHead && git(["read-tree", "HEAD"], env).status !== 0) throw new Error("read-tree");
    if (git(["add", "-A"], env).status !== 0) throw new Error("add");
    const w = git(["write-tree"], env);
    if (w.status !== 0) throw new Error("write-tree");
    tree = w.stdout.trim();
  } catch (e) {
    console.error(`✖ Couldn't gather the working tree (${e.message}).`);
    process.exit(1);
  } finally {
    rmSync(index, { force: true });
  }
  rev = `${rev}.local`;
  console.log("→ Deploying the working tree (uncommitted changes included)");
} else if (git(["status", "--porcelain"]).stdout.trim()) {
  console.warn(
    "⚠ Uncommitted changes are NOT deployed (only HEAD is shipped). Use --working-tree to include them.\n",
  );
}
console.log(`→ Deploying ${rev} to ${host}:${path}`);

// 1. Stream `git archive HEAD` into a fresh src folder on the NAS.
await new Promise((resolve, reject) => {
  const remote = `set -e; mkdir -p ${path}/data; cd ${path}; rm -rf src.new; mkdir src.new; tar -x -C src.new; rm -rf src; mv src.new src; [ -f compose.yaml ] || cp src/docker/compose.yaml compose.yaml`;
  const archive = spawn("git", ["archive", "--format=tar", tree], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const upload = spawn(ssh, ["-o", "BatchMode=yes", host, remote], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  archive.stdout.pipe(upload.stdin);
  upload.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`upload exit ${code}`))));
  archive.on("error", reject);
  upload.on("error", reject);
}).catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
console.log("✔ Source uploaded");

// 2. Build and (re)create the hearth container only, then wait for its healthcheck.
const remote = [
  "set -e",
  `cd ${path}`,
  `${docker} compose build --build-arg HEARTH_VERSION=${rev} hearth`,
  `${docker} compose up -d --no-deps hearth`,
  `for i in $(seq 1 30); do s=$(${docker} inspect -f '{{.State.Health.Status}}' hearth); [ "$s" = healthy ] && break; sleep 2; done`,
  `echo "health: $s"`,
  `${docker} image prune -f >/dev/null`,
  `[ "$s" = healthy ]`,
].join("; ");
run(ssh, ["-o", "BatchMode=yes", host, remote]);
console.log(`✔ Hearth ${rev} is running on port 8082`);
