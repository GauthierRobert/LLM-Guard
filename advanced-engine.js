/**
 * LLM Guard — Moteur de détection avancé
 * 
 * 4 couches de détection, du plus rapide au plus intelligent :
 * 
 *   Couche 1 : Regex (< 1ms)        → forme exacte des PII
 *   Couche 2 : Fuzzy matching (< 5ms) → fautes, obfuscation, variantes
 *   Couche 3 : Règles contextuelles (< 10ms) → combinaisons suspectes
 *   Couche 4 : Classification LLM (~ 1-2s)   → compréhension sémantique
 * 
 * Les couches 1-3 tournent côté client (navigateur).
 * La couche 4 appelle un LLM classifieur (optionnelle, nécessite une API key).
 */

// ═══════════════════════════════════════════════════════════════
// COUCHE 1 — REGEX (identique à v2, la base)
// ═══════════════════════════════════════════════════════════════

const PII_PATTERNS = [
  { name: "Email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "high", placeholder: "[EMAIL_§]" },
  { name: "Téléphone FR", regex: /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g, severity: "high", placeholder: "[TEL_§]" },
  { name: "Téléphone international", regex: /\+\d{1,3}[\s.-]?\d{4,14}/g, severity: "medium", placeholder: "[TEL_INTL_§]" },
  { name: "IBAN", regex: /\b[A-Z]{2}\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\b/g, severity: "critical", placeholder: "[IBAN_§]" },
  { name: "Carte bancaire", regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, severity: "critical", placeholder: "[CB_§]" },
  { name: "Numéro SS", regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, severity: "critical", placeholder: "[NSS_§]" },
  { name: "Adresse IP", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, severity: "low", placeholder: "[IP_§]" },
  { name: "Date de naissance", regex: /\b(?:0[1-9]|[12]\d|3[01])[\/.-](?:0[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/g, severity: "medium", placeholder: "[DATE_§]" },
  { name: "Domaine interne", regex: /\b[a-zA-Z0-9-]+\.(?:internal|local|corp|intranet|lan)\b/gi, severity: "medium", placeholder: "[DOMAIN_§]" },
  { name: "Mot de passe", regex: /(?:password|mot de passe|mdp|pwd)\s*[:=]\s*\S+/gi, severity: "critical", placeholder: "[PASSWORD_§]" },
  { name: "Nom de personne FR", regex: /\b(?:M\.|Mme|Mlle|Dr|Pr)\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+(?:\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+){1,2}\b/g, severity: "high", placeholder: "[PERSONNE_§]" },
  { name: "Adresse postale FR", regex: /\b\d{1,4}\s+(?:rue|avenue|boulevard|place|impasse|allée|chemin|route)\s+[A-Za-zÀ-ÿ\s-]{3,40}\b/gi, severity: "high", placeholder: "[ADRESSE_§]" },
];

function scanRegex(text) {
  const findings = [];
  for (const p of PII_PATTERNS) {
    const regex = new RegExp(p.regex.source, p.regex.flags);
    const matches = text.match(regex);
    if (matches) {
      findings.push({
        layer: "regex",
        type: p.name,
        severity: p.severity,
        count: matches.length,
        matches: [...new Set(matches)],
      });
    }
  }
  return findings;
}


// ═══════════════════════════════════════════════════════════════
// COUCHE 2 — FUZZY MATCHING
// Attrape les fautes de frappe, l'obfuscation, les variantes
// ═══════════════════════════════════════════════════════════════

// --- 2a. Distance de Levenshtein ---
// Mesure combien de caractères il faut changer pour passer d'un mot à un autre.
// "salaire" → "salaire" = 0 (identique)
// "salaure" → "salaire" = 1 (une lettre changée)
// "sal4ire" → "salaire" = 1 (obfuscation par chiffre)

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

// --- 2b. Normalisation du texte ---
// Retire les astuces d'obfuscation courantes :
//   "s.a.l.a.i.r.e" → "salaire"
//   "s4l41r3"        → "salaire" 
//   "S A L A I R E"  → "salaire"

function normalize(text) {
  return text
    .toLowerCase()
    // Remplacer les substitutions courantes (leetspeak)
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/!/g, "i")
    // Supprimer les séparateurs d'obfuscation
    .replace(/[\s.\-_*]+/g, "")
    // Supprimer les accents pour la comparaison
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// --- 2c. Mots-clés avec seuil de tolérance ---

const SENSITIVE_KEYWORDS = [
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

function scanFuzzy(text) {
  const findings = [];
  const normalizedText = normalize(text);
  const words = text.toLowerCase().split(/\s+/);

  for (const kw of SENSITIVE_KEYWORDS) {
    const normalizedKw = normalize(kw.term);

    // --- Recherche exacte (insensible casse + accents) ---
    if (normalizedText.includes(normalizedKw)) {
      findings.push({
        layer: "fuzzy",
        type: `Mot-clé: ${kw.term}`,
        severity: "medium",
        category: kw.category,
        matchType: "exact",
        matches: [kw.term],
      });
      continue;
    }

    // --- Recherche par Levenshtein sur les mots individuels ---
    // Seulement pour les termes d'un seul mot (≥ 5 caractères)
    if (!kw.term.includes(" ") && kw.term.length >= 5) {
      const threshold = kw.term.length <= 6 ? 1 : 2; // tolérance proportionnelle

      for (const word of words) {
        const normalizedWord = normalize(word);
        if (normalizedWord.length < normalizedKw.length - 2) continue;
        if (normalizedWord.length > normalizedKw.length + 2) continue;

        const distance = levenshtein(normalizedWord, normalizedKw);
        if (distance > 0 && distance <= threshold) {
          findings.push({
            layer: "fuzzy",
            type: `Mot-clé (approx): ${kw.term}`,
            severity: "low",
            category: kw.category,
            matchType: "levenshtein",
            distance,
            original: word,
            matches: [word],
          });
          break;
        }
      }
    }

    // --- Recherche de groupes de mots éclatés ---
    // "bulletin de paie" → cherche si tous les mots sont présents proches
    if (kw.term.includes(" ")) {
      const kwWords = kw.term.toLowerCase().split(/\s+/);
      const allPresent = kwWords.every((w) =>
        words.some((tw) => {
          const nw = normalize(tw);
          const nkw = normalize(w);
          return nw === nkw || (nkw.length >= 4 && levenshtein(nw, nkw) <= 1);
        })
      );
      if (allPresent && !normalizedText.includes(normalizedKw)) {
        // Vérifier la proximité (mots dans une fenêtre de 8 mots)
        const positions = kwWords.map((w) => {
          const nw = normalize(w);
          return words.findIndex((tw) => {
            const ntw = normalize(tw);
            return ntw === nw || (nw.length >= 4 && levenshtein(ntw, nw) <= 1);
          });
        });
        const minPos = Math.min(...positions);
        const maxPos = Math.max(...positions);
        if (maxPos - minPos <= 8) {
          findings.push({
            layer: "fuzzy",
            type: `Groupe de mots (dispersé): ${kw.term}`,
            severity: "low",
            category: kw.category,
            matchType: "dispersed",
            matches: [words.slice(minPos, maxPos + 1).join(" ")],
          });
        }
      }
    }
  }

  return findings;
}

// --- 2d. Détection d'obfuscation intentionnelle ---
// Quelqu'un qui écrit "s.a.l.a.i.r.e" ou "s4l41r3" essaie
// probablement de contourner le filtre → sévérité augmentée.

function detectObfuscation(text) {
  const findings = [];

  // Pattern : lettres séparées par des points/tirets/espaces
  // "c.o.n.f.i.d.e.n.t.i.e.l" ou "s a l a i r e"
  const spaced = text.match(
    /\b([a-zA-ZÀ-ÿ][\s.\-_*]{1,2}){4,}[a-zA-ZÀ-ÿ]\b/g
  );
  if (spaced) {
    for (const match of spaced) {
      const collapsed = normalize(match);
      for (const kw of SENSITIVE_KEYWORDS) {
        const nkw = normalize(kw.term);
        if (collapsed === nkw || levenshtein(collapsed, nkw) <= 1) {
          findings.push({
            layer: "fuzzy",
            type: `Obfuscation détectée: ${kw.term}`,
            severity: "high",
            category: kw.category,
            matchType: "obfuscation",
            original: match,
            matches: [match],
          });
        }
      }
    }
  }

  // Pattern : mélange chiffres/lettres suspect (leetspeak)
  const leet = text.match(/\b[a-zA-Z]*[\d@$!]+[a-zA-Z]+[\d@$!]*[a-zA-Z]*\b/g);
  if (leet) {
    for (const match of leet) {
      if (match.length < 5) continue;
      const collapsed = normalize(match);
      for (const kw of SENSITIVE_KEYWORDS) {
        const nkw = normalize(kw.term);
        if (collapsed === nkw || levenshtein(collapsed, nkw) <= 1) {
          findings.push({
            layer: "fuzzy",
            type: `Leetspeak détecté: ${kw.term}`,
            severity: "high",
            category: kw.category,
            matchType: "leetspeak",
            original: match,
            matches: [match],
          });
        }
      }
    }
  }

  // Pattern : email écrit en toutes lettres
  const spelledEmail =
    /(\w+)\s+(?:point|dot)\s+(\w+)\s+(?:arobase|arrobase|at|chez)\s+(\w+)\s+(?:point|dot)\s+(\w+)/gi;
  const emailMatch = spelledEmail.exec(text);
  if (emailMatch) {
    const reconstructed = `${emailMatch[1]}.${emailMatch[2]}@${emailMatch[3]}.${emailMatch[4]}`;
    findings.push({
      layer: "fuzzy",
      type: "Email obfusqué (épelé)",
      severity: "high",
      matchType: "spelled-email",
      original: emailMatch[0],
      reconstructed,
      matches: [emailMatch[0]],
    });
  }

  // Pattern : numéro de téléphone en toutes lettres
  const phoneWords =
    /(?:z[ée]ro|zero)\s+(?:six|sept|un|deux|trois|quatre|cinq|huit|neuf)\b.*?(?:(?:z[ée]ro|zero|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante)[\s,\-]*){4,}/gi;
  const phoneMatch = phoneWords.exec(text);
  if (phoneMatch) {
    findings.push({
      layer: "fuzzy",
      type: "Téléphone obfusqué (en lettres)",
      severity: "high",
      matchType: "spelled-phone",
      original: phoneMatch[0],
      matches: [phoneMatch[0]],
    });
  }

  return findings;
}


// ═══════════════════════════════════════════════════════════════
// COUCHE 3 — RÈGLES CONTEXTUELLES
// Analyse les combinaisons de mots qui, ensemble, révèlent
// une information sensible — même si aucun mot isolé n'est suspect.
// ═══════════════════════════════════════════════════════════════

const CONTEXT_RULES = [
  {
    name: "Données médicales implicites",
    description: "Mention d'une personne + termes médicaux sans mot-clé exact",
    personIndicators:
      /(?:^|[\s'"])(?:patient|patiente|malade|employ[ée]+s?|salari[ée]+s?|coll[èe]gues?|M\.|Mme|Mr)(?:\s|$)/im,
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

function scanContextual(text) {
  const findings = [];

  for (const rule of CONTEXT_RULES) {
    // Chaque règle a 2 indicateurs qui doivent être présents ensemble
    const indicators = Object.entries(rule).filter(
      ([k, v]) => k.endsWith("Indicators") && v instanceof RegExp
    );

    const allMatch = indicators.every(([, regex]) => regex.test(text));

    if (allMatch) {
      // Extraire les portions matchées pour le rapport
      const evidence = indicators.map(([key, regex]) => {
        const match = text.match(regex);
        return { indicator: key.replace("Indicators", ""), match: match?.[0] };
      });

      findings.push({
        layer: "contextual",
        type: rule.name,
        severity: rule.severity,
        category: rule.category,
        description: rule.description,
        evidence,
        matches: evidence.map((e) => e.match).filter(Boolean),
      });
    }
  }

  return findings;
}


// ═══════════════════════════════════════════════════════════════
// COUCHE 4 — CLASSIFICATION PAR LLM
// Le plus puissant : un LLM analyse le prompt pour comprendre
// le SENS, pas juste la forme.
// 
// Architecture : le prompt est envoyé à Claude (via API Anthropic)
// AVANT d'être envoyé à ChatGPT/Gemini/etc.
// ═══════════════════════════════════════════════════════════════

const LLM_CLASSIFIER_CONFIG = {
  enabled: false, // Mettre à true pour activer
  apiUrl: "https://api.anthropic.com/v1/messages",
  apiKey: "", // Votre clé API Anthropic
  model: "claude-sonnet-4-20250514",
  maxTokens: 300,
  // Seuil de confiance (0-1) au-dessus duquel on considère le prompt sensible
  confidenceThreshold: 0.7,
  // Timeout en ms
  timeout: 3000,
};

const CLASSIFIER_SYSTEM_PROMPT = `Tu es un classificateur de données personnelles pour la conformité RGPD.

Analyse le texte fourni et réponds UNIQUEMENT avec un JSON valide (sans backticks) :

{
  "contains_pii": true/false,
  "confidence": 0.0-1.0,
  "findings": [
    {
      "type": "catégorie RGPD",
      "severity": "critical|high|medium|low",
      "description": "explication courte",
      "evidence": "extrait du texte"
    }
  ],
  "reasoning": "explication en une phrase"
}

Catégories à détecter :
- Données d'identification (nom, prénom, surnom, photo)
- Coordonnées (adresse, téléphone, email)
- Données financières (salaire, revenus, comptes bancaires)
- Données médicales (santé, handicap, traitements)
- Données sensibles art. 9 RGPD (religion, opinions politiques, orientation sexuelle, appartenance syndicale, données biométriques/génétiques)
- Données judiciaires (casier, infractions, condamnations)
- Données professionnelles confidentielles (évaluations, sanctions, licenciements)
- Identification indirecte (combinaison de données qui permettrait d'identifier une personne)
- Données de mineurs

IMPORTANT : ne flag PAS les questions génériques sur ces sujets.
"Quel est le salaire moyen en France ?" = pas de PII.
"Le salaire de Jean Dupont est de 45000€" = PII.

La distinction clé : est-ce qu'une personne RÉELLE et IDENTIFIABLE est concernée ?`;

async function classifyWithLLM(text) {
  if (!LLM_CLASSIFIER_CONFIG.enabled || !LLM_CLASSIFIER_CONFIG.apiKey) {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      LLM_CLASSIFIER_CONFIG.timeout
    );

    // IMPORTANT : on utilise la vraie fetch, pas celle qu'on a monkey-patché
    const response = await window.__originalFetch(
      LLM_CLASSIFIER_CONFIG.apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": LLM_CLASSIFIER_CONFIG.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: LLM_CLASSIFIER_CONFIG.model,
          max_tokens: LLM_CLASSIFIER_CONFIG.maxTokens,
          system: CLASSIFIER_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Analyse ce texte pour la conformité RGPD :\n\n${text}`,
            },
          ],
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn("[LLM Guard] Classificateur LLM erreur:", response.status);
      return [];
    }

    const data = await response.json();
    const resultText = data.content?.[0]?.text || "";

    // Parser le JSON de la réponse
    const result = JSON.parse(resultText.replace(/```json?|```/g, "").trim());

    if (
      !result.contains_pii ||
      result.confidence < LLM_CLASSIFIER_CONFIG.confidenceThreshold
    ) {
      return [];
    }

    return (result.findings || []).map((f) => ({
      layer: "llm",
      type: f.type,
      severity: f.severity || "medium",
      description: f.description,
      evidence: f.evidence,
      confidence: result.confidence,
      reasoning: result.reasoning,
      matches: [f.evidence].filter(Boolean),
    }));
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[LLM Guard] Classificateur LLM timeout");
    } else {
      console.warn("[LLM Guard] Classificateur LLM erreur:", err.message);
    }
    return [];
  }
}


// ═══════════════════════════════════════════════════════════════
// ORCHESTRATEUR — Combine les 4 couches
// ═══════════════════════════════════════════════════════════════

async function analyzePrompt(text) {
  const startTime = performance.now();

  // Couches 1-3 en parallèle (synchrones, très rapides)
  const regexFindings = scanRegex(text);
  const fuzzyFindings = scanFuzzy(text);
  const obfuscationFindings = detectObfuscation(text);
  const contextFindings = scanContextual(text);

  // Couche 4 : uniquement si les couches précédentes n'ont rien trouvé
  // OU si on veut une double vérification
  let llmFindings = [];
  const localFindings = [
    ...regexFindings,
    ...fuzzyFindings,
    ...obfuscationFindings,
    ...contextFindings,
  ];

  if (LLM_CLASSIFIER_CONFIG.enabled) {
    // Si rien trouvé localement, ou si le texte est long/complexe
    if (localFindings.length === 0 || text.length > 200) {
      llmFindings = await classifyWithLLM(text);
    }
  }

  const allFindings = [...localFindings, ...llmFindings];

  // Dédupliquer les findings similaires
  const deduped = deduplicateFindings(allFindings);

  const elapsed = performance.now() - startTime;

  return {
    findings: deduped,
    stats: {
      totalFindings: deduped.length,
      byLayer: {
        regex: regexFindings.length,
        fuzzy: fuzzyFindings.length + obfuscationFindings.length,
        contextual: contextFindings.length,
        llm: llmFindings.length,
      },
      elapsed: Math.round(elapsed),
      hasCritical: deduped.some((f) => f.severity === "critical"),
      maxSeverity: getMaxSeverity(deduped),
    },
  };
}

function getMaxSeverity(findings) {
  const order = { critical: 4, high: 3, medium: 2, low: 1 };
  return findings.reduce((max, f) => {
    return order[f.severity] > order[max] ? f.severity : max;
  }, "low");
}

function deduplicateFindings(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.type}:${(f.matches || []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


// ═══════════════════════════════════════════════════════════════
// EXPORTS (pour les tests)
// ═══════════════════════════════════════════════════════════════

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    scanRegex,
    scanFuzzy,
    detectObfuscation,
    scanContextual,
    analyzePrompt,
    levenshtein,
    normalize,
    SENSITIVE_KEYWORDS,
    CONTEXT_RULES,
    PII_PATTERNS,
  };
}
