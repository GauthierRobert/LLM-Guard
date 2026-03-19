/**
 * LLM Guard — Couche 4 : NLP local (pas d'appel cloud)
 * 
 * 3 options selon votre contexte, de la plus légère à la plus puissante :
 * 
 * Option A : transformers.js dans le navigateur (ONNX, ~50MB de modèle)
 *            → Tourne 100% côté client, aucun serveur nécessaire
 *            → Modèle NER pour détecter noms, orgs, lieux
 *            → Latence : ~200-500ms
 * 
 * Option B : Microservice spaCy / Presidio (Docker, auto-hébergé)
 *            → Tourne sur votre serveur interne
 *            → Plus précis, supporte le français nativement
 *            → Latence : ~50-100ms
 * 
 * Option C : LLM local via Ollama (Mistral 7B, Llama 3.2)
 *            → Le plus puissant, compréhension sémantique complète
 *            → Nécessite un GPU ou CPU puissant
 *            → Latence : ~1-3s
 * 
 * AUCUNE de ces options n'envoie de données à un service cloud.
 */


// ═══════════════════════════════════════════════════════════════
// OPTION A — transformers.js (100% navigateur)
// ═══════════════════════════════════════════════════════════════
// 
// Utilise un modèle ONNX qui tourne dans un Web Worker.
// Le modèle est téléchargé une seule fois puis mis en cache
// dans le navigateur (IndexedDB).
//
// Modèle recommandé : Jean-Baptiste/camembert-ner
// (entraîné pour le NER français : PER, ORG, LOC, MISC)

class BrowserNLPClassifier {
  constructor() {
    this.pipeline = null;
    this.loading = false;
    this.ready = false;
  }

  async init() {
    if (this.ready || this.loading) return;
    this.loading = true;

    try {
      // transformers.js se charge via CDN et met le modèle en cache
      const { pipeline } = await import(
        "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2"
      );

      // NER (Named Entity Recognition) avec CamemBERT fine-tuné
      // Le modèle (~50MB) est téléchargé une seule fois
      this.pipeline = await pipeline(
        "token-classification",
        "Xenova/camembert-ner", // Version ONNX de Jean-Baptiste/camembert-ner
        { quantized: true }     // Version 8-bit, plus léger
      );

      this.ready = true;
      console.log("[LLM Guard] Modèle NER local chargé (navigateur)");
    } catch (err) {
      console.warn("[LLM Guard] Échec chargement NER:", err.message);
    } finally {
      this.loading = false;
    }
  }

  async classify(text) {
    if (!this.ready) {
      await this.init();
      if (!this.ready) return [];
    }

    try {
      const entities = await this.pipeline(text, {
        aggregation_strategy: "simple",
      });

      // Mapper les entités NER vers nos catégories de sévérité
      return entities
        .filter((e) => e.score > 0.75) // seuil de confiance
        .map((e) => ({
          layer: "nlp-local",
          type: this.mapEntityType(e.entity_group),
          severity: this.mapSeverity(e.entity_group),
          confidence: e.score,
          matches: [e.word.trim()],
          start: e.start,
          end: e.end,
        }));
    } catch (err) {
      console.warn("[LLM Guard] Erreur NER:", err.message);
      return [];
    }
  }

  mapEntityType(nerLabel) {
    const map = {
      PER: "Nom de personne (NLP)",
      ORG: "Organisation (NLP)",
      LOC: "Lieu (NLP)",
      MISC: "Entité diverse (NLP)",
    };
    return map[nerLabel] || `Entité: ${nerLabel}`;
  }

  mapSeverity(nerLabel) {
    const map = {
      PER: "high",     // Un nom de personne = toujours sensible
      ORG: "medium",   // Nom d'entreprise = potentiellement sensible
      LOC: "medium",   // Un lieu = contextuellement sensible
      MISC: "low",
    };
    return map[nerLabel] || "low";
  }
}


