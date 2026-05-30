# LLM Guard — Chrome Extension (v3)

A Manifest V3 Chrome extension that protects personal & sensitive data in prompts
sent to LLM web apps. It intercepts outgoing requests and, depending on the
selected **mode**, either:

- **Anonymize** (default) — replaces detected values with reversible
  `[TYPE_xxxx]` placeholders and restores them in the streamed response, so the
  model never sees the raw data but you still read a normal answer.
- **Warn** — notifies you but sends the prompt unchanged.
- **Block** — refuses to send prompts that contain high-risk data.

All processing is local. No data leaves the browser.

## Supported services

ChatGPT, Claude, Gemini, Copilot, Mistral, Perplexity, DeepSeek, Grok.

## Tech stack

- **TypeScript**, strict mode
- **Vite** + **`@crxjs/vite-plugin`** (MV3 bundling, HMR)
- **Vitest** for unit tests
- **ESLint** (flat config, `typescript-eslint`)

Modules communicate through typed contracts in `src/shared/` — no global-state
hacks.

## Develop

```bash
npm install
npm run dev      # dev build with HMR → load ./dist unpacked
npm run build    # typecheck + production build → ./dist
npm test         # unit tests
npm run lint     # eslint
```

Load it: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `dist/` folder. Reload your LLM tab after building.

## How it works

```
 MAIN world (content/main-world.ts)              ISOLATED world (content/bridge.ts)
 ─ monkey-patches window.fetch                    ─ relays detection events → SW
 ─ findAdapter(host) → matchEndpoint(url)         ─ serves GuardConfig from storage
 ─ scan() / Anonymizer.anonymize()      ⇄ postMessage ⇄
 ─ block → 403 | anonymize → rewrite body                   │ chrome.runtime
 ─ de-anonymizes the streamed response                      ▼
                                                  background/service-worker.ts
                                                  ─ logs, daily stats, toolbar badge
```

### Detection

1. **Regex PII** — 29 patterns (`core/pii-patterns.ts`) with validators
   (Luhn for cards/SIREN/SIRET, IPv4 sanity, JWT header check, RFC-2606
   reserved-email skip).
2. **Overlap resolution** — `core/match.ts` merges overlapping matches from
   different patterns into one non-overlapping set (longest span wins), so you
   never get nested/duplicate placeholders.
3. **Keywords** — `core/keywords.ts` flags sensitive terms (reported, not
   replaced).

### Anonymization

`core/anonymizer.ts` rebuilds the text by walking spans left-to-right, minting
stable `[TYPE_<fnv1a6>]` placeholders (same value → same placeholder within a
session) and keeping a reversible map. A streaming de-anonymizer restores
placeholders even when one is split across response chunks.

## Project layout

```
src/
├── shared/        # types.ts (domain contracts), messages.ts (wire protocol)
├── core/          # validators, pii-patterns, keywords, match, detector, anonymizer
├── adapters/      # one LLMAdapter per service + registry (findAdapter)
├── content/       # main-world.ts (MAIN), bridge.ts (ISOLATED)
├── background/    # service-worker.ts
├── ui/            # banner.ts (in-page toast)
├── popup/         # popup dashboard (mode, stats, activity)
└── options/       # full settings page
```

## Add a new LLM service

1. Create `src/adapters/<service>.ts` implementing `LLMAdapter`
   (`hostnames`, `matchEndpoint`, `extractPrompts`, `injectPrompts`).
2. Register it in `src/adapters/index.ts`.
3. Add its host globs to `manifest.config.ts`.
