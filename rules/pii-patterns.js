/**
 * LLM Guard -- Shared PII Patterns
 * Single source of truth for PII regex patterns used by content.js, advanced-engine.js, and tests.
 */
(function () {
  "use strict";

  const PII_PATTERNS = [
    { name: "Email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "high", placeholder: "[EMAIL_§]" },
    { name: "Téléphone FR", regex: /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g, severity: "high", placeholder: "[TEL_§]" },
    { name: "Téléphone international", regex: /\+\d{1,3}[\s.-]?\d{4,14}/g, severity: "medium", placeholder: "[TEL_INTL_§]" },
    { name: "IBAN", regex: /\b[A-Z]{2}\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\b/g, severity: "critical", placeholder: "[IBAN_§]" },
    { name: "Carte bancaire", regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, severity: "critical", placeholder: "[CB_§]" },
    { name: "Numéro SS", regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, severity: "critical", placeholder: "[NSS_§]" },
    { name: "SSN US", regex: /\b\d{3}-\d{2}-\d{4}\b/g, severity: "critical", placeholder: "[SSN_US_§]" },
    { name: "SIN CA", regex: /\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/g, severity: "critical", placeholder: "[SIN_CA_§]" },
    { name: "NINO UK", regex: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g, severity: "critical", placeholder: "[NINO_§]" },
    { name: "Adresse IP", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, severity: "low", placeholder: "[IP_§]" },
    { name: "Date de naissance", regex: /\b(?:0[1-9]|[12]\d|3[01])[\/.-](?:0[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/g, severity: "medium", placeholder: "[DATE_§]" },
    { name: "Domaine interne", regex: /\b[a-zA-Z0-9-]+\.(?:internal|local|corp|intranet|lan)\b/gi, severity: "medium", placeholder: "[DOMAIN_§]" },
    { name: "Mot de passe", regex: /(?:password|mot de passe|mdp|pwd)\s*[:=]\s*\S+/gi, severity: "critical", placeholder: "[PASSWORD_§]" },
    { name: "Nom de personne FR", regex: /\b(?:M\.|Mme|Mlle|Dr|Pr)\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+(?:\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+){1,2}\b/g, severity: "high", placeholder: "[PERSONNE_§]" },
    { name: "Adresse postale FR", regex: /\b\d{1,4}\s+(?:rue|avenue|boulevard|place|impasse|allée|chemin|route)\s+[A-Za-zÀ-ÿ\s-]{3,40}\b/gi, severity: "high", placeholder: "[ADRESSE_§]" },

    // ─── Secrets & cloud/dev tokens ─────────────────────────────
    { name: "Clé AWS", regex: /\bAKIA[0-9A-Z]{16}\b/g, severity: "critical", placeholder: "[AWS_KEY_§]" },
    { name: "GitHub PAT", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, severity: "critical", placeholder: "[GH_PAT_§]" },
    { name: "Slack token", regex: /\bxox[abprsvoe]-[A-Za-z0-9-]{10,}\b/g, severity: "critical", placeholder: "[SLACK_TOKEN_§]" },
    { name: "Stripe API key", regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g, severity: "critical", placeholder: "[STRIPE_KEY_§]" },
    { name: "OpenAI API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g, severity: "critical", placeholder: "[OPENAI_KEY_§]" },
    { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "critical", placeholder: "[GOOGLE_KEY_§]" },
    { name: "JWT", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, severity: "critical", placeholder: "[JWT_§]" },
    { name: "Clé privée SSH/PGP", regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g, severity: "critical", placeholder: "[PRIVATE_KEY_§]" },
  ];

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.patterns = { PII_PATTERNS };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PII_PATTERNS };
  }
})();