// ═══════════════════════════════════════════════════════════════
// OPTION B — Microservice Presidio (Docker auto-hébergé)
// ═══════════════════════════════════════════════════════════════
//
// Microsoft Presidio est un framework open source de détection PII.
// Il tourne dans un container Docker sur votre serveur interne.
//
// Déploiement :
//   docker run -p 5001:3000 mcr.microsoft.com/presidio-analyzer
//   docker run -p 5002:3000 mcr.microsoft.com/presidio-anonymizer
//
// Le serveur est sur votre réseau — rien ne sort vers le cloud.

class PresidioClassifier {
  constructor(analyzerUrl = "http://presidio.internal:5001") {
    this.analyzerUrl = analyzerUrl;
    this.ready = false;
  }

  async init() {
    try {
      // Vérifier que le service est accessible
      const response = await fetch(`${this.analyzerUrl}/health`);
      this.ready = response.ok;
      if (this.ready) {
        console.log("[LLM Guard] Presidio connecté (serveur interne)");
      }
    } catch {
      console.warn("[LLM Guard] Presidio non accessible");
      this.ready = false;
    }
  }

  async classify(text) {
    if (!this.ready) {
      await this.init();
      if (!this.ready) return [];
    }

    try {
      const response = await fetch(`${this.analyzerUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          language: "fr",
          // Types d'entités à détecter
          entities: [
            "PERSON",
            "PHONE_NUMBER",
            "EMAIL_ADDRESS",
            "IBAN_CODE",
            "CREDIT_CARD",
            "LOCATION",
            "NRP",           // Nationality, Religion, Political group
            "MEDICAL_LICENSE",
            "ORGANIZATION",
            "DATE_TIME",
            "IP_ADDRESS",
          ],
          // Seuil de confiance
          score_threshold: 0.6,
        }),
      });

      if (!response.ok) return [];

      const results = await response.json();

      return results.map((r) => ({
        layer: "presidio",
        type: this.mapPresidioType(r.entity_type),
        severity: this.mapPresidioSeverity(r.entity_type),
        confidence: r.score,
        matches: [text.slice(r.start, r.end)],
        start: r.start,
        end: r.end,
      }));
    } catch (err) {
      console.warn("[LLM Guard] Erreur Presidio:", err.message);
      return [];
    }
  }

  // Anonymiser via Presidio (le service s'en charge)
  async anonymize(text) {
    try {
      // D'abord analyser
      const analysisResponse = await fetch(`${this.analyzerUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "fr", score_threshold: 0.6 }),
      });
      const analysisResults = await analysisResponse.json();

