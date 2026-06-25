import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const svg = readFileSync(new URL('./src/assets/icon.svg', import.meta.url), 'utf8');
const sizes = [16, 48, 128];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  // transparent background; scale the SVG to the viewport
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${s}px;height:${s}px}
  </style></head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  const el = await page.$('svg');
  const buf = await el.screenshot({ omitBackground: true });
  writeFileSync(new URL(`./src/assets/icon-${s}.png`, import.meta.url), buf);
  console.log(`wrote icon-${s}.png`);
}

await browser.close();
