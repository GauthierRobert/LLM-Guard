import {
  type AnonymizeResult,
  type Finding,
  type IAnonymizer,
  type StreamDeanonymizer,
} from "@/shared/types";
import { collectMatches } from "./match";
import { scanKeywords } from "./keywords";

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
 * Reversible, session-scoped anonymizer. Replaces PII spans with stable
 * `[TYPE_xxxx]` placeholders and can restore them — including across streamed
 * response chunks.
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

  anonymize(text: string): AnonymizeResult {
    const matches = collectMatches(text);
    const findings: Finding[] = [];
    const map: Record<string, string> = {};

    // Rebuild the string by walking the non-overlapping spans left to right.
    let out = "";
    let cursor = 0;
    for (const m of matches) {
      let placeholder = this.rev.get(m.value);
      if (!placeholder) {
        placeholder = this.mint(m.pattern.type, m.value);
        this.store(placeholder, m.value);
      }
      out += text.slice(cursor, m.start) + placeholder;
      cursor = m.end;
      map[placeholder] = m.value;
      findings.push({
        type: m.pattern.type,
        label: m.pattern.label,
        value: m.value,
        severity: m.pattern.severity,
        start: m.start,
        end: m.end,
        source: "regex",
      });
    }
    out += text.slice(cursor);

    // Keywords are reported but not replaced (no reversible placeholder).
    for (const kf of scanKeywords(text)) findings.push(kf);

    return { text: out, findings, map, changed: matches.length > 0 };
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

  createStreamDeanonymizer(): StreamDeanonymizer {
    let carry = "";
    const deanon = (s: string) => this.deanonymize(s);
    return {
      push(chunk: string): string {
        carry += chunk;
        // Hold back from the last unterminated '[' so a placeholder is never
        // split across emitted chunks.
        const lastOpen = carry.lastIndexOf("[");
        let cut = carry.length;
        if (lastOpen !== -1 && carry.indexOf("]", lastOpen) === -1) {
          cut = lastOpen;
        }
        const emit = carry.slice(0, cut);
        carry = carry.slice(cut);
        return deanon(emit);
      },
      flush(): string {
        const out = deanon(carry);
        carry = "";
        return out;
      },
    };
  }

  reset(): void {
    this.fwd.clear();
    this.rev.clear();
  }

  private mint(type: string, value: string): string {
    const base = fnv1a6(this.salt + ":" + value);
    let placeholder = `[${type}_${base}]`;
    let n = 2;
    while (this.fwd.has(placeholder) && this.fwd.get(placeholder) !== value) {
      placeholder = `[${type}_${base}_${n}]`;
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
