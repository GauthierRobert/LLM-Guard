import { describe, it, expect } from "vitest";
import {
  addBlacklistValue,
  addWhitelistValue,
  buildImportedYaml,
  extractRuleObject,
  removeBlacklistValue,
  removeWhitelistValue,
  setRuleEnabled,
  upsertRules,
} from "./edit";
import { parseRulesYaml } from "./parse";

const SAMPLE = `# Top comment must survive
version: 6
whitelist:
  - "example.com" # inline comment
blacklist:
  action: anonymize
  severity: critical
  placeholder: MATTER
  values: []
rules:
  - id: email
    description: Email address
    kind: regex
    action: anonymize
    pattern: "a@b"
  - id: phone
    description: Phone
    kind: regex
    action: warn
    pattern: "\\\\d+"
`;

function parse(yaml: string) {
  const res = parseRulesYaml(yaml);
  if (!res.ok) throw new Error(res.errors.join("; "));
  return res.doc;
}

describe("setRuleEnabled", () => {
  it("disables a rule by writing enabled: false", () => {
    const out = setRuleEnabled(SAMPLE, "email", false);
    const rule = parse(out).rules.find((r) => r.id === "email");
    expect(rule?.enabled).toBe(false);
  });

  it("re-enabling removes the enabled key", () => {
    const off = setRuleEnabled(SAMPLE, "email", false);
    const on = setRuleEnabled(off, "email", true);
    const rule = parse(on).rules.find((r) => r.id === "email");
    expect(rule?.enabled).toBeUndefined();
  });

  it("leaves the document untouched for an unknown id", () => {
    expect(setRuleEnabled(SAMPLE, "nope", false)).toBe(SAMPLE);
  });

  it("preserves the top comment", () => {
    expect(setRuleEnabled(SAMPLE, "phone", false)).toContain("# Top comment must survive");
  });
});

describe("whitelist", () => {
  it("adds a value", () => {
    const out = addWhitelistValue(SAMPLE, "test@example.org");
    expect(parse(out).whitelist).toContain("test@example.org");
  });

  it("ignores a case-insensitive duplicate", () => {
    const out = addWhitelistValue(SAMPLE, "EXAMPLE.COM");
    expect(parse(out).whitelist?.filter((v) => v.toLowerCase() === "example.com")).toHaveLength(1);
  });

  it("removes a value", () => {
    const out = removeWhitelistValue(SAMPLE, "example.com");
    expect(parse(out).whitelist ?? []).not.toContain("example.com");
  });
});

describe("blacklist", () => {
  it("adds the first value to an empty list and keeps it a valid array", () => {
    const out = addBlacklistValue(SAMPLE, "Project Titan");
    const doc = parse(out);
    expect(doc.blacklist?.values).toEqual(["Project Titan"]);
  });

  it("adds a second value", () => {
    const out = addBlacklistValue(addBlacklistValue(SAMPLE, "Alpha"), "Beta");
    expect(parse(out).blacklist?.values).toEqual(["Alpha", "Beta"]);
  });

  it("removing the last value restores an empty array (not null)", () => {
    const withOne = addBlacklistValue(SAMPLE, "Solo");
    const empty = removeBlacklistValue(withOne, "Solo");
    const doc = parse(empty);
    expect(Array.isArray(doc.blacklist?.values)).toBe(true);
    expect(doc.blacklist?.values).toHaveLength(0);
  });

  it("creates a blacklist when none exists", () => {
    const out = addBlacklistValue("version: 1\nrules: []\n", "Acme");
    expect(parse(out).blacklist?.values).toEqual(["Acme"]);
  });
});

describe("upsertRules", () => {
  it("replaces an existing rule by id, keeping the others and the comment", () => {
    const out = upsertRules(SAMPLE, [
      { id: "email", description: "Email", kind: "regex", action: "warn", pattern: "x@y" },
    ]);
    const doc = parse(out);
    expect(doc.rules).toHaveLength(2);
    const email = doc.rules.find((r) => r.id === "email");
    expect(email?.action).toBe("warn");
    expect(out).toContain("# Top comment must survive");
  });

  it("appends a new rule", () => {
    const out = upsertRules(SAMPLE, [
      { id: "ssn", kind: "words", action: "block", words: ["secret"] },
    ]);
    const doc = parse(out);
    expect(doc.rules.map((r) => r.id)).toContain("ssn");
    expect(doc.rules).toHaveLength(3);
  });
});

describe("extractRuleObject", () => {
  it("returns the rule as a plain object", () => {
    expect(extractRuleObject(SAMPLE, "phone")).toMatchObject({ id: "phone", action: "warn" });
  });

  it("returns null for an unknown id", () => {
    expect(extractRuleObject(SAMPLE, "nope")).toBeNull();
  });
});

describe("buildImportedYaml", () => {
  it("merges a single pasted rule by id", () => {
    const pasted = `- id: email
  kind: regex
  action: block
  pattern: "a@b"`;
    const res = buildImportedYaml(SAMPLE, pasted);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mode).toBe("merge");
      expect(parse(res.yaml).rules.find((r) => r.id === "email")?.action).toBe("block");
    }
  });

  it("merges a single rule given as a bare mapping", () => {
    const pasted = `id: phone
kind: regex
action: block
pattern: "x"`;
    const res = buildImportedYaml(SAMPLE, pasted);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mode).toBe("merge");
  });

  it("treats a full document as a wholesale replace", () => {
    const full = `version: 2
rules:
  - id: only
    kind: words
    words: ["x"]`;
    const res = buildImportedYaml(SAMPLE, full);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mode).toBe("replace");
      expect(parse(res.yaml).rules).toHaveLength(1);
    }
  });

  it("rejects text that is neither a rule nor a document", () => {
    const res = buildImportedYaml(SAMPLE, "just some prose without an id");
    expect(res.ok).toBe(false);
  });

  it("rejects invalid YAML", () => {
    const res = buildImportedYaml(SAMPLE, "rules: [unclosed");
    expect(res.ok).toBe(false);
  });

  it("rejects an empty paste", () => {
    expect(buildImportedYaml(SAMPLE, "   ").ok).toBe(false);
  });
});
