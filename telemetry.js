/**
 * LLM Guard v2 — Telemetry module
 *
 * Buffers detection events in a persistent outbox (chrome.storage.local.guard_outbox)
 * and ships them in batches to a self-hosted backend. Strips raw prompt text and
 * masked samples before upload — only metadata + already-anonymized previews leave
 * the browser.
 *
 * Exported as a global `telemetry` object so background.js can call
 * `telemetry.enqueue(event)` after persisting to guard_logs.
 */

const TELEMETRY_CONFIG_KEY = "guard_telemetry_config";
const TELEMETRY_OUTBOX_KEY = "guard_outbox";
const TELEMETRY_STATE_KEY = "guard_telemetry_state";
const EXTENSION_VERSION = chrome?.runtime?.getManifest?.()?.version || "0.0.0";

const DEFAULTS = {
  batchSize: 50,
  flushIntervalMs: 30_000,
  maxOutbox: 2000,
  maxRetries: 5,
  baseBackoffMs: 2_000,
  maxBackoffMs: 300_000,
};

let flushTimer = null;
let flushing = false;

/** Public: read current telemetry config (opt-in, backend URL, device token, etc.). */
async function getConfig() {
  const r = await chrome.storage.local.get([TELEMETRY_CONFIG_KEY]);
  return r[TELEMETRY_CONFIG_KEY] || {
    enabled: false,
    backendUrl: "",
    deviceToken: "",
    deviceId: "",
    orgId: "",
    userHint: "",
  };
}

async function setConfig(partial) {
  const current = await getConfig();
  const next = { ...current, ...partial };
  if (!next.deviceId) next.deviceId = randomUuid();
  await chrome.storage.local.set({ [TELEMETRY_CONFIG_KEY]: next });
  return next;
}

async function getState() {
  const r = await chrome.storage.local.get([TELEMETRY_STATE_KEY]);
  return r[TELEMETRY_STATE_KEY] || {
    queued: 0,
    lastSentAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    evictedCount: 0,
    lastEvictionAt: null,
    totalFlushAttempts: 0,
    totalFlushSuccesses: 0,
  };
}

async function setState(partial) {
  const current = await getState();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [TELEMETRY_STATE_KEY]: next });
  return next;
}

/**
 * Public: enqueue a raw log event. Scrubs PII, validates shape, persists to outbox,
 * then schedules a flush. Never throws — failures are logged and silently dropped
 * from the pipeline so they never break detection.
 */
async function enqueue(rawEvent) {
  try {
    const config = await getConfig();
    if (!config.enabled || !config.backendUrl) return;

    const scrubbed = scrub(rawEvent, config);
    if (!scrubbed) return;

    const r = await chrome.storage.local.get([TELEMETRY_OUTBOX_KEY]);
    const outbox = r[TELEMETRY_OUTBOX_KEY] || [];
    outbox.push(scrubbed);
    // LRU eviction: drop oldest-first when we exceed maxOutbox and track how
    // many events were dropped so the options page can surface it. Without
    // this counter, long backend outages silently lose events.
    let evictedThisCall = 0;
    if (outbox.length > DEFAULTS.maxOutbox) {
      evictedThisCall = outbox.length - DEFAULTS.maxOutbox;
      outbox.splice(0, evictedThisCall);
    }
    await chrome.storage.local.set({ [TELEMETRY_OUTBOX_KEY]: outbox });
    if (evictedThisCall > 0) {
      const prev = await getState();
      await setState({
        queued: outbox.length,
        evictedCount: (prev.evictedCount || 0) + evictedThisCall,
        lastEvictionAt: new Date().toISOString(),
      });
      console.warn(`[LLM Guard telemetry] Outbox full — evicted ${evictedThisCall} old event(s). Backend may be unreachable.`);
    } else {
      await setState({ queued: outbox.length });
    }

    scheduleFlush();
  } catch (err) {
    console.warn("[LLM Guard telemetry] enqueue failed", err);
  }
}

/**
 * Convert a raw background-log event into the upload-schema shape. Drops
 * promptPreview, per-finding samples, and strips URL to hostname only.
 * Returns null if the event is malformed.
 */
function scrub(event, config) {
  if (!event || typeof event !== "object") return null;

  let hostname = "";
  try {
    hostname = event.url ? new URL(event.url).hostname : "";
  } catch {
    hostname = "";
  }

  const findings = Array.isArray(event.findings)
    ? event.findings.slice(0, 50).map((f) => ({
        type: String(f?.type || "unknown").slice(0, 128),
        severity: ["critical", "high", "medium", "low"].includes(f?.severity) ? f.severity : "low",
        count: Number.isFinite(f?.count) ? Math.max(1, f.count | 0) : 1,
      }))
    : [];

  const anonymizedPreview =
    typeof event.anonymizedPreview === "string"
      ? event.anonymizedPreview.slice(0, 200)
      : null;

  const ALLOWED_ACTIONS = [
    "CLEAN", "ANONYMIZED", "PII_DETECTED", "BLOCKED",
    "ATTACHMENT_CLEAN", "ATTACHMENT_PII_DETECTED", "ATTACHMENT_BLOCKED",
    "ATTACHMENT_DETECTED", "ATTACHMENT_UNSCANNED",
  ];
  const action = ALLOWED_ACTIONS.includes(event.action) ? event.action : "CLEAN";

  return {
    eventId: randomUuid(),
    deviceId: config.deviceId || "",
    orgId: config.orgId || "default",
    userHint: config.userHint || null,
    timestamp: event.timestamp || new Date().toISOString(),
    hostname,
    llm: ["ChatGPT", "Claude", "Gemini", "Copilot", "Mistral", "Perplexity", "DeepSeek", "Grok"].includes(event.llm) ? event.llm : "Unknown",
    action,
    endpoint: typeof event.endpoint === "string" ? event.endpoint.slice(0, 512) : null,
    mode: ["block", "visible", "anonymize"].includes(event.mode) ? event.mode : "anonymize",
    promptLength: Number.isFinite(event.promptLength) ? event.promptLength | 0 : 0,
    mappingsCount: Number.isFinite(event.mappingsCount) ? event.mappingsCount | 0 : 0,
    anonymizedPreview,
    findings,
    attachment: scrubAttachment(event.attachment),
    extensionVersion: EXTENSION_VERSION,
    schemaVersion: 1,
  };
}

