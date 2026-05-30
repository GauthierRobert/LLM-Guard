# LLM Guard — E2E tests (Tier A: deterministic core)

These tests load the unpacked extension into a fresh Chromium, route
`https://chatgpt.com/*` to a local fixture page, and assert that the
extension's intercept → detect → anonymize → inject → de-anonymize loop
behaves correctly.

No real LLM is involved. The fixture mimics ChatGPT's wire format
(`/backend-api/conversation` with `messages[].content.parts[]`), which is
sufficient because the extension matches by hostname + endpoint regex.

## Run

```bash
npm install
npx playwright install chromium
npm run e2e            # headless not supported for MV3 — opens a window
npm run e2e:headed     # explicit headed
npm run e2e:debug      # Playwright inspector
```

CI tip: run under `xvfb-run -a npm run e2e` on Linux.

## Layout

```
e2e/
├── playwright.config.js        # workers=1, headed
├── fixtures/
│   ├── extension.js            # launchPersistentContext + chrome.* helpers
│   └── mock-chatgpt.html       # static page mimicking chatgpt.com wire format
└── extension.spec.js           # tests
```

## What's covered (Tier A)

- Clean prompt passes through unchanged
- Email PII → `[EMAIL_<hex>]` in outgoing body
- Phone + IBAN → corresponding placeholders
- Block mode → 403 returned by extension, route never invoked
- Response de-anonymization rewrites placeholders in the page body
- Banner appears on detection
- Telemetry: configured + enabled flushes events to a mock backend, with
  Bearer auth, correct payload shape, and prompt scrubbed

## What's NOT covered (Tier B — to add later)

- Real `chatgpt.com` DOM/selector drift — needs a smoke test against the
  actual site. That's the next milestone.
