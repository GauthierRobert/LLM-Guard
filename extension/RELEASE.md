# Releasing AvoPseudo

One shared `src/` engine → two packages. `BROWSER=chrome|firefox` (default `chrome`,
set via `cross-env` in the npm scripts) drives `vite.config.ts` (output `dist/<browser>`)
and `manifest.config.ts` (per-browser manifest shape).

```bash
cd extension
npm run build            # typecheck once, then build BOTH packages
npm run build:chrome     # → dist/chrome
npm run build:firefox    # → dist/firefox
```

---

## Firefox — public listing on addons.mozilla.org (AMO)

External users install from AMO, so this is a **listed** release. Every install outside
"Load Temporary Add-on" must be **signed by Mozilla**; AMO does that on submission.

### One-time setup

1. **Pick the final add-on id.** It's set in `extension/manifest.config.ts`
   (`browser_specific_settings.gecko.id`, currently `avopseudo@avocat.tools`). AMO binds
   the listing to this id permanently — change it *before* the first submission, never after.
2. Create an account at <https://addons.mozilla.org>.
3. Generate API credentials at <https://addons.mozilla.org/developers/addon/api/key/>
   (JWT issuer + secret).
4. Export them so `web-ext` picks them up automatically (no secrets on the CLI):

   ```bash
   # PowerShell
   $env:WEB_EXT_API_KEY    = "user:xxxxxxxx:123"     # the JWT issuer
   $env:WEB_EXT_API_SECRET = "xxxxxxxxxxxxxxxxxxxx"  # the JWT secret

   # bash
   export WEB_EXT_API_KEY="user:xxxxxxxx:123"
   export WEB_EXT_API_SECRET="xxxxxxxxxxxxxxxxxxxx"
   ```

### Listing was created via the API

The add-on already exists on AMO (guid `avopseudo@avocat.tools`, slug `avopseudo`),
created by `release:firefox`. `extension/amo-metadata.json` carries the API-required
fields (`categories: ["privacy-security"]`, `version.license: "all-rights-reserved"`).

What still must be completed once in the **Developer Hub** before it can go live:
name, summary, description, screenshots, and privacy policy — the API cannot set these.

> Mozilla reviewers require **reviewable source** for bundled extensions. `source:firefox`
> produces `web-ext-artifacts/avopseudo-source.tar.gz` and `sign:firefox` uploads it.
> Build steps for the reviewer: Node 22, `npm ci`, `npm run build:firefox` → `dist/firefox`.
> NOTE: the source archive **must use forward-slash paths** — use `tar` (as the script
> does), not PowerShell `Compress-Archive`, which writes `src\…` and AMO rejects with
> *"Invalid file name in archive"*.

### Every subsequent release

1. Bump `version` in `extension/package.json` (the manifest version derives from it).
2. Run:

   ```bash
   npm run release:firefox    # build:firefox → lint:firefox → source:firefox → sign:firefox
   ```

   This builds, validates, packages the source tarball, then uploads the new version +
   source. Listed versions go through AMO review before going live; the listing metadata
   carries over — no UI step needed.

### Validate locally before submitting

`npm run lint:firefox` runs the same validator AMO uses. **0 errors** is required;
warnings are advisory (e.g. `data_collection_permissions` is consumed only on Firefox
140+ and harmlessly ignored on our 128 floor).

---

## Chrome — Chrome Web Store

### Build the package

```bash
npm run build:chrome      # → dist/chrome
npm run package:chrome    # → web-ext-artifacts/avopseudo-chrome-<version>.zip
```

`package:chrome` zips the **contents** of `dist/chrome`, so `manifest.json` lands
at the zip root — the Web Store rejects a zip with a wrapping folder. Check it:

```bash
unzip -l web-ext-artifacts/avopseudo-chrome-*.zip | head
```

### Upload

1. Bump `version` in `package.json` **first** — the manifest version derives from
   it, and the Web Store refuses a version that is not strictly higher than the
   published one. There is no way to reuse or roll back a version number.
2. <https://chrome.google.com/webstore/devconsole> → the **AvoPseudo** item.
3. **Package** → *Upload new package* → the zip → **Save draft**.
4. Walk the **Store listing**, **Privacy** and **Distribution** tabs — see below.
5. **Submit for review**. Review is typically hours-to-days; it is slower when
   permissions changed or the package is large (ours is ~19 MB zipped / ~78 MB
   unpacked, almost entirely the four ONNX WASM runtime variants under `ort/`).

### What must be re-checked on every submission

- **Store listing** — the description, screenshots and promo images are separate
  from `manifest.description`. Uploading a package does **not** update them.
  Screenshots showing an older UI are the most common thing to forget.
- **Privacy tab** — single-purpose statement, a justification per permission,
  the "remote code" answer, and the data-usage certification. Google requires
  the certification to be re-affirmed each time, even when nothing changed.
- **Privacy policy URL** — `docs/privacy-policy.html`, served from GitHub Pages.
  It must describe what the extension actually does *in the version you are
  submitting*.

### Answers that apply to this extension

| Question | Answer | Why |
|---|---|---|
| Remote code? | **No** | All JS/WASM ships in the package; `ort/` is bundled precisely so nothing executable is fetched at runtime. |
| Collects user data? | **No** | Prompts, detected values, logs and stats never leave `chrome.storage.local`. |
| Outbound network? | Model **weights** only | With the on-device NER layer enabled, `@huggingface/transformers` downloads model weights from `huggingface.co` / `*.hf.co` on first use (see `content_security_policy.extension_pages`). Data, not code — but it *is* a third-party request that exposes the user's IP, so the privacy policy must say so. |

### Permissions, and how to justify them

| Permission | Justification |
|---|---|
| `storage` | Stores the detection rules, settings, and the local activity log. |
| `alarms` | Daily reset of the toolbar badge counter. |
| `scripting` | Re-injects the content-script bridge into already-open tabs after an update, so protection resumes without a manual reload. |
| `offscreen` | Hosts the on-device NER model outside the service worker (which cannot run WASM persistently). |
| Host permissions (the LLM hostnames) | Read and pseudonymise text pasted into those chat composers. |
