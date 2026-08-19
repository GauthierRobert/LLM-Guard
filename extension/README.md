# AvoPseudo — browser extension (v5)

A Manifest V3 extension (Chrome + Firefox) that protects personal & sensitive
data in LLM web apps — **at the moment you paste it**.

When you paste into a chat composer (Ctrl/⌘+V, right-click *Paste*, or a paste
button), AvoPseudo reads the clipboard text, checks it against **rules your DPO
writes in plain YAML**, and acts *before the text reaches the box*. Every rule
declares its own action:

- **Anonymize** — the value is replaced with a reversible `[LABEL_xxxx]`
  placeholder as it is pasted. What you see in the box is already pseudonymised,
  so the model can never see the raw data — not even if you send by accident.
- **Warn** — the text is pasted unchanged, with a warning.
- **Block** — nothing is pasted at all.

When a paste triggers several rules, the **most severe action wins**
(`block > anonymize > warn`).

All processing is local. No data leaves the browser.

## You always know it was us

The whole point of pseudonymising in the composer is that the change is visible
*before* you send — so it has to be unmistakably attributable. Every time
AvoPseudo steps in, a branded panel appears next to the chat box and says so:

- it carries the AvoPseudo shield and the words **"You are reading a message
  from your AvoPseudo extension — not from this website, and not from the AI"**;
- it states that the `[LABEL_xxxx]` tags now in the box **were written by the
  extension**, not by you and not by the model;
- it lists every value that was replaced — masked, with a *Show originals*
  toggle — next to the placeholder that replaced it;
- it offers **Undo — paste my original** if you disagree;
- the composer itself flashes an outline so your eye goes to what changed.

The panel lives in a **shadow root** and is styled entirely through the CSSOM,
so no host page CSS can restyle it and no page Content-Security-Policy can
suppress it.

## Manual reveal

Anonymization is reversible but **never automatic**. The conversation keeps the
placeholders — `[EMAIL_a1b2c3]` and friends — in your messages and in the
model's answers. Click **Reveal real values** in the popup to swap them for the
real values directly in the page; click again to **Hide** them. The
placeholder→value map lives only in the page's memory for that session.

## Guarding the send as well (optional)

Pasting is where sensitive data realistically enters a prompt, but text you
*type* never passes through the paste guard. **Settings → Also check when I send**
turns the v4 behaviour back on: the outgoing request is intercepted and rewritten
too. It is **off by default**, because that rewrite happens invisibly, after you
have already hit send.

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
npm run dev          # dev build with HMR (Chrome)  → dist/chrome
npm run dev:firefox  # dev build (Firefox)          → dist/firefox
npm run build        # typecheck + both production packages
npm test             # unit tests
npm run lint         # eslint
```

Load it in Chrome: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `dist/chrome`. In Firefox:
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
`dist/firefox/manifest.json`. Reload your LLM tab after building.

## How it works

```
 MAIN world (content/*)                        ISOLATED world (content/bridge.ts)
 ─ paste-guard.ts: capture-phase `paste`         ─ serves config + rules YAML
 ─ evaluate(pasted text, rules) [+ NER]          ─ relays detections → SW
 ─ paste-plan.ts → outcome + text        ⇄ postMessage ⇄  reveal commands → MAIN
 ─ composer.ts writes it into the box                       │ chrome.runtime
 ─ ui/paste-notice.ts explains what we did                  ▼
 ─ reveal/hide real values (reveal.ts)          background/service-worker.ts
 ─ opt-in: window.fetch patch (send guard)      ─ logs, stats, badge
                                                ─ seeds + validates + serves rules
```

### The paste path

1. A capture-phase `paste` listener reads `clipboardData` `text/plain` and
   resolves the composer — `<textarea>` *or* a ProseMirror/Lexical-style
   `contenteditable`, found generically, with no per-site selector.
2. `evaluate()` runs on the pasted text itself, so the finding offsets apply
   directly.
3. If nothing is found (and the ML layer is off) the guard **stands aside** and
   lets the browser do its own, higher-fidelity native paste.
4. Otherwise it takes the event over — `preventDefault()` **plus**
   `stopImmediatePropagation()`, because rich editors handle `paste` themselves
   and would otherwise insert the text a second time — and writes the planned
   text back: `execCommand("insertText")` for rich editors (they observe it
   exactly like a keystroke), the native value setter + an `input` event for
   text fields (so React's value tracker notices).
5. The notice panel reports what changed; **Undo** puts the original back.

### Detection

`core/rules/engine.ts` `evaluate(text, rules)`:

1. Collect **whitelist** spans (never flagged).
2. Collect candidate spans from built-in matchers + the DPO's `words` / `regex`
   / `combination` rules (a combination fires only if **all** its conditions hit).
3. Drop candidates overlapping a whitelist span.
4. **Overlap resolution** (`core/match.ts` `resolveOverlaps`) → one
   non-overlapping set (longest span wins, ties by rule order).
5. Map to findings and pick the **decision** (most severe action).

### Pseudonymisation

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
│   ├── ner/       # optional on-device entity model (types/merge/engine/host)
│   ├── match.ts   # generic overlap resolver
│   ├── validators.ts
│   └── anonymizer.ts
├── adapters/      # one LLMAdapter per service (+ conversationSelector) + registry
├── content/       # MAIN: paste-guard, paste-plan, composer, main-world, reveal
│                  # ISOLATED: bridge.ts
├── background/    # service-worker.ts (+ offscreen NER host)
├── ui/            # paste-notice.ts (the branded panel), banner.ts (toast)
├── popup/         # enable switch, reveal button, recent activity
└── options/       # guard switches + DPO YAML rules editor
```

## Add a new LLM service

Adding the host globs to `manifest.config.ts` is enough for the paste guard —
it finds the composer generically. An adapter additionally gives the service a
name in the activity log, a reveal scope, and send-guard support:

1. Create `src/adapters/<service>.ts` implementing `LLMAdapter`
   (`hostnames`, `matchEndpoint`, `extractPrompts`, `injectPrompts`,
   optionally `conversationSelector` to scope the in-page reveal).
2. Register it in `src/adapters/index.ts`.
3. Add its host globs to `manifest.config.ts`.
