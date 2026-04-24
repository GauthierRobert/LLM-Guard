/**
 * LLM Guard v2 — Tests unitaires
 * Usage : node test-scanner-v2.js
 */

// ─── Shared modules ──────────────────────────────────────────────
const { PII_PATTERNS } = require("../rules/pii-patterns.js");
const { SENSITIVE_KEYWORDS } = require("../rules/sensitive-keywords.js");

function scanForPII(text) {
  const findings = [];
  for (const p of PII_PATTERNS) {
    const regex = new RegExp(p.regex.source, p.regex.flags);
    const raw = text.match(regex);
    if (!raw) continue;
    const matches = typeof p.validate === "function" ? raw.filter((m) => p.validate(m)) : raw;
    if (matches.length === 0) continue;
    findings.push({ type: p.name, severity: p.severity, count: matches.length, samples: matches.slice(0, 3) });
  }
  const lower = text.toLowerCase();
  const kws = SENSITIVE_KEYWORDS.filter(k => lower.includes(k.toLowerCase()));
  if (kws.length > 0) findings.push({ type: "Mot-clé sensible RGPD", severity: "medium", count: kws.length, samples: kws.slice(0, 3) });
  return findings;
}

function anonymizeText(text) {
  let result = text;
  const map = new Map();
  const reverse = new Map();
  let counter = 0;

  for (const p of PII_PATTERNS) {
    const regex = new RegExp(p.regex.source, p.regex.flags);
    let match;
    while ((match = regex.exec(result)) !== null) {
      const original = match[0];
      if (reverse.has(original)) continue;
      if (typeof p.validate === "function" && !p.validate(original)) continue;
      counter++;
      const ph = p.placeholder.replace("§", counter);
      map.set(ph, original);
      reverse.set(original, ph);
    }
  }

  const sorted = [...reverse.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [original, ph] of sorted) {
    result = result.split(original).join(ph);
  }

  return { anonymized: result, mappings: map, changed: map.size > 0 };
}

function deanonymizeText(text, map) {
  let result = text;
  for (const [ph, original] of map) {
    result = result.split(ph).join(original);
  }
  return result;
}

// ─── Framework de test ─────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }
function assertDetects(text, type) { assert(scanForPII(text).some(f => f.type === type), `"${type}" non détecté`); }
function assertClean(text) { const f = scanForPII(text); assert(f.length === 0, `Faux positif : ${f.map(x => x.type).join(", ")}`); }

// ─── Tests détection (repris de v1 + nouveaux) ─────────────────

console.log("\n\x1b[1m📧 Emails\x1b[0m");
test("Email simple", () => assertDetects("a@b.com", "Email"));
test("Email entreprise", () => assertDetects("prenom.nom@societe.fr", "Email"));

console.log("\n\x1b[1m📞 Téléphones\x1b[0m");
test("Mobile FR espaces", () => assertDetects("06 12 34 56 78", "Téléphone FR"));
test("Mobile FR compact", () => assertDetects("0612345678", "Téléphone FR"));
test("+33", () => assertDetects("+33 6 12 34 56 78", "Téléphone FR"));
test("UK", () => assertDetects("+44 7911 123456", "Téléphone international"));

console.log("\n\x1b[1m🏦 IBAN / CB / NSS\x1b[0m");
test("IBAN FR (mod-97 valide)", () => assertDetects("FR14 2004 1010 0505 0001 3M02 606", "IBAN"));
test("IBAN invalide (mod-97 rejeté)", () => {
  const f = scanForPII("FR76 3000 6000 0112 3456 789");
  assert(!f.some((x) => x.type === "IBAN"), "IBAN avec mauvaise clé ne doit PAS matcher");
});
test("CB espaces (Luhn valide)", () => assertDetects("4111 1111 1111 1111", "Carte bancaire"));
test("NSS (INSEE clé valide)", () => assertDetects("1 85 05 78 006 084 91", "Numéro SS"));
test("NSS clé invalide ignoré", () => {
  const f = scanForPII("1 85 05 78 006 084 36");
  assert(!f.some((x) => x.type === "Numéro SS"), "NSS avec mauvaise clé ne doit PAS matcher");
});

