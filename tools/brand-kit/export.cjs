// PNGs and PDFs of every SVG master build.py wrote, rendered by Chromium.
//
//   npm i --no-save playwright && npx playwright install chromium   (once)
//   node tools/brand-kit/export.cjs
//
// PNGs have transparent backgrounds. PDFs are vector, one artwork per page at
// the master's own size; the white versions look empty on a white page, which
// is what a white logo on a transparent page looks like.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'brand');
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));

// Widths in pixels. Logos and wordmarks: email and web, social posts, print.
const WIDTHS = { logo: [600, 1200, 2400], wordmark: [600, 1200, 2400], mark: [256, 512, 1024, 2048], social: [1080] };

const page = (svg, w, h) => `<!doctype html><html><head><style>
  @page { size: ${w}px ${h}px; margin: 0 }
  html, body { margin: 0; background: transparent; overflow: hidden }
  img { display: block; width: ${w}px; height: ${h}px }
</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;

(async () => {
  const browser = await chromium.launch();
  let pngs = 0, pdfs = 0;
  for (const e of manifest) {
    const svg = fs.readFileSync(path.join(OUT, e.svg), 'utf8');
    const stem = path.join(OUT, e.svg.replace(/\.svg$/, ''));
    for (const w of WIDTHS[e.kind]) {
      const h = Math.round((w * e.h) / e.w);
      const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await p.setContent(page(svg, w, h));
      await p.locator('img').evaluate((img) => img.decode());
      const png = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
      fs.writeFileSync(`${stem}-${w}px.png`, png);
      await p.close();
      pngs++;
    }
    if (e.kind !== 'social') {
      const w = Math.round(e.w * 100) / 100, h = Math.round(e.h * 100) / 100;
      const p = await browser.newPage({ viewport: { width: Math.ceil(w), height: Math.ceil(h) } });
      // Inline, not an <img>: an inline SVG prints as vector paths.
      await p.setContent(page('', w, h).replace(/<img[^>]*>/, svg.replace(/<svg /, '<svg style="display:block" ')));
      await p.pdf({ path: `${stem}.pdf`, width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: '1' });
      await p.close();
      pdfs++;
    }
  }

  // The two-page guide, from guide.html beside this script.
  const g = await browser.newPage();
  await g.goto('file://' + path.join(__dirname, 'guide.html'), { waitUntil: 'load' });
  await g.evaluate(() => document.fonts.ready);
  await g.pdf({ path: path.join(OUT, 'Charlotte-Square-Logo-Guide.pdf'), preferCSSPageSize: true, printBackground: true });
  await g.close();

  await browser.close();
  console.log(`wrote ${pngs} PNGs, ${pdfs} PDFs and the guide to brand/`);
})();

