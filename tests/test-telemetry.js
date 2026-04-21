/**
 * LLM Guard v2 — Telemetry tests
 * Usage : node tests/test-telemetry.js
 */

// ─── Mock chrome.storage + chrome.runtime + crypto + fetch ──────
const fakeStore = {};
const mockStorage = {
  get(keys, cb) {
    const out = {};
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) if (k in fakeStore) out[k] = fakeStore[k];
    const result = Promise.resolve(out);
    if (cb) result.then(cb);
    return result;
  },
  set(obj, cb) {
    Object.assign(fakeStore, obj);
    const result = Promise.resolve();
    if (cb) result.then(cb);
    return result;
  },
};

globalThis.chrome = {
  storage: { local: mockStorage },
  runtime: {
    getManifest: () => ({ version: "2.0.0" }),
  },
};

if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

// Mutable fetch mock
let fetchCalls = [];
let fetchResponder = () => ({ ok: true, status: 200, text: async () => "ok" });
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  const res = fetchResponder(url, init);
  return res instanceof Promise ? res : res;
};

// ─── Framework de test ─────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }
function reset() {
  for (const k of Object.keys(fakeStore)) delete fakeStore[k];
  fetchCalls = [];
  fetchResponder = () => ({ ok: true, status: 200, text: async () => "ok" });
  // Reload module to reset its internal timers/state
  delete require.cache[require.resolve("../telemetry.js")];
}

// ─── Tests ─────────────────────────────────────────────────────

