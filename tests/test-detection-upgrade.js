/**
 * LLM Guard — Phase 2 (detection engine upgrade) tests
 * Usage : node tests/test-detection-upgrade.js
 *
 * Covers:
 *   1. New Layer 1 patterns (AWS/GitHub/Stripe/JWT/SSN-US/SIN-CA/NINO-UK/SSH)
 *   2. Hashed placeholder strategy in the anonymizer
 *   3. build.js looksRedosRisky() static analyzer
 *   4. New Layer 3 context rules (temporal, aggregation, family)
 *   5. createLRU + fnv1aHex helpers in utils.js
 */

const assert = require("assert");
const path = require("path");

const { PII_PATTERNS } = require(path.join(__dirname, "..", "rules", "pii-patterns.js"));
const { CONTEXT_RULES } = require(path.join(__dirname, "..", "rules", "context-rules.js"));
const { createAnonymizer } = require(path.join(__dirname, "..", "anonymizer.js"));
const { looksRedosRisky } = require(path.join(__dirname, "..", "build.js"));
const { createLRU, fnv1aHex } = require(path.join(__dirname, "..", "utils.js"));

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${err?.stack || err}\x1b[0m`);
  }
}

function firstMatch(text, patternName) {
  const p = PII_PATTERNS.find((x) => x.name === patternName);
  if (!p) throw new Error(`pattern ${patternName} missing`);
  const re = new RegExp(p.regex.source, p.regex.flags);
  const m = text.match(re);
  return m ? m[0] : null;
}

console.log("\n\x1b[1mLayer 1 — new cloud / dev / ID patterns\x1b[0m");

test("AWS access key detected", () => {
  const t = "key=AKIAIOSFODNN7EXAMPLE here";
  assert.strictEqual(firstMatch(t, "Clé AWS"), "AKIAIOSFODNN7EXAMPLE");
});

test("GitHub PAT (ghp_) detected", () => {
  const t = "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok";
  assert.ok(firstMatch(t, "GitHub PAT").startsWith("ghp_"));
});

test("Stripe live key detected", () => {
  const t = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
  assert.strictEqual(firstMatch(t, "Stripe API key"), "sk_live_4eC39HqLyjWDarjtT1zdp7dc");
});

test("Stripe test key detected", () => {
  const t = "pk_test_4eC39HqLyjWDarjtT1zdp7dc-aaaaa";
  assert.ok(firstMatch(t, "Stripe API key"));
});

test("OpenAI API key detected", () => {
  const t = "export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  assert.ok(firstMatch(t, "OpenAI API key"));
});

test("Google API key detected", () => {
  const t = "AIzaSyB1234567890abcdefghijklmnopqrstuv and some text";
  assert.strictEqual(firstMatch(t, "Google API key"), "AIzaSyB1234567890abcdefghijklmnopqrstuv");
});

test("JWT (3-segment base64url) detected", () => {
  const t = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.abcDEF-_123xyz";
  assert.ok(firstMatch(t, "JWT"));
});

test("SSH private key header detected", () => {
  const t = "config: -----BEGIN RSA PRIVATE KEY----- ...";
  assert.ok(firstMatch(t, "Clé privée SSH/PGP"));
});

test("US SSN detected", () => {
  assert.strictEqual(firstMatch("ssn: 123-45-6789", "SSN US"), "123-45-6789");
});

test("Canadian SIN with hyphens detected", () => {
  assert.strictEqual(firstMatch("SIN 046-454-286", "SIN CA"), "046-454-286");
});

test("UK NINO detected", () => {
  assert.ok(firstMatch("NINO: AB 12 34 56 A", "NINO UK"));
});

test("Slack bot token detected", () => {
  const t = "xoxb-1234567890-abcdef";
  assert.ok(firstMatch(t, "Slack token"));
});

test("Clean text does not trigger false positives", () => {
  const t = "Hello, this is a perfectly innocent sentence about weather.";
  for (const name of ["Clé AWS", "GitHub PAT", "Stripe API key", "OpenAI API key", "JWT", "Clé privée SSH/PGP", "SSN US", "SIN CA", "NINO UK"]) {
    assert.strictEqual(firstMatch(t, name), null, `false positive for ${name}`);
  }
});

console.log("\n\x1b[1mHashed placeholder strategy\x1b[0m");

test("hashed placeholders use hex instead of counters", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS, placeholderStrategy: "hashed", sessionSalt: "fixed" });
  const r = a.anonymize("ping alice@example.com");
  const [ph] = [...r.mappings.keys()];
  assert.match(ph, /^\[EMAIL_[0-9a-f]{6}\]$/, `expected hex placeholder, got ${ph}`);
});

test("hashed placeholders are deterministic per session (same value → same placeholder)", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS, placeholderStrategy: "hashed", sessionSalt: "fixed" });
  const r1 = a.anonymize("a@x.com");
  const r2 = a.anonymize("different text with a@x.com");
  const p1 = [...r1.mappings.keys()][0];
  const p2 = [...r2.mappings.keys()][0];
  assert.strictEqual(p1, p2, "same value should reuse placeholder");
});

test("different sessions produce different placeholders for the same value", () => {
  const a1 = createAnonymizer({ patterns: PII_PATTERNS, placeholderStrategy: "hashed", sessionSalt: "salt-A" });
  const a2 = createAnonymizer({ patterns: PII_PATTERNS, placeholderStrategy: "hashed", sessionSalt: "salt-B" });
  const p1 = [...a1.anonymize("a@x.com").mappings.keys()][0];
  const p2 = [...a2.anonymize("a@x.com").mappings.keys()][0];
  assert.notStrictEqual(p1, p2, "enumerable across sessions (bad)");
});

test("deanonymize restores original from hashed placeholder", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS, placeholderStrategy: "hashed", sessionSalt: "s" });
  const r = a.anonymize("contact alice@example.com");
  const ph = [...r.mappings.keys()][0];
  assert.strictEqual(a.deanonymize(`reply to ${ph}`), "reply to alice@example.com");
});

test("counter strategy is still the default (backward compat)", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r = a.anonymize("a@x.com");
  const ph = [...r.mappings.keys()][0];
  assert.strictEqual(ph, "[EMAIL_1]");
});

console.log("\n\x1b[1mReDoS static guard (build.js)\x1b[0m");

test("nested quantifier flagged", () => {
  assert.strictEqual(looksRedosRisky("(a+)+"), "nested-quantifier");
  assert.strictEqual(looksRedosRisky("(.+)*"), "nested-quantifier");
  assert.strictEqual(looksRedosRisky("(foo+)*"), "nested-quantifier");
});

test("duplicate-branch alternation flagged", () => {
  assert.strictEqual(looksRedosRisky("(foo|foo|bar)+"), "duplicate-branches");
});

test("huge bounded repetition flagged", () => {
  assert.strictEqual(looksRedosRisky("a{9999}"), "huge-repetition");
  assert.strictEqual(looksRedosRisky("x{1000,9999}"), "huge-repetition");
});

test("wildcard-quantifier pattern flagged", () => {
  assert.strictEqual(looksRedosRisky("(.*)*"), "nested-quantifier");
  assert.strictEqual(looksRedosRisky("(.+)*"), "nested-quantifier");
});

test("safe patterns pass", () => {
  assert.strictEqual(looksRedosRisky("srv-\\d+\\.internal"), null);
  assert.strictEqual(looksRedosRisky("[A-Za-z0-9]{8,16}"), null);
  assert.strictEqual(looksRedosRisky("\\bProject-\\w+\\b"), null);
});

console.log("\n\x1b[1mLayer 3 — new contextual rules\x1b[0m");

function matchesAll(text, rule) {
  const pairs = Object.entries(rule).filter(([k, v]) => k.endsWith("Indicators") && v instanceof RegExp);
  return pairs.every(([, re]) => re.test(text));
}

test("Antécédent médical temporel matches: famille + période + maladie", () => {
  const rule = CONTEXT_RULES.find((r) => r.name === "Antécédent médical temporel");
  assert.ok(rule, "rule missing");
  assert.ok(matchesAll("Ma mère souffre depuis 2018 d'un cancer du sein", rule));
});

test("Antécédent médical temporel ignores pure clinical text without time", () => {
  const rule = CONTEXT_RULES.find((r) => r.name === "Antécédent médical temporel");
  assert.ok(!matchesAll("Le cancer est une pathologie complexe", rule));
});

test("Agrégat RH matches count + sensitive trait", () => {
  const rule = CONTEXT_RULES.find((r) => r.name === "Agrégat RH sensible");
  assert.ok(rule);
  assert.ok(matchesAll("3 employés sont en arrêt maladie depuis lundi", rule));
  assert.ok(matchesAll("Plusieurs salariés ont porté plainte pour harcèlement", rule));
});

test("Agrégat RH ignores generic count without sensitive term", () => {
  const rule = CONTEXT_RULES.find((r) => r.name === "Agrégat RH sensible");
  assert.ok(!matchesAll("3 employés travaillent sur ce projet", rule));
});

test("Lien familial sensible matches: family + condition", () => {
  const rule = CONTEXT_RULES.find((r) => r.name === "Lien familial sensible");
  assert.ok(rule);
  assert.ok(matchesAll("Ma fille a été diagnostiquée avec un diabète", rule));
  assert.ok(matchesAll("Mon frère est en instance de divorce", rule));
});

test("Lien familial sensible ignores neutral family mentions", () => {
  const rule = CONTEXT_RULES.find((r) => r.name === "Lien familial sensible");
  assert.ok(!matchesAll("Ma fille aime le chocolat.", rule));
});

console.log("\n\x1b[1mutils.js: fnv1aHex + createLRU\x1b[0m");

test("fnv1aHex returns stable 8-char hex for same input", () => {
  const a = fnv1aHex("hello");
  const b = fnv1aHex("hello");
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}$/);
});

test("fnv1aHex differs across inputs", () => {
  assert.notStrictEqual(fnv1aHex("foo"), fnv1aHex("bar"));
});

test("LRU evicts oldest entry at capacity", () => {
  const lru = createLRU(3);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.set("c", 3);
  lru.set("d", 4);
  assert.strictEqual(lru.has("a"), false);
  assert.strictEqual(lru.has("d"), true);
  assert.strictEqual(lru.size, 3);
});

test("LRU get refreshes recency so the touched key survives eviction", () => {
  const lru = createLRU(3);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.set("c", 3);
  lru.get("a");     // refresh 'a'
  lru.set("d", 4);  // evicts oldest, which is now 'b'
  assert.strictEqual(lru.has("a"), true);
  assert.strictEqual(lru.has("b"), false);
});

test("LRU clear() empties the cache", () => {
  const lru = createLRU(5);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.clear();
  assert.strictEqual(lru.size, 0);
  assert.strictEqual(lru.has("a"), false);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${total}  \x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`);
if (failed > 0) process.exit(1);
