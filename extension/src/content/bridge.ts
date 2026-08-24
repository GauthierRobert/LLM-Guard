/**
 * ISOLATED-world content script (document_start).
 *
 * Bridges the MAIN-world fetch interceptor (which cannot touch chrome.*) with
 * the service worker and chrome.storage:
 *   - relays detection events MAIN → service worker
 *   - serves config + rules to the page (on request, on load, on storage change)
 *   - relays reveal/hide commands from the popup (chrome.tabs.sendMessage) → MAIN
 *     and the reveal result back to the popup
 */

import {
  CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG,
  GUARD_NS,
  RULES_STORAGE_KEY,
  isGuardMessage,
  withConfigDefaults as withDefaults,
  type GuardConfig,
  type NerDetectResponse,
  type RevealResponse,
  type RevealStatusResponse,
  type TabMessage,
} from "@/shared/messages";

async function readConfig(): Promise<GuardConfig> {
  try {
    const stored = await chrome.storage.sync.get(CONFIG_STORAGE_KEY);
    return withDefaults(stored[CONFIG_STORAGE_KEY] as Partial<GuardConfig> | undefined);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function readRulesYaml(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
    return (stored[RULES_STORAGE_KEY] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

function post(message: object): void {
  try {
    window.postMessage(message, location.origin);
  } catch {
    /* never throw onto the page */
  }
}

async function pushConfig(): Promise<void> {
  post({ ns: GUARD_NS, kind: "config", payload: await readConfig() });
}

async function pushRules(): Promise<void> {
  const yaml = await readRulesYaml();
  // null → MAIN keeps its bundled default compiled rules.
  if (yaml !== null) post({ ns: GUARD_NS, kind: "rules", payload: { yaml } });
}

/**
 * MAIN can't reach chrome.*; forward its NER request to the service worker
 * (which routes to the offscreen/background host) and post the result back,
 * keyed by the request id. Always answers — [] on any failure.
 */
function relayNer(id: string, text: string): void {
  void (async () => {
    let entities: NerDetectResponse["entities"] = [];
    try {
      const resp = (await chrome.runtime.sendMessage({
        kind: "ner-detect",
        payload: { text },
      })) as NerDetectResponse | undefined;
      if (resp?.ok) entities = resp.entities;
    } catch {
      /* worker asleep / context invalidated → empty result */
    }
    post({ ns: GUARD_NS, kind: "ner-result", payload: { id, entities } });
  })();
}

/* ----------------------- MAIN ⇄ ISOLATED (postMessage) -------------------- */

// Pending reveal request awaiting MAIN's result, so we can answer the popup.
let pendingReveal: ((r: RevealResponse) => void) | null = null;
// Pending reveal-status query awaiting MAIN's answer.
let pendingRevealStatus: ((r: RevealStatusResponse) => void) | null = null;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isGuardMessage(event.data)) return;
  const data = event.data;

  if (data.kind === "detection") {
    try {
      void chrome.runtime.sendMessage({ kind: "detection", payload: data.payload });
    } catch {
      /* worker asleep / context invalidated */
    }
  } else if (data.kind === "ner-request") {
    relayNer(data.payload.id, data.payload.text);
  } else if (data.kind === "config-request") {
    void pushConfig();
    void pushRules();
  } else if (data.kind === "reveal-result") {
    if (pendingReveal) {
      pendingReveal({
        ok: data.payload.ok,
        reveal: data.payload.reveal,
        replaced: data.payload.replaced,
        panel: data.payload.panel === true,
      });
      pendingReveal = null;
    }
  } else if (data.kind === "reveal-status") {
    if (pendingRevealStatus) {
      pendingRevealStatus({ ok: true, reveal: data.payload.reveal });
      pendingRevealStatus = null;
    }
  }
});

/* ---------------------- popup → tab → MAIN (reveal) ------------------------ */

chrome.runtime.onMessage.addListener(
  (message: TabMessage, _sender, sendResponse): boolean => {
    if (message?.kind === "reveal") {
      // Replace any earlier pending waiter; answer it as a no-op.
      if (pendingReveal) pendingReveal({ ok: false, reveal: false, replaced: 0 });
      pendingReveal = sendResponse;
      post({ ns: GUARD_NS, kind: "reveal", payload: { reveal: message.reveal } });
      // Safety net: if MAIN never answers, release the channel.
      setTimeout(() => {
        if (pendingReveal === sendResponse) {
          pendingReveal({ ok: false, reveal: false, replaced: 0 });
          pendingReveal = null;
        }
      }, 3000);
      return true; // async response
    }
    if (message?.kind === "reveal-status") {
      if (pendingRevealStatus) pendingRevealStatus({ ok: false, reveal: false });
      pendingRevealStatus = sendResponse;
      post({ ns: GUARD_NS, kind: "reveal-status-request" });
      setTimeout(() => {
        if (pendingRevealStatus === sendResponse) {
          pendingRevealStatus({ ok: false, reveal: false });
          pendingRevealStatus = null;
        }
      }, 3000);
      return true; // async response
    }
    return false;
  },
);

/* --------------------------- storage change feed -------------------------- */

chrome.storage.onChanged.addListener((changes, area) => {
  // Config lives in sync; rules live in local (too big for sync's per-item cap).
  if (area === "sync" && CONFIG_STORAGE_KEY in changes) {
    post({
      ns: GUARD_NS,
      kind: "config",
      payload: withDefaults(changes[CONFIG_STORAGE_KEY]?.newValue as Partial<GuardConfig> | undefined),
    });
  }
  if (area === "local" && RULES_STORAGE_KEY in changes) {
    const yaml = changes[RULES_STORAGE_KEY]?.newValue as string | undefined;
    if (typeof yaml === "string") post({ ns: GUARD_NS, kind: "rules", payload: { yaml } });
  }
});

// Push current config + rules immediately on load.
void pushConfig();
void pushRules();
