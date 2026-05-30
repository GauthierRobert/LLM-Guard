/**
 * Rule model types — the contract for the DPO-authored YAML rules engine.
 *
 *   YAML text  ──parse──▶  ParsedRulesDoc  ──compile──▶  CompiledRules
 *                                                            │
 *                                          evaluate(text) ───┘──▶ EvaluateResult
 *
 * A rule says WHAT to look for (`kind`) and WHAT to do (`action`). The DPO only
 * needs to understand three kinds: words, regex, combination.
 */

import type { Severity } from "@/shared/types";

/** What the extension does when a rule matches. block > anonymize > warn. */
export type RuleAction = "block" | "anonymize" | "warn";

/** Action precedence — the per-request decision is the highest-ranked match. */
export const ACTION_RANK: Record<RuleAction, number> = {
  warn: 0,
  anonymize: 1,
  block: 2,
};

/** Returns the more severe of two actions. */
export function maxAction(a: RuleAction | null, b: RuleAction | null): RuleAction | null {
  if (a === null) return b;
  if (b === null) return a;
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

export type RuleKind = "words" | "regex" | "combination";

/* --------------------------- parsed model (YAML) -------------------------- */

export interface ParsedDefaults {
  action?: RuleAction;
  severity?: Severity;
}

export interface ParsedBlacklist {
  action?: RuleAction;
  severity?: Severity;
  values: string[];
}

interface ParsedRuleBase {
  id: string;
  description?: string;
  action?: RuleAction;
  severity?: Severity;
  /** Placeholder label for anonymize, e.g. "PROJECT" → [PROJECT_xxxx]. */
  placeholder?: string;
}

export interface ParsedWordsRule extends ParsedRuleBase {
  kind: "words";
  words: string[];
}

export interface ParsedRegexRule extends ParsedRuleBase {
  kind: "regex";
  pattern: string;
}

/** A combination sub-condition is itself a words-or-regex test. */
export type ParsedCondition =
  | { kind: "words"; words: string[] }
  | { kind: "regex"; pattern: string };

export interface ParsedCombinationRule extends ParsedRuleBase {
  kind: "combination";
  all: ParsedCondition[];
}

export type ParsedRule = ParsedWordsRule | ParsedRegexRule | ParsedCombinationRule;

export interface ParsedRulesDoc {
  version: number;
  defaults?: ParsedDefaults;
  whitelist?: string[];
  blacklist?: ParsedBlacklist;
  rules: ParsedRule[];
}

/* ------------------------- compiled model (regex) ------------------------- */

export interface CompiledMatcher {
  ruleId: string;
  kind: RuleKind;
  action: RuleAction;
  severity: Severity;
  /** Resolved placeholder label (used only when action === "anonymize"). */
  placeholder: string;
  /** words/regex: regexes to scan (global). For combination: ignored. */
  regexes: RegExp[];
  /**
   * combination only: each entry is the set of alternative regexes for one
   * sub-condition. Every sub-condition must produce >= 1 span for the rule to
   * fire. The collected spans across all conditions become the findings.
   */
  conditions?: RegExp[][];
  /** Optional validator (built-in matchers only, e.g. Luhn for cards). */
  validate?: (match: string) => boolean;
}

export interface CompiledRules {
  version: number;
  /** Spans matching these are never flagged. */
  whitelist: RegExp[];
  matchers: CompiledMatcher[];
}

/* -------------------------------- findings -------------------------------- */

export interface RuleFinding {
  ruleId: string;
  start: number;
  end: number;
  value: string;
  action: RuleAction;
  severity: Severity;
  /** Present iff action === "anonymize". */
  placeholderLabel?: string;
}

export interface EvaluateResult {
  /** Non-overlapping, sorted by start ascending. */
  findings: RuleFinding[];
  /** Most severe action present, or null when nothing matched. */
  decision: RuleAction | null;
  maxSeverity: Severity | null;
}
