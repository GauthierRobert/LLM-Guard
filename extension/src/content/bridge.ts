/**
 * ISOLATED-world content script (document_start).
 *
 * Bridges the MAIN-world fetch interceptor (which cannot touch chrome.*) with
 * the service worker and chrome.storage:
 *   - relays detection events MAIN → service worker
 *   - serves config to the page (on request, on load, and on storage change)
 */

import {
  CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG,
  GUARD_NS,
  isGuardMessage,
  type GuardConfig,
} from "@/shared/messages";

async function readConfig(): Promise<GuardConfig> {
  try {
    const stored = await chrome.storage.sync.get(CONFIG_STORAGE_KEY);
    const value = stored[CONFIG_STORAGE_KEY] as GuardConfig | undefined;
    return value ?? DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function postConfig(config: GuardConfig): void {
  try {
    window.postMessage(
      { ns: GUARD_NS, kind: "config", payload: config },
      location.origin,
    );
  } catch {
    /* never throw onto the page */
  }
}

async function pushCurrentConfig(): Promise<void> {
  postConfig(await readConfig());
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isGuardMessage(event.data)) return;

  const data = event.data;
  if (data.kind === "detection") {
    try {
      void chrome.runtime.sendMessage({ kind: "detection", payload: data.payload });
    } catch {
      /* worker may be asleep / context invalidated */
    }
  } else if (data.kind === "config-request") {
    void pushCurrentConfig();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (!(CONFIG_STORAGE_KEY in changes)) return;
  const next = changes[CONFIG_STORAGE_KEY]?.newValue as GuardConfig | undefined;
  postConfig(next ?? DEFAULT_CONFIG);
});

// Push current config immediately on load (page may already be listening).
void pushCurrentConfig();
