/**
 * Merge NER entities into an existing (regex/YAML) evaluation result.
 *
 * Pure and synchronous — no model, no DOM — so it is fully unit-testable. The
 * model call happens elsewhere (engine/host); this just decides how its output
 * combines with the rules engine output.
 *
 * Policy:
 *   - drop entities whose group is disabled or below its confidence threshold
 *   - drop entities overlapping a whitelist span (never flag) or ANY existing
 *     regex finding (regex is exact and validated — it wins every overlap)
 *   - resolve overlaps among the surviving entities (higher score wins)
 *   - recompute the per-request decision + max severity over the union
 */

import { maxSeverity, type Severity } from "@/shared/types";
import { resolveOverlaps, type Span } from "@/core/match";
import { maxAction, type EvaluateResult, type RuleAction, type RuleFinding } from "@/core/rules/types";
import type { NerConfig, NerEntity } from "./types";

interface NerCandidate extends Span {
  value: string;
  ruleId: string;
  action: RuleAction;
  severity: Severity;
  placeholder: string;
}

function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Collect non-zero-width matches of one global regex (whitelist scan). */
function scanRegex(text: string, re: RegExp): Array<{ start: number; end: number }> {
  const hits: Array<{ start: number; end: number }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    hits.push({ start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

/**
 * Combine NER entities with a base (regex) result into one EvaluateResult.
 * Returns `base` untouched when NER is disabled or contributes nothing.
 */
export function mergeNerFindings(
  text: string,
  base: EvaluateResult,
  entities: NerEntity[],
  cfg: NerConfig,
  whitelist: RegExp[] = [],
): EvaluateResult {
  if (!cfg.enabled || entities.length === 0) return base;

  const whitelistSpans: Array<{ start: number; end: number }> = [];
  for (const re of whitelist) whitelistSpans.push(...scanRegex(text, re));

  // Entity → candidate, filtered by per-group policy + confidence.
  const candidates: NerCandidate[] = [];
  for (const e of entities) {
    const setting = cfg.entities[e.entity];
    if (!setting || !setting.enabled) continue;
    if (e.score < setting.threshold) continue;
    if (e.end <= e.start || e.end > text.length) continue;
    candidates.push({
      start: e.start,
      end: e.end,
      // Higher score → lower number → wins resolveOverlaps ties.
      priority: Math.round((1 - Math.max(0, Math.min(1, e.score))) * 1000),
      value: e.value,
      ruleId: `ner:${e.entity}`,
      action: setting.action,
      severity: setting.severity,
      placeholder: setting.label,
    });
  }

  // Regex is exact and validated: drop any NER candidate that overlaps a kept
  // regex finding or a whitelist span.
  const kept = candidates.filter(
    (c) =>
      !base.findings.some((f) => spansOverlap(c, f)) &&
      !whitelistSpans.some((w) => spansOverlap(c, w)),
  );
  if (kept.length === 0) return base;

  const resolved = resolveOverlaps(kept);

  const nerFindings: RuleFinding[] = resolved.map((c) => ({
    ruleId: c.ruleId,
    start: c.start,
    end: c.end,
    value: c.value,
    action: c.action,
    severity: c.severity,
    ...(c.action === "anonymize" ? { placeholderLabel: c.placeholder } : {}),
  }));

  const findings = [...base.findings, ...nerFindings].sort((a, b) => a.start - b.start);

  let decision: RuleAction | null = null;
  let maxSev: Severity | null = null;
  for (const f of findings) {
    decision = maxAction(decision, f.action);
    maxSev = maxSeverity(maxSev, f.severity);
  }

  return { findings, decision, maxSeverity: maxSev };
}
