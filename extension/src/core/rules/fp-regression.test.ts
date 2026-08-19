import { describe, it, expect } from "vitest";
import { getDefaultCompiledRules } from "./defaults";
import { evaluate } from "./engine";

// Regression: under the previous `/giu` compilation the `i` flag case-folded
// `\p{Lu}`, so ordinary lowercase French words tripped the capital-letter
// heuristic in the PERSON / COMPANY / MATTER rules. This text must stay clean.
describe("false-positive regression (lowercase French prose)", () => {
  const r = getDefaultCompiledRules();

  it("does not flag ordinary lowercase prose as COMPANY/MATTER/PERSON", () => {
    const text =
      "La forêt se renouvelle ainsi en permanence ; les périodes de fructification " +
      "et de dispersion des graines se succèdent ; de nombreux organismes coexistent ; " +
      "la prédation est disputée. Le client demeure responsable. Le client reçoit " +
      "uniquement les droits d'utilisation. Le client reste responsable pour réduire " +
      "les effets de l'événement. Lorsque l'empêchement se prolonge, une information " +
      "claire avant son entrée en vigueur.";
    const res = evaluate(text, r);
    expect(res.findings).toEqual([]);
    expect(res.decision).toBeNull();
  });

  it("still catches a genuinely capitalised proper noun (COMPANY)", () => {
    const res = evaluate("Le contrat avec Meridian Solutions SA est signé.", r);
    expect(res.findings.some((f) => f.value.includes("Meridian"))).toBe(true);
  });
});

// The RFC-2606 example domains used to sit in the default whitelist, which made
// every test prompt look clean and hid the protection from the person trying it.
describe("example domains are not exempt", () => {
  const r = getDefaultCompiledRules();

  it.each(["a@example.com", "a@example.org", "a@example.net"])(
    "pseudonymises %s like any other address",
    (address) => {
      const res = evaluate(`Ecrivez a ${address} pour confirmer.`, r);
      const email = res.findings.find((f) => f.value === address);
      expect(email).toBeDefined();
      expect(email!.action).toBe("anonymize");
      expect(email!.placeholderLabel).toBe("EMAIL");
    },
  );
});
