import type { PIIPattern } from "@/shared/types";
import { luhnCheck, isValidIPv4, looksLikeJwt, isReservedExampleEmail } from "./validators";

/**
 * Layer 1 PII regex patterns. Structured/secret patterns come BEFORE generic
 * numeric ones (SIREN/SIRET/VAT/PHONE_INTL last) to reduce false replacements.
 */
export const PII_PATTERNS: PIIPattern[] = [
  {
    type: "EMAIL",
    label: "Email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    severity: "high",
    validate: (s) => !isReservedExampleEmail(s),
  },
  {
    type: "AWS_KEY",
    label: "Clé AWS",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "critical",
  },
  {
    type: "GH_PAT",
    label: "GitHub PAT",
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    severity: "critical",
  },
  {
    type: "SLACK_TOKEN",
    label: "Slack token",
    regex: /\bxox[abprsvoe]-[A-Za-z0-9-]{10,}\b/g,
    severity: "critical",
  },
  {
    type: "STRIPE_KEY",
    label: "Stripe key",
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
    severity: "critical",
  },
  {
    type: "OPENAI_KEY",
    label: "OpenAI key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g,
    severity: "critical",
  },
  {
    type: "GOOGLE_KEY",
    label: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "critical",
  },
  {
    type: "JWT",
    label: "JWT",
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    severity: "critical",
    validate: looksLikeJwt,
  },
  {
    type: "PRIVATE_KEY",
    label: "Clé privée",
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g,
    severity: "critical",
  },
  {
    type: "AZURE_CONN",
    label: "Azure connection string",
    regex: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/g,
    severity: "critical",
  },
  {
    type: "PASSWORD",
    label: "Mot de passe",
    regex: /(?:password|mot de passe|mdp|pwd)\s*[:=]\s*\S+/gi,
    severity: "critical",
  },
  {
    type: "IBAN",
    label: "IBAN",
    regex:
      /\b[A-Z]{2}\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\b/g,
    severity: "critical",
  },
  {
    type: "CARD",
    label: "Carte bancaire",
    regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
    severity: "critical",
    validate: luhnCheck,
  },
  {
    type: "NSS_FR",
    label: "Numéro SS FR",
    regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g,
    severity: "critical",
  },
  {
    type: "SSN_US",
    label: "SSN US",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: "critical",
  },
  {
    type: "SIN_CA",
    label: "SIN CA",
    regex: /\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/g,
    severity: "critical",
  },
  {
    type: "NINO_UK",
    label: "NINO UK",
    regex: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g,
    severity: "critical",
  },
  {
    type: "PERSON_FR",
    label: "Nom de personne FR",
    regex:
      /\b(?:M\.|Mme|Mlle|Dr|Pr)\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+(?:\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+){1,2}\b/g,
    severity: "high",
  },
  {
    type: "ADDRESS_FR",
    label: "Adresse postale FR",
    regex:
      /\b\d{1,4}\s+(?:rue|avenue|boulevard|place|impasse|allée|chemin|route)\s+[A-Za-zÀ-ÿ\s-]{3,40}\b/gi,
    severity: "high",
  },
  {
    type: "PHONE_FR",
    label: "Téléphone FR",
    regex: /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g,
    severity: "high",
  },
  {
    type: "BTC",
    label: "Bitcoin",
    regex: /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,87})\b/g,
    severity: "high",
  },
  {
    type: "ETH",
    label: "Ethereum",
    regex: /\b0x[a-fA-F0-9]{40}\b/g,
    severity: "high",
  },
  {
    type: "INTERNAL_DOMAIN",
    label: "Domaine interne",
    regex: /\b[a-zA-Z0-9-]+\.(?:internal|local|corp|intranet|lan)\b/gi,
    severity: "medium",
  },
  {
    type: "DOB",
    label: "Date de naissance",
    regex: /\b(?:0[1-9]|[12]\d|3[01])[\/.-](?:0[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/g,
    severity: "medium",
  },
  {
    type: "VAT_EU",
    label: "Numéro TVA UE",
    regex:
      /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[\s-]?[A-Z0-9]{8,12}\b/g,
    severity: "medium",
  },
  {
    type: "SIRET",
    label: "SIRET",
    regex: /\b\d{14}\b/g,
    severity: "medium",
    validate: luhnCheck,
  },
  {
    type: "SIREN",
    label: "SIREN",
    regex: /\b\d{9}\b/g,
    severity: "medium",
    validate: luhnCheck,
  },
  {
    type: "PHONE_INTL",
    label: "Téléphone international",
    regex: /\+\d{1,3}[\s.-]?\d{4,14}/g,
    severity: "medium",
  },
  {
    type: "IP",
    label: "Adresse IP",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    severity: "low",
    validate: isValidIPv4,
  },
];
