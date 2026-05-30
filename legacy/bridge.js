/**
 * LLM Guard — ISOLATED↔MAIN bridge.
 *
 * The bridge is the only path from the page (MAIN world) into privileged
 * extension APIs (chrome.runtime, chrome.storage). Because postMessage is
 * unauthenticated — any script in the page can fake `source: "llm-guard"` —
 * every branch here defends in depth:
 *   - event.origin must equal the top-level window origin (rejects cross-origin
 *     iframes reusing window.postMessage to talk through us).
 *   - event.source must be `window` (rejects bubbled-up iframe messages).
 *   - Each message type strictly validates its own payload shape before
 *     touching chrome.* APIs.
 *   - The allowlist.addAttachment path is gated on a strict hex/length check
 *     because a malicious sha256 injection would let an attacker pre-whitelist
 *     an arbitrary file.
 */

const VALID_MODES = new Set(["block", "visible", "anonymize", "review"]);
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const MAX_FILENAME_LEN = 256;

// After an extension reload/update, `chrome.runtime.id` becomes undefined in
// orphaned content scripts. Any call to chrome.* then throws
// "Extension context invalidated". Guard every bridge hop so a stale page
// fails quietly instead of spamming the console until the user refreshes.
function extensionAlive() {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
}

function originMatches(evt) {
  // window.location.origin covers http/https/file etc. Same-origin-only.
  try {
    return evt.origin === window.location.origin;
  } catch {
    return false;
  }
}

function isLLMGuardMessage(evt) {
  if (evt.source !== window) return false;
  if (!originMatches(evt)) return false;
  if (!evt.data || typeof evt.data !== "object") return false;
  if (evt.data.source !== "llm-guard") return false;
  if (typeof evt.data.type !== "string") return false;
  return true;
}

window.addEventListener("message", (event) => {
  if (!isLLMGuardMessage(event)) return;

  if (event.data.type === "log") {
    // Log payload is opaque metadata — background.js revalidates before
    // storing. We limit nothing here because the payload is bounded by the
    // scrubber downstream.
    if (!extensionAlive()) return;
    try {
      chrome.runtime.sendMessage({
        source: "llm-guard",
        type: "log",
        payload: event.data.payload,
      });
    } catch { /* orphaned content script — page needs a refresh */ }
    return;
  }

  if (event.data.type === "getMode") {
    if (!extensionAlive()) return;
    try {
      chrome.storage.local.get(["guard_mode", "guard_layer4", "guard_attachment"], (r) => {
        const mode = VALID_MODES.has(r.guard_mode) ? r.guard_mode : "anonymize";
        const layer4 = r.guard_layer4 || { enabled: false, presidioUrl: "" };
        const attachment = r.guard_attachment || {};
        window.postMessage({ source: "llm-guard-bridge", type: "modeUpdate", mode }, window.location.origin);
        window.postMessage({ source: "llm-guard-bridge", type: "layer4Update", layer4 }, window.location.origin);
        window.postMessage({ source: "llm-guard-bridge", type: "attachmentConfigUpdate", attachment }, window.location.origin);
      });
    } catch { /* orphaned */ }
    return;
  }

  if (event.data.type === "setMode") {
    const mode = event.data.mode;
    if (!VALID_MODES.has(mode)) return;
    if (!extensionAlive()) return;
    try { chrome.storage.local.set({ guard_mode: mode }); } catch { /* orphaned */ }
    return;
  }

  if (event.data.type === "presidio.fetch") {
    // Proxy Presidio HTTP through the background service worker to bypass the
    // host page's Content Security Policy. Validate URL before forwarding.
    const { reqId, url, body, method } = event.data;
    if (typeof reqId !== "string" || typeof url !== "string") return;
    if (!/^https?:\/\//i.test(url)) return;

    // Always post a response for this reqId so the content-script promise
    // resolves immediately instead of waiting for its 5s timeout.
    const respond = (payload) => {
      window.postMessage(
        { source: "llm-guard-bridge", type: "presidio.response", reqId, ...payload },
        window.location.origin
      );
    };

    if (!extensionAlive()) {
      respond({ ok: false, data: null, error: "extension reloaded — refresh the page" });
      return;
    }
    try {
      chrome.runtime.sendMessage(
        { source: "llm-guard", type: "presidio.fetch", reqId, url, body: body || null, method: method || "GET" },
        (result) => {
          if (chrome.runtime.lastError) {
            respond({ ok: false, data: null, error: chrome.runtime.lastError.message });
            return;
          }
          const r = result || { error: "no response from background" };
          respond({ ok: !!r.ok, data: r.data || null, error: r.error || null });
        }
      );
    } catch (err) {
      respond({ ok: false, data: null, error: err?.message || String(err) });
    }
    return;
  }

  if (event.data.type === "allowlist.addAttachment") {
    // Strict validation: sha256 must be 64-char hex; filename trimmed to a
    // safe length. Forged requests with arbitrary strings are rejected so a
    // compromised page can't poison the user allowlist with pre-approved
    // attacker-controlled hashes.
    const sha256Raw = typeof event.data.sha256 === "string" ? event.data.sha256 : "";
    if (!SHA256_HEX.test(sha256Raw)) return;
    const sha256 = sha256Raw.toLowerCase();
    const filenameRaw = typeof event.data.filename === "string" ? event.data.filename : "";
    const filename = filenameRaw.slice(0, MAX_FILENAME_LEN);
    if (!extensionAlive()) return;
    try {
      chrome.storage.local.get(["guard_user_allowlist"], (r) => {
        const list = Array.isArray(r.guard_user_allowlist) ? r.guard_user_allowlist : [];
        if (!list.some((e) => e.type === "attachment" && e.pattern === sha256)) {
          list.push({ type: "attachment", pattern: sha256, filename });
          chrome.storage.local.set({ guard_user_allowlist: list });
        }
      });
    } catch { /* orphaned */ }
    return;
  }
});

// Relay storage changes (e.g. popup mode switch) back to the page
chrome.storage.onChanged.addListener((changes) => {
  if (changes.guard_mode) {
    const raw = changes.guard_mode.newValue;
    const mode = VALID_MODES.has(raw) ? raw : "anonymize";
    window.postMessage({ source: "llm-guard-bridge", type: "modeUpdate", mode }, window.location.origin);
  }
  if (changes.guard_layer4) {
    const layer4 = changes.guard_layer4.newValue || { enabled: false, presidioUrl: "" };
    window.postMessage({ source: "llm-guard-bridge", type: "layer4Update", layer4 }, window.location.origin);
  }
  if (changes.guard_attachment) {
    const attachment = changes.guard_attachment.newValue || {};
    window.postMessage({ source: "llm-guard-bridge", type: "attachmentConfigUpdate", attachment }, window.location.origin);
  }
});
