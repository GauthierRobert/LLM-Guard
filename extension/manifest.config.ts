import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

/**
 * Target browser for this build. Set by the npm scripts via `BROWSER=...`
 * (see package.json) and read here + in vite.config.ts. Defaults to Chrome.
 * One shared `src/` engine — only the manifest shape differs per browser.
 */
const isFirefox = process.env.BROWSER === "firefox";

/**
 * Hostnames of supported LLM web apps. Keep in sync with
 * `src/adapters/*` (each adapter declares the same hostnames).
 */
const LLM_HOST_GLOBS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*",
  "https://copilot.microsoft.com/*",
  "https://chat.mistral.ai/*",
  "https://*.perplexity.ai/*",
  "https://perplexity.ai/*",
  "https://chat.deepseek.com/*",
  "https://grok.com/*",
  "https://x.ai/*",
];

export default defineManifest({
  manifest_version: 3,
  name: "AvoPseudo",
  version: pkg.version,
  description:
    "Pseudonymises or blocks personal & sensitive data in prompts sent to ChatGPT, Claude, Gemini, Copilot and more.",
  icons: {
    16: "src/assets/icon-16.png",
    48: "src/assets/icon-48.png",
    128: "src/assets/icon-128.png",
  },
  action: {
    default_popup: "src/popup/popup.html",
    default_title: "AvoPseudo",
    default_icon: {
      16: "src/assets/icon-16.png",
      48: "src/assets/icon-48.png",
      128: "src/assets/icon-128.png",
    },
  },
  options_page: "src/options/options.html",
  // Chrome MV3 uses a module service worker; Firefox MV3 uses a background
  // script (@crxjs bundles the same entry either way).
  background: isFirefox
    ? { scripts: ["src/background/service-worker.ts"] }
    : { service_worker: "src/background/service-worker.ts", type: "module" },
  permissions: ["storage", "alarms", "scripting"],
  host_permissions: LLM_HOST_GLOBS,
  content_scripts: [
    {
      // MAIN world: monkey-patches window.fetch to intercept prompts.
      matches: LLM_HOST_GLOBS,
      js: ["src/content/main-world.ts"],
      run_at: "document_start",
      world: "MAIN",
      all_frames: false,
    },
    {
      // ISOLATED world: relays detection events to the service worker and
      // pushes config back into the page (MAIN cannot touch chrome.* APIs).
      matches: LLM_HOST_GLOBS,
      js: ["src/content/bridge.ts"],
      run_at: "document_start",
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/content/main-world.ts"],
      matches: LLM_HOST_GLOBS,
    },
  ],
  // Firefox requires an explicit add-on id; `world: "MAIN"` content scripts
  // need Firefox 128+. Omitted entirely for the Chrome build.
  ...(isFirefox && {
    browser_specific_settings: {
      gecko: {
        id: "avopseudo@avocat.tools",
        strict_min_version: "128.0",
        // Required for new AMO submissions. The extension pseudonymises data
        // locally and stores logs/stats only in the browser — nothing is
        // transmitted to us or any third party, so no collection is declared.
        data_collection_permissions: { required: ["none"] },
      },
    },
  }),
});