      // Puis anonymiser
      const anonUrl = this.analyzerUrl.replace("5001", "5002");
      const anonResponse = await fetch(`${anonUrl}/anonymize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          analyzer_results: analysisResults,
          anonymizers: {
            // Remplacer par des placeholders, pas des astérisques
            DEFAULT: { type: "replace", new_value: "[PII]" },
            PERSON: { type: "replace", new_value: "[PERSONNE]" },
            PHONE_NUMBER: { type: "replace", new_value: "[TEL]" },
            EMAIL_ADDRESS: { type: "replace", new_value: "[EMAIL]" },
            LOCATION: { type: "replace", new_value: "[LIEU]" },
            ORGANIZATION: { type: "replace", new_value: "[ORG]" },
          },
        }),
      });

      const result = await anonResponse.json();
      return result.text;
    } catch (err) {
      console.warn("[LLM Guard] Erreur anonymisation Presidio:", err.message);
      return text; // Retourner le texte original en cas d'erreur
    }
  }

  mapPresidioType(entityType) {
    const map = {
      PERSON: "Nom de personne",
      PHONE_NUMBER: "Téléphone",
      EMAIL_ADDRESS: "Email",
      IBAN_CODE: "IBAN",
      CREDIT_CARD: "Carte bancaire",
      LOCATION: "Lieu",
      NRP: "Nationalité/Religion/Politique",
      ORGANIZATION: "Organisation",
      DATE_TIME: "Date",
      IP_ADDRESS: "Adresse IP",
    };
    return map[entityType] || entityType;
  }

  mapPresidioSeverity(entityType) {
    const map = {
      PERSON: "high",
      PHONE_NUMBER: "high",
      EMAIL_ADDRESS: "high",
      IBAN_CODE: "critical",
      CREDIT_CARD: "critical",
      LOCATION: "medium",
      NRP: "high",
      ORGANIZATION: "medium",
      DATE_TIME: "low",
      IP_ADDRESS: "low",
    };
    return map[entityType] || "medium";
  }
}


// ═══════════════════════════════════════════════════════════════
// OPTION C — LLM local via Ollama
// ═══════════════════════════════════════════════════════════════
//
// Ollama fait tourner Mistral/Llama localement.
// Installation : curl -fsSL https://ollama.com/install.sh | sh
// Lancement :    ollama run mistral
//
// API REST sur localhost:11434 — rien ne sort du réseau.

class OllamaClassifier {
  constructor(baseUrl = "http://localhost:11434") {
    this.baseUrl = baseUrl;
    this.model = "mistral"; // ou "llama3.2", "phi3", etc.
    this.ready = false;
  }

  async init() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        const hasModel = data.models?.some((m) =>
          m.name.includes(this.model)
        );
        this.ready = hasModel;
        if (this.ready) {
          console.log(`[LLM Guard] Ollama connecté (${this.model})`);
        } else {
          console.warn(
            `[LLM Guard] Modèle ${this.model} non trouvé dans Ollama`
          );
        }
      }
    } catch {
      console.warn("[LLM Guard] Ollama non accessible sur", this.baseUrl);
      this.ready = false;
    }
  }

  async classify(text) {
    if (!this.ready) {
      await this.init();
      if (!this.ready) return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: `Tu es un détecteur de données personnelles RGPD.
Analyse ce texte et réponds UNIQUEMENT avec du JSON valide, sans backticks :
{"pii": true/false, "items": [{"type": "catégorie", "value": "extrait", "severity": "critical/high/medium/low"}]}

Texte : "${text}"`,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 200,
          },
        }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      const resultText = data.response || "";

      try {
        const result = JSON.parse(
          resultText.replace(/```json?|```/g, "").trim()
        );
        if (!result.pii || !result.items) return [];

        return result.items.map((item) => ({
          layer: "ollama-local",
          type: item.type,
          severity: item.severity || "medium",
          matches: [item.value].filter(Boolean),
        }));
      } catch {
        return [];
      }
    } catch (err) {
      console.warn("[LLM Guard] Erreur Ollama:", err.message);
      return [];
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// SÉLECTEUR AUTOMATIQUE
// Détecte quelle option est disponible et l'utilise
// ═══════════════════════════════════════════════════════════════

class Layer4Classifier {
  constructor(config = {}) {
    this.config = {
      // Priorité : presidio > ollama > browser
      presidioUrl: config.presidioUrl || null,
      ollamaUrl: config.ollamaUrl || null,
      enableBrowserNLP: config.enableBrowserNLP !== false,
    };

    this.activeClassifier = null;
    this.activeType = null;
  }

  async init() {
    // Essayer dans l'ordre de préférence

    if (this.config.presidioUrl) {
      const presidio = new PresidioClassifier(this.config.presidioUrl);
      await presidio.init();
      if (presidio.ready) {
        this.activeClassifier = presidio;
        this.activeType = "presidio";
        return;
      }
    }

    if (this.config.ollamaUrl) {
      const ollama = new OllamaClassifier(this.config.ollamaUrl);
      await ollama.init();
      if (ollama.ready) {
        this.activeClassifier = ollama;
        this.activeType = "ollama";
        return;
      }
    }

    if (this.config.enableBrowserNLP) {
      const browser = new BrowserNLPClassifier();
      await browser.init();
      if (browser.ready) {
        this.activeClassifier = browser;
        this.activeType = "browser-nlp";
        return;
      }
    }

    console.warn(
      "[LLM Guard] Aucun classifieur local disponible. Couche 4 désactivée."
    );
  }

  async classify(text) {
    if (!this.activeClassifier) return [];
    return this.activeClassifier.classify(text);
  }

  getType() {
    return this.activeType;
  }
}


// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BrowserNLPClassifier,
    PresidioClassifier,
    OllamaClassifier,
    Layer4Classifier,
  };
}
