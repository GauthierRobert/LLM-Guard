import { describe, it, expect } from "vitest";
import { Anonymizer } from "./anonymizer";
import type { AnonymizeSpan } from "@/shared/types";

/** Build spans by locating each value in the text (test helper). */
function spans(text: string, items: Array<{ value: string; label: string }>): AnonymizeSpan[] {
  const out: AnonymizeSpan[] = [];
  for (const { value, label } of items) {
    const start = text.indexOf(value);
    if (start === -1) continue;
    out.push({ start, end: start + value.length, value, label });
  }
  return out;
}

describe("Anonymizer.anonymizeSpans", () => {
  it("replaces a value with a [LABEL_xxxx] placeholder", () => {
    const a = new Anonymizer();
    const text = "write to john@gmail.com today";
    const out = a.anonymizeSpans(text, spans(text, [{ value: "john@gmail.com", label: "EMAIL" }]));
    expect(out).toMatch(/\[EMAIL_[0-9a-f]{6}\]/);
    expect(out).not.toContain("john@gmail.com");
  });

  it("uses the SAME placeholder for the SAME value within a session", () => {
    const a = new Anonymizer();
    const t1 = "john@gmail.com";
    const t2 = "again john@gmail.com";
    const p1 = a.anonymizeSpans(t1, spans(t1, [{ value: "john@gmail.com", label: "EMAIL" }]));
    const p2 = a.anonymizeSpans(t2, spans(t2, [{ value: "john@gmail.com", label: "EMAIL" }]));
    expect(p1).toBe(p2.replace("again ", ""));
  });

  it("uses different placeholders for different values", () => {
    const a = new Anonymizer();
    const text = "john@gmail.com and jane@gmail.com";
    a.anonymizeSpans(
      text,
      spans(text, [
        { value: "john@gmail.com", label: "EMAIL" },
        { value: "jane@gmail.com", label: "EMAIL" },
      ]),
    );
    const map = a.exportMap();
    expect(Object.keys(map)).toHaveLength(2);
  });

  it("leaves clean text unchanged when no spans are given", () => {
    const a = new Anonymizer();
    expect(a.anonymizeSpans("hello world", [])).toBe("hello world");
    expect(a.size).toBe(0);
  });

  it("evicts oldest entries past maxMapSize", () => {
    const a = new Anonymizer({ maxMapSize: 2 });
    for (const v of ["a@x.com", "b@x.com", "c@x.com"]) {
      a.anonymizeSpans(v, spans(v, [{ value: v, label: "EMAIL" }]));
    }
    expect(a.size).toBeLessThanOrEqual(2);
  });

  it("skips overlapping spans defensively", () => {
    const a = new Anonymizer();
    const text = "4242 4242 4242 4242";
    const out = a.anonymizeSpans(text, [
      { start: 0, end: 19, value: text, label: "CARD" },
      { start: 5, end: 9, value: "4242", label: "NUM" }, // overlaps, must be skipped
    ]);
    expect(out).toMatch(/^\[CARD_[0-9a-f]{6}\]$/);
  });
});

describe("Anonymizer.deanonymize", () => {
  it("round-trips anonymize → deanonymize back to the original", () => {
    const a = new Anonymizer();
    const original = "email john@gmail.com and card 4242 end";
    const anon = a.anonymizeSpans(
      original,
      spans(original, [
        { value: "john@gmail.com", label: "EMAIL" },
        { value: "4242", label: "CARD" },
      ]),
    );
    expect(anon).not.toContain("john@gmail.com");
    expect(a.deanonymize(anon)).toBe(original);
  });

  it("restores correctly when one placeholder is a prefix of another", () => {
    const a = new Anonymizer();
    // Force two values; longest-placeholder-first ordering must restore both.
    const text = "x AAAA y BBBBBBBB z";
    const anon = a.anonymizeSpans(
      text,
      spans(text, [
        { value: "AAAA", label: "A" },
        { value: "BBBBBBBB", label: "B" },
      ]),
    );
    expect(a.deanonymize(anon)).toBe(text);
  });

  it("returns text unchanged when no placeholders are present", () => {
    const a = new Anonymizer();
    a.anonymizeSpans("john@gmail.com", spans("john@gmail.com", [{ value: "john@gmail.com", label: "EMAIL" }]));
    expect(a.deanonymize("nothing here")).toBe("nothing here");
  });

  it("exportMap reflects the session map; reset clears it", () => {
    const a = new Anonymizer();
    const t = "john@gmail.com";
    a.anonymizeSpans(t, spans(t, [{ value: t, label: "EMAIL" }]));
    expect(Object.values(a.exportMap())).toContain("john@gmail.com");
    a.reset();
    expect(a.size).toBe(0);
    expect(a.exportMap()).toEqual({});
  });
});
