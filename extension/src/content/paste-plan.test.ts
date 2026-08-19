import { describe, it, expect, beforeEach } from "vitest";
import { compileRules } from "@/core/rules/compile";
import { evaluate } from "@/core/rules/engine";
import type { ParsedRule, ParsedRulesDoc } from "@/core/rules/types";
import { Anonymizer } from "@/core/anonymizer";
import { planPaste } from "./paste-plan";

function rules(doc: Partial<ParsedRulesDoc>): ReturnType<typeof compileRules> {
  return compileRules({ version: 1, rules: [], ...doc });
}

const EMAIL_RULE: ParsedRule = {
  id: "email",
  kind: "regex",
  action: "anonymize",
  placeholder: "EMAIL",
  pattern: "[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}",
};

const CODENAME_WARN: ParsedRule = {
  id: "codename",
  kind: "words",
  action: "warn",
  words: ["Bluebird"],
};

const SECRET_BLOCK: ParsedRule = {
  id: "secret",
  kind: "words",
  action: "block",
  words: ["Project Titan"],
};

let anonymizer: Anonymizer;

beforeEach(() => {
  anonymizer = new Anonymizer();
});

function plan(text: string, doc: Partial<ParsedRulesDoc>) {
  const compiled = rules(doc);
  return planPaste(text, evaluate(text, compiled), anonymizer);
}

describe("planPaste — nothing to do", () => {
  it("leaves clean text exactly as pasted", () => {
    const p = plan("just a normal sentence", { rules: [EMAIL_RULE] });
    expect(p.outcome).toBe("clean");
    expect(p.text).toBe("just a normal sentence");
    expect(p.replacements).toEqual([]);
    expect(p.ruleIds).toEqual([]);
  });
});

describe("planPaste — pseudonymise", () => {
  it("replaces the detected value with a placeholder", () => {
    const p = plan("write to john@acme.com today", { rules: [EMAIL_RULE] });
    expect(p.outcome).toBe("pseudonymised");
    expect(p.text).not.toContain("john@acme.com");
    expect(p.text).toMatch(/^write to \[EMAIL_[0-9a-f]{6}\] today$/);
    expect(p.original).toBe("write to john@acme.com today");
  });

  it("reports each replaced value once, with its occurrence count", () => {
    const p = plan("a@x.com then b@x.com then a@x.com", { rules: [EMAIL_RULE] });
    expect(p.replacements).toHaveLength(2);
    const a = p.replacements.find((r) => r.value === "a@x.com")!;
    expect(a.count).toBe(2);
    expect(a.label).toBe("EMAIL");
    expect(a.placeholder).toMatch(/^\[EMAIL_[0-9a-f]{6}\]$/);
    // The placeholder reported is the one actually written into the text.
    expect(p.text).toContain(a.placeholder);
  });

  it("keeps the same placeholder for the same value across pastes", () => {
    const first = plan("mail john@acme.com", { rules: [EMAIL_RULE] });
    const second = plan("again john@acme.com", { rules: [EMAIL_RULE] });
    expect(second.replacements[0]!.placeholder).toBe(first.replacements[0]!.placeholder);
  });

  it("feeds the anonymizer map so the manual reveal still works", () => {
    const p = plan("mail john@acme.com", { rules: [EMAIL_RULE] });
    const map = anonymizer.exportMap();
    expect(map[p.replacements[0]!.placeholder]).toBe("john@acme.com");
    expect(anonymizer.deanonymize(p.text)).toBe("mail john@acme.com");
  });
});

describe("planPaste — warn", () => {
  it("pastes the original text unchanged and names the rule", () => {
    const p = plan("the Bluebird flies", { rules: [CODENAME_WARN] });
    expect(p.outcome).toBe("warned");
    expect(p.text).toBe("the Bluebird flies");
    expect(p.ruleIds).toEqual(["codename"]);
    expect(p.replacements).toEqual([]);
  });
});

describe("planPaste — block", () => {
  it("inserts nothing at all", () => {
    const p = plan("about Project Titan", { rules: [SECRET_BLOCK] });
    expect(p.outcome).toBe("blocked");
    expect(p.text).toBe("");
    expect(p.original).toBe("about Project Titan");
    expect(p.ruleIds).toEqual(["secret"]);
  });

  it("wins over an anonymize match in the same paste", () => {
    const p = plan("Project Titan — john@acme.com", { rules: [EMAIL_RULE, SECRET_BLOCK] });
    expect(p.outcome).toBe("blocked");
    expect(p.text).toBe("");
    // Nothing was minted: a blocked paste must not pollute the reveal map.
    expect(anonymizer.size).toBe(0);
  });
});

describe("planPaste — mixed actions", () => {
  it("pseudonymises the anonymize spans and still reports the warn rule", () => {
    const p = plan("Bluebird — john@acme.com", { rules: [EMAIL_RULE, CODENAME_WARN] });
    expect(p.outcome).toBe("pseudonymised");
    expect(p.text).toContain("Bluebird");
    expect(p.text).not.toContain("john@acme.com");
    expect(p.ruleIds).toContain("codename");
    expect(p.ruleIds).toContain("email");
  });
});
