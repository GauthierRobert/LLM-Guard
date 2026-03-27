/**
 * LLM Guard -- Layer 3 Contextual Rules
 * Each rule defines indicator regex pairs that, when both match,
 * signal a contextual PII leak (e.g., person + medical term).
 */
(function () {
  "use strict";

  const CONTEXT_RULES = [
    {
      name: "Données médicales implicites",
      description: "Mention d'une personne + termes médicaux sans mot-clé exact",
      personIndicators:
        /(?:^|[\s'"])(?:patient|patiente|malade|employ[ée]+s?|salari[ée]+s?|coll[èe]gues?|M\.|Mme|Mr)(?:\s|$)/im,
      medicalIndicators:
        /(?:op[ée]ration|chirurgie|cancer|diab[èe]te|d[ée]pression|anxi[ée]t[ée]|traitement|m[ée]dicament|ordonnance|h[ôo]pital|clinique|IRM|scanner|radio|analyse|bilan|sympt[ôo]me|allergie|vaccin|arr[êe]t maladie|hospitalisation|th[ée]rapie|psychiatre|psychologue|grossesse|enceinte|handicap)/i,
      severity: "high",
      category: "Données médicales contextuelles",
    },
    {
      name: "Données financières implicites",
      description: "Mention d'une personne + montants/revenus",
      personIndicators:
        /(?:^|[\s'"])(?:employ[ée]+s?|salari[ée]+s?|coll[èe]gues?|directeur|directrice|manager|chef|M\.|Mme|Mr)(?:\s|$)/im,
      financialIndicators:
        /(?:\d+\s*(?:€|euros?|k€|ke|k)\b|touche|gagne|per[çc]oit|revenus?|primes?|bonus|indemnit[ée]|augmentation|r[ée]tribution|net|brut|mensuel|annuel)/i,
      severity: "high",
      category: "Données financières contextuelles",
    },
    {
      name: "Évaluation personnelle",
      description: "Jugement ou évaluation sur une personne identifiable",
      personIndicators:
        /(?:^|[\s'"])(?:employ[ée]+s?|salari[ée]+s?|coll[èe]gues?|candidat|candidate|stagiaire|M\.|Mme|Mr)(?:\s|$)/im,
      evaluationIndicators:
        /(?:incomp[ée]tent|performant|licencier|virer|sanctionner|avertissement|bl[âa]me|mise [àa] pied|entretien disciplinaire|faute grave|insuffisant|excellent|[ée]valuation|notation|appr[ée]ciation|probl[èe]me de comportement|harc[èe]lement|plainte)/i,
      severity: "high",
      category: "Évaluation personnelle",
    },
    {
      name: "Identification indirecte",
      description: "Combinaison de quasi-identifiants qui pourrait identifier quelqu'un",
      deptIndicators:
        /(?:d[ée]partement|service|[ée]quipe|direction|p[ôo]le|bureau)\s+(?:de\s+)?[A-ZÀ-Ÿa-zà-ÿ]+/i,
      roleIndicators:
        /(?:seul|unique|le\s+seul|la\s+seule|nouveau|nouvelle|stagiaire|alternant|int[ée]rimaire)/i,
      severity: "medium",
      category: "Identification indirecte",
    },
    {
      name: "Données de localisation personnelle",
      description: "Adresse ou localisation associée à une personne",
      personIndicators:
        /(?:habite|domicile|adresse|r[ée]side|vit\s+[àa]|domicili[ée])/i,
      locationIndicators:
        /(?:\d{5}|[A-ZÀ-Ÿ][a-zà-ÿ]+(?:[-\s][A-ZÀ-Ÿ][a-zà-ÿ]+)?)/,
      severity: "medium",
      category: "Données de localisation",
    },
  ];

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.contextRules = { CONTEXT_RULES };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { CONTEXT_RULES };
  }
})();
