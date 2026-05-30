import { describe, it, expect } from "vitest";
import { PII_PATTERNS } from "./pii-patterns";

function matchType(text: string, type: string): string[] {
  const p = PII_PATTERNS.find((x) => x.type === type);
  if (!p) throw new Error(`no pattern ${type}`);
  p.regex.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = p.regex.exec(text)) !== null) {
    if (m[0].length === 0) {
      p.regex.lastIndex++;
      continue;
    }
    if (p.validate && !p.validate(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

describe("PII_PATTERNS structure", () => {
  it("all regexes are global", () => {
    for (const p of PII_PATTERNS) {
      expect(p.regex.flags.includes("g")).toBe(true);
    }
  });
  it("orders generic numeric patterns last", () => {
    const types = PII_PATTERNS.map((p) => p.type);
    expect(types.indexOf("EMAIL")).toBeLessThan(types.indexOf("SIREN"));
    expect(types.indexOf("IBAN")).toBeLessThan(types.indexOf("PHONE_INTL"));
    expect(types.indexOf("SIREN")).toBeGreaterThan(types.indexOf("SIRET"));
  });
});

describe("validated patterns", () => {
  it("rejects reserved example emails, keeps real ones", () => {
    expect(matchType("ping me at john@example.com", "EMAIL")).toHaveLength(0);
    expect(matchType("ping me at john@gmail.com", "EMAIL")).toEqual(["john@gmail.com"]);
  });
  it("only matches Luhn-valid cards", () => {
    expect(matchType("4242 4242 4242 4242", "CARD")).toEqual(["4242 4242 4242 4242"]);
    expect(matchType("4242 4242 4242 4243", "CARD")).toHaveLength(0);
  });
  it("only matches valid IPv4", () => {
    expect(matchType("server 192.168.0.1 up", "IP")).toEqual(["192.168.0.1"]);
    expect(matchType("version 1.2.3.999", "IP")).toHaveLength(0);
  });
});

describe("secret patterns", () => {
  it("detects an AWS key", () => {
    expect(matchType("key AKIAIOSFODNN7EXAMPLE here", "AWS_KEY")).toEqual([
      "AKIAIOSFODNN7EXAMPLE",
    ]);
  });
  it("detects a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123";
    expect(matchType(`token=${jwt}`, "JWT")).toEqual([jwt]);
  });
  it("rejects a fake eyJ-prefixed non-JWT", () => {
    // valid shape but header is not parseable JSON with alg
    const fake = "eyJabc.eyJdef.sig";
    expect(matchType(fake, "JWT")).toHaveLength(0);
  });
});
