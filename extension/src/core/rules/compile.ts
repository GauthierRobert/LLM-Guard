/**
 * Compile a parsed rules document into ready-to-evaluate matchers: regexes
 * built, defaults resolved, placeholder labels normalised. Plus a set of
 * built-in validated matchers (cards, IPs, JWTs, …) that need a JS validator
 * the DPO can't express in YAML — these run ahead of user rules.
 */

import type { Severity } from "@/shared/types";
import { isValidIPv4, looksLikeJwt, luhnCheck } from "@/core/validators";
import type {
  CompiledMatcher,
  CompiledRules,
  ParsedCondition,
  ParsedRule,
  ParsedRulesDoc,
  RuleAction,
} from "./types";

const DEFAULT_ACTION: RuleAction = "anonymize";
const DEFAULT_SEVERITY: Severity = "medium";

/** Thrown by compile when a rule's regex is invalid; carries a DPO message. */
export class CompileError extends Error {}

/** Escape a literal string for safe inclusion in a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a global, case-insensitive, unicode regex that matches `word` only on
 * letter/number/underscore boundaries. `\b` is ASCII-only and breaks on
 * accented French text, so we use explicit Unicode lookarounds.
 */
function wordRegex(word: string): RegExp {
  const esc = escapeRegExp(word.trim());
  return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "giu");
}

/**
 * Compile a user-supplied pattern. Deliberately NO global `i` flag: under
 * `/iu`, Unicode case-folding makes `\p{Lu}` (and `[A-Z]`) match lowercase too,
 * which silently destroys the "starts with a capital → likely a proper noun"
 * signal every PERSON / COMPANY / MATTER rule relies on (mass false positives
 * on ordinary lowercase French words). Case tolerance is expressed in the
 * patterns themselves via classes like `[Pp]assword`; keyword matching keeps
 * its own case-insensitivity in `wordRegex`, independent of this flag.
 * Invalid patterns become a CompileError.
 */
function userRegex(pattern: string, ruleId: string): RegExp {
  try {
    return new RegExp(pattern, "gu");
  } catch {
    // 'u' can reject patterns with otherwise-tolerated escapes; retry without it.
    try {
      return new RegExp(pattern, "g");
    } catch (err) {
      throw new CompileError(
        `Rule "${ruleId}": invalid regular expression — ${(err as Error).message}`,
      );
    }
  }
}

function conditionRegexes(cond: ParsedCondition, ruleId: string): RegExp[] {
  if (cond.kind === "words") return cond.words.map(wordRegex);
  return [userRegex(cond.pattern, ruleId)];
}

/** PROJECT → "PROJECT"; "Client Names" → "CLIENT_NAMES". */
function slugLabel(s: string): string {
  const up = s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return up || "INFO";
}

function resolvePlaceholder(rule: { placeholder?: string; id: string }): string {
  return slugLabel(rule.placeholder ?? rule.id);
}

function compileRule(rule: ParsedRule, doc: ParsedRulesDoc): CompiledMatcher {
  const action = rule.action ?? doc.defaults?.action ?? DEFAULT_ACTION;
  const severity = rule.severity ?? doc.defaults?.severity ?? DEFAULT_SEVERITY;
  const placeholder = resolvePlaceholder(rule);

  const base = { ruleId: rule.id, action, severity, placeholder } as const;

  switch (rule.kind) {
    case "words":
      return { ...base, kind: "words", regexes: rule.words.map(wordRegex) };
    case "regex":
      return { ...base, kind: "regex", regexes: [userRegex(rule.pattern, rule.id)] };
    case "combination":
      return {
        ...base,
        kind: "combination",
        regexes: [],
        conditions: rule.all.map((c) => conditionRegexes(c, rule.id)),
      };
  }
}

/**
 * Built-in matchers for values that need JS validation the DPO can't write in
 * YAML. They run BEFORE user rules (higher priority on ties) so e.g. a credit
 * card is recognised with a Luhn check. Kept deliberately small.
 */
function builtinMatchers(): CompiledMatcher[] {
  const mk = (
    ruleId: string,
    placeholder: string,
    pattern: RegExp,
    severity: Severity,
    validate?: (s: string) => boolean,
  ): CompiledMatcher => ({
    ruleId,
    kind: "regex",
    action: "anonymize",
    severity,
    placeholder,
    regexes: [pattern],
    validate,
  });

  return [
    mk("builtin-card", "CARD", /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, "critical", luhnCheck),
    mk("builtin-jwt", "JWT", /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "critical", looksLikeJwt),
    mk("builtin-ip", "IP", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "low", isValidIPv4),
  ];
}

export function compileRules(doc: ParsedRulesDoc): CompiledRules {
  const whitelist = (doc.whitelist ?? []).map(wordRegex);

  const matchers: CompiledMatcher[] = [...builtinMatchers()];

  // Blacklist → a words matcher that always flags, with its own action.
  if (doc.blacklist && doc.blacklist.values.length > 0) {
    matchers.push({
      ruleId: "blacklist",
      kind: "words",
      action: doc.blacklist.action ?? doc.defaults?.action ?? "block",
      severity: doc.blacklist.severity ?? doc.defaults?.severity ?? "critical",
      placeholder: "BLACKLIST",
      regexes: doc.blacklist.values.map(wordRegex),
    });
  }

  // Rules explicitly disabled (enabled: false) stay in the document but are
  // never compiled, so the DPO can toggle them off without deleting them.
  for (const rule of doc.rules) {
    if (rule.enabled === false) continue;
    matchers.push(compileRule(rule, doc));
  }

  return { version: doc.version, whitelist, matchers };
}
