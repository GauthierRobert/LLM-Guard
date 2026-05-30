/**
 * LLM Guard — Cross-cutting tests for the improvement batch.
 * Usage: node tests/test-improvements.js
 *
 * Covers:
 *   - SIRET/SIREN context rule (content.js-level logic, reproduced here so
 *     we test the invariant independently of the DOM wrapper).
 *   - Anonymizer hashed-placeholder default (createAnonymizer with no
 *     `placeholderStrategy` should embed the fnv hash).
 *   - Options.js isSafeInsecureBackend (http allowed only for loopback /
 *     RFC1918).
 *   - build.js looksRedosRisky regression cases.
 */

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }

// ─── SIRET/SIREN context gate ────────────────────────────────
// Re-implement the gate the same way content.js does so the invariant is
// testable without a DOM. If the two drift, add a shared export.
const BUSINESS_CONTEXT_REGEX = /(SIREN|SIRET|RCS|SARL|SASU?|SA\b|EURL|SNC|SCI|SCOP|TVA|immatricul|soci[ée]t[ée]|entreprise|registre du commerce|num[ée]ro d'entreprise)/i;
function hasBusinessContext(text, matchIndex, matchLen) {
  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(text.length, matchIndex + matchLen + 40);
  return BUSINESS_CONTEXT_REGEX.test(text.slice(start, end));
}

console.log("\n\x1b[1mSIRET/SIREN context gate\x1b[0m");

test("Flags SIRET when near 'SIRET' keyword", () => {
  const text = "Notre SIRET est 73282932000074 pour la facturation.";
  const idx = text.indexOf("73282932000074");
  assert(hasBusinessContext(text, idx, 14) === true);
});

test("Rejects 9-digit number with no business keyword nearby", () => {
  const text = "La commande 829374521 est expédiée demain matin";
  const idx = text.indexOf("829374521");
  assert(hasBusinessContext(text, idx, 9) === false);
});

test("Accepts 'SARL' as business indicator", () => {
  const text = "La SARL Dupont 732829320 est immatriculée";
  const idx = text.indexOf("732829320");
  assert(hasBusinessContext(text, idx, 9) === true);
});

test("Context window is 40 chars each side", () => {
  // SIRET 40+ chars away from the keyword must NOT be picked up.
  const far = "SIRET " + "x".repeat(50) + " 73282932000074 " + "y".repeat(10);
  const idx = far.indexOf("73282932000074");
  assert(hasBusinessContext(far, idx, 14) === false);
});

// ─── Anonymizer hashed-placeholder default ───────────────────
console.log("\n\x1b[1mAnonymizer default strategy\x1b[0m");

const { createAnonymizer } = require("../anonymizer.js");
const emailPattern = {
  name: "Email",
  regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  severity: "high",
  placeholder: "[EMAIL_§]",
};

test("Default placeholder strategy is hashed (not counter)", () => {
  const a = createAnonymizer({ patterns: [emailPattern], sessionSalt: "fixed-salt" });
  const { anonymized } = a.anonymize("contact: alice@example.com");
  // Hashed form contains 6 hex chars; counter form would be [EMAIL_1].
  const match = anonymized.match(/\[EMAIL_([0-9a-f]+)\]/);
  assert(match, `no placeholder found in: ${anonymized}`);
  assert(match[1].length >= 6, `expected hex placeholder, got [EMAIL_${match[1]}]`);
});

test("Same email maps to the same placeholder across calls", () => {
  const a = createAnonymizer({ patterns: [emailPattern], sessionSalt: "s" });
  const r1 = a.anonymize("first: alice@acme.com");
  const r2 = a.anonymize("second: alice@acme.com");
  const p1 = r1.anonymized.match(/\[EMAIL_[0-9a-f]+\]/)[0];
  const p2 = r2.anonymized.match(/\[EMAIL_[0-9a-f]+\]/)[0];
  assert(p1 === p2, `stable placeholder expected: ${p1} vs ${p2}`);
});

test("Different emails get different placeholders", () => {
  const a = createAnonymizer({ patterns: [emailPattern], sessionSalt: "s" });
  const { anonymized } = a.anonymize("alice@acme.com and bob@acme.com");
  const matches = [...anonymized.matchAll(/\[EMAIL_[0-9a-f]+(?:_\d+)?\]/g)].map((m) => m[0]);
  assert(matches.length === 2, `expected 2 placeholders, got ${matches.length}: ${anonymized}`);
  assert(matches[0] !== matches[1], "different originals must not share a placeholder");
});

test("deanonymize round-trips with hashed placeholders", () => {
  const a = createAnonymizer({ patterns: [emailPattern], sessionSalt: "s" });
  const input = "Contact alice@acme.com or bob@other.io";
  const { anonymized } = a.anonymize(input);
  assert(a.deanonymize(anonymized) === input);
});

// ─── Options HTTPS gate ──────────────────────────────────────
// Replicate the predicate (options.js is browser-only so we import by
// text). Tiny copy to keep tests independent of DOM.
function isSafeInsecureBackend(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol === "https:") return true;
    if (u.protocol !== "http:") return false;
    const h = u.hostname;
    if (h === "localhost" || h === "::1" || /^127\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  } catch { return false; }
}