(async () => {
  console.log("\n\x1b[1mScrubbing (privacy filter)\x1b[0m");

  await test("Strips promptPreview from events", () => {
    reset();
    const telemetry = require("../telemetry.js");
    const scrubbed = telemetry.scrub(
      {
        timestamp: "2026-01-01T00:00:00Z",
        url: "https://chatgpt.com/c/abc?secret=xyz",
        llm: "ChatGPT",
        action: "ANONYMIZED",
        promptPreview: "RAW PROMPT WITH alice@example.com",
        anonymizedPreview: "RAW PROMPT WITH [EMAIL_1]",
        findings: [{ type: "Email", severity: "high", count: 1, samples: ["a***@example.com"] }],
        promptLength: 42,
        mappingsCount: 1,
        mode: "anonymize",
      },
      { deviceId: "dev-1", orgId: "acme" }
    );
    assert(!("promptPreview" in scrubbed), "promptPreview should be removed");
    assert(scrubbed.anonymizedPreview === "RAW PROMPT WITH [EMAIL_1]", "anonymizedPreview kept");
    assert(!("samples" in scrubbed.findings[0]), "samples should be removed from findings");
    assert(scrubbed.findings[0].type === "Email");
    assert(scrubbed.hostname === "chatgpt.com", "URL reduced to hostname");
    assert(!("url" in scrubbed), "full url should be absent");
  });

  await test("Coerces unknown enum values to safe defaults", () => {
    reset();
    const telemetry = require("../telemetry.js");
    const s = telemetry.scrub(
      { llm: "EvilLLM", action: "HACK", mode: "nuke", findings: [{ type: "x", severity: "nope", count: 0 }] },
      { deviceId: "d", orgId: "o" }
    );
    assert(s.llm === "Unknown", `llm: ${s.llm}`);
    assert(s.action === "CLEAN", `action: ${s.action}`);
    assert(s.mode === "anonymize", `mode: ${s.mode}`);
    assert(s.findings[0].severity === "low", "severity coerced to low");
    assert(s.findings[0].count === 1, "count clamped to >=1");
  });

  await test("Generates eventId (UUID) and sets schemaVersion=1", () => {
    reset();
    const telemetry = require("../telemetry.js");
    const s = telemetry.scrub({ timestamp: "2026-01-01T00:00:00Z" }, { deviceId: "d", orgId: "o" });
    assert(/^[0-9a-f-]{36}$/.test(s.eventId), `bad eventId: ${s.eventId}`);
    assert(s.schemaVersion === 1);
    assert(s.extensionVersion === "2.0.0");
  });

  await test("Returns null for non-object input", () => {
    reset();
    const telemetry = require("../telemetry.js");
    assert(telemetry.scrub(null, {}) === null);
    assert(telemetry.scrub("nope", {}) === null);
  });

  console.log("\n\x1b[1mEnqueue + outbox persistence\x1b[0m");

  await test("Enqueue persists to guard_outbox when enabled", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "https://b.example", deviceToken: "tok", orgId: "acme" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN", findings: [], mode: "anonymize", promptLength: 0, mappingsCount: 0 });
    const stored = fakeStore.guard_outbox || [];
    assert(stored.length === 1, `expected 1 in outbox, got ${stored.length}`);
    assert(stored[0].hostname === "chatgpt.com");
  });

  await test("Enqueue is a no-op when telemetry disabled", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: false, backendUrl: "https://b.example" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN", findings: [] });
    assert(!fakeStore.guard_outbox || fakeStore.guard_outbox.length === 0, "outbox should be empty");
  });

  await test("Enqueue is a no-op when backendUrl missing", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN" });
    assert(!fakeStore.guard_outbox || fakeStore.guard_outbox.length === 0);
  });

  await test("Outbox capped at maxOutbox", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "https://b", deviceToken: "t", orgId: "o" });
    // Pre-seed with near-full outbox
    const pre = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    await mockStorage.set({ guard_outbox: pre });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN" });
    assert(fakeStore.guard_outbox.length === 2000, `expected 2000 after cap, got ${fakeStore.guard_outbox.length}`);
    // Oldest entry evicted, newest kept
    assert(fakeStore.guard_outbox[fakeStore.guard_outbox.length - 1].hostname === "chatgpt.com");
  });

  console.log("\n\x1b[1mFlush (batching + HTTP)\x1b[0m");

  await test("Flush POSTs batch with bearer auth and empties outbox on 200", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example/", deviceToken: "secret-tok", orgId: "acme" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN", findings: [] });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:01Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "ANONYMIZED", findings: [] });
    await telemetry.flush();
    assert(fetchCalls.length === 1, `expected 1 fetch, got ${fetchCalls.length}`);
    const call = fetchCalls[0];
    assert(call.url === "https://api.example/v1/events", `url: ${call.url}`);
    assert(call.init.method === "POST");
    assert(call.init.headers.Authorization === "Bearer secret-tok");
    const body = JSON.parse(call.init.body);
    assert(Array.isArray(body.events) && body.events.length === 2, "body.events array of 2");
    assert(fakeStore.guard_outbox.length === 0, "outbox cleared after success");
    assert(fakeStore.guard_telemetry_state.consecutiveFailures === 0);
    assert(fakeStore.guard_telemetry_state.lastSentAt, "lastSentAt set");
  });

  await test("Flush is a no-op when not configured", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.flush();
    assert(fetchCalls.length === 0);
  });

  await test("Flush records error + retry counter on HTTP 500", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    fetchResponder = () => ({ ok: false, status: 500, text: async () => "server boom" });
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example", deviceToken: "t", orgId: "o" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN" });
    await telemetry.flush();
    assert(fakeStore.guard_outbox.length === 1, "outbox preserved on failure");
    assert(fakeStore.guard_telemetry_state.consecutiveFailures === 1);
    assert(/500/.test(fakeStore.guard_telemetry_state.lastError || ""), "error recorded");
  });

  await test("Flush records error on network failure", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    fetchResponder = () => { throw new Error("ECONNREFUSED"); };
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example", deviceToken: "t", orgId: "o" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN" });
    await telemetry.flush();
    assert(fakeStore.guard_outbox.length === 1, "outbox preserved on network failure");
    assert(/ECONNREFUSED/.test(fakeStore.guard_telemetry_state.lastError || ""));
  });

  await test("Flush respects batchSize (50) and leaves the rest queued", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example", deviceToken: "t", orgId: "o" });
    // Pre-seed 120 events
    const pre = Array.from({ length: 120 }, (_, i) => ({ eventId: "e" + i }));
    await mockStorage.set({ guard_outbox: pre });
    await telemetry.flush();
    const body = JSON.parse(fetchCalls[0].init.body);
    assert(body.events.length === 50, `expected 50 in batch, got ${body.events.length}`);
    assert(fakeStore.guard_outbox.length === 70, `expected 70 remaining, got ${fakeStore.guard_outbox.length}`);
  });

  console.log("\n\x1b[1mConfig + device ID\x1b[0m");

  await test("setConfig generates a deviceId on first call", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    const saved = await telemetry.setConfig({ enabled: true, backendUrl: "https://b", orgId: "o" });
    assert(/^[0-9a-f-]{36}$/.test(saved.deviceId), `bad deviceId: ${saved.deviceId}`);
  });

  await test("setConfig preserves existing deviceId", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    const first = await telemetry.setConfig({ enabled: true, backendUrl: "https://b" });
    const second = await telemetry.setConfig({ orgId: "acme" });
    assert(first.deviceId === second.deviceId, "deviceId should persist");
  });

  await test("joinUrl trims trailing slash on base", () => {
    reset();
    const telemetry = require("../telemetry.js");
    assert(telemetry._internals.joinUrl("https://x.com/", "/v1/events") === "https://x.com/v1/events");
    assert(telemetry._internals.joinUrl("https://x.com", "v1/events") === "https://x.com/v1/events");
  });

  console.log("\n\x1b[1mQueue eviction + flush stats\x1b[0m");

  await test("Overfill evicts oldest and bumps evictedCount", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example", deviceToken: "t", orgId: "o" });
    // Pre-seed outbox close to the 2000 cap.
    const pre = Array.from({ length: 1999 }, (_, i) => ({ eventId: "old-" + i }));
    await mockStorage.set({ guard_outbox: pre });
    // Enqueue 5 new events → should trigger eviction (4 dropped).
    for (let i = 0; i < 5; i++) {
      await telemetry.enqueue({
        timestamp: "2026-01-01T00:00:00Z",
        url: "https://chatgpt.com/",
        llm: "ChatGPT",
        action: "CLEAN",
      });
    }
    assert(fakeStore.guard_outbox.length === 2000, `expected 2000, got ${fakeStore.guard_outbox.length}`);
    const state = fakeStore.guard_telemetry_state;
    assert(state.evictedCount === 4, `expected evictedCount=4, got ${state.evictedCount}`);
    assert(typeof state.lastEvictionAt === "string", "lastEvictionAt should be set");
  });

  await test("Successful flush increments totalFlushAttempts + totalFlushSuccesses", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example", deviceToken: "t", orgId: "o" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN" });
    await telemetry.flush();
    const st = fakeStore.guard_telemetry_state;
    assert(st.totalFlushAttempts >= 1, "attempts should have incremented");
    assert(st.totalFlushSuccesses === 1, `expected totalFlushSuccesses=1, got ${st.totalFlushSuccesses}`);
    assert(st.lastError === null, "lastError should clear on success");
  });

  await test("Failed flush records lastErrorAt timestamp", async () => {
    reset();
    const telemetry = require("../telemetry.js");
    fetchResponder = () => ({ ok: false, status: 503, text: async () => "upstream down" });
    await telemetry.setConfig({ enabled: true, backendUrl: "https://api.example", deviceToken: "t", orgId: "o" });
    await telemetry.enqueue({ timestamp: "2026-01-01T00:00:00Z", url: "https://chatgpt.com/", llm: "ChatGPT", action: "CLEAN" });
    await telemetry.flush();
    const st = fakeStore.guard_telemetry_state;
    assert(/HTTP 503/.test(st.lastError), `lastError should contain HTTP 503; got: ${st.lastError}`);
    assert(typeof st.lastErrorAt === "string", "lastErrorAt should be set");
    assert(st.totalFlushSuccesses === 0 || st.totalFlushSuccesses == null, "no successes on 503");
  });

  // ─── Résumé ────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total: ${total}  \x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`);
  // Explicit exit: the failing-flush tests schedule retry timers that would
  // otherwise keep Node alive until the 5-minute backoff cap elapses.
  process.exit(failed > 0 ? 1 : 0);
})();
