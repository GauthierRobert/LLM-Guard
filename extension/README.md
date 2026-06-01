# LLM Guard — Chrome Extension (v3)

A Manifest V3 Chrome extension that protects personal & sensitive data in prompts
sent to LLM web apps. It intercepts outgoing requests and acts on them according
to **rules your DPO writes in plain YAML**. Every rule declares its own action:

- **Anonymize** — replace the detected value with a reversible `[LABEL_xxxx]`
  placeholder before the request leaves the browser. The model never sees the
  raw data. The response keeps the placeholders; you reveal the real values
  **manually** with a button in the popup (see below).
- **Warn** — notify you, but send the prompt unchanged.
- **Block** — refuse to send the prompt at all (returns a local 403).

When a prompt triggers several rules, the **most severe action wins**
(`block > anonymize > warn`).

All processing is local. No data leaves the browser.

## Manual reveal

Anonymization is reversible but **never automatic**. After a prompt is
anonymized, the LLM's answer comes back containing placeholders like
`[EMAIL_a1b2c3]`. Click **Reveal real values** in the popup to swap them for the
real values directly in the page; click again to **Hide** them. The
placeholder→value map lives only in the page's memory for that session.

## DPO rules (YAML)

Rules are authored in YAML — readable by a non-developer. A default rule set is
bundled; the **Options page** has an editor to paste/edit YAML, which is
validated (syntax + schema + size) and saved to `chrome.storage.local`
(the ruleset is larger than `chrome.storage.sync`'s ~8KB per-item cap).

```yaml
version: 1
defaults: { action: anonymize, severity: medium }

whitelist:            # never flagged, even if a rule matches
  - "support@acme.com"

blacklist:            # always flagged, with this action
  action: block
  severity: critical
  values: ["Project Titan"]

rules:
  - id: email                 # kind: words | regex | combination
    kind: regex
    action: anonymize         # block | anonymize | warn
    placeholder: EMAIL        # → [EMAIL_xxxx]
    pattern: "[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}"

  - id: codenames
    kind: words               # case-insensitive, word-boundary aware
    action: warn
    words: ["Bluebird", "Project Falcon"]

  - id: salary-with-amount
    kind: combination         # fires only if ALL conditions appear
    action: warn
    all:
      - { kind: words, words: ["salaire", "salary"] }
      - { kind: regex, pattern: "\\d+\\s?k€" }
```

Built-in **validated** matchers (credit cards via Luhn, IPv4, JWT) always run on
top of the YAML rules so the DPO doesn't have to express maths checks.

## Supported services

ChatGPT, Claude, Gemini, Copilot, Mistral, Perplexity, DeepSeek, Grok.

## Tech stack

- **TypeScript**, strict mode
- **Vite** + **`@crxjs/vite-plugin`** (MV3 bundling, HMR)
- **`js-yaml`** for rule parsing
- **Vitest** (+ jsdom for the reveal tests)
- **ESLint** (flat config, `typescript-eslint`)

Modules communicate through typed contracts in `src/shared/`.

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
 MAIN world (content/main-world.ts)            ISOLATED world (content/bridge.ts)
 ─ patches window.fetch                          ─ serves config + rules YAML
 ─ findAdapter(host) → matchEndpoint(url)        ─ relays detections → SW
 ─ evaluate(prompt, rules) → decision   ⇄ postMessage ⇄   reveal commands → MAIN
 ─ block → 403 | warn → pass | anonymize spans              │ chrome.runtime
 ─ reveal/hide real values in the page                      ▼
 (content/reveal.ts)                            background/service-worker.ts
                                                ─ logs, stats, badge
                                                ─ seeds + validates + serves rules
```

### Detection

`core/rules/engine.ts` `evaluate(text, rules)`:

1. Collect **whitelist** spans (never flagged).
2. Collect candidate spans from built-in matchers + the DPO's `words` / `regex`
   / `combination` rules (a combination fires only if **all** its conditions hit).
3. Drop candidates overlapping a whitelist span.
4. **Overlap resolution** (`core/match.ts` `resolveOverlaps`) → one
   non-overlapping set (longest span wins, ties by rule order).
5. Map to findings and pick the **decision** (most severe action).

### Anonymization

`core/anonymizer.ts` `anonymizeSpans()` walks the caller-supplied spans
left-to-right, minting stable `[LABEL_<fnv1a6>]` placeholders (same value → same
placeholder within a session) and keeping a reversible map. `deanonymize()` and
the in-page reveal restore the originals on demand — there is no automatic
response rewriting.

## Project layout

```
src/
├── shared/        # types.ts (contracts), messages.ts (wire protocol + storage keys)
├── core/
│   ├── rules/     # rules.default.yaml + types/schema/parse/compile/engine/defaults
│   ├── match.ts   # generic overlap resolver
│   ├── validators.ts
│   └── anonymizer.ts
├── adapters/      # one LLMAdapter per service (+ conversationSelector) + registry
├── content/       # main-world.ts (MAIN), reveal.ts (MAIN), bridge.ts (ISOLATED)
├── background/    # service-worker.ts
├── ui/            # banner.ts (in-page toast)
├── popup/         # enable switch, reveal button, stats, activity
└── options/       # enable switch + DPO YAML rules editor
```

## Add a new LLM service

1. Create `src/adapters/<service>.ts` implementing `LLMAdapter`
   (`hostnames`, `matchEndpoint`, `extractPrompts`, `injectPrompts`,
   optionally `conversationSelector` to scope the in-page reveal).
2. Register it in `src/adapters/index.ts`.
3. Add its host globs to `manifest.config.ts`.