console.log("\n\x1b[1m🔑 Mots de passe\x1b[0m");
test("password:", () => assertDetects("password: hunter2", "Mot de passe"));
test("mdp=", () => assertDetects("mdp= test123", "Mot de passe"));

console.log("\n\x1b[1m👤 Noms de personnes (NOUVEAU v2)\x1b[0m");
test("M. Dupont", () => assertDetects("Contacte M. Jean Dupont", "Nom de personne FR"));
test("Mme Martin", () => assertDetects("Mme Sophie Martin a appelé", "Nom de personne FR"));
test("Dr Lefebvre", () => assertDetects("Le Dr Pierre Lefebvre", "Nom de personne FR"));
test("Mme avec accent", () => assertDetects("Mme Hélène Béranger", "Nom de personne FR"));

console.log("\n\x1b[1m🏠 Adresses postales (NOUVEAU v2)\x1b[0m");
test("Rue", () => assertDetects("15 rue de la Paix", "Adresse postale FR"));
test("Avenue", () => assertDetects("42 avenue des Champs", "Adresse postale FR"));
test("Boulevard", () => assertDetects("8 boulevard Saint-Germain", "Adresse postale FR"));

console.log("\n\x1b[1m✅ Prompts propres\x1b[0m");
test("Question technique", () => assertClean("Explique TCP vs UDP"));
test("Code Python", () => assertClean("Comment trier une liste en Python ?"));
test("Math", () => assertClean("Résous 2x + 5 = 17"));

// ─── Tests anonymisation (NOUVEAU v2) ──────────────────────────

console.log("\n\x1b[1m🔒 Anonymisation\x1b[0m");

test("Anonymise un email", () => {
  const { anonymized, changed } = anonymizeText("Contacte jean@test.fr demain");
  assert(changed, "Devrait détecter un changement");
  assert(!anonymized.includes("jean@test.fr"), "L'email doit être remplacé");
  assert(anonymized.includes("[EMAIL_"), "Doit contenir un placeholder EMAIL");
});

test("Anonymise un téléphone", () => {
  const { anonymized } = anonymizeText("Appelle le 06 12 34 56 78");
  assert(!anonymized.includes("06 12 34 56 78"), "Le tel doit être remplacé");
  assert(anonymized.includes("[TEL_"), "Doit contenir un placeholder TEL");
});

test("Anonymise un IBAN", () => {
  const { anonymized } = anonymizeText("Virement sur FR14 2004 1010 0505 0001 3M02 606");
  assert(anonymized.includes("[IBAN_"), "Doit contenir un placeholder IBAN");
});

test("Anonymise un nom de personne", () => {
  const { anonymized } = anonymizeText("Envoie le dossier à Mme Sophie Martin");
  assert(anonymized.includes("[PERSONNE_"), "Doit contenir un placeholder PERSONNE");
  assert(!anonymized.includes("Sophie Martin"), "Le nom doit disparaître");
});

test("Anonymise une adresse", () => {
  const { anonymized } = anonymizeText("Livraison au 15 rue de la Paix");
  assert(anonymized.includes("[ADRESSE_"), "Doit contenir un placeholder ADRESSE");
});

test("Anonymise plusieurs PII dans un même texte", () => {
  const text = "M. Jean Dupont (jean@test.fr, 06 12 34 56 78) habite 10 rue Victor Hugo";
  const { anonymized, mappings } = anonymizeText(text);
  assert(mappings.size >= 3, `Attendu ≥3 mappings, obtenu ${mappings.size}`);
  assert(!anonymized.includes("jean@test.fr"), "Email doit disparaître");
  assert(!anonymized.includes("06 12 34 56 78"), "Tel doit disparaître");
});

