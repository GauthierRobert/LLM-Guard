# LLM Guard

A Manifest V3 Chrome extension that protects personal & sensitive data in the
prompts you send to LLM web apps (**ChatGPT, Claude, Gemini, Copilot, Mistral,
Perplexity, DeepSeek, Grok**). It intercepts each outgoing request and acts on it
according to **rules your DPO writes in plain YAML** — every rule declares its own
action:

- **Anonymize** — replace the detected value with a reversible `[LABEL_xxxx]`
  placeholder before the request leaves the browser. The model never sees the raw
  data. The answer comes back with the placeholders; you reveal the real values
  **manually** with a button in the popup.
- **Warn** — notify you, but send the prompt unchanged.
- **Block** — refuse to send the prompt at all (returns a local 403).

When a prompt triggers several rules, the **most severe action wins**
(`block > anonymize > warn`).

**All processing is local. No prompt content, detected value, or activity ever
leaves the browser** — see the [privacy policy](docs/privacy-policy.html).

---

## Repository layout

| Path | What it is |
|------|------------|
| **[`extension/`](extension/)** | **v3 — the current extension.** TypeScript, Vite + `@crxjs`, Vitest. See [`extension/README.md`](extension/README.md). |
| `docs/` | `privacy-policy.html` (served via GitHub Pages for the Web Store listing). |
| `legacy/` | The previous vanilla-JS **v2** extension (4-layer engine, telemetry, company rules), archived for reference. |
| `api-java/`, `dashboard/`, `infra/`, `shared/` | Optional self-hosted backend + SOC dashboard (Java API, Angular 21, docker-compose). Independent of the v3 extension, which talks to no server. |

## Quick start (extension)

```bash
cd extension
npm install
npm run dev      # dev build with HMR → load ./dist unpacked
npm run build    # typecheck + production build → ./dist
npm test         # Vitest unit suite
npm run lint     # ESLint
```

Load it: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/dist`. Reload your LLM tab after building.

## DPO rules (YAML)

Rules are authored in YAML — readable by a non-developer. A default rule set is
bundled; the **Options page** has an editor to paste/edit YAML, which is validated
(syntax + schema + size) and applied live to open tabs.

```yaml
version: 1
defaults: { action: anonymize, severity: medium }

whitelist:                       # never flagged, even if a rule matches
  - "support@acme.com"

blacklist:                       # always flagged, with this action
  action: block
  severity: critical
  values: ["Project Titan"]

rules:
  - id: email                    # kind: words | regex | combination
    kind: regex
    action: anonymize            # block | anonymize | warn
    placeholder: EMAIL           # → [EMAIL_xxxx]
    pattern: "[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}"

  - id: codenames
    kind: words                  # case-insensitive, word-boundary aware
    action: warn
    words: ["Bluebird", "Project Falcon"]
```

Built-in **validated** matchers (credit cards via Luhn, IPv4, JWT) always run on
top of the YAML rules, so the DPO doesn't have to express maths checks.

## How it works

```
 MAIN world (content/main-world.ts)            ISOLATED world (content/bridge.ts)
 ─ patches window.fetch                          ─ serves config + rules YAML
 ─ findAdapter(host) → matchEndpoint(url)        ─ relays detections → SW
 ─ evaluate(prompt, rules) → decision   ⇄ postMessage ⇄   reveal commands → MAIN
 ─ block → 403 | warn → pass | anonymize spans              │ chrome.runtime
 ─ reveal/hide real values in the page                      ▼
 (content/reveal.ts)                            background/service-worker.ts
                                                ─ logs, badge, seeds/validates rules
```

Full architecture, the detection pipeline, and how to add a new LLM service are
documented in [`extension/README.md`](extension/README.md).

## Adding an LLM service

1. Create `extension/src/adapters/<service>.ts` implementing `LLMAdapter`.
2. Register it in `extension/src/adapters/index.ts`.
3. Add its host globs to `extension/manifest.config.ts`.

---

## Legacy v2 & self-hosted backend

The archived **v2** extension and the optional self-hosted stack are documented
separately: see `legacy/`, `infra/README.md`, `api-java/README.md`, and
`dashboard/README.md`. The v3 extension does not depend on any of them.
