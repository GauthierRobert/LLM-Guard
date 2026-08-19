/**
 * Paste planning — the pure decision step of the v5 paste guard.
 *
 * Given the text the user is pasting and the rules result for that exact text,
 * decide what should actually land in the composer and what the user must be
 * told about it. No DOM, no chrome.* — so it is fully unit-testable.
 *
 * Offsets in `EvaluateResult` are relative to the pasted text itself (the
 * engine ran on it directly), which is why the spans can be used as-is instead
 * of being re-found by value the way the send-time path had to.
 */

import type { EvaluateResult, RuleAction, RuleFinding } from "@/core/rules/types";
import type { AnonymizeSpan, IAnonymizer } from "@/shared/types";

/** One value that was pseudonymised, as shown in the notice. */
export interface PasteReplacement {
  /** The placeholder now sitting in the composer, e.g. `[EMAIL_a1b2c3]`. */
  placeholder: string;
  /** The real value it stands for. */
  value: string;
  /** Placeholder label, e.g. "EMAIL". */
  label: string;
  /** How many times this value occurred in the pasted text. */
  count: number;
}

export type PasteOutcome = "clean" | "pseudonymised" | "warned" | "blocked";

export interface PastePlan {
  outcome: PasteOutcome;
  /** What to insert into the composer. Empty string when blocked. */
  text: string;
  /** The clipboard text as the user copied it. */
  original: string;
  /** Ordered, de-duplicated list of the values that were replaced. */
  replacements: PasteReplacement[];
  /** Rule ids behind the decision — shown when warning or blocking. */
  ruleIds: string[];
  decision: RuleAction | null;
  findings: RuleFinding[];
}

/** Distinct rule ids in match order. */
function ruleIdsOf(findings: RuleFinding[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const f of findings) {
    if (seen.has(f.ruleId)) continue;
    seen.add(f.ruleId);
    ids.push(f.ruleId);
  }
  return ids;
}

/**
 * Turn the anonymize-action findings into spans the anonymizer can consume.
 * `resolveOverlaps` already guarantees they do not overlap.
 */
function anonymizeSpans(findings: RuleFinding[]): AnonymizeSpan[] {
  return findings
    .filter((f) => f.action === "anonymize")
    .map((f) => ({
      start: f.start,
      end: f.end,
      value: f.value,
      label: f.placeholderLabel ?? "INFO",
    }));
}

/**
 * Decide what to do with a paste.
 *
 *   block     → nothing is inserted; the user is told why.
 *   anonymize → the pseudonymised text is inserted and every substitution is
 *               listed back to the user.
 *   warn      → the original text is inserted, with a warning.
 *   no match  → the original text, untouched.
 *
 * `anonymizer` is mutated (it mints and remembers the placeholders) exactly as
 * it is on the send path, so the same value keeps the same placeholder for the
 * whole session and the popup's manual reveal keeps working.
 */
export function planPaste(
  original: string,
  result: EvaluateResult,
  anonymizer: IAnonymizer,
): PastePlan {
  const base: PastePlan = {
    outcome: "clean",
    text: original,
    original,
    replacements: [],
    ruleIds: [],
    decision: result.decision,
    findings: result.findings,
  };

  if (result.findings.length === 0 || result.decision === null) return base;

  const ruleIds = ruleIdsOf(result.findings);

  if (result.decision === "block") {
    return { ...base, outcome: "blocked", text: "", ruleIds };
  }

  const spans = anonymizeSpans(result.findings);
  if (spans.length === 0) {
    // Only warn-action rules matched (or an anonymize rule produced no span).
    return { ...base, outcome: "warned", ruleIds };
  }

  const text = anonymizer.anonymizeSpans(original, spans);

  // Roll the spans up per distinct value so the notice lists each real value
  // once, with an occurrence count.
  const byValue = new Map<string, PasteReplacement>();
  const placeholderOf = new Map<string, string>();
  for (const [placeholder, value] of Object.entries(anonymizer.exportMap())) {
    placeholderOf.set(value, placeholder);
  }
  for (const span of spans) {
    const existing = byValue.get(span.value);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byValue.set(span.value, {
      placeholder: placeholderOf.get(span.value) ?? `[${span.label}]`,
      value: span.value,
      label: span.label,
      count: 1,
    });
  }

  return {
    ...base,
    outcome: "pseudonymised",
    text,
    replacements: [...byValue.values()],
    ruleIds,
  };
}
