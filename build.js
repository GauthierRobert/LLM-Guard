#!/usr/bin/env node
/**
 * LLM Guard — Build Script
 * Reads config/whitelist.json and config/blacklist.json,
 * generates config/company-rules.js for the extension.
 *
 * Usage: node build.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "config");
const WHITELIST_PATH = path.join(CONFIG_DIR, "whitelist.json");
const BLACKLIST_PATH = path.join(CONFIG_DIR, "blacklist.json");
const OUTPUT_PATH = path.join(CONFIG_DIR, "company-rules.js");

function readJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[build] ${label} not found at ${filePath} — using empty list.`);
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries)) {
      console.error(`[build] ERROR: ${label} must have an "entries" array.`);
      process.exit(1);
    }
    return parsed;
  } catch (e) {
    console.error(`[build] ERROR: Failed to parse ${label}: ${e.message}`);
    process.exit(1);
  }
}

function validateWhitelist(entries) {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.type || !e.pattern) {
      console.error(`[build] ERROR: whitelist entry #${i} must have "type" and "pattern".`);
      process.exit(1);
    }
    if (e.isRegex) {
      try {
        new RegExp(e.pattern);
      } catch (err) {
        console.error(`[build] ERROR: whitelist entry #${i} has invalid regex "${e.pattern}": ${err.message}`);
        process.exit(1);
      }
    }
  }
}

/**
 * Static ReDoS guard. Rejects patterns known to cause catastrophic
 * backtracking. Heuristics (not exhaustive, but catch the common traps):
 *   - nested quantifiers: `(a+)+`, `(.*)*`, `(a+)*`
 *   - alternation inside a quantified group where branches overlap: `(a|a)+`
 *   - unbounded repetition inside unbounded repetition via backreferences
 *   - huge `{n,}` lower bounds (>=1000)
 * Regexes supplied by a company admin are the only user-controlled regex
 * inputs in this codebase, so gating them here is the ReDoS entry point.
 */
function looksRedosRisky(source) {
  // Nested quantifier: (X+)+  (X*)*  (X+)*  (X*)+  — allowing whitespace.
  if (/\([^)]*[+*][^)]*\)\s*[+*]/.test(source)) return "nested-quantifier";
  // Alternation with repeated branch inside quantified group: (a|a|b)+
  const altGroup = /\(([^)]*)\)\s*[+*]/g;
  let m;
  while ((m = altGroup.exec(source)) !== null) {
    const parts = m[1].split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && new Set(parts).size < parts.length) return "duplicate-branches";
  }
  // Giant bounded repetition
  if (/\{\s*\d{4,}\s*,?\s*\d*\s*\}/.test(source)) return "huge-repetition";
  // Evil regex pattern: (a+)+$ or (.*)*$
  if (/\(\.\*\)\s*[*+]|\(\.\+\)\s*[*+]/.test(source)) return "wildcard-quantifier";
  return null;
}

function validateBlacklist(entries) {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.term && !e.isRegex) {
      console.error(`[build] ERROR: blacklist entry #${i} must have "term".`);
      process.exit(1);
    }
    if (e.isRegex) {
      const pat = e.term || e.pattern;
      if (!pat) {
        console.error(`[build] ERROR: blacklist regex entry #${i} must have "term" or "pattern".`);
        process.exit(1);
      }
      try {
        new RegExp(pat);
      } catch (err) {
        console.error(`[build] ERROR: blacklist entry #${i} has invalid regex "${pat}": ${err.message}`);
        process.exit(1);
      }
      const risk = looksRedosRisky(pat);
      if (risk) {
        console.error(`[build] ERROR: blacklist entry #${i} pattern "${pat}" is ReDoS-risky (${risk}). Rewrite without nested quantifiers / repeated alternatives / huge repetitions.`);
        process.exit(1);
      }
    }
    if (!e.category) {
      console.error(`[build] ERROR: blacklist entry #${i} must have "category".`);
      process.exit(1);
    }
  }
}

module.exports = { looksRedosRisky };

if (require.main !== module) {
  return;
}

// ─── Main ───────────────────────────────────────────────────────

const whitelist = readJSON(WHITELIST_PATH, "whitelist.json");
const blacklist = readJSON(BLACKLIST_PATH, "blacklist.json");

validateWhitelist(whitelist.entries);
validateBlacklist(blacklist.entries);

// Separate blacklist into string-match and regex entries
const blacklistKeywords = blacklist.entries.filter((e) => !e.isRegex);
const blacklistRegex = blacklist.entries.filter((e) => e.isRegex).map((e) => ({
  pattern: e.term || e.pattern,
  category: e.category,
  severity: e.severity || "high",
}));

const timestamp = new Date().toISOString();

const output = `/**
 * LLM Guard — Company-specific rules (GENERATED)
 * Built from config/whitelist.json + config/blacklist.json
 * Timestamp: ${timestamp}
 *
 * DO NOT EDIT — re-run: node build.js
 */
(function () {
  "use strict";

  var COMPANY_WHITELIST = ${JSON.stringify(whitelist.entries, null, 2).replace(/\n/g, "\n  ")};

  var COMPANY_BLACKLIST = ${JSON.stringify(blacklistKeywords, null, 2).replace(/\n/g, "\n  ")};

  var COMPANY_BLACKLIST_REGEX = ${JSON.stringify(blacklistRegex, null, 2).replace(/\n/g, "\n  ")};

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.companyConfig = {
      whitelist: COMPANY_WHITELIST,
      blacklist: COMPANY_BLACKLIST,
      blacklistRegex: COMPANY_BLACKLIST_REGEX,
    };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      COMPANY_WHITELIST: COMPANY_WHITELIST,
      COMPANY_BLACKLIST: COMPANY_BLACKLIST,
      COMPANY_BLACKLIST_REGEX: COMPANY_BLACKLIST_REGEX,
    };
  }
})();
`;

fs.writeFileSync(OUTPUT_PATH, output, "utf-8");

const wCount = whitelist.entries.length;
const bkCount = blacklistKeywords.length;
const brCount = blacklistRegex.length;
console.log(`[build] Generated ${OUTPUT_PATH}`);
console.log(`[build]   Whitelist:        ${wCount} entries`);
console.log(`[build]   Blacklist (terms): ${bkCount} entries`);
console.log(`[build]   Blacklist (regex): ${brCount} entries`);
