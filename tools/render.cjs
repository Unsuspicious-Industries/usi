/* Full-page renders of the served site, for looking at, not for asserting.
   Usage: PLAYWRIGHT_CORE=<playwright-core> PLAYWRIGHT_BROWSERS_PATH=<browsers> \
          node tools/render.cjs [base URL] [out dir] [route ...]
   Prints one JSON line per capture: route, width, page height, horizontal overflow. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE);
const base = process.argv[2] || 'http://localhost:8080';
const out = process.argv[3] || '/tmp/usi-renders';
const routes = process.argv.length > 4 ? process.argv.slice(4) : ['/', '/research', '/projects', '/projects/mpi-rma',
    '/jobs', '/jobs/ethics-researcher', '/about', '/blog', '/blog/proposition-7', '/contact', '/ethics', '/style', '/nope'];
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
    console.log(JSON.stringify({ chromium: browser.version(), base }));
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        for (const route of routes) {
            const res = await page.goto(new URL(route, base).href, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight,
                overflow: document.documentElement.scrollWidth - innerWidth }));
            const name = (route === '/' ? 'index' : route.slice(1).replace(/\//g, '_')) + '_' + width + '.png';
            await page.screenshot({ path: path.join(out, name), fullPage: true });
            console.log(JSON.stringify({ route, width, status: res.status(), ...m, file: name }));
        }
        await page.close();
    }
    await browser.close();
})();