test("Prompt propre reste inchangé", () => {
  const text = "Explique-moi comment fonctionne TCP.";
  const { anonymized, changed } = anonymizeText(text);
  assert(!changed, "Ne devrait pas détecter de changement");
  assert(anonymized === text, "Le texte doit rester identique");
});

// ─── Tests dé-anonymisation ────────────────────────────────────

console.log("\n\x1b[1m🔓 Dé-anonymisation\x1b[0m");

test("Dé-anonymise correctement un email", () => {
  const original = "Contacte jean@test.fr pour le projet";
  const { anonymized, mappings } = anonymizeText(original);
  const restored = deanonymizeText(anonymized, mappings);
  assert(restored === original, `Attendu "${original}", obtenu "${restored}"`);
});

test("Dé-anonymise un texte avec multiples PII", () => {
  const original = "M. Jean Dupont, email jean@test.fr, tel 06 12 34 56 78";
  const { anonymized, mappings } = anonymizeText(original);
  const restored = deanonymizeText(anonymized, mappings);
  assert(restored.includes("jean@test.fr"), "L'email doit être restauré");
  assert(restored.includes("06 12 34 56 78"), "Le tel doit être restauré");
});

test("Dé-anonymise une réponse LLM contenant des placeholders", () => {
  const { anonymized, mappings } = anonymizeText("Le salaire de jean@test.fr est confidentiel");
  // Simule une réponse LLM qui reprend les placeholders
  const llmResponse = `Concernant ${anonymized.match(/\[EMAIL_\d+\]/)?.[0] || "[EMAIL_1]"}, voici ce que je peux dire...`;
  const restored = deanonymizeText(llmResponse, mappings);
  assert(restored.includes("jean@test.fr"), "Le placeholder doit être remplacé dans la réponse");
});

// ─── Tests validateurs (NOUVEAU) ───────────────────────────────
// Each pattern may ship a `validate(match)` hook that drops matches the
// regex can't distinguish from the real thing — invalid Luhn cards, out-of-
// range IP octets, reserved example domains, too-short JWTs.

console.log("\n\x1b[1m🧪 Validateurs — faux positifs éliminés\x1b[0m");

test("CB Luhn invalide ignorée", () => {
  const f = scanForPII("Facture #1234 5678 9012 3456 à payer");
  assert(!f.some((x) => x.type === "Carte bancaire"), "CB non-Luhn ne doit PAS être détectée");
});

test("CB Luhn valide détectée", () => assertDetects("4242 4242 4242 4242", "Carte bancaire"));

test("Email sur example.com ignoré (RFC 2606)", () => {
  const f = scanForPII("Écris à test@example.com pour info");
  assert(!f.some((x) => x.type === "Email"), "email reserved-domain ne doit PAS être détecté");
});

test("Email sur TLD .test ignoré", () => {
  const f = scanForPII("support@site.test dit...");
  assert(!f.some((x) => x.type === "Email"), "email .test ne doit PAS être détecté");
});

test("Email corporate détecté", () => assertDetects("alice@acme.com", "Email"));

test("IP valide détectée", () => assertDetects("Serveur à 192.168.1.42", "Adresse IP"));

test("IP invalide (octets >255) ignorée", () => {
  const f = scanForPII("Ping 999.999.999.999 timeout");
  assert(!f.some((x) => x.type === "Adresse IP"), "octets >255 ne doivent PAS matcher");
});

test("IP avec zero leading ignorée (version string)", () => {
  const f = scanForPII("Version 01.02.03.04 released");
  assert(!f.some((x) => x.type === "Adresse IP"), "leading-zero octet ne doit PAS matcher");
});

test("JWT trop court ignoré", () => {
  const f = scanForPII("Fake: eyJa.eyJb.eyJc done");
  assert(!f.some((x) => x.type === "JWT"), "pseudo-JWT court ne doit PAS matcher");
});

test("JWT réaliste détecté", () => {
  const realJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  assertDetects(`Bearer ${realJwt}`, "JWT");
});

