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
    {
      name: "Antécédent médical temporel",
      description: "Personne identifiable + période + condition médicale (ex: « depuis 2019, Marie souffre de… »)",
      personIndicators:
        /(?:^|[\s'"])(?:patient|patiente|malade|employ[ée]+s?|salari[ée]+s?|coll[èe]gues?|M\.|Mme|Mr|ma\s+(?:fille|m[èe]re|s[œo]ur|femme|belle-m[èe]re)|mon\s+(?:fils|p[èe]re|fr[èe]re|mari|beau-p[èe]re))/im,
      timeIndicators:
        /(?:depuis\s+(?:19|20)\d{2}|depuis\s+\d+\s+(?:an|ans|mois|semaines?)|depuis\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)|il\s+y\s+a\s+\d+\s+(?:an|ans|mois))/i,
      medicalIndicators:
        /(?:op[ée]ration|chirurgie|cancer|diab[èe]te|d[ée]pression|anxi[ée]t[ée]|traitement|th[ée]rapie|psychiatre|grossesse|enceinte|handicap|VIH|s[ée]ropositif|alzheimer|parkinson|autisme|trouble\s+\w+|pathologie\s+\w+)/i,
      severity: "high",
      category: "Donnée de santé temporelle",
    },
    {
      name: "Agrégat RH sensible",
      description: "Décompte de personnes associé à un attribut sensible (ex: « 3 employés sont en arrêt »)",
      countIndicators:
        /\b(?:\d+|plusieurs|quelques|la\s+moiti[ée]|tous\s+les|toutes\s+les|certains|certaines)\s+(?:employ[ée]+s|salari[ée]+s|coll[èe]gues|candidats|candidates|stagiaires|membres?)\b/i,
      sensitiveIndicators:
        /(?:arr[êe]t\s+maladie|cong[ée]\s+(?:parental|maternit[ée]|paternit[ée]|maladie)|licenci[ée]+s?|harc[èe]lement|syndicat|gr[èe]ve|d[ée]pression|burn[-\s]?out|d[ée]mission|origine\s+(?:[ée]trang[èe]re|africaine|asiatique|maghr[ée]bine)|religion|orientation\s+sexuelle|handicap)/i,
      severity: "high",
      category: "Agrégat RH",
    },
    {
      name: "Lien familial sensible",
      description: "Relation familiale + donnée santé/finance/justice — l'identification se fait par ricochet",
      familyIndicators:
        /(?:^|[\s'"])(?:ma\s+(?:fille|m[èe]re|s[œo]ur|femme|tante|cousine|ni[èe]ce|grand-m[èe]re|belle-m[èe]re|belle-s[œo]ur|belle-fille)|mon\s+(?:fils|p[èe]re|fr[èe]re|mari|oncle|cousin|neveu|grand-p[èe]re|beau-p[èe]re|beau-fr[èe]re|beau-fils)|mes\s+(?:parents|enfants)|notre\s+enfant)(?:\s|$)/i,
      sensitiveIndicators:
        /(?:cancer|diab[èe]te|d[ée]pression|VIH|handicap|salaire|revenu|dettes?|surendettement|divorce|casier\s+judiciaire|condamn[ée]|prison|tribunal|avocat|grossesse|adoption|ALD|invalidit[ée])/i,
      severity: "high",
      category: "Donnée familiale sensible",
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
