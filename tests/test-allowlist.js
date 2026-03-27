/**
 * LLM Guard — Tests for allowlist/exemptions
 * Usage: node tests/test-allowlist.js
 */
const { isAllowlisted, loadAllowlist } = require("../rules/allowlist.js");

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }

console.log("\n\x1b[1m\x1b[36m━━━ Allowlist Tests ━━━\x1b[0m\n");

test("Empty allowlist matches nothing", () => {
  loadAllowlist([]);
  assert(!isAllowlisted("jean@test.fr", "Email"), "Should not match");
});

test("String pattern matches", () => {
  loadAllowlist([{ type: "email", pattern: "test.fr" }]);
  assert(isAllowlisted("jean@test.fr", "Email"), "Should match test.fr");
  assert(!isAllowlisted("jean@gmail.com", "Email"), "Should not match gmail");
});

test("Regex pattern matches", () => {
  loadAllowlist([{ type: "email", pattern: ".*@company\\.com", isRegex: true }]);
  assert(isAllowlisted("alice@company.com", "Email"), "Should match regex");
  assert(!isAllowlisted("alice@other.com", "Email"), "Should not match");
});

test("Case insensitive matching", () => {
  loadAllowlist([{ type: "domain", pattern: "INTERNAL.CORP" }]);
  assert(isAllowlisted("server.internal.corp", "Domaine interne"), "Should match case-insensitive");
});

test("Invalid regex is treated as string", () => {
  loadAllowlist([{ type: "email", pattern: "[invalid", isRegex: true }]);
  assert(isAllowlisted("contains [invalid text", "Email"), "Should fallback to string match");
});

test("Multiple rules - first match wins", () => {
  loadAllowlist([
    { type: "email", pattern: "safe.com" },
    { type: "email", pattern: "also-safe.org" },
  ]);
  assert(isAllowlisted("user@safe.com", "Email"), "First rule matches");
  assert(isAllowlisted("user@also-safe.org", "Email"), "Second rule matches");
  assert(!isAllowlisted("user@blocked.com", "Email"), "No rule matches");
});

console.log("\n" + "═".repeat(50));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m  ✓ ${passed}/${total} tests réussis\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m  ✗ ${failed} échoué(s) sur ${total}\x1b[0m`);
}
console.log("═".repeat(50) + "\n");
process.exit(failed > 0 ? 1 : 0);
