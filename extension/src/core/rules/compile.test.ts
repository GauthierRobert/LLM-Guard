import { describe, it, expect } from "vitest";
import { compileRules, CompileError, escapeRegExp } from "./compile";
import { evaluate } from "./engine";

describe("compileRules", () => {
  it("applies defaults when a rule omits action/severity", () => {
    const r = compileRules({
      version: 1,
      defaults: { action: "block", severity: "high" },
      rules: [{ id: "x", kind: "words", words: ["secret"] }],
    });
    const res = evaluate("a secret here", r);
    expect(res.decision).toBe("block");
    expect(res.maxSeverity).toBe("high");
  });

  it("derives a placeholder label from the id when none is given", () => {
    const r = compileRules({
      version: 1,
      rules: [{ id: "client names", kind: "words", action: "anonymize", words: ["acme"] }],
    });
    const res = evaluate("hello acme", r);
    expect(res.findings[0]!.placeholderLabel).toBe("CLIENT_NAMES");
  });

  it("throws a CompileError for an invalid regex", () => {
    expect(() =>
      compileRules({
        version: 1,
        rules: [{ id: "bad", kind: "regex", action: "warn", pattern: "(" }],
      }),
    ).toThrow(CompileError);
  });

  it("escapeRegExp neutralises regex metacharacters", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
  });
});
