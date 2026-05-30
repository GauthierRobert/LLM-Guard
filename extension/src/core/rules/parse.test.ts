import { describe, it, expect } from "vitest";
import { parseRulesYaml } from "./parse";
import { DEFAULT_RULES_YAML, getDefaultCompiledRules } from "./defaults";

describe("parseRulesYaml", () => {
  it("parses a valid document", () => {
    const res = parseRulesYaml(`
version: 1
rules:
  - id: email
    kind: regex
    action: anonymize
    pattern: "\\\\w+@\\\\w+"
`);
    expect(res.ok).toBe(true);
  });

  it("returns errors (no throw) for malformed YAML", () => {
    const res = parseRulesYaml("rules: [unclosed");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/YAML syntax/i);
  });

  it("rejects an empty document", () => {
    const res = parseRulesYaml("");
    expect(res.ok).toBe(false);
  });

  it("flags a missing rule id", () => {
    const res = parseRulesYaml(`
rules:
  - kind: words
    words: ["x"]
`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => /id/.test(e))).toBe(true);
  });

  it("flags an unknown kind", () => {
    const res = parseRulesYaml(`
rules:
  - id: bad
    kind: magic
`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => /kind/.test(e))).toBe(true);
  });

  it("flags a words rule with no words", () => {
    const res = parseRulesYaml(`
rules:
  - id: empty
    kind: words
`);
    expect(res.ok).toBe(false);
  });

  it("flags an invalid action enum", () => {
    const res = parseRulesYaml(`
rules:
  - id: x
    kind: words
    words: ["a"]
    action: destroy
`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => /action/.test(e))).toBe(true);
  });

  it("flags duplicate rule ids", () => {
    const res = parseRulesYaml(`
rules:
  - id: dup
    kind: words
    words: ["a"]
  - id: dup
    kind: words
    words: ["b"]
`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => /Duplicate/.test(e))).toBe(true);
  });

  it("flags a combination with fewer than 2 conditions", () => {
    const res = parseRulesYaml(`
rules:
  - id: combo
    kind: combination
    all:
      - kind: words
        words: ["only"]
`);
    expect(res.ok).toBe(false);
  });
});

describe("bundled default rules", () => {
  it("are valid and compile without error", () => {
    const parsed = parseRulesYaml(DEFAULT_RULES_YAML);
    expect(parsed.ok).toBe(true);
    expect(() => getDefaultCompiledRules()).not.toThrow();
  });
});
