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

  // IBAN mod-97 check (ISO 13616). Strips whitespace, verifies length bucket,
  // then rotates the country/check pair to the end and replaces letters with
  // their A=10..Z=35 digit pair. The resulting number mod 97 must be 1.
  const IBAN_LENGTHS = {
    AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
    ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26,
    IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15,
    PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  };
  function isValidIBAN(match) {
    const s = String(match).replace(/\s+/g, "").toUpperCase();
    if (s.length < 15 || s.length > 34) return false;
    const country = s.slice(0, 2);
    const expected = IBAN_LENGTHS[country];
    if (expected && s.length !== expected) return false;
    const rotated = s.slice(4) + s.slice(0, 4);
    let digits = "";
    for (let i = 0; i < rotated.length; i++) {
      const c = rotated.charCodeAt(i);
      if (c >= 48 && c <= 57) digits += rotated[i];
      else if (c >= 65 && c <= 90) digits += String(c - 55);
      else return false;
    }
    // Compute mod 97 in chunks to stay within safe integer range.
    let rem = 0;
    for (let i = 0; i < digits.length; i += 7) {
      rem = Number(String(rem) + digits.slice(i, i + 7)) % 97;
    }
    return rem === 1;
  }

  // French NIR (numéro de sécurité sociale) INSEE checksum. The base NIR is
  // the first 13 digits; the last 2 are the control key = 97 - (NIR mod 97).
  // For people born in Corsica, 2A → 19 and 2B → 18 before computing, but the
  // regex only captures digit characters so that branch never fires here.
  function isValidNIR(match) {
    const s = String(match).replace(/\s+/g, "");
    if (!/^\d{15}$/.test(s)) return false;
    const base = Number(s.slice(0, 13));
    const key = Number(s.slice(13));
    if (!Number.isSafeInteger(base)) return false;
    return key === 97 - (base % 97);
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

  // JWT validator: requires exactly three base64url segments, a decodable
  // header JSON with an "alg" claim, and a payload JSON with at least one of
  // the standard registered claims. Rejects random `eyJa.eyJb.eyJc` strings
  // whose header happens to start with `{"alg":` but carry no real payload.
  function b64urlDecode(seg) {
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    if (typeof atob === "function") return atob(b64 + pad);
    return Buffer.from(b64 + pad, "base64").toString("binary");
  }
  const JWT_CLAIM_RE = /"(?:iss|sub|aud|exp|nbf|iat|jti|scope|scp|roles|email|name|kid)"\s*:/;
  function looksLikeJwt(match) {
    if (match.length < 100) return false;
    const parts = match.split(".");
    if (parts.length !== 3) return false;
    const [h, p, s] = parts;
    if (h.length < 8 || p.length < 8 || s.length < 8) return false;
    try {
      const header = b64urlDecode(h);
      if (!/^\s*\{\s*"(?:alg|typ)"\s*:/.test(header)) return false;
      // Parse the header strictly to weed out `{"alg":` prefixes wedged
      // onto non-JSON bytes. Any parse failure = not a JWT.
      JSON.parse(header);
      const payload = b64urlDecode(p);
      if (!JWT_CLAIM_RE.test(payload)) return false;
      JSON.parse(payload);
      return true;
    } catch {
      return false;
    }
  }

  const PII_PATTERNS = [
    { name: "Email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "high", placeholder: "[EMAIL_§]",
      validate: (m) => !isReservedExampleEmail(m) },
    // Phone FR: require a non-digit/non-letter boundary after the last group
    // so the regex doesn't gobble day/month/year chunks of a date like
    // "01.01.2025" or tail segments of an order ID.
    { name: "Téléphone FR", regex: /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}(?![\d.\-a-zA-Z])/g, severity: "high", placeholder: "[TEL_§]" },
    { name: "Téléphone international", regex: /\+\d{1,3}[\s.-]?\d{4,14}(?![\d.\-a-zA-Z])/g, severity: "medium", placeholder: "[TEL_INTL_§]" },
    { name: "IBAN", regex: /\b[A-Z]{2}\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\b/g, severity: "critical", placeholder: "[IBAN_§]",
      validate: (m) => isValidIBAN(m) },
    { name: "Carte bancaire", regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, severity: "critical", placeholder: "[CB_§]",
      validate: (m) => luhnCheck(m) },
    { name: "Numéro SS", regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, severity: "critical", placeholder: "[NSS_§]",
      validate: (m) => isValidNIR(m) },
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
    // AWS STS session credential. Prefix ASIA is an IAM temp access-key id —
    // pairs with a secret access key, so should never cross a trust boundary.
    { name: "Clé AWS STS", regex: /\bASIA[0-9A-Z]{16}\b/g, severity: "critical", placeholder: "[AWS_STS_§]" },
    { name: "GitHub PAT", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, severity: "critical", placeholder: "[GH_PAT_§]" },
    { name: "Slack token", regex: /\bxox[abprsvoe]-[A-Za-z0-9-]{10,}\b/g, severity: "critical", placeholder: "[SLACK_TOKEN_§]" },
    { name: "Stripe API key", regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g, severity: "critical", placeholder: "[STRIPE_KEY_§]" },
    { name: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "critical", placeholder: "[ANTHROPIC_KEY_§]" },
    { name: "OpenAI API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g, severity: "critical", placeholder: "[OPENAI_KEY_§]" },
    { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "critical", placeholder: "[GOOGLE_KEY_§]" },
    { name: "JWT", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, severity: "critical", placeholder: "[JWT_§]",
      validate: (m) => looksLikeJwt(m) },
    // Generic Bearer header with a long opaque token. The 40-char floor
    // avoids flagging the word "Bearer" followed by a short placeholder.
    { name: "Bearer token", regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{40,}\b/g, severity: "critical", placeholder: "[BEARER_§]",
      validate: (m) => !/^Bearer\s+eyJ/.test(m) }, // JWTs are flagged separately
    { name: "Clé privée SSH/PGP", regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g, severity: "critical", placeholder: "[PRIVATE_KEY_§]" },
    // GCP service account private-key marker. Flag on the structural anchor
    // alone — capturing the full JSON would be enormous and the presence of
    // `"type":"service_account"` + `"private_key":` is unambiguous.
    { name: "Clé GCP service-account", regex: /"type"\s*:\s*"service_account"[\s\S]{0,500}?"private_key"\s*:\s*"/g, severity: "critical", placeholder: "[GCP_SA_§]" },
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
