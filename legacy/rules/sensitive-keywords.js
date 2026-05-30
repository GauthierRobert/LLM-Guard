/**
 * LLM Guard -- Sensitive Keywords (simple string array)
 * Used by content.js for basic keyword matching in scanForPII.
 */
(function () {
  "use strict";

  const SENSITIVE_KEYWORDS = [
    "salaire", "rémunération", "bulletin de paie", "fiche de paie",
    "dossier médical", "diagnostic", "pathologie", "casier judiciaire",
    "orientation sexuelle", "religion", "opinion politique",
    "appartenance syndicale", "données biométriques",
    "numéro de sécurité sociale", "NIR", "secret professionnel",
    "confidentiel", "NDA",
  ];

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.keywords = { SENSITIVE_KEYWORDS };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SENSITIVE_KEYWORDS };
  }
})();
