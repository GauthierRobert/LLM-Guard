import type { PIIPattern } from "@/shared/types";
import { PII_PATTERNS } from "./pii-patterns";

/** A regex match selected after overlap resolution. */
export interface SelectedMatch {
  pattern: PIIPattern;
  value: string;
  start: number;
  end: number;
}

/**
 * Run every PII pattern over `text`, validate each hit, then resolve
 * overlapping spans into a single non-overlapping set. Many patterns can match
 * the same characters (e.g. a French and an international phone number, or a
 * card number and a numeric id) — without resolution this produces duplicate /
 * nested placeholders. Resolution rule: scan left-to-right, and when spans
 * overlap keep the LONGER one, breaking ties by pattern priority (earlier in
 * `PII_PATTERNS` wins). Returns matches sorted by start offset, ascending.
 */
export function collectMatches(text: string): SelectedMatch[] {
  const raw: Array<SelectedMatch & { priority: number }> = [];

  PII_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      const value = m[0];
      // Guard against zero-width matches looping forever.
      if (value.length === 0) {
        pattern.regex.lastIndex++;
        continue;
      }
      if (pattern.validate && !pattern.validate(value)) continue;
      raw.push({
        pattern,
        value,
        start: m.index,
        end: m.index + value.length,
        priority,
      });
    }
  });

  // Order so the greedy sweep prefers earlier start, then longer span, then
  // higher-priority pattern.
  raw.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    return a.priority - b.priority;
  });

  const selected: SelectedMatch[] = [];
  let lastEnd = -1;
  for (const r of raw) {
    if (r.start >= lastEnd) {
      selected.push({ pattern: r.pattern, value: r.value, start: r.start, end: r.end });
      lastEnd = r.end;
    }
  }
  return selected;
}
