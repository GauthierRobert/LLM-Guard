# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LLM Guard v2** is a Chrome extension (Manifest V3) that intercepts prompts sent to LLM services (ChatGPT, Claude, Gemini, Copilot), detects PII using a 4-layer system, and anonymizes/blocks/warns based on configured mode. No build step required — vanilla JavaScript, load unpacked into Chrome.

## Running Tests

```bash
node tests/test-scanner-v2.js          # 31 unit tests (PII detection, anonymization)
node tests/test-advanced-engine.js     # 37 Layer 1-4 detection pipeline tests
node tests/test-llm-adapters.js        # 18 LLM adapter extract/inject tests
node tests/test-allowlist.js           # 6 allowlist/exemption tests
node tests/test-company-rules.js       # 25 company whitelist/blacklist tests
node tests/test-telemetry.js           # 16 telemetry (scrub, batching, retry) tests
node tests/test-anonymizer.js          # 9 anonymizer tests (cross-prompt collisions, stream chunk fix)
node tests/test-layer4-wiring.js       # 8 Layer 4 tests (Presidio classifier + orchestrator)
```

No linting or formatting toolchain is configured.

## Company Customization (Whitelist / Blacklist)

Companies can package the extension with their own whitelist (never-flag patterns) and blacklist (always-flag terms) by editing JSON files and running a build script.

### Workflow

1. Edit `config/whitelist.json` — patterns exempted from PII detection
2. Edit `config/blacklist.json` — company-specific sensitive terms to always flag
3. Run `node build.js` — generates `config/company-rules.js`
4. Load the extension into Chrome as usual

### JSON Formats

**`config/whitelist.json`** — reuses the `loadAllowlist()` entry format:
```json
{
  "entries": [
    { "type": "domain",  "pattern": "company.com" },
    { "type": "email",   "pattern": ".*@company\\.com", "isRegex": true },
    { "type": "keyword", "pattern": "Safe Project Name" }
  ]
}
```

**`config/blacklist.json`** — extends `SENSITIVE_KEYWORDS_CATEGORIZED` format:
```json
{
  "entries": [
    { "term": "Secret Project",     "category": "Projet confidentiel", "severity": "high" },
    { "term": "srv-\\d+\\.internal", "category": "Infrastructure", "severity": "medium", "isRegex": true }
  ]
}
```

### How It Works

- `config/company-rules.js` (generated) is loaded as a content script before `allowlist.js` and `content.js`
- Whitelist entries are auto-loaded into `isAllowlisted()` via `loadCompanyAllowlist()`
- Blacklist keyword entries are merged into `SENSITIVE_KEYWORDS_CATEGORIZED` for fuzzy/Levenshtein detection
- Blacklist regex entries are scanned as a separate layer (Layer 1.6) in `scanForPII()`

## Centralized Dashboard (self-hosted)

The extension can ship metadata to a central dashboard run by a company's SOC. All components are self-hosted — no third-party cloud.

### Architecture

```
Extension (telemetry.js) → POST /v1/events → FastAPI (api/) → Postgres+TimescaleDB
                                                      ↑
Angular 21 dashboard (dashboard/) ──── /v1/stats, /v1/events, WS /v1/live
                           ↑
                      Keycloak (OIDC)
```

- **Wire contract:** `shared/schema.json` (JSON Schema) — Pydantic in `api/`, TS types in `dashboard/src/app/core/schema.generated.ts`.
- **Privacy:** `telemetry.js` strips `promptPreview` and per-finding `samples[]` before upload; URL is reduced to hostname. Only metadata + `anonymizedPreview` (already `[EMAIL_1]`-style) leaves the browser.
- **Opt-in:** disabled by default. Enable in the Options page (`chrome-extension://.../options.html`).

### Extension files

