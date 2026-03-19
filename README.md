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
├── background.js      # Service worker — stockage + badges
├── popup.html         # Dashboard multi-LLM
├── tests/
│   └── test-scanner-v2.js   # 31 tests unitaires
└── icons/
```

## Modes de protection

| Mode | Comportement | Données critiques |
|------|-------------|-------------------|
| **Anonymiser** (défaut) | Remplace les PII par des placeholders | Anonymisées aussi |
| **Avertir** | Bandeau d'alerte, laisse passer | Bloquées |
| **Bloquer** | Empêche tout envoi contenant des PII | Bloquées |

## Tests

```bash
node tests/test-scanner-v2.js
# ✓ 31/31 tests réussis
```

## Limites et prochaines étapes

- **Limites** : détection par regex (pas de NLP), pas de scan des fichiers uploadés, dé-anonymisation des réponses non implémentée côté navigateur (le mapping est prêt)
- **Prochaines étapes possibles** : backend centralisé pour collecter les logs de tous les employés, intégration Microsoft Presidio pour NLP, scan des images/PDF via OCR, webhook vers un SIEM, dé-anonymisation en temps réel dans les réponses SSE
