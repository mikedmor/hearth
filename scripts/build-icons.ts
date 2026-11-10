/** Writes the compact icon library next to the server bundle (dist/server/icons.json). */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildIconData } from "../src/server/icon-data";

const data = buildIconData(createRequire(import.meta.url));
mkdirSync("dist/server", { recursive: true });
writeFileSync("dist/server/icons.json", JSON.stringify(data));
console.log(
  `icons: ${data.brands.length} logos, ${data.symbols.length} symbols, ${data.emoji.length} emoji`,
);
