# pdf.js drop-in

LLM Guard lazy-loads pdf.js from this directory to extract text from PDF attachments before they leave the browser. The extension works without these files — PDF attachments will simply be skipped and logged as `UNSCANNED_ATTACHMENT`.

## Expected layout

```
vendor/pdfjs/
├── pdf.mjs          # pdf.js ES module build
└── pdf.worker.mjs   # pdf.js worker
```

## How to populate

Option A — npm:

```bash
npm install pdfjs-dist@^4
cp node_modules/pdfjs-dist/build/pdf.mjs vendor/pdfjs/pdf.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.mjs vendor/pdfjs/pdf.worker.mjs
```

Option B — CDN tarball:

Download the matching release from <https://github.com/mozilla/pdf.js/releases> (the `-dist.zip` asset) and copy the `build/pdf.mjs` + `build/pdf.worker.mjs` files into this directory.

## Version pinning

Tested against `pdfjs-dist@4.9.x`. Major-version upgrades may require tweaking the `GlobalWorkerOptions.workerSrc` setup in `extractors/pdf-extractor.js`.
