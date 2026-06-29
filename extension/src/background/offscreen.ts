/**
 * Offscreen document script (Chrome only).
 *
 * Hosts the transformers.js NER model. The service worker can't run heavy WASM
 * reliably (it's killed after ~30s idle and lacks the right CSP), so on Chrome
 * we run the model here and answer `ner-run` messages from the worker. On
 * Firefox there is no offscreen API — the background script runs the engine
 * directly (see host.ts), and this file is never loaded.
 */

import { detectEntities } from "@/core/ner/engine";
import type { OffscreenNerRequest, OffscreenNerResponse } from "@/core/ner/host";

chrome.runtime.onMessage.addListener(
  (message: OffscreenNerRequest, _sender, sendResponse: (r: OffscreenNerResponse) => void): boolean => {
    if (message?.target !== "offscreen" || message.kind !== "ner-run") return false;
    detectEntities(message.text, message.model)
      .then((entities) => sendResponse({ ok: true, entities }))
      .catch((err) => sendResponse({ ok: false, entities: [], error: String(err) }));
    return true; // async sendResponse
  },
);
