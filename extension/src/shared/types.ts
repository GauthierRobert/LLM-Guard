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

/**
 * A single PII detection rule (Layer 1, regex based).
 * `regex` MUST carry the global flag so the engine can iterate all matches.
 */
export interface PIIPattern {
  /** Stable machine id, used in placeholders, e.g. "EMAIL". */
  type: string;
  /** Human-friendly label, e.g. "Email". */
  label: string;
  /** Global regex. */
  regex: RegExp;
  severity: Severity;
  /**
   * Optional validator run on each raw match. Return false to reject the
   * match (e.g. Luhn check for cards, RFC-2606 reserved emails).
   */
  validate?: (match: string) => boolean;
}

/** One concrete piece of detected sensitive data. */
export interface Finding {
  /** Pattern/category type, e.g. "EMAIL", "KEYWORD". */
  type: string;
  /** Human label of the rule that fired. */
  label: string;
  /** The matched substring (the sensitive value itself). */
  value: string;
  severity: Severity;
  /** Where it matched, if known. */
  start?: number;
  end?: number;
  source: "regex" | "keyword";
}

/** Result of scanning text without mutating it. */
export interface ScanResult {
  findings: Finding[];
  maxSeverity: Severity | null;
  hasCritical: boolean;
}

/** Result of anonymizing text. */
export interface AnonymizeResult {
  /** Text with sensitive values replaced by `[TYPE_xxxx]` placeholders. */
  text: string;
  findings: Finding[];
  /** Placeholder → original value, for this call (subset of session map). */
  map: Record<string, string>;
  /** True when at least one replacement happened. */
  changed: boolean;
}

/** Streaming de-anonymizer that is safe across chunk boundaries. */
export interface StreamDeanonymizer {
  /** Feed a chunk; returns text safe to emit now (may hold back a tail). */
  push(chunk: string): string;
  /** Flush any held-back tail at end of stream. */
  flush(): string;
}

/** The reversible anonymization engine (session-scoped). */
export interface IAnonymizer {
  anonymize(text: string): AnonymizeResult;
  deanonymize(text: string): string;
  createStreamDeanonymizer(): StreamDeanonymizer;
  /** Current placeholder→original map size (for tests/diagnostics). */
  readonly size: number;
  reset(): void;
}