test("JWT sans en-tête alg ignoré", () => {
  // Header décodé = {"foo":"bar"} → absence de "alg" → rejeté par le validateur
  const fake = "eyJmb28iOiJiYXIifQ.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const f = scanForPII(`Bearer ${fake}`);
  assert(!f.some((x) => x.type === "JWT"), "JWT sans alg ne doit PAS matcher");
});

// ─── Tests nouveaux patterns (crypto + Azure + EU) ─────────────

console.log("\n\x1b[1m🪙 Nouveaux patterns — wallets crypto & identifiants EU\x1b[0m");

test("Ethereum address détectée", () => assertDetects("Wallet: 0xdAC17F958D2ee523a2206206994597C13D831ec7", "Ethereum"));

test("Bitcoin bech32 détecté", () => assertDetects("Send to bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "Bitcoin (bech32)"));

test("Bitcoin legacy détecté", () => assertDetects("Pay 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa now", "Bitcoin (legacy)"));

test("Azure connection string détectée", () => {
  const s = "DefaultEndpointsProtocol=https;AccountName=mystore;AccountKey=abc123def456";
  assertDetects(s, "Azure connection string");
});

test("SIREN Luhn-valide détecté", () => assertDetects("SIREN 732829320 (Air France)", "SIREN"));

test("SIREN non-Luhn ignoré", () => {
  const f = scanForPII("Ticket numéro 123456789 fermé");
  assert(!f.some((x) => x.type === "SIREN"), "SIREN non-Luhn ne doit PAS matcher");
});

test("SIRET Luhn-valide détecté", () => assertDetects("SIRET 35600000000048", "SIRET"));

test("Numéro TVA UE détecté", () => assertDetects("VAT FR40303265045 invoice", "Numéro TVA UE"));

// ─── Tests secrets additionnels ────────────────────────────────

console.log("\n\x1b[1m🔐 Secrets — tokens cloud & API keys\x1b[0m");

test("Anthropic API key détectée", () =>
  assertDetects("key=sk-ant-api03-AaBbCcDdEeFfGgHhIi1234567890_-", "Anthropic API key"));

test("AWS STS session credential détecté", () =>
  assertDetects("aws_access_key_id = ASIAIOSFODNN7EXAMPLE", "Clé AWS STS"));

test("Bearer token générique détecté", () => {
  const f = scanForPII("Authorization: Bearer abcdef0123456789ABCDEF0123456789abcdef01234567890");
  assert(f.some((x) => x.type === "Bearer token"), "Bearer token opaque ne devrait pas être raté");
});

test("Bearer JWT géré par le pattern JWT (pas double-flag)", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const f = scanForPII(`Authorization: Bearer ${jwt}`);
  assert(f.some((x) => x.type === "JWT"), "JWT doit être détecté");
  assert(!f.some((x) => x.type === "Bearer token"), "Bearer token ne doit PAS dupliquer le JWT");
});

test("GCP service-account JSON détecté", () => {
  const sa = '{"type": "service_account", "project_id": "my-proj", "private_key_id": "abc", "private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvQ...\\n-----END PRIVATE KEY-----\\n"}';
  assertDetects(sa, "Clé GCP service-account");
});

// ─── Tests régression: téléphone resserré ──────────────────────

console.log("\n\x1b[1m📞 Téléphone — faux positifs évités\x1b[0m");

test("Date DD.MM.YYYY n'est pas téléphone", () => {
  const f = scanForPII("Réunion du 01.01.2025 confirmée");
  assert(!f.some((x) => x.type === "Téléphone FR"), "date ne doit pas matcher Téléphone FR");
});

test("Téléphone FR légitime toujours détecté après resserrage", () => {
  assertDetects("Appel: 06 12 34 56 78 merci", "Téléphone FR");
});

// ─── Résumé ────────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m  ✓ ${passed}/${total} tests réussis\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m  ✗ ${failed}/${total} tests échoués\x1b[0m`);
}
console.log("═".repeat(50) + "\n");
process.exit(failed > 0 ? 1 : 0);
