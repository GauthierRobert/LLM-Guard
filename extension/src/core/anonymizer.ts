import { type AnonymizeSpan, type IAnonymizer } from "@/shared/types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit hash → 6 hex chars. */
function fnv1a6(input: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Reversible, session-scoped anonymizer. Replaces caller-provided spans with
 * stable `[LABEL_xxxx]` placeholders and retains a placeholder→value map so the
 * real values can be restored on demand (manual reveal). The same value always
 * maps to the same placeholder within a session.
 */
export class Anonymizer implements IAnonymizer {
  private readonly maxMapSize: number;
  private readonly salt: string;
  private fwd = new Map<string, string>(); // placeholder -> original
  private rev = new Map<string, string>(); // original -> placeholder

  constructor(opts?: { maxMapSize?: number }) {
    this.maxMapSize = opts?.maxMapSize ?? 5000;
    this.salt = Math.random().toString(36).slice(2, 10);
  }

  get size(): number {
    return this.fwd.size;
  }

  anonymizeSpans(text: string, spans: AnonymizeSpan[]): string {
    if (spans.length === 0) return text;
    // Walk spans left-to-right; they are expected non-overlapping and may be
    // in any order, so sort defensively.
    const ordered = [...spans].sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    for (const span of ordered) {
      if (span.start < cursor) continue; // skip accidental overlaps
      let placeholder = this.rev.get(span.value);
      if (!placeholder) {
        placeholder = this.mint(span.label, span.value);
        this.store(placeholder, span.value);
      }
      out += text.slice(cursor, span.start) + placeholder;
      cursor = span.end;
    }
    out += text.slice(cursor);
    return out;
  }

  deanonymize(text: string): string {
    let out = text;
    // Longest placeholder first so no placeholder is a prefix of another.
    const entries = [...this.fwd.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [placeholder, original] of entries) {
      if (out.includes(placeholder)) out = out.split(placeholder).join(original);
    }
    return out;
  }

  exportMap(): Record<string, string> {
    return Object.fromEntries(this.fwd);
  }

  reset(): void {
    this.fwd.clear();
    this.rev.clear();
  }

  private mint(label: string, value: string): string {
    const base = fnv1a6(this.salt + ":" + value);
    let placeholder = `[${label}_${base}]`;
    let n = 2;
    while (this.fwd.has(placeholder) && this.fwd.get(placeholder) !== value) {
      placeholder = `[${label}_${base}_${n}]`;
      n++;
    }
    return placeholder;
  }

  private store(placeholder: string, original: string): void {
    this.fwd.set(placeholder, original);
    this.rev.set(original, placeholder);
    while (this.fwd.size > this.maxMapSize) {
      const oldest = this.fwd.keys().next().value as string;
      const oldestOriginal = this.fwd.get(oldest);
      this.fwd.delete(oldest);
      if (oldestOriginal !== undefined) this.rev.delete(oldestOriginal);
    }
  }
}
