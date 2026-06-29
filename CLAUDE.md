# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview (v3 — current)

**LLM Guard v3** is a clean-room rewrite of the Chrome extension (Manifest V3) in **TypeScript**, bundled with **Vite + `@crxjs/vite-plugin`** and tested with **Vitest**. It intercepts prompts sent to LLM services and, according to **DPO-authored YAML rules**, either **anonymizes** sensitive data with reversible `[LABEL_xxxx]` placeholders, **warns**, or **blocks** the request — **each rule declares its own action**. Anonymization is reversible but de-anonymization is **manual**: the response keeps the placeholders and a **popup button** reveals/hides the real values directly in the page.

The new extension lives entirely under **`extension/`**. The previous vanilla-JS v2 (4-layer engine, telemetry, company rules) is archived under **`legacy/`** for reference. The self-hosted backend/dashboard (`api-java/`, `dashboard/`, `infra/`, `shared/`) are unchanged.

### Working on the extension (`extension/`)

```bash
cd extension
npm install            # or rely on the SessionStart hook (.claude/hooks/session-start.sh)
npm run dev            # Vite dev build (Chrome) with HMR → extension/dist/chrome
npm run dev:firefox    # Vite dev build (Firefox) → extension/dist/firefox
npm run build          # tsc --noEmit, then build BOTH packages (chrome + firefox)
npm run build:chrome   # production build → extension/dist/chrome
npm run build:firefox  # production build → extension/dist/firefox
npm test               # Vitest unit suite (core detection, anonymizer, adapters)
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint (flat config, typescript-eslint)
```

**Cross-browser build (one engine, two packages):** the shared `src/` engine is built
twice, once per target. The `BROWSER` env var (`chrome` | `firefox`, default `chrome`,
set via `cross-env` in the npm scripts) drives both `vite.config.ts` (output dir
`dist/<browser>` + `crx({ browser })`) and `manifest.config.ts` (Chrome uses
`background.service_worker`; Firefox uses `background.scripts` + a required
`browser_specific_settings.gecko` id and `strict_min_version: "128.0"`, since
`world: "MAIN"` content scripts need Firefox 128+). `npm run build` emits both.

Load unpacked (Chrome): `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/dist/chrome`.
Load temporary (Firefox): `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `extension/dist/firefox/manifest.json`.

**Publishing:** see `extension/RELEASE.md`. Firefox ships as a **listed** add-on on AMO
(signed by Mozilla) via `web-ext` — `npm run lint:firefox` (AMO validator, 0 errors
required), `npm run package:firefox` (zip), `npm run sign:firefox` / `release:firefox`
(build → lint → sign, using `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`). The gecko id is
fixed in `manifest.config.ts` and must not change after the first submission.

### Architecture (`extension/src/`)

| Path | Role |
|------|------|
| `shared/types.ts` | Domain contracts: `Severity`, `AnonymizeSpan`, `IAnonymizer` |
| `shared/messages.ts` | Cross-context messaging + `GuardConfig` (`enabled` + `ner`) + rules/reveal/NER messages + storage keys |
| `core/rules/rules.default.yaml` | Bundled, DPO-readable default rules (imported via Vite `?raw`) |
| `core/rules/{types,schema,parse,compile,engine,defaults}.ts` | YAML rule model → validate → compile to regex matchers → `evaluate(text)` |
| `core/match.ts` | Generic `resolveOverlaps()` — collapses overlapping spans into one non-overlapping set |
| `core/validators.ts` | Luhn / IPv4 / JWT / reserved-email validators (used by built-in matchers) |
| `core/anonymizer.ts` | `Anonymizer`: `anonymizeSpans()` (reversible `[LABEL_xxxx]`), `deanonymize()`, `exportMap()` |
| `core/ner/{types,merge,engine,host}.ts` | **NER layer (v4.3)**: `NerConfig` + `mergeNerFindings()` (pure, merges model entities into the rules result, regex wins overlaps), transformers.js `detectEntities()`, and the cross-browser `detectViaHost()` |
| `adapters/*.ts` | Per-service request shapers + optional `conversationSelector` (reveal scope), implementing `LLMAdapter` |
| `content/main-world.ts` | MAIN world: patches `window.fetch`, runs `evaluate()`, awaits NER, anonymizes anonymize-action spans, handles reveal |
| `content/reveal.ts` | MAIN world: in-page reveal/hide of real values (TreeWalker, marker spans, React-safe) |
| `content/bridge.ts` | ISOLATED world: relays config + rules + reveal commands, detection events, and NER requests |
| `background/service-worker.ts` | Stores logs/stats, seeds + validates + serves rules YAML, updates the badge, routes NER to the host |
| `background/offscreen.{html,ts}` | Chrome offscreen document hosting the transformers.js NER model (extension CSP, persistent) |
| `ui/banner.ts` | In-page toast (createElement/textContent only) |
| `popup/` | Popup: enable switch, **Reveal/Hide** button, stats, activity |
| `options/` | Options: enable switch + **DPO YAML rules editor** (load/validate/save/reset) |

**Detection pipeline:** `evaluate(prompt, rules)` runs built-in validated matchers + the DPO's `words`/`regex`/`combination` rules, drops whitelist spans, resolves overlaps, and returns findings + a **decision = most severe action** (`block > anonymize > warn`). Rules are authoritative — there is no global mode.

**NER layer (v4.3):** when `GuardConfig.ner.enabled`, `main-world.ts` awaits an on-device NER pass after `evaluate()` and folds the entities into the same result via `mergeNerFindings()` (exact regex findings win overlaps; entities are filtered by per-group action/severity/confidence in `NerConfig`). The model (`@huggingface/transformers`, default `Xenova/bert-base-multilingual-cased-ner-hrl`) runs **once** in a persistent host — a Chrome **offscreen document** or, on Firefox (no offscreen API), the background script — selected at runtime by feature-detecting `chrome.offscreen`. Flow: `main-world` → `bridge` (`ner-request`) → service worker (`ner-detect`) → `detectViaHost()` → entities back. The ONNX WASM is bundled locally; model **weights** download once from the HuggingFace CDN (allowed via the `extension_pages` CSP) and are browser-cached. NER spans reuse the existing anonymizer/reveal path unchanged. ⚠️ Defaults to **on** for testing — gate or expose it before a public release (each NER inference adds latency on the send path and the first use downloads the model).

**Rules:** stored as a YAML string in `chrome.storage.sync` (`guard_rules_yaml`); the bundled default seeds it on install. The service worker validates size + syntax on save; the bridge pushes the YAML to the MAIN world, which compiles and evaluates.

**Adding an LLM:** add an adapter in `extension/src/adapters/` (implement `LLMAdapter`, optionally set `conversationSelector`), register it in `adapters/index.ts`, and add the hostname globs to `extension/manifest.config.ts`.

**Editing detection rules:** change `extension/src/core/rules/rules.default.yaml` (the bundled default) or, at runtime, the Options-page YAML editor. Options-page saves apply live to open LLM tabs (validated — parse **and** compile — by the service worker, pushed via `storage.onChanged`). Changes to the bundled default require a rebuild + extension reload; on update the service worker re-seeds storage with the new default **only if** the stored rules were never customized (tracked via `guard_rules_seeded_yaml`), and re-injects the bridge into already-open LLM tabs so the rules feed survives the reload.

---

## Legacy (v2 — archived under `legacy/`)

> The sections below describe the archived v2 vanilla-JS extension, now under `legacy/`. Kept for reference; not the active codebase. Paths in those sections are relative to `legacy/`.

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
