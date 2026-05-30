import { describe, it, expect } from "vitest";
import { compileRules } from "./compile";
import { evaluate } from "./engine";
import type { ParsedRulesDoc } from "./types";

function rules(doc: Partial<ParsedRulesDoc>): ReturnType<typeof compileRules> {
  return compileRules({ version: 1, rules: [], ...doc });
}

describe("evaluate — words", () => {
  const r = rules({
    rules: [{ id: "codename", kind: "words", action: "anonymize", placeholder: "CN", words: ["Bluebird", "Project Falcon"] }],
  });

  it("matches case-insensitively", () => {
    const res = evaluate("the bluebird and BLUEBIRD fly", r);
    expect(res.findings).toHaveLength(2);
    expect(res.decision).toBe("anonymize");
  });

  it("respects word boundaries (no match inside a larger word)", () => {
    const res = evaluate("Bluebirds are plural", r);
    expect(res.findings).toHaveLength(0);
  });

  it("matches multi-word phrases", () => {
    const res = evaluate("ship Project Falcon now", r);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]!.placeholderLabel).toBe("CN");
  });
});

describe("evaluate — regex", () => {
  it("matches all occurrences of a user pattern", () => {
    const r = rules({
      rules: [{ id: "emp", kind: "regex", action: "anonymize", placeholder: "EMPID", pattern: "EMP-\\d{5}" }],
    });
    const res = evaluate("EMP-12345 and EMP-67890", r);
    expect(res.findings).toHaveLength(2);
  });
});

describe("evaluate — combination", () => {
  const r = rules({
    rules: [
      {
        id: "salary",
        kind: "combination",
        action: "warn",
        all: [
          { kind: "words", words: ["salaire"] },
          { kind: "regex", pattern: "\\d+\\s?k€" },
        ],
      },
    ],
  });

  it("fires only when ALL conditions are present", () => {
    expect(evaluate("le salaire est 45 k€", r).decision).toBe("warn");
  });

  it("does not fire when a condition is missing", () => {
    expect(evaluate("le salaire est élevé", r).findings).toHaveLength(0);
    expect(evaluate("budget de 45 k€", r).findings).toHaveLength(0);
  });
});

describe("evaluate — whitelist", () => {
  it("suppresses a finding overlapping a whitelisted value", () => {
    const r = rules({
      whitelist: ["safe@acme.com"],
      rules: [{ id: "email", kind: "regex", action: "anonymize", placeholder: "EMAIL", pattern: "[\\w.]+@[\\w.]+" }],
    });
    const res = evaluate("contact safe@acme.com please", r);
    expect(res.findings).toHaveLength(0);
  });

  it("keeps non-whitelisted matches", () => {
    const r = rules({
      whitelist: ["safe@acme.com"],
      rules: [{ id: "email", kind: "regex", action: "anonymize", placeholder: "EMAIL", pattern: "[\\w.]+@[\\w.]+" }],
    });
    const res = evaluate("safe@acme.com and other@evil.com", r);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]!.value).toBe("other@evil.com");
  });
});

describe("evaluate — blacklist", () => {
  it("always flags blacklisted values with its action", () => {
    const r = rules({ blacklist: { action: "block", severity: "critical", values: ["Project Titan"] } });
    const res = evaluate("we discussed Project Titan today", r);
    expect(res.decision).toBe("block");
    expect(res.maxSeverity).toBe("critical");
  });
});

describe("evaluate — action precedence", () => {
  const r = rules({
    rules: [
      { id: "w", kind: "words", action: "warn", words: ["alpha"] },
      { id: "a", kind: "words", action: "anonymize", placeholder: "A", words: ["bravo"] },
      { id: "b", kind: "words", action: "block", words: ["charlie"] },
    ],
  });

  it("block beats anonymize beats warn", () => {
    expect(evaluate("alpha bravo charlie", r).decision).toBe("block");
    expect(evaluate("alpha bravo", r).decision).toBe("anonymize");
    expect(evaluate("alpha only", r).decision).toBe("warn");
  });
});

describe("evaluate — overlap resolution", () => {
  it("keeps the single longest span when rules overlap", () => {
    const r = rules({
      rules: [
        { id: "long", kind: "regex", action: "anonymize", placeholder: "L", pattern: "abc def" },
        { id: "short", kind: "regex", action: "anonymize", placeholder: "S", pattern: "abc" },
      ],
    });
    const res = evaluate("abc def", r);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]!.value).toBe("abc def");
  });
});

describe("evaluate — severity is independent of action", () => {
  it("reports critical severity even when decision is warn", () => {
    const r = rules({
      rules: [{ id: "w", kind: "words", action: "warn", severity: "critical", words: ["nuclear"] }],
    });
    const res = evaluate("the nuclear option", r);
    expect(res.decision).toBe("warn");
    expect(res.maxSeverity).toBe("critical");
  });
});

describe("evaluate — empty", () => {
  it("returns no decision for clean text", () => {
    const r = rules({ rules: [{ id: "x", kind: "words", action: "warn", words: ["secret"] }] });
    expect(evaluate("nothing to see", r)).toEqual({ findings: [], decision: null, maxSeverity: null });
  });
});

describe("evaluate — built-in validated matchers", () => {
  it("flags a Luhn-valid card and rejects an invalid one", () => {
    const r = rules({});
    expect(evaluate("card 4242 4242 4242 4242", r).findings.length).toBeGreaterThan(0);
    expect(evaluate("num 4242 4242 4242 4243", r).findings).toHaveLength(0);
  });
});
