import { describe, it, expect } from "vitest";
import { Anonymizer } from "./anonymizer";

describe("Anonymizer.anonymize", () => {
  it("replaces an email with an [EMAIL_xxxx] placeholder", () => {
    const a = new Anonymizer();
    const r = a.anonymize("write to john@gmail.com today");
    expect(r.changed).toBe(true);
    expect(r.text).toMatch(/\[EMAIL_[0-9a-f]{6}\]/);
    expect(r.text).not.toContain("john@gmail.com");
    const placeholder = Object.keys(r.map)[0];
    expect(placeholder).toBeDefined();
    expect(r.map[placeholder!]).toBe("john@gmail.com");
  });

  it("uses the SAME placeholder for the SAME value within a session", () => {
    const a = new Anonymizer();
    const first = a.anonymize("john@gmail.com");
    const second = a.anonymize("again john@gmail.com");
    const p1 = Object.keys(first.map)[0];
    const p2 = Object.keys(second.map)[0];
    expect(p1).toBe(p2);
  });

  it("uses different placeholders for different values", () => {
    const a = new Anonymizer();
    const r = a.anonymize("john@gmail.com and jane@gmail.com");
    const placeholders = Object.keys(r.map);
    expect(placeholders.length).toBe(2);
    expect(placeholders[0]).not.toBe(placeholders[1]);
  });

  it("reports keyword findings but does NOT replace them", () => {
    const a = new Anonymizer();
    const r = a.anonymize("mon salaire est confidentiel");
    expect(r.text).toContain("salaire");
    expect(r.text).toContain("confidentiel");
    const kw = r.findings.filter((f) => f.source === "keyword");
    expect(kw.some((f) => f.label === "salaire")).toBe(true);
    expect(kw.some((f) => f.label === "confidentiel")).toBe(true);
  });

  it("leaves clean text unchanged", () => {
    const a = new Anonymizer();
    const r = a.anonymize("hello world");
    expect(r.changed).toBe(false);
    expect(r.text).toBe("hello world");
    expect(Object.keys(r.map)).toHaveLength(0);
  });

  it("evicts oldest entries past maxMapSize", () => {
    const a = new Anonymizer({ maxMapSize: 2 });
    a.anonymize("a@gmail.com");
    a.anonymize("b@gmail.com");
    a.anonymize("c@gmail.com");
    expect(a.size).toBeLessThanOrEqual(2);
  });
});

describe("Anonymizer.deanonymize", () => {
  it("round-trips anonymize → deanonymize back to the original", () => {
    const a = new Anonymizer();
    const original = "email john@gmail.com and card 4242 4242 4242 4242 end";
    const anon = a.anonymize(original);
    expect(anon.text).not.toContain("john@gmail.com");
    const back = a.deanonymize(anon.text);
    expect(back).toBe(original);
  });

  it("returns text unchanged when no placeholders are present", () => {
    const a = new Anonymizer();
    a.anonymize("john@gmail.com");
    expect(a.deanonymize("nothing here")).toBe("nothing here");
  });

  it("reset() clears the session map", () => {
    const a = new Anonymizer();
    a.anonymize("john@gmail.com");
    expect(a.size).toBeGreaterThan(0);
    a.reset();
    expect(a.size).toBe(0);
  });
});

describe("Anonymizer stream deanonymizer", () => {
  it("reassembles a placeholder split across two chunks", () => {
    const a = new Anonymizer();
    const anon = a.anonymize("contact john@gmail.com now");
    const placeholder = Object.keys(anon.map)[0]!;
    const full = anon.text; // "contact [EMAIL_xxxx] now"

    // Split right in the middle of the placeholder token.
    const splitAt = full.indexOf(placeholder) + Math.floor(placeholder.length / 2);
    const chunk1 = full.slice(0, splitAt);
    const chunk2 = full.slice(splitAt);

    const stream = a.createStreamDeanonymizer();
    let out = stream.push(chunk1);
    out += stream.push(chunk2);
    out += stream.flush();

    expect(out).toBe("contact john@gmail.com now");
    expect(out).not.toContain("[EMAIL");
  });

  it("handles a placeholder arriving fully within one chunk", () => {
    const a = new Anonymizer();
    const anon = a.anonymize("hi jane@gmail.com bye");
    const stream = a.createStreamDeanonymizer();
    let out = stream.push(anon.text);
    out += stream.flush();
    expect(out).toBe("hi jane@gmail.com bye");
  });

  it("streams text with no placeholders verbatim", () => {
    const a = new Anonymizer();
    const stream = a.createStreamDeanonymizer();
    let out = stream.push("plain ");
    out += stream.push("text");
    out += stream.flush();
    expect(out).toBe("plain text");
  });
});
