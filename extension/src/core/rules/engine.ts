/**
 * Rules engine. Evaluate a prompt against compiled rules and return the
 * non-overlapping findings plus the per-request decision.
 *
 * Pipeline: whitelist spans → candidate spans (words/regex/combination) →
 * drop whitelisted → resolve overlaps → map to findings → decide.
 */

import { maxSeverity, type Severity } from "@/shared/types";
import { resolveOverlaps, type Span } from "@/core/match";
import { maxAction, type CompiledRules, type EvaluateResult, type RuleFinding } from "./types";

interface Candidate extends Span {
  value: string;
  ruleId: string;
  action: RuleFinding["action"];
  severity: Severity;
  placeholder: string;
}

/** Collect all non-zero-width matches of one global regex. */
function scanRegex(text: string, re: RegExp): Array<{ start: number; end: number; value: string }> {
  const hits: Array<{ start: number; end: number; value: string }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    if (value.length === 0) {
      re.lastIndex++;
      continue;
    }
    hits.push({ start: m.index, end: m.index + value.length, value });
  }
  return hits;
}

function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function evaluate(text: string, rules: CompiledRules): EvaluateResult {
  if (!text) return { findings: [], decision: null, maxSeverity: null };

  // 1. Whitelist spans (never flagged).
  const whitelistSpans: Array<{ start: number; end: number }> = [];
  for (const re of rules.whitelist) {
    for (const h of scanRegex(text, re)) whitelistSpans.push(h);
  }

  // 2. Candidate spans. Priority = matcher index (built-ins first).
  const candidates: Candidate[] = [];
  rules.matchers.forEach((matcher, priority) => {
    if (matcher.kind === "combination") {
      const conditions = matcher.conditions ?? [];
      const perCondition = conditions.map((alts) =>
        alts.flatMap((re) => scanRegex(text, re)),
      );
      // Fire only if EVERY sub-condition matched at least once.
      if (perCondition.some((spans) => spans.length === 0)) return;
      for (const spans of perCondition) {
        for (const h of spans) {
          candidates.push({ ...h, priority, ruleId: matcher.ruleId, action: matcher.action, severity: matcher.severity, placeholder: matcher.placeholder });
        }
      }
      return;
    }

    for (const re of matcher.regexes) {
      for (const h of scanRegex(text, re)) {
        if (matcher.validate && !matcher.validate(h.value)) continue;
        candidates.push({ ...h, priority, ruleId: matcher.ruleId, action: matcher.action, severity: matcher.severity, placeholder: matcher.placeholder });
      }
    }
  });

  // 3. Drop candidates overlapping any whitelist span.
  const kept =
    whitelistSpans.length === 0
      ? candidates
      : candidates.filter((c) => !whitelistSpans.some((w) => spansOverlap(c, w)));

  // 4. Resolve overlaps into one non-overlapping set.
  const resolved = resolveOverlaps(kept);

  // 5. Map to findings (sorted by start) and 6. decide.
  const findings: RuleFinding[] = resolved
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      ruleId: c.ruleId,
      start: c.start,
      end: c.end,
      value: c.value,
      action: c.action,
      severity: c.severity,
      ...(c.action === "anonymize" ? { placeholderLabel: c.placeholder } : {}),
    }));

  let decision: RuleFinding["action"] | null = null;
  let maxSev: Severity | null = null;
  for (const f of findings) {
    decision = maxAction(decision, f.action);
    maxSev = maxSeverity(maxSev, f.severity);
  }

  return { findings, decision, maxSeverity: maxSev };
}
