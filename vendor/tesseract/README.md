# tesseract.js drop-in

LLM Guard lazy-loads tesseract.js from this directory to OCR image attachments before they leave the browser. The extension works without these files — image attachments will simply be skipped and logged as `UNSCANNED_ATTACHMENT`.

## Expected layout

```
vendor/tesseract/
├── tesseract.min.js         # main library
├── worker.min.js            # worker script
├── tesseract-core.wasm.js   # wasm loader
└── lang-data/
    ├── eng.traineddata.gz   # English model
    └── fra.traineddata.gz   # French model
```

## How to populate

Option A — npm:

```bash
npm install tesseract.js@^5
cp node_modules/tesseract.js/dist/tesseract.min.js vendor/tesseract/
cp node_modules/tesseract.js/dist/worker.min.js vendor/tesseract/
cp node_modules/tesseract.js-core/tesseract-core.wasm.js vendor/tesseract/

mkdir -p vendor/tesseract/lang-data
curl -L -o vendor/tesseract/lang-data/eng.traineddata.gz https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz
curl -L -o vendor/tesseract/lang-data/fra.traineddata.gz https://tessdata.projectnaptha.com/4.0.0/fra.traineddata.gz
```

## Version pinning

Tested against `tesseract.js@5.x`. The models are gzipped traineddata files from <https://github.com/tesseract-ocr/tessdata>. First use will cache them in IndexedDB so later OCRs are fast (sub-3s for a 3 MP image).

## Bundle size

The three JS files total ~2 MB; the two language models are ~10 MB each gzipped. Ship all five files as part of the extension if you want zero first-use latency; otherwise point `langPath` at a mirror that serves them.
