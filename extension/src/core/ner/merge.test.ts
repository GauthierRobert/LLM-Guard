import { describe, it, expect } from "vitest";
import { mergeNerFindings } from "./merge";
import { DEFAULT_NER_CONFIG, type NerConfig, type NerEntity } from "./types";
import type { EvaluateResult } from "@/core/rules/types";

const cfg: NerConfig = DEFAULT_NER_CONFIG;
// LOC is disabled by default (locations are not pseudonymised); some tests need
// it on to exercise the merge mechanics.
const cfgLoc: NerConfig = {
  ...cfg,
  entities: { ...cfg.entities, LOC: { ...cfg.entities.LOC, enabled: true } },
};

function empty(): EvaluateResult {
  return { findings: [], decision: null, maxSeverity: null };
}

describe("mergeNerFindings", () => {
  const text = "Maître Dupont représente Acme à Lyon.";
  const dupont: NerEntity = { entity: "PER", value: "Dupont", start: 7, end: 13, score: 0.99 };
  const acme: NerEntity = { entity: "ORG", value: "Acme", start: 25, end: 29, score: 0.95 };
  const lyon: NerEntity = { entity: "LOC", value: "Lyon", start: 32, end: 36, score: 0.97 };

  it("returns base untouched when NER is disabled", () => {
    const base = empty();
    const out = mergeNerFindings(text, base, [dupont], { ...cfg, enabled: false });
    expect(out).toBe(base);
  });

  it("returns base untouched when there are no entities", () => {
    const base = empty();
    expect(mergeNerFindings(text, base, [], cfg)).toBe(base);
  });

  it("adds entities as findings and computes the decision", () => {
    const out = mergeNerFindings(text, empty(), [dupont, acme, lyon], cfgLoc);
    expect(out.findings).toHaveLength(3);
    expect(out.decision).toBe("anonymize");
    expect(out.maxSeverity).toBe("high"); // PER is high
    expect(out.findings.map((f) => f.ruleId)).toEqual(["ner:PER", "ner:ORG", "ner:LOC"]);
    // anonymize findings carry a placeholder label
    expect(out.findings[0].placeholderLabel).toBe("PERSON");
  });

  it("does NOT detect locations by default (LOC disabled — not pseudonymised)", () => {
    const out = mergeNerFindings(text, empty(), [dupont, acme, lyon], cfg);
    expect(out.findings.map((f) => f.ruleId)).toEqual(["ner:PER", "ner:ORG"]);
    expect(out.findings.some((f) => f.ruleId === "ner:LOC")).toBe(false);
  });

  it("findings come out sorted by start offset", () => {
    const out = mergeNerFindings(text, empty(), [lyon, dupont, acme], cfgLoc);
    const starts = out.findings.map((f) => f.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("drops entities below their confidence threshold", () => {
    const weak: NerEntity = { ...dupont, score: 0.5 };
    expect(mergeNerFindings(text, empty(), [weak], cfg).findings).toHaveLength(0);
  });

  it("drops entities of disabled groups (MISC off by default)", () => {
    const misc: NerEntity = { entity: "MISC", value: "Acme", start: 25, end: 29, score: 0.99 };
    expect(mergeNerFindings(text, empty(), [misc], cfg).findings).toHaveLength(0);
  });

  it("ignores unknown entity groups", () => {
    const weird: NerEntity = { entity: "DATE", value: "Lyon", start: 32, end: 36, score: 0.99 };
    expect(mergeNerFindings(text, empty(), [weird], cfg).findings).toHaveLength(0);
  });

  it("regex findings win overlaps — overlapping NER is dropped", () => {
    const base: EvaluateResult = {
      findings: [{ ruleId: "email", start: 7, end: 13, value: "Dupont", action: "anonymize", severity: "high", placeholderLabel: "EMAIL" }],
      decision: "anonymize",
      maxSeverity: "high",
    };
    const out = mergeNerFindings(text, base, [dupont, lyon], cfgLoc);
    // Dupont overlaps the regex finding → dropped; only Lyon survives.
    expect(out.findings).toHaveLength(2);
    expect(out.findings.some((f) => f.ruleId === "ner:PER")).toBe(false);
    expect(out.findings.some((f) => f.ruleId === "ner:LOC")).toBe(true);
  });

  it("drops entities overlapping a whitelist span", () => {
    const whitelist = [/Acme/g];
    const out = mergeNerFindings(text, empty(), [acme, lyon], cfgLoc, whitelist);
    expect(out.findings.some((f) => f.value === "Acme")).toBe(false);
    expect(out.findings.some((f) => f.value === "Lyon")).toBe(true);
  });

  it("a warn-only entity escalates the decision but is not anonymized", () => {
    const warnCfg: NerConfig = {
      ...cfg,
      entities: { ...cfg.entities, ORG: { enabled: true, action: "warn", severity: "low", label: "ORG", threshold: 0.5 } },
    };
    const out = mergeNerFindings(text, empty(), [acme], warnCfg);
    expect(out.decision).toBe("warn");
    expect(out.findings[0].placeholderLabel).toBeUndefined();
  });

  it("higher-score entity wins when two NER spans overlap", () => {
    const a: NerEntity = { entity: "PER", value: "Jean Dupont", start: 0, end: 11, score: 0.99 };
    const b: NerEntity = { entity: "LOC", value: "Dupont", start: 5, end: 11, score: 0.70 };
    const out = mergeNerFindings("Jean Dupont went home", empty(), [a, b], { ...cfg, entities: { ...cfg.entities, LOC: { ...cfg.entities.LOC, enabled: true, threshold: 0.5 } } });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].ruleId).toBe("ner:PER");
  });
});
