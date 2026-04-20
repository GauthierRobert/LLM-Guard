# LLM Guard v2 — Extension Chrome Multi-LLM, RGPD & AI Act

Extension Chrome qui intercepte, anonymise et journalise les prompts envoyés à **ChatGPT, Claude, Gemini et Copilot** pour assurer la conformité RGPD et AI Act.

## Nouveautés v2

### Anonymisation automatique
Au lieu de simplement bloquer, l'extension remplace les données personnelles par des placeholders **avant** l'envoi au LLM. L'utilisateur ne voit aucune différence, mais aucune donnée sensible ne quitte l'entreprise.

**Exemple :**
```
Avant  : "Envoie le dossier de Mme Sophie Martin (sophie@rh.fr) au 06 12 34 56 78"
Envoyé : "Envoie le dossier de [PERSONNE_1] ([EMAIL_2]) au [TEL_3]"
```

### Support multi-LLM
| LLM | Domaine surveillé | Endpoint détecté |
|-----|-------------------|------------------|
| ChatGPT | chatgpt.com, chat.openai.com | /conversation (toutes variantes) |
| Claude | claude.ai | /api/*chat/completion/message* |
| Gemini | gemini.google.com | /generate, /stream, BardChatUi |
| Copilot | copilot.microsoft.com | /api/conversation, /sydney |

### Nouveaux détecteurs PII
- **Noms de personnes** (M. Jean Dupont, Mme Martin, Dr Lefebvre…)
- **Adresses postales** (15 rue de la Paix, 42 avenue des Champs…)
- 12 détecteurs au total (vs 10 en v1)

### Dashboard amélioré
- Stats par LLM (quel service est le plus utilisé)
- Compteur de prompts anonymisés
- 3 modes : Anonymiser / Avertir / Bloquer

## Installation

1. Dézipper le fichier
2. `chrome://extensions/` → Mode développeur → Charger l'extension non empaquetée
3. Sélectionner le dossier `llm-guard-v2/`
4. **Recharger** les pages LLM ouvertes (Ctrl+Maj+R)

## Architecture

```
llm-guard-v2/
├── manifest.json      # Manifest V3, multi-domaines
├── content.js         # Injection MAIN — interception + anonymisation
├── bridge.js          # Relais ISOLATED → background
├── background.js      # Service worker — stockage + badges + telemetry
├── telemetry.js       # Upload vers dashboard centralisé (opt-in)
├── options.html/.js   # Configuration du backend
├── popup.html         # Dashboard local multi-LLM
├── shared/
│   └── schema.json    # Contrat d'évènement (extension ↔ api ↔ dashboard)
├── api/               # Backend FastAPI + Postgres/Timescale (self-hosted)
├── dashboard/         # Dashboard Angular 21 (SSR, Material 3)
├── infra/             # docker-compose, Caddy, Keycloak
├── tests/             # 6 suites (~133 tests)
└── icons/
```

## Dashboard centralisé (auto-hébergé)

Pour les équipes sécurité qui veulent une vue de flotte, le projet inclut un backend FastAPI et un dashboard Angular 21 auto-hébergés :

1. `cd infra && docker compose up -d` (Postgres+Timescale, Keycloak, API, dashboard, Caddy TLS)
2. Créer un jeton d'appareil côté dashboard, le coller dans `chrome-extension://.../options.html`
3. Cocher *"Activer l'envoi des métadonnées"* — seules les métadonnées et les aperçus anonymisés (`[EMAIL_1]`, `[PHONE_2]`…) quittent le navigateur

Voir `infra/README.md`, `api-java/README.md`, `dashboard/README.md`.

## Modes de protection

| Mode | Comportement | Données critiques |
|------|-------------|-------------------|
| **Anonymiser** (défaut) | Remplace les PII par des placeholders | Anonymisées aussi |
| **Avertir** | Bandeau d'alerte, laisse passer | Bloquées |
| **Bloquer** | Empêche tout envoi contenant des PII | Bloquées |

## Tests

```bash
node tests/test-scanner-v2.js       # 31 tests détection/anonymisation
node tests/test-advanced-engine.js  # 37 tests pipeline 4 couches
node tests/test-llm-adapters.js     # 18 tests adaptateurs LLM
node tests/test-allowlist.js        # 6 tests allowlist
node tests/test-company-rules.js    # 25 tests whitelist/blacklist entreprise
node tests/test-telemetry.js        # 16 tests télémétrie (scrub, batching, retry)
```

## Limites et prochaines étapes

- **Limites** : détection par regex (pas de NLP), pas de scan des fichiers uploadés, dé-anonymisation des réponses non implémentée côté navigateur (le mapping est prêt)
- **Prochaines étapes possibles** : intégration Microsoft Presidio pour NLP, scan des images/PDF via OCR, webhook vers un SIEM, dé-anonymisation en temps réel dans les réponses SSE, alerting Slack/Teams depuis le dashboard