| File | Role |
|------|------|
| `telemetry.js` | Service-worker module: batching, retry (exponential backoff), outbox in `chrome.storage.local.guard_outbox`, scrub filter |
| `options.html` / `options.js` | Configure backend URL, device token, org ID; view queue status; force flush; test connection |
| `shared/schema.json` | Wire contract (JSON Schema) |
| `background.js` | Calls `telemetry.enqueue(event)` after `storeLog`; `chrome.alarms` periodic flush every minute |

### Backend & dashboard

See `api-java/README.md` and `dashboard/README.md` for dev and deployment. Single-node prod via `infra/docker-compose.yml` (Postgres + Timescale, Keycloak, Java API, Angular SSR, Caddy TLS).

## Installing the Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Reload active LLM tabs (`Ctrl+Shift+R`)

## Architecture

### File Structure

```
LLM-Guard/
├── api/                             # Self-hosted FastAPI backend (Python 3.12)
├── dashboard/                       # Angular 21 SOC dashboard (SSR, signals)
├── infra/                           # docker-compose.yml, Caddyfile, Keycloak realm
├── shared/
│   └── schema.json                  # Wire contract between extension ↔ api ↔ dashboard
├── telemetry.js                     # Extension telemetry module (service worker)
├── options.html / options.js        # Extension options page (backend config)
├── config/                          # Company customization (JSON + generated JS)
│   ├── whitelist.json               # Company whitelist (never-flag patterns)
│   ├── blacklist.json               # Company blacklist (always-flag terms)
│   └── company-rules.js             # GENERATED by build.js — do not edit
├── rules/                           # Detection rules (data, no logic)
│   ├── pii-patterns.js              # 12 PII regex patterns (shared)
│   ├── sensitive-keywords.js         # Simple keyword list (content.js)
│   ├── sensitive-keywords-categorized.js  # Keywords + RGPD categories (fuzzy matching)
│   ├── context-rules.js             # Layer 3 contextual rules (5 rules)
│   └── allowlist.js                 # Domain/pattern exemptions + company whitelist
├── utils.js                         # Pure utilities (levenshtein, normalize, maskPII, etc.)
├── ui.js                            # UI infrastructure (banner, badge, logging) — browser-only
├── llm-adapters.js                  # Generic LLM prompt extraction/injection adapters
├── content.js                       # Business logic (scan, anonymize, fetch intercept, de-anonymize responses)
├── advanced-engine.js               # Full 4-layer detection engine (Node.js module for tests)
├── background.js                    # Service worker (storage, stats, badge)
├── bridge.js                        # ISOLATED↔MAIN world message relay
├── layer4-local.js                  # Alternative Layer 4 backends (transformers.js, Presidio)
├── build.js                         # Generates config/company-rules.js from JSON
├── popup.html                       # Extension popup dashboard
├── popup.js                         # Popup dashboard logic
└── tests/
    ├── test-scanner-v2.js           # PII detection + anonymization tests
    ├── test-advanced-engine.js      # 4-layer pipeline tests
    ├── test-llm-adapters.js         # LLM adapter tests
    ├── test-allowlist.js            # Allowlist tests
    └── test-company-rules.js        # Company whitelist/blacklist tests
```

### Module System

All browser files use the `window.__llmGuard` namespace for sharing:
- `window.__llmGuard.patterns` — PII_PATTERNS
- `window.__llmGuard.keywords` — SENSITIVE_KEYWORDS (simple)
- `window.__llmGuard.keywordsCategorized` — SENSITIVE_KEYWORDS_CATEGORIZED (with RGPD categories)
- `window.__llmGuard.contextRules` — CONTEXT_RULES
- `window.__llmGuard.companyConfig` — whitelist, blacklist, blacklistRegex (from build.js)
- `window.__llmGuard.allowlist` — isAllowlisted, loadAllowlist, loadCompanyAllowlist
- `window.__llmGuard.utils` — levenshtein, normalize, maskPII, getMaxSeverity, deduplicateFindings
- `window.__llmGuard.ui` — showBanner, addStatusBadge, logEvent
- `window.__llmGuard.adapters` — extractPrompt, injectAnonymized, LLM_ADAPTERS

