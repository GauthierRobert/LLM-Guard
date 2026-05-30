import { describe, it, expect } from "vitest";
import { scan } from "./detector";

describe("scan", () => {
  it("detects a real email with regex source and span", () => {
    const r = scan("contact john@gmail.com please");
    const email = r.findings.find((f) => f.type === "EMAIL");
    expect(email).toBeDefined();
    expect(email?.source).toBe("regex");
    expect(email?.value).toBe("john@gmail.com");
    expect(typeof email?.start).toBe("number");
    expect(typeof email?.end).toBe("number");
  });

  it("skips reserved example emails", () => {
    const r = scan("contact john@example.com please");
    expect(r.findings.some((f) => f.type === "EMAIL")).toBe(false);
  });

  it("skips Luhn-invalid cards", () => {
    const r = scan("card 4242 4242 4242 4243");
    expect(r.findings.some((f) => f.type === "CARD")).toBe(false);
  });

  it("flags a critical secret and reports hasCritical", () => {
    const r = scan("aws AKIAIOSFODNN7EXAMPLE");
    expect(r.hasCritical).toBe(true);
    expect(r.maxSeverity).toBe("critical");
  });

  it("detects keywords case-insensitively from the dictionary", () => {
    const r = scan("Voici mon SALAIRE et mon dossier médical");
    const kw = r.findings.filter((f) => f.source === "keyword");
    expect(kw.some((f) => f.label === "salaire")).toBe(true);
    expect(kw.some((f) => f.label === "dossier médical")).toBe(true);
  });

  it("returns null maxSeverity for clean text", () => {
    const r = scan("hello world, nothing here");
    expect(r.findings).toHaveLength(0);
    expect(r.maxSeverity).toBeNull();
    expect(r.hasCritical).toBe(false);
  });
});
