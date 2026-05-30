/** Anything with a span and a tie-break priority can be overlap-resolved. */
export interface Span {
  start: number;
  end: number;
  /** Lower number wins ties (earlier-declared pattern/rule). */
  priority: number;
}

/**
 * Resolve overlapping spans into a single non-overlapping set. Sort by start
 * ascending, then longer span first, then higher priority (lower number), then
 * greedily sweep keeping any span that starts at/after the last kept end.
 * Many rules can match the same characters (e.g. a French and an international
 * phone number) — without resolution this produces duplicate / nested
 * placeholders. Used by the YAML rules engine.
 */
export function resolveOverlaps<T extends Span>(raw: T[]): T[] {
  const sorted = [...raw].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    return a.priority - b.priority;
  });

  const selected: T[] = [];
  let lastEnd = -1;
  for (const r of sorted) {
    if (r.start >= lastEnd) {
      selected.push(r);
      lastEnd = r.end;
    }
  }
  return selected;
}
