/**
 * LLM Guard — Company Rules Integration Tests
 * Tests whitelist/blacklist from config/company-rules.js
 *
 * Run: node tests/test-company-rules.js
 */
"use strict";

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 FAIL: ${name}`);
  }
}

// ─── Load modules ────────────────────────────────────────────

const { COMPANY_WHITELIST, COMPANY_BLACKLIST, COMPANY_BLACKLIST_REGEX } = require("../config/company-rules.js");
const { isAllowlisted, loadCompanyAllowlist, loadAllowlist } = require("../rules/allowlist.js");
const { scanFuzzy, scanCompanyBlacklistRegex, analyzePrompt, SENSITIVE_KEYWORDS } = require("../advanced-engine.js");

// ─── Test 1: Generated file loads correctly ──────────────────

console.log("\n--- Generated company-rules.js ---");
assert(Array.isArray(COMPANY_WHITELIST), "COMPANY_WHITELIST is an array");
assert(COMPANY_WHITELIST.length > 0, "COMPANY_WHITELIST has entries");
assert(Array.isArray(COMPANY_BLACKLIST), "COMPANY_BLACKLIST is an array");
assert(COMPANY_BLACKLIST.length > 0, "COMPANY_BLACKLIST has entries");
assert(Array.isArray(COMPANY_BLACKLIST_REGEX), "COMPANY_BLACKLIST_REGEX is an array");
assert(COMPANY_BLACKLIST_REGEX.length > 0, "COMPANY_BLACKLIST_REGEX has entries");

// ─── Test 2: Whitelist integration ───────────────────────────

console.log("\n--- Whitelist integration ---");

// Load company whitelist into allowlist module
loadCompanyAllowlist(COMPANY_WHITELIST);

assert(isAllowlisted("john@acme-corp.com", "Email") === true, "Company email is allowlisted (regex)");
assert(isAllowlisted("acme-corp.com", "Domain") === true, "Company domain is allowlisted (string)");
assert(isAllowlisted("Project Phoenix is our main initiative", "Keyword") === true, "Company keyword is allowlisted (string)");
assert(isAllowlisted("random@evil.com", "Email") === false, "Non-company email is NOT allowlisted");
assert(isAllowlisted("some-other-domain.com", "Domain") === false, "Non-company domain is NOT allowlisted");

// Verify user allowlist stacks with company allowlist
loadAllowlist([{ type: "keyword", pattern: "user-safe-term" }]);
assert(isAllowlisted("user-safe-term here", "Keyword") === true, "User allowlist entry works alongside company");
assert(isAllowlisted("acme-corp.com", "Domain") === true, "Company allowlist still active after user allowlist load");

// ─── Test 3: Blacklist keyword detection (fuzzy) ────────────

console.log("\n--- Blacklist keyword detection (fuzzy scan) ---");

// Company blacklist terms should be merged into SENSITIVE_KEYWORDS
assert(
  SENSITIVE_KEYWORDS.some((kw) => kw.term === "Project Titan"),
  "Company blacklist term 'Project Titan' is in SENSITIVE_KEYWORDS"
);
assert(
  SENSITIVE_KEYWORDS.some((kw) => kw.term === "Operation Midnight"),
  "Company blacklist term 'Operation Midnight' is in SENSITIVE_KEYWORDS"
);

const fuzzyResults1 = scanFuzzy("We discussed Project Titan with the team");
assert(
  fuzzyResults1.some((f) => f.type.includes("Project Titan")),
  "scanFuzzy detects 'Project Titan' in text"
);

const fuzzyResults2 = scanFuzzy("The Operation Midnight plan is ready");
assert(
  fuzzyResults2.some((f) => f.type.includes("Operation Midnight")),
  "scanFuzzy detects 'Operation Midnight' in text"
);

const fuzzyResults3 = scanFuzzy("The weather is nice today");
assert(
  fuzzyResults3.every((f) => !f.type.includes("Project Titan") && !f.type.includes("Operation Midnight")),
  "scanFuzzy does NOT flag company terms in clean text"
);

// ─── Test 4: Blacklist regex detection ───────────────────────

console.log("\n--- Blacklist regex detection ---");

const regexResults1 = scanCompanyBlacklistRegex("Connect to client-42.internal for the database");
assert(
  regexResults1.some((f) => f.type.includes("Infrastructure interne")),
  "Regex blacklist catches 'client-42.internal'"
);

const regexResults2 = scanCompanyBlacklistRegex("The server client-999.internal is down");
assert(
  regexResults2.some((f) => f.type.includes("Infrastructure interne")),
  "Regex blacklist catches 'client-999.internal'"
);

const regexResults3 = scanCompanyBlacklistRegex("The weather is nice today");
assert(regexResults3.length === 0, "Regex blacklist has no matches on clean text");

// ─── Test 5: Full pipeline (analyzePrompt) ──────────────────

console.log("\n--- Full pipeline (analyzePrompt) ---");

(async () => {
  const result = await analyzePrompt("Send the Project Titan docs to client-42.internal");
  assert(result.findings.length >= 2, "Full pipeline detects both keyword and regex blacklist");
  assert(
    result.findings.some((f) => f.type.includes("Project Titan")),
    "Full pipeline includes 'Project Titan' finding"
  );
  assert(
    result.findings.some((f) => f.type.includes("Infrastructure interne")),
    "Full pipeline includes regex blacklist finding"
  );

  // ─── Test 6: Empty / no company config ────────────────────

  console.log("\n--- Edge cases ---");

  const cleanResult = await analyzePrompt("Hello, how are you?");
  assert(
    cleanResult.findings.every((f) => !f.type.includes("Blacklist")),
    "Clean text has no company blacklist findings"
  );

  // ─── Summary ──────────────────────────────────────────────

  console.log(`\n=== Company Rules: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
