/* Renders every ad in src/ to a PNG beside this file, at 1440 px wide: the
 * size Instagram and Facebook keep at full quality. Needs Playwright:
 *   npx playwright install chromium   (once)
 *   node marketing/social-ads/render.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const SCALE = 4 / 3;   // 1080 css px -> 1440 px

(async () => {
  const browser = await chromium.launch();
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(SRC, file), 'utf8');
    const [w, h] = (/name="ad-size" content="(\d+)x(\d+)"/.exec(html) || [0, 1080, 1080]).slice(1).map(Number);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: SCALE });
    await page.goto('file://' + path.join(SRC, file), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(__dirname, file.replace(/\.html$/, '.png'));
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
    console.log('wrote', path.relative(process.cwd(), out));
  }
  await browser.close();
})();
