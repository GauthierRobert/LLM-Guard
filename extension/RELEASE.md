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

1. `npm run build:chrome` → `dist/chrome`.
2. Zip the **contents** of `dist/chrome` (manifest.json at the zip root).
3. Upload at <https://chrome.google.com/webstore/devconsole> ($5 one-time dev fee).
