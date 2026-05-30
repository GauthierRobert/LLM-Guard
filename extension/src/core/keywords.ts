import type { Finding } from "@/shared/types";

/** RGPD-sensitive keyword dictionary (Layer 1.5). */
export const SENSITIVE_KEYWORDS: string[] = [
  "salaire",
  "rémunération",
  "bulletin de paie",
  "fiche de paie",
  "dossier médical",
  "diagnostic",
  "pathologie",
  "casier judiciaire",
  "orientation sexuelle",
  "religion",
  "opinion politique",
  "appartenance syndicale",
  "données biométriques",
  "numéro de sécurité sociale",
  "NIR",
  "secret professionnel",
  "confidentiel",
  "NDA",
];

/**
 * Case-insensitive substring scan over the sensitive keyword dictionary.
 * Emits at most one Finding per keyword.
 */
export function scanKeywords(text: string): Finding[] {
  const lower = text.toLowerCase();
  const findings: Finding[] = [];
  for (const keyword of SENSITIVE_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      findings.push({
        type: "KEYWORD",
        label: keyword,
        value: keyword,
        severity: "high",
        source: "keyword",
      });
    }
  }
  return findings;
}
