# Couche 4 — Comparatif des solutions locales

## Le problème

Envoyer le prompt à un LLM cloud (Claude, GPT) pour le classifier **avant** de l'anonymiser revient à envoyer les données sensibles à un tiers. C'est exactement ce qu'on essaie d'éviter.

**Toute la couche 4 doit tourner localement.**

## Les 3 options

### Option A — transformers.js (100% navigateur)

Un modèle NER (Named Entity Recognition) tourne directement dans le navigateur via WebAssembly/ONNX.

**Comment ça marche** : le modèle CamemBERT-NER (~50MB quantifié) est téléchargé une seule fois depuis un CDN, puis mis en cache dans IndexedDB. Chaque prompt est analysé localement en ~200-500ms. Le modèle détecte 4 types d'entités : personnes (PER), organisations (ORG), lieux (LOC), et divers (MISC).

| Critère | Valeur |
|---------|--------|
| Données sortantes | Aucune (tout dans le navigateur) |
| Installation | Aucune (CDN + cache auto) |
| Latence | 200-500ms |
| Précision NER français | Bonne (~85% F1) |
| GPU nécessaire | Non |
| Poids modèle | ~50MB (une seule fois) |

**Limites** : ne comprend pas le contexte sémantique profond. Détecte "Jean Dupont" comme personne, mais ne sait pas que "le gars du 3ème" désigne aussi une personne.

### Option B — Presidio (Docker auto-hébergé)

Microsoft Presidio est un framework spécialisé PII qui tourne dans un container Docker sur votre réseau.

**Comment ça marche** : deux containers (analyzer + anonymizer) exposent une API REST sur votre réseau interne. L'extension envoie le texte en POST, Presidio utilise spaCy + regex + contexte pour détecter les PII, et retourne la liste des entités avec un score de confiance.

| Critère | Valeur |
|---------|--------|
| Données sortantes | Aucune (votre serveur) |
| Installation | Docker : 2 containers |
| Latence | 50-100ms |
| Précision NER français | Très bonne (~90% F1 avec spaCy fr_core_news_lg) |
| GPU nécessaire | Non |
| Avantage | Anonymisation intégrée |

**Commandes de déploiement** :
```bash
docker run -d -p 5001:3000 mcr.microsoft.com/presidio-analyzer
docker run -d -p 5002:3000 mcr.microsoft.com/presidio-anonymizer
```

**Limites** : nécessite un serveur Docker accessible depuis les postes. Ne comprend pas les implications sémantiques complexes.

### Option C — LLM local via Ollama

Un vrai LLM tourne sur votre machine ou serveur interne. C'est le plus puissant.

**Comment ça marche** : Ollama expose une API REST sur localhost:11434. L'extension envoie le prompt au LLM local avec un system prompt de classification RGPD. Le modèle comprend le sens des phrases et détecte les données sensibles implicites.

| Critère | Valeur |
|---------|--------|
| Données sortantes | Aucune (localhost) |
| Installation | Ollama + téléchargement modèle |
| Latence | 1-3s (GPU), 5-15s (CPU) |
| Précision | Excellente (compréhension sémantique) |
| GPU nécessaire | Recommandé (8GB VRAM minimum) |
| Poids modèle | 4-7GB (Mistral 7B quantifié) |

**Commandes** :
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull mistral
# L'API est accessible sur http://localhost:11434
```

**Limites** : latence plus élevée, nécessite des ressources matérielles conséquentes.

## Recommandation

| Contexte | Solution recommandée |
|----------|---------------------|
| Startup / équipe petite, pas de serveur | **Option A** (navigateur) |
| Entreprise avec infra Docker | **Option B** (Presidio) |
| Données très sensibles (santé, finance) | **Option B + C** (Presidio + Ollama) |
| Maximum de sécurité | **Option B + C** sur un réseau isolé |

La combinaison idéale : **Presidio pour la détection rapide** (50ms, pas de GPU) **+ Ollama en fallback** pour les cas complexes que Presidio rate. Les deux tournent sur votre infrastructure, rien ne sort.

## Schéma décisionnel

```
Prompt arrive
    │
    ├── Couches 1-3 (regex + fuzzy + contextuel) → < 10ms
    │
    ├── PII trouvées ? → Anonymiser immédiatement
    │
    └── Rien trouvé ? → Couche 4 locale
            │
            ├── Presidio disponible ? → Analyser (50ms)
            │       │
            │       └── PII trouvées ? → Anonymiser
            │
            └── Ollama disponible ? → Classifier (1-3s)
                    │
                    └── PII trouvées ? → Anonymiser
                    
    Résultat final : prompt anonymisé → envoyé au LLM cloud
```
