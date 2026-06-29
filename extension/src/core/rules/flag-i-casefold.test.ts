/**
 * Proof that the `i` flag breaks capital-letter detection.
 *
 * Every PERSON / COMPANY / MATTER rule leans on a single signal: `\p{Lu}`
 * ("this token starts with a capital → probably a proper noun"). Under `/iu`,
 * Unicode case-folding makes `\p{Lu}` match lowercase letters too, so ordinary
 * lowercase words get flagged. These tests demonstrate the failure under `giu`
 * and the correct behaviour under `gu`, both on a raw RegExp and through the
 * real compile → evaluate pipeline.
 */

import { describe, it, expect } from "vitest";
import { compileRules } from "./compile";
import { evaluate } from "./engine";
import type { ParsedRulesDoc } from "./types";

// A proper-noun pattern, exactly the shape the real rules use: a capital
// followed by letters. "client" / "forêt" must NOT match it.
const PROPER_NOUN = "\\p{Lu}[\\p{L}'-]{2,}";

describe("the `i` flag case-folds \\p{Lu} (raw RegExp)", () => {
  it("giu: \\p{Lu} WRONGLY matches a lowercase word", () => {
    const re = new RegExp(PROPER_NOUN, "giu");
    // Bug: case-folding turns \p{Lu} into "any letter", so "client" matches.
    expect("le client est responsable".match(re)).not.toBeNull();
    expect("la forêt se renouvelle".match(re)).not.toBeNull();
  });

  it("gu: \\p{Lu} correctly matches ONLY a real capital", () => {
    const re = new RegExp(PROPER_NOUN, "gu");
    // Lowercase prose is rejected...
    expect("le client est responsable".match(re)).toBeNull();
    expect("la forêt se renouvelle".match(re)).toBeNull();
    // ...but a genuine capitalised name is still caught.
    expect("le dossier Meridian avance".match(re)![0]).toBe("Meridian");
  });
});

describe("the same regex through compile → evaluate", () => {
  // Mirror of the real `company-legal-form` rule, reduced to its core signal:
  // a capitalised name followed by a legal form.
  const doc: ParsedRulesDoc = {
    version: 1,
    rules: [
      {
        id: "company",
        kind: "regex",
        action: "anonymize",
        placeholder: "COMPANY",
        pattern: `(?<![\\p{L}\\p{N}])${PROPER_NOUN}\\s+(?:SA|SRL)`,
      },
    ],
  };

  const lowercaseProse = "le client sa part reste responsable";
  const realCompany = "le contrat avec Meridian SA est signé";

  it("compiles with `gu` (no `i`): lowercase prose stays clean", () => {
    // compileRules() uses userRegex(), which deliberately compiles in "gu".
    const r = compileRules(doc);
    expect(evaluate(lowercaseProse, r).findings).toEqual([]);
    // A genuine capitalised company is still detected.
    const hit = evaluate(realCompany, r).findings;
    expect(hit).toHaveLength(1);
    expect(hit[0]!.value).toBe("Meridian SA");
  });

  it("would have fired on lowercase prose IF compiled with `giu` (the old bug)", () => {
    // Re-create the pre-fix behaviour by hand to prove the regression is real:
    // same pattern, but with the `i` flag restored.
    const buggy = new RegExp(`(?<![\\p{L}\\p{N}])${PROPER_NOUN}\\s+(?:SA|SRL)`, "giu");
    // "sa part" matches "<word> sa" because i lets \p{Lu} match lowercase AND
    // lets "SA" match "sa" — a pure false positive.
    expect(lowercaseProse.match(buggy)).not.toBeNull();
  });
});
