import { defineConfig } from "vite";
import { resolve } from "node:path";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

// Target browser, set by the npm scripts via `BROWSER=...` (default: chrome).
// One shared `src/` engine → separate `dist/<browser>` packages.
const browser = process.env.BROWSER === "firefox" ? "firefox" : "chrome";

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  plugins: [crx({ manifest, browser })],
  build: {
    target: "es2022",
    // Per-browser output so both packages can coexist (and be built together).
    outDir: `dist/${browser}`,
    emptyOutDir: true,
    // Keep the MAIN-world content bundle lean — no vendor splitting that would
    // break content-script injection.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/popup.html"),
        options: resolve(__dirname, "src/options/options.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