console.log("\n\x1b[1mOptions page HTTPS gate\x1b[0m");

test("https:// is always safe", () => { assert(isSafeInsecureBackend("https://dashboard.example.com")); });
test("http://localhost is safe (dev)", () => { assert(isSafeInsecureBackend("http://localhost:8000")); });
test("http://127.0.0.1 is safe (dev)", () => { assert(isSafeInsecureBackend("http://127.0.0.1:8000")); });
test("http://10.x is safe (corp LAN)", () => { assert(isSafeInsecureBackend("http://10.42.1.5")); });
test("http://192.168.x is safe (home LAN)", () => { assert(isSafeInsecureBackend("http://192.168.1.100")); });
test("http://172.16.x is safe (private range)", () => { assert(isSafeInsecureBackend("http://172.16.0.1")); });
test("http://172.15.x is NOT safe (not in RFC1918)", () => { assert(!isSafeInsecureBackend("http://172.15.0.1")); });
test("http://attacker.example.com is NOT safe", () => { assert(!isSafeInsecureBackend("http://attacker.example.com")); });
test("garbage URLs are rejected", () => { assert(!isSafeInsecureBackend("not a url")); });

// ─── build.js ReDoS detector regression ──────────────────────
console.log("\n\x1b[1mbuild.js ReDoS detector\x1b[0m");
const { looksRedosRisky } = require("../build.js");

test("Detects nested quantifier (a+)+", () => {
  assert(looksRedosRisky("(a+)+") === "nested-quantifier");
});
test("Detects (.*)* wildcard quantifier", () => {
  assert(looksRedosRisky("(.*)*") !== null);
});
test("Detects duplicate alternation branches", () => {
  assert(looksRedosRisky("(a|a|b)+") === "duplicate-branches");
});
test("Allows benign patterns", () => {
  assert(looksRedosRisky("srv-\\d+\\.internal") === null);
  assert(looksRedosRisky("[A-Z]{3}-\\d{4}") === null);
});
test("Detects {10000,} huge repetition", () => {
  assert(looksRedosRisky("a{10000,}") === "huge-repetition");
});

// ─── AuthRateLimiter-like behavior (documentation test) ──────
// The Java rate limiter is tested by Spring's own harness; this JS test
// documents the contract (10 failures / 60s window) so any JS port stays
// consistent.
console.log("\n\x1b[1mRate-limit contract documentation\x1b[0m");
test("Documented contract: MAX_FAILURES=10, WINDOW_MS=60_000", () => {
  const fs = require("fs");
  const src = fs.readFileSync(
    require("path").join(__dirname, "..", "api-java", "src", "main", "java", "com", "llmguard", "api", "auth", "AuthRateLimiter.java"),
    "utf-8"
  );
  assert(/MAX_FAILURES\s*=\s*10\b/.test(src), "MAX_FAILURES should be 10");
  assert(/WINDOW_MS\s*=\s*60_000L/.test(src), "WINDOW_MS should be 60_000");
});

// ─── Résumé ──────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${total}  \x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`);
if (failed > 0) process.exit(1);
