import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/server/index.ts" },
  outDir: "dist/server",
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  // Bundle everything so the image needs no node_modules.
  noExternal: [/.*/],
  banner: {
    // Aliased, so it can't clash with a module that imports createRequire itself.
    js: "import { createRequire as __hearthRequire } from 'node:module'; const require = __hearthRequire(import.meta.url);",
  },
});