All files also export via `module.exports` for Node.js test consumption.

### Execution Contexts

| File | World | Role |
|------|-------|------|
| `content.js` | MAIN (document_start) | Monkey-patches `window.fetch`, applies PII detection & anonymization, de-anonymizes responses |
| `bridge.js` | ISOLATED (document_start) | Relays `window.postMessage` → `chrome.runtime.sendMessage` |
| `background.js` | Service Worker | Stores logs/stats in `chrome.storage`, updates badge |
| `popup.html` | Extension Popup | Dashboard: stats, mode toggle, log stream |

### Detection Pipeline

PII detection layers active in content.js:

| Layer | Mechanism | Latency | Default |
|-------|-----------|---------|---------|
| 1 | Regex — 12 PII patterns (email, phone FR/intl, IBAN, credit card, SSN, IP, date, domain, password, name, address) | <1ms | Always on |
| 1.5 | Simple keyword matching — 18 RGPD-sensitive terms | <1ms | Always on |
| 1.6 | Company blacklist regex — patterns from `config/blacklist.json` | <1ms | Always on (if config exists) |
| 2 | Fuzzy — Levenshtein distance on categorized keywords + company blacklist terms | <5ms | Always on |
| 3 | Contextual rules — Medical + person, Financial + person, Evaluation + person, Indirect ID, Location + person | <10ms | Always on |
| 4 | LLM classification — Claude API call for semantic PII | 1-2s | **Disabled** (requires API key) |

Layer 4 only activates when `LLM_CLASSIFIER_CONFIG.enabled = true` and an API key is set in `advanced-engine.js`. Alternative Layer 4 backends (transformers.js, Presidio Docker) are documented in `layer4-local.js` and `docs/LAYER4-COMPARISON.md`.

### Multi-LLM Support

`LLM_PROFILES` in `content.js` maps hostnames to per-service configurations. Each profile references a generic adapter from `llm-adapters.js` that handles prompt extraction and anonymized injection via field mappings. Adding a new LLM requires:
1. Add an adapter entry in `llm-adapters.js` (field mappings)
2. Add a profile entry in `content.js` (hostname, endpoint, adapter reference)

### Operating Modes

Configured via `CONFIG.mode` in `content.js`:
- `"anonymize"` — replaces PII with typed placeholders (e.g., `[EMAIL_1]`), de-anonymizes LLM responses. Default.
- `"block"` — prevents send on critical/high severity findings

Anonymization uses a session-scoped `Map` (capped at 500 entries) for reversible placeholder-to-value mapping, sorted longest-first to prevent nested replacements.

### Security

- All `postMessage` calls use explicit `window.location.origin` (no wildcard `"*"`)
- All dynamic HTML in popup.html and ui.js uses `createElement` + `textContent` (no innerHTML with user data)
- `window.__originalFetch` is saved before monkey-patching so Layer 4 can bypass the intercept
- Allowlist supports regex and string patterns for exempting known-safe domains/emails

## Key Configuration Points

- **Layer 4 toggle**: `LLM_CLASSIFIER_CONFIG.enabled` in `advanced-engine.js`
- **Layer 4 API key**: `LLM_CLASSIFIER_CONFIG.apiKey` in `advanced-engine.js`
- **Sensitive keyword dictionary** (Layer 2): `rules/sensitive-keywords-categorized.js`
- **Context rules** (Layer 3): `rules/context-rules.js`
- **Company whitelist**: `config/whitelist.json` → run `node build.js` to apply
- **Company blacklist**: `config/blacklist.json` → run `node build.js` to apply
- **Allowlist**: `rules/allowlist.js` (default entries) + company whitelist + chrome.storage (user entries)
- **Max stored logs**: 1000 entries (enforced in `background.js`)
- **Max anonymization map size**: 500 entries (enforced in `content.js`)
