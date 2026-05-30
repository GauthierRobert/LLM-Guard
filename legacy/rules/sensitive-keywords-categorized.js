/**
 * LLM Guard -- Sensitive Keywords with categories
 * Used by advanced-engine.js for fuzzy matching with RGPD category metadata.
 *
 * Each entry has:
 *   - term: the keyword or phrase to detect
 *   - category: RGPD data category for reporting
 *
 * Add your custom terms at the bottom (see commented examples).
 */
(function () {
  "use strict";

  const SENSITIVE_KEYWORDS_CATEGORIZED = [
    // Mots simples
    { term: "salaire", category: "Données financières RH" },
    { term: "rémunération", category: "Données financières RH" },
    { term: "confidentiel", category: "Classification document" },
    { term: "diagnostic", category: "Données médicales" },
    { term: "pathologie", category: "Données médicales" },
    { term: "religion", category: "Données sensibles art.9" },
    { term: "NDA", category: "Classification document" },
    { term: "NIR", category: "Identifiant national" },

    // Groupes de mots (cherchés comme séquence)
    { term: "bulletin de paie", category: "Données financières RH" },
    { term: "fiche de paie", category: "Données financières RH" },
    { term: "dossier médical", category: "Données médicales" },
    { term: "casier judiciaire", category: "Données judiciaires" },
    { term: "orientation sexuelle", category: "Données sensibles art.9" },
    { term: "opinion politique", category: "Données sensibles art.9" },
    { term: "appartenance syndicale", category: "Données sensibles art.9" },
    { term: "données biométriques", category: "Données sensibles art.9" },
    { term: "secret professionnel", category: "Classification document" },
    { term: "numéro de sécurité sociale", category: "Identifiant national" },

    // ─── VOTRE DICTIONNAIRE PERSONNALISÉ ───
    // Ajoutez ici les termes propres à votre entreprise :
    // { term: "projet phoenix", category: "Projet confidentiel" },
    // { term: "client acme", category: "Client sous NDA" },
    // { term: "formule secrète", category: "Propriété intellectuelle" },
  ];

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.keywordsCategorized = { SENSITIVE_KEYWORDS_CATEGORIZED };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SENSITIVE_KEYWORDS_CATEGORIZED };
  }
})();
