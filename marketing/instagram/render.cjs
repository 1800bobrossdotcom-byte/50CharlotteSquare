/* Renders every page in src/ to a PNG in build/: grid posts at 1440 px wide
 * (4/3 of 1080), reel captions and end cards at 1080x1920 (the Reel's own
 * size), captions with a transparent background.
 *   node marketing/instagram/render.cjs            everything
 *   node marketing/instagram/render.cjs grid-05    only pages whose names start so
 *
 * Every line of text is measured where it lands and must sit inside the
 * page's safe area (meta "safe", from make_instagram.py), the part no crop or
 * button of Instagram's covers. Anything outside fails the run, by name.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'build');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const only = process.argv.slice(2);
  const failed = [];
  const wanted = (f) => f.endsWith('.html') && (!only.length || only.some((p) => f.startsWith(p)));
  for (const file of fs.readdirSync(SRC).filter(wanted).sort()) {
    const html = fs.readFileSync(path.join(SRC, file), 'utf8');
    const [w, h] = (/name="ad-size" content="(\d+)x(\d+)"/.exec(html) || [0, 1080, 1350]).slice(1).map(Number);
    const transparent = /name="transparent"/.test(html);
    const scale = file.startsWith('grid-') ? 4 / 3 : 1;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await page.goto('file://' + path.join(SRC, file), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const safe = (/name="safe" content="([\d,]+)"/.exec(html) || [0, ''])[1].split(',').map(Number);
    if (safe.length === 4) {
      const outside = await page.evaluate(([x0, y0, x1, y1]) => {
        const bad = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent.trim()) continue;
          const r = document.createRange(); r.selectNodeContents(n);
          for (const b of r.getClientRects()) {
            if (b.width < 1) continue;
            if (b.left < x0 - 0.5 || b.top < y0 - 0.5 || b.right > x1 + 0.5 || b.bottom > y1 + 0.5) {
              bad.push(`"${n.textContent.trim().slice(0, 40)}" at ${Math.round(b.left)},${Math.round(b.top)}-${Math.round(b.right)},${Math.round(b.bottom)}`);
            }
          }
        }
        return bad;
      }, safe);
      if (outside.length) {
        failed.push(`${file}: outside the safe area ${safe.join(',')}:\n    ${outside.join('\n    ')}`);
      }
    }
    const out = path.join(OUT, file.replace(/\.html$/, '.png'));
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent });
    await page.close();
    console.log('wrote', path.relative(process.cwd(), out));
  }
  await browser.close();
  if (failed.length) {
    console.error('\nText Instagram would cut off or cover:\n  ' + failed.join('\n  '));
    process.exit(1);
  }
  console.log('all text inside the safe areas');
})();
