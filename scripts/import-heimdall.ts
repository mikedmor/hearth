/**
 * Import Heimdall's apps into hearth.json.
 *
 *   npm run import:heimdall -- <path to app.sqlite>            # dry run: shows what would change
 *   npm run import:heimdall -- <path to app.sqlite> --write    # apply it
 *
 * Options:
 *   --data <dir>    Hearth's data folder (default: $HEARTH_DATA_DIR or ./data)
 *   --icons <dir>   folder that holds Heimdall's icons/ (default: next to app.sqlite)
 *
 * Get app.sqlite from Heimdall's config folder on the NAS (www/app.sqlite), copied while Heimdall
 * is running is fine: it's opened read-only. Before writing, hearth.json is backed up next to
 * itself. A running Hearth picks the change up by itself.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ConfigStore } from "../src/server/config-store";
import { planImport, readHeimdall } from "../src/server/heimdall";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    write: { type: "boolean", default: false },
    data: { type: "string" },
    icons: { type: "string" },
  },
});

const sqlite = positionals[0];
if (!sqlite || !existsSync(sqlite)) {
  console.error("Usage: npm run import:heimdall -- <path to Heimdall's app.sqlite> [--write]");
  process.exit(1);
}
const dataDir = resolve(values.data ?? process.env.HEARTH_DATA_DIR ?? "data");
const iconsRoot = resolve(values.icons ?? dirname(sqlite));

const store = new ConfigStore(dataDir);
const current = await store.load();
const heimdall = readHeimdall(sqlite);
const plan = planImport(current, heimdall);

console.log(`Heimdall: ${heimdall.apps.length} apps, ${heimdall.tags.length} tags`);
console.log(`Hearth:   ${store.path}\n`);
if (plan.newGroups.length) console.log(`New groups: ${plan.newGroups.join(", ")}\n`);
for (const { tile } of plan.added) {
  const icon = tile.icon ? `  icon ${tile.icon}` : "";
  console.log(`  + ${tile.name.padEnd(28)} ${tile.url}  [${tile.group}]${icon}`);
}
for (const s of plan.skipped) console.log(`  - ${s.title.padEnd(28)} skipped: ${s.reason}`);
if (plan.added.length === 0) {
  console.log("\nNothing new to add.");
  process.exit(0);
}

const missingIcons = plan.icons.filter((i) => !existsSync(join(iconsRoot, i.from)));
if (missingIcons.length) {
  console.log(
    `\n${missingIcons.length} icon(s) not found under ${iconsRoot} (pass --icons <Heimdall's www folder>); those tiles get a monogram.`,
  );
  for (const m of missingIcons) {
    const tile = plan.config.tiles.find((t) => t.icon === m.to);
    if (tile) delete tile.icon;
  }
}

if (!values.write) {
  console.log(`\nDry run: nothing changed. Add --write to import ${plan.added.length} tile(s).`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = `${store.path}.before-heimdall-${stamp}`;
await copyFile(store.path, backup);
const iconsDir = join(dataDir, "icons");
await mkdir(iconsDir, { recursive: true });
for (const icon of plan.icons) {
  const from = join(iconsRoot, icon.from);
  if (existsSync(from)) await copyFile(from, join(iconsDir, icon.to));
}
await store.save(plan.config);
console.log(`\n✔ Imported ${plan.added.length} tile(s). The old file is at ${backup}`);
console.log(
  "  Review the new tiles in hearth.json: add descriptions, audiences, and checkUrl where needed.",
);