function scrubAttachment(a) {
  if (!a || typeof a !== "object") return null;
  const sha256 = typeof a.sha256 === "string" && /^[a-f0-9]{0,64}$/i.test(a.sha256) ? a.sha256.slice(0, 64) : "";
  return {
    sha256,
    mimeType: typeof a.mimeType === "string" ? a.mimeType.slice(0, 128) : "",
    sizeBytes: Number.isFinite(a.sizeBytes) ? Math.max(0, a.sizeBytes | 0) : 0,
    extractedChars: Number.isFinite(a.extractedChars) ? Math.max(0, a.extractedChars | 0) : 0,
    truncated: !!a.truncated,
    extractorId: typeof a.extractorId === "string" ? a.extractorId.slice(0, 32) : null,
    unavailable: !!a.unavailable,
    passwordProtected: !!a.passwordProtected,
  };
}

function scheduleFlush(delayMs = 0) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((err) => console.warn("[LLM Guard telemetry] flush error", err));
  }, delayMs || DEFAULTS.flushIntervalMs);
}

/** Public: attempt to ship everything in the outbox. Safe to call at any time. */
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const config = await getConfig();
    if (!config.enabled || !config.backendUrl || !config.deviceToken) {
      flushing = false;
      return;
    }

    const r = await chrome.storage.local.get([TELEMETRY_OUTBOX_KEY]);
    const outbox = r[TELEMETRY_OUTBOX_KEY] || [];
    if (outbox.length === 0) {
      flushing = false;
      return;
    }

    const batch = outbox.slice(0, DEFAULTS.batchSize);
    const url = joinUrl(config.backendUrl, "/v1/events");

    const prevState = await getState();
    await setState({ totalFlushAttempts: (prevState.totalFlushAttempts || 0) + 1 });

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.deviceToken}`,
        },
        body: JSON.stringify({ events: batch }),
      });
    } catch (err) {
      await handleFailure(err.message || "network error", { batchSize: batch.length, url });
      flushing = false;
      return;
    }

    if (!response.ok) {
      const body = await safeText(response);
      await handleFailure(`HTTP ${response.status}: ${body.slice(0, 200)}`, {
        batchSize: batch.length,
        url,
        status: response.status,
      });
      flushing = false;
      return;
    }

    // Success — drop the sent batch from the outbox.
    const fresh = await chrome.storage.local.get([TELEMETRY_OUTBOX_KEY]);
    const freshOutbox = fresh[TELEMETRY_OUTBOX_KEY] || [];
    const remaining = freshOutbox.slice(batch.length);
    await chrome.storage.local.set({ [TELEMETRY_OUTBOX_KEY]: remaining });
    const afterSuccess = await getState();
    await setState({
      queued: remaining.length,
      lastSentAt: new Date().toISOString(),
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      totalFlushSuccesses: (afterSuccess.totalFlushSuccesses || 0) + 1,
    });

    // If more remains, flush again soon.
    if (remaining.length > 0) scheduleFlush(1000);
  } finally {
    flushing = false;
  }
}

async function handleFailure(message, context = {}) {
  const state = await getState();
  const failures = (state.consecutiveFailures || 0) + 1;
  const backoff = Math.min(
    DEFAULTS.baseBackoffMs * 2 ** Math.min(failures - 1, 8),
    DEFAULTS.maxBackoffMs
  );
  await setState({
    consecutiveFailures: failures,
    lastError: message,
    lastErrorAt: new Date().toISOString(),
  });
  // Structured log so users investigating "why aren't events leaving" can
  // see the URL, batch size, and HTTP status at a glance in the console.
  const ctx = Object.entries(context).map(([k, v]) => `${k}=${v}`).join(" ");
  console.warn(`[LLM Guard telemetry] send failed (attempt ${failures}/${DEFAULTS.maxRetries}): ${message}${ctx ? " " + ctx : ""}`);
  if (failures <= DEFAULTS.maxRetries) {
    scheduleFlush(backoff);
  } else {
    console.warn(`[LLM Guard telemetry] exhausted ${DEFAULTS.maxRetries} retries — queue is stuck. Check backend URL and device token in options.`);
  }
}

function joinUrl(base, path) {
  const trimmed = base.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : "/" + path;
  return trimmed + suffix;
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function randomUuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

const telemetry = { enqueue, flush, getConfig, setConfig, getState, scrub, _internals: { randomUuid, joinUrl } };

if (typeof self !== "undefined") self.telemetry = telemetry;
if (typeof module !== "undefined" && module.exports) module.exports = telemetry;
