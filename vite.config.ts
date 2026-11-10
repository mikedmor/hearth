import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://127.0.0.1:${process.env.HEARTH_PORT ?? 8082}`;

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    strictPort: true,
    // Reachable from phones on the home network, for testing on real devices.
    host: true,
    // Keep the trailing slashes: "/api" alone would also catch a module named api.ts.
    // changeOrigin stays false so Hearth sees the name the browser used (its same-site check).
    proxy: {
      "/api/live": { target: server, ws: true, changeOrigin: false },
      "/api/": { target: server, changeOrigin: false },
      "/icons/": { target: server, changeOrigin: false },
      "/media/": { target: server, changeOrigin: false },
    },
  },
});
