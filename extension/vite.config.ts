import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

// Target browser, set by the npm scripts via `BROWSER=...` (default: chrome).
// One shared `src/` engine → separate `dist/<browser>` packages.
const browser = process.env.BROWSER === "firefox" ? "firefox" : "chrome";

/**
 * Host the onnxruntime-web runtime files (.mjs loaders + .wasm) locally under
 * `/ort`. MV3 forbids remotely-hosted scripts, so onnxruntime-web cannot pull
 * its loader from the jsdelivr CDN at runtime — engine.ts points it at this
 * local copy via `env.backends.onnx.wasm.wasmPaths`.
 */
function copyOnnxRuntime(outDir: string): Plugin {
  return {
    name: "copy-onnxruntime-web",
    apply: "build",
    closeBundle() {
      const src = resolve(__dirname, "node_modules/onnxruntime-web/dist");
      const dest = resolve(__dirname, outDir, "ort");
      mkdirSync(dest, { recursive: true });
      for (const file of readdirSync(src)) {
        if (/^ort-wasm-.*\.(mjs|wasm)$/.test(file)) {
          cpSync(resolve(src, file), resolve(dest, file));
        }
      }
      // Vite also bundles an unused copy of the ORT wasm into assets/ (from an
      // `new URL(..., import.meta.url)` inside onnxruntime-web). We serve from
      // /ort via wasmPaths, so drop the duplicate to save ~23 MB.
      const assets = resolve(__dirname, outDir, "assets");
      if (existsSync(assets)) {
        for (const file of readdirSync(assets)) {
          if (/^ort-wasm-.*\.(mjs|wasm)$/.test(file)) rmSync(resolve(assets, file));
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  plugins: [crx({ manifest, browser }), copyOnnxRuntime(`dist/${browser}`)],
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
        // Hidden page that hosts the NER model (Chrome offscreen document).
        offscreen: resolve(__dirname, "src/background/offscreen.html"),
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
