/**
 * LLM Guard — Tests for the shared anonymizer (anonymizer.js).
 *
 * Covers the two correctness fixes landed alongside Layer 4 wiring:
 *   A) placeholder collisions across successive prompts
 *   B) stream de-anonymization when a placeholder straddles chunks
 */

const { createAnonymizer } = require("../anonymizer.js");
const { PII_PATTERNS } = require("../rules/pii-patterns.js");

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || "not equal"}\n      expected: ${JSON.stringify(b)}\n      got:      ${JSON.stringify(a)}`); }

console.log("\n\x1b[1m🔐 Anonymizer — collision fix (bug A)\x1b[0m");

test("successive anonymize calls mint distinct placeholders", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r1 = a.anonymize("Mon email est alice@acme.com.");
  const r2 = a.anonymize("Et aussi bob@acme.com.");
  const p1 = [...r1.mappings.keys()][0];
  const p2 = [...r2.mappings.keys()][0];
  assert(p1 !== p2, `placeholders aliased across prompts: both "${p1}"`);
  eq(a.anonymizationMap.get(p1), "alice@acme.com");
  eq(a.anonymizationMap.get(p2), "bob@acme.com");
});

test("same value reused across prompts keeps a single placeholder", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r1 = a.anonymize("Contact: alice@acme.com");
  const r2 = a.anonymize("Réécrire alice@acme.com stp");
  const p1 = [...r1.mappings.keys()][0];
  const p2 = [...r2.mappings.keys()][0];
  eq(p1, p2, "same PII value should reuse the same placeholder");
  eq(a.anonymizationMap.size, 1, "map should hold exactly one entry");
});

test("three distinct emails across three prompts keep all mappings intact", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  a.anonymize("x@a.com");
  a.anonymize("y@b.com");
  a.anonymize("z@c.com");
  eq(a.anonymizationMap.size, 3);
  const originals = new Set(a.anonymizationMap.values());
  assert(originals.has("x@a.com"));
  assert(originals.has("y@b.com"));
  assert(originals.has("z@c.com"));
});

test("de-anonymization restores the correct value for old turns", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r1 = a.anonymize("alice@acme.com wrote");
  const p1 = [...r1.mappings.keys()][0];
  a.anonymize("bob@acme.com replied");
  // A later LLM response still references the first placeholder.
  eq(a.deanonymize(`About ${p1}: ...`), "About alice@acme.com: ...");
});

console.log("\n\x1b[1m🔐 Anonymizer — stream chunk fix (bug B)\x1b[0m");

function streamDeanonInChunks(anon, full, size) {
  const deanon = anon.makeStreamDeanonymizer();
  let out = "";
  for (let i = 0; i < full.length; i += size) {
    out += deanon.push(full.slice(i, i + size));
  }
  out += deanon.flush();
  return out;
}

test("placeholder split across 3-byte chunks is restored", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r = a.anonymize("Écris à alice@acme.com");
  const ph = [...r.mappings.keys()][0]; // e.g. "[EMAIL_1]"
  const llmAnswer = `D'accord, j'envoie à ${ph} demain.`;
  const restored = streamDeanonInChunks(a, llmAnswer, 3);
  eq(restored, "D'accord, j'envoie à alice@acme.com demain.");
});

test("two placeholders back-to-back across chunks are both restored", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r = a.anonymize("alice@acme.com et bob@acme.com");
  const [p1, p2] = [...r.mappings.keys()];
  const llmAnswer = `Contacts: ${p1}, ${p2}. Fin.`;
  eq(streamDeanonInChunks(a, llmAnswer, 1), "Contacts: alice@acme.com, bob@acme.com. Fin.");
  eq(streamDeanonInChunks(a, llmAnswer, 4), "Contacts: alice@acme.com, bob@acme.com. Fin.");
  eq(streamDeanonInChunks(a, llmAnswer, 7), "Contacts: alice@acme.com, bob@acme.com. Fin.");
});

test("text with no placeholder passes through unchanged even in 1-char chunks", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  a.anonymize("seed alice@acme.com"); // populate maxPlaceholderLen
  const text = "Bonjour, aucun PII ici. [crochet littéral]";
  eq(streamDeanonInChunks(a, text, 1), text);
});

test("unfinished placeholder at stream end is flushed verbatim", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  a.anonymize("alice@acme.com");
  // LLM hallucinates a half-written placeholder that never completes.
  const text = "Erreur: fragment [EMA";
  eq(streamDeanonInChunks(a, text, 2), "Erreur: fragment [EMA");
});

console.log("\n\x1b[1m🔐 Anonymizer — visible mode idempotency\x1b[0m");

test("anonymizing already-anonymized text produces no new placeholders", () => {
  // "Visible" mode shows placeholders in the composer before sending. When the
  // fetch interceptor runs after that, the body already contains placeholders.
  // A second anonymize pass must be a no-op so we don't create [EMAIL_1_1] junk.
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const first = a.anonymize("Écrire à alice@acme.com");
  assert(first.changed, "first pass should change the text");
  const second = a.anonymize(first.anonymized);
  assert(!second.changed, "second pass should not mint new placeholders");
  eq(second.anonymized, first.anonymized);
});

console.log("\n\x1b[1m🔐 Anonymizer — overflow behavior\x1b[0m");

test("onOverflow fires exactly once when map exceeds maxMapSize", () => {
  let calls = 0;
  const a = createAnonymizer({
    patterns: PII_PATTERNS,
    maxMapSize: 3,
    onOverflow: () => calls++,
  });
  for (let i = 0; i < 10; i++) a.anonymize(`u${i}@x.com`);
  eq(calls, 1, "onOverflow should fire exactly once");
  assert(a.anonymizationMap.size <= 3, `map size should be bounded to 3, got ${a.anonymizationMap.size}`);
});

test("overflowed flag flips and deanonymize becomes a no-op", () => {
  // After eviction, evicted placeholders can no longer be mapped back —
  // returning the raw placeholder would leak garbage to the UI. Deanonymize
  // must bail out and return the text unchanged once overflow has fired.
  const a = createAnonymizer({ patterns: PII_PATTERNS, maxMapSize: 2 });
  const r1 = a.anonymize("alice@x.com");
  const p1 = [...r1.mappings.keys()][0];
  for (let i = 0; i < 5; i++) a.anonymize(`u${i}@x.com`);
  assert(a.overflowed, "overflowed flag should be true after exceeding map");
  eq(a.deanonymize(`Refers to ${p1}`), `Refers to ${p1}`, "deanonymize must pass through on overflow");
});

console.log("\n\x1b[1m🔐 Anonymizer — stream tail buffer bound\x1b[0m");

test("stream tail stays bounded when chunks never close a placeholder", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  a.anonymize("alice@acme.com"); // seeds maxPlaceholderLen
  const deanon = a.makeStreamDeanonymizer();
  // Feed ~10KB of content with a lone '[' but no matching ']'. The carry
  // buffer must not grow unbounded; output must keep flowing.
  let emitted = "";
  for (let i = 0; i < 100; i++) {
    emitted += deanon.push("some text [unfinished fragment ");
  }
  emitted += deanon.flush();
  // Everything we pushed must surface eventually (modulo internal ordering),
  // and the byte count out must be within the byte count in.
  const inputLen = "some text [unfinished fragment ".length * 100;
  assert(emitted.length >= inputLen - 200, `emitted too little: ${emitted.length}/${inputLen}`);
  assert(emitted.length <= inputLen + 10, `emitted too much: ${emitted.length}/${inputLen}`);
});

console.log(`\n\x1b[1m${passed}/${total} tests passed\x1b[0m`);
if (failed > 0) process.exit(1);
