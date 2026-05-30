/**
 * Shared domain types — the contract between the detection core, the LLM
 * adapters, the content scripts and the UI. Treat this file as stable: the
 * parallel modules all import from here.
 */

export type Severity = "low" | "medium" | "high" | "critical";

/** Ascending severity rank — higher number = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Returns the most severe of two severities. */
export function maxSeverity(a: Severity | null, b: Severity | null): Severity | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** A span the caller wants replaced with a reversible placeholder. */
export interface AnonymizeSpan {
  start: number;
  end: number;
  /** The sensitive value occupying [start, end). */
  value: string;
  /** Placeholder label, e.g. "EMAIL" → `[EMAIL_xxxx]`. */
  label: string;
}

/** The reversible anonymization engine (session-scoped). */
export interface IAnonymizer {
  /**
   * Replace the given non-overlapping spans with stable `[LABEL_xxxx]`
   * placeholders and return the rewritten text. The placeholder→value map is
   * retained so values can be restored on demand.
   */
  anonymizeSpans(text: string, spans: AnonymizeSpan[]): string;
  /** Restore every known placeholder in `text` back to its original value. */
  deanonymize(text: string): string;
  /** Snapshot of placeholder → original value (for the manual reveal feature). */
  exportMap(): Record<string, string>;
  /** Current placeholder→original map size (for tests/diagnostics). */
  readonly size: number;
  reset(): void;
}
