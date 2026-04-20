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
  const r1 = a.anonymize("Mon email est alice@example.com.");
  const r2 = a.anonymize("Et aussi bob@example.com.");
  const p1 = [...r1.mappings.keys()][0];
  const p2 = [...r2.mappings.keys()][0];
  assert(p1 !== p2, `placeholders aliased across prompts: both "${p1}"`);
  eq(a.anonymizationMap.get(p1), "alice@example.com");
  eq(a.anonymizationMap.get(p2), "bob@example.com");
});

test("same value reused across prompts keeps a single placeholder", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r1 = a.anonymize("Contact: alice@example.com");
  const r2 = a.anonymize("Réécrire alice@example.com stp");
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
  const r1 = a.anonymize("alice@example.com wrote");
  const p1 = [...r1.mappings.keys()][0];
  a.anonymize("bob@example.com replied");
  // A later LLM response still references the first placeholder.
  eq(a.deanonymize(`About ${p1}: ...`), "About alice@example.com: ...");
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
  const r = a.anonymize("Écris à alice@example.com");
  const ph = [...r.mappings.keys()][0]; // e.g. "[EMAIL_1]"
  const llmAnswer = `D'accord, j'envoie à ${ph} demain.`;
  const restored = streamDeanonInChunks(a, llmAnswer, 3);
  eq(restored, "D'accord, j'envoie à alice@example.com demain.");
});

test("two placeholders back-to-back across chunks are both restored", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  const r = a.anonymize("alice@example.com et bob@example.com");
  const [p1, p2] = [...r.mappings.keys()];
  const llmAnswer = `Contacts: ${p1}, ${p2}. Fin.`;
  eq(streamDeanonInChunks(a, llmAnswer, 1), "Contacts: alice@example.com, bob@example.com. Fin.");
  eq(streamDeanonInChunks(a, llmAnswer, 4), "Contacts: alice@example.com, bob@example.com. Fin.");
  eq(streamDeanonInChunks(a, llmAnswer, 7), "Contacts: alice@example.com, bob@example.com. Fin.");
});

test("text with no placeholder passes through unchanged even in 1-char chunks", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  a.anonymize("seed alice@example.com"); // populate maxPlaceholderLen
  const text = "Bonjour, aucun PII ici. [crochet littéral]";
  eq(streamDeanonInChunks(a, text, 1), text);
});

test("unfinished placeholder at stream end is flushed verbatim", () => {
  const a = createAnonymizer({ patterns: PII_PATTERNS });
  a.anonymize("alice@example.com");
  // LLM hallucinates a half-written placeholder that never completes.
  const text = "Erreur: fragment [EMA";
  eq(streamDeanonInChunks(a, text, 2), "Erreur: fragment [EMA");
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

console.log(`\n\x1b[1m${passed}/${total} tests passed\x1b[0m`);
if (failed > 0) process.exit(1);
