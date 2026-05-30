/**
 * LLM Guard -- Shared PII Patterns
 * Single source of truth for PII regex patterns used by content.js, advanced-engine.js, and tests.
 *
 * Each entry is `{ name, regex, severity, placeholder, validate? }`.
 * The optional `validate(match)` hook is called after a raw regex match; if it
 * returns false the match is dropped. Use it to cut regex-driven false
 * positives (Luhn, octet bounds, reserved domains, header sniffing, …).
 */
(function () {
  "use strict";

  // ─── Validator helpers ──────────────────────────────────────
  // Kept inline so this file remains the single source of truth; the tiny
  // amount of duplication with utils.js.luhn is deliberate (patterns load
  // standalone in the extension and in Node tests).
  function luhnCheck(str) {
    const s = String(str).replace(/\D/g, "");
    if (s.length < 2) return false;
    let sum = 0;
    let alt = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let d = s.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // Reserved per RFC 2606: .test/.example/.invalid/.localhost TLDs and the
  // example.com/.net/.org second-level domains are guaranteed never to hold
  // real mailboxes, so flagging them wastes user trust.
  const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"]);
  const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
  function isReservedExampleEmail(match) {
    const at = match.lastIndexOf("@");
    if (at === -1) return false;
    const domain = match.slice(at + 1).toLowerCase();
    if (RESERVED_DOMAINS.has(domain)) return true;
    const dot = domain.lastIndexOf(".");
    if (dot === -1) return false;
    return RESERVED_TLDS.has(domain.slice(dot + 1));
  }

  function isValidIPv4(match) {
    const parts = match.split(".");
    if (parts.length !== 4) return false;
    for (const p of parts) {
      if (p.length === 0 || p.length > 3) return false;
      if (p.length > 1 && p[0] === "0") return false; // reject leading zeros (version strings, etc.)
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    }
    return true;
  }

  // Base64url decode the first segment of a JWT and require the familiar
  // `{"alg":` header prefix. Catches random `eyJa.eyJb.eyJc` text.
  function looksLikeJwt(match) {
    if (match.length < 100) return false;
    const firstDot = match.indexOf(".");
    if (firstDot < 8) return false;
    const header = match.slice(0, firstDot);
    try {
      const b64 = header.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      const decoded = (typeof atob === "function")
        ? atob(b64 + pad)
        : Buffer.from(b64 + pad, "base64").toString("binary");
      return /^\s*\{\s*"alg"\s*:/.test(decoded);
    } catch {
      return false;
    }
  }

  const PII_PATTERNS = [
    { name: "Email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "high", placeholder: "[EMAIL_§]",
      validate: (m) => !isReservedExampleEmail(m) },
    { name: "Téléphone FR", regex: /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g, severity: "high", placeholder: "[TEL_§]" },
    { name: "Téléphone international", regex: /\+\d{1,3}[\s.-]?\d{4,14}/g, severity: "medium", placeholder: "[TEL_INTL_§]" },
    { name: "IBAN", regex: /\b[A-Z]{2}\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\b/g, severity: "critical", placeholder: "[IBAN_§]" },
    { name: "Carte bancaire", regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, severity: "critical", placeholder: "[CB_§]",
      validate: (m) => luhnCheck(m) },
    { name: "Numéro SS", regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, severity: "critical", placeholder: "[NSS_§]" },
    { name: "SSN US", regex: /\b\d{3}-\d{2}-\d{4}\b/g, severity: "critical", placeholder: "[SSN_US_§]" },
    { name: "SIN CA", regex: /\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/g, severity: "critical", placeholder: "[SIN_CA_§]" },
    { name: "NINO UK", regex: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g, severity: "critical", placeholder: "[NINO_§]" },
    { name: "Adresse IP", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, severity: "low", placeholder: "[IP_§]",
      validate: (m) => isValidIPv4(m) },
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
    { name: "JWT", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, severity: "critical", placeholder: "[JWT_§]",
      validate: (m) => looksLikeJwt(m) },
    { name: "Clé privée SSH/PGP", regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g, severity: "critical", placeholder: "[PRIVATE_KEY_§]" },
    { name: "Azure connection string", regex: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/g, severity: "critical", placeholder: "[AZURE_CONN_§]" },

    // ─── Cryptocurrency wallets ─────────────────────────────────
    { name: "Bitcoin (legacy)", regex: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, severity: "high", placeholder: "[BTC_§]" },
    { name: "Bitcoin (bech32)", regex: /\bbc1[a-zA-HJ-NP-Z0-9]{25,87}\b/g, severity: "high", placeholder: "[BTC_§]" },
    { name: "Ethereum", regex: /\b0x[a-fA-F0-9]{40}\b/g, severity: "high", placeholder: "[ETH_§]" },

    // ─── EU business identifiers ────────────────────────────────
    // SIREN (9 digits) / SIRET (14 digits) rely on a Luhn check — random
    // numbers of the right length still pass ~10% of the time, so severity
    // stays medium and context rules should ultimately confirm.
    { name: "SIREN", regex: /\b\d{9}\b/g, severity: "medium", placeholder: "[SIREN_§]",
      validate: (m) => luhnCheck(m) },
    { name: "SIRET", regex: /\b\d{14}\b/g, severity: "medium", placeholder: "[SIRET_§]",
      validate: (m) => luhnCheck(m) },
    { name: "Numéro TVA UE", regex: /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[\s-]?[A-Z0-9]{8,12}\b/g, severity: "medium", placeholder: "[VAT_§]" },
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
