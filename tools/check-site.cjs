/* Run with the pinned browser/module supplied by `nix run .#check-browser`.
   These expected links are site obligations, not an alternative icon registry.
   No screenshot baseline: assert layout/behaviour and inspect optional captures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, 'Use nix run "path:$PWD#check-browser" -- [base URL]');
const { chromium } = require(core);
const base = new URL(process.argv[2] || 'http://localhost:8080');
const artifacts = process.env.CHECK_ARTIFACTS;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const routes = ['/', '/research', '/tools', '/infra', '/about', '/contact',
    '/ethics', '/jobs', '/blog', '/blog/completing-regex',
    '/blog/proposition-7', '/jobs/itinerant-polymath'];
const expectedIcons = { '/': 8, '/tools': 4, '/research': 3, '/infra': 2 };
const expectedLinks = ['/research#karl', '/tools#remblais', '/research#aufbau',
    '/research#slop', '/tools#political-alignment', '/infra#mpi-rma', '/infra#trame'];
const url = route => new URL(route, base).href;

async function run() {
    const browser = await chromium.launch({ channel: 'chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const errors = [], records = [], ids = new Set();
        const metadata = { host: os.hostname(), node: process.version,
            playwright: require(path.join(core, 'package.json')).version,
            chromium: browser.version(), base: base.href };
        console.log(JSON.stringify(metadata));
        const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
        page.on('pageerror', error => errors.push(error.message));
        for (const width of [320, 390, 768, 800, 1024, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            for (const route of routes) {
                const response = await page.goto(url(route), { waitUntil: 'networkidle' });
                assert.equal(response.status(), 200, route);
                await page.evaluate(() => document.fonts.ready);
                await page.evaluate(() => Promise.all([...document.images].map(image => {
                    image.loading = 'eager';
                    return image.decode().catch(() => {});
                })));
                const result = await page.evaluate(() => ({
                    scroll: document.documentElement.scrollWidth,
                    navBottom: document.querySelector('nav').getBoundingClientRect().bottom,
                    mainPadding: parseFloat(getComputedStyle(document.querySelector('main')).paddingTop),
                    badImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src),
                    features: [...document.querySelectorAll('.feature-prose')].map(e => {
                        const box = e.getBoundingClientRect();
                        return { left: box.left, right: box.right };
                    }),
                    icons: [...document.querySelectorAll('.project-icon use')].map(e => ({
                        href: e.getAttribute('href'),
                        exists: !!document.getElementById(e.getAttribute('href').slice(1)),
                        width: e.getBBox().width
                    }))
                }));
                assert.ok(result.scroll <= width + 1, `${route}: document overflow at ${width}`);
                assert.ok(result.navBottom <= result.mainPadding + 1, `${route}: nav covers content at ${width}`);
                assert.deepEqual(result.badImages, [], `${route}: broken images`);
                if (width <= 768) for (const box of result.features) {
                    assert.ok(box.left >= 15 && box.right <= width - 15,
                        `${route}: missing feature gutters ${JSON.stringify(box)}`);
                }
                if (route in expectedIcons) assert.equal(result.icons.length, expectedIcons[route], `${route}: missing icons`);
                for (const icon of result.icons) {
                    assert.ok(icon.exists && icon.width > 0, `${route}: unresolved/empty icon ${icon.href}`);
                    ids.add(icon.href.slice('#project-'.length));
                }
                records.push({ route, width, ...result });
                if (artifacts && [390, 1440].includes(width) && route in expectedIcons) {
                    await page.screenshot({ path: path.join(artifacts,
                        `${route === '/' ? 'home' : route.slice(1)}-${width}.png`), fullPage: true });
                }
            }
            console.log(`viewport ${width} CSS px: PASS`);
        }
        assert.deepEqual([...ids].sort(), ['aufbau', 'gilles-economics', 'hrml', 'karl',
            'mpi-rma', 'political-alignment', 'remblais', 'slop', 'slut', 'trame'].sort());
        await page.setViewportSize({ width: 390, height: 1000 });
        await page.goto(url('/'), { waitUntil: 'networkidle' });
        const cards = page.locator('main .card');
        assert.equal(await cards.count(), 6);
        for (const card of await cards.all()) assert.equal(await card.locator('xpath=ancestor::a').count(), 0, 'whole-card link');
        assert.equal(await page.getByText('Diffused Consciousness research', { exact: true }).count(), 0);
        for (const href of expectedLinks) assert.ok(await page.locator(`main a[href="${href}"]`).count(), `missing ${href}`);
        assert.ok(await page.locator('main a[href="https://gilles.unsuspicious.org/#lab-economics"]').count());
        // Test native keyboard activation, not a synthetic click that bypasses focus.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'nav-toggle');
        await page.keyboard.press('Space');
        assert.ok(await page.locator('.nav-links a[href="/infra"]').isVisible());
        await page.keyboard.press('Space');
        assert.equal(await page.locator('.nav-links').isVisible(), false);
        for (const href of expectedLinks) {
            await page.goto(url(href), { waitUntil: 'networkidle' });
            assert.equal(await page.locator(`[id="${href.split('#')[1]}"]`).count(), 1, `missing anchor ${href}`);
        }
        await page.goto(url('/tools#remblais'), { waitUntil: 'networkidle' });
        const gif = page.locator('.remblais-morph');
        await gif.scrollIntoViewIfNeeded();
        await gif.evaluate(image => image.decode());
        assert.ok((await gif.evaluate(image => image.currentSrc)).endsWith('remblais-square.gif'));
        assert.equal(await gif.evaluate(image => image.naturalWidth), 96);
        const first = await gif.screenshot();
        await page.waitForTimeout(1300);
        assert.equal(first.equals(await gif.screenshot()), false, 'animation does not advance');
        const toggle = page.locator('#remblais-still');
        await toggle.focus();
        await page.keyboard.press('Space');
        assert.ok(await toggle.isChecked(), 'Space does not select Still');
        assert.equal(await gif.isVisible(), false, 'animation remains visible');
        const still = page.locator('.remblais-static');
        assert.ok(await still.isVisible());
        await still.evaluate(image => image.decode());
        const stopped = await still.screenshot();
        await page.waitForTimeout(1300);
        assert.ok(stopped.equals(await still.screenshot()), 'Still frame changes');
        await page.keyboard.press('Space');
        assert.ok(await gif.isVisible(), 'Space does not restore animation');
        const label = page.locator('label[for="remblais-still"]');
        const target = await label.boundingBox();
        assert.ok(target.width >= 24 && target.height >= 24, 'Still label has a small pointer target');
        await label.click();
        assert.ok(await still.isVisible(), 'Still label does not stop animation');
        await label.click();
        assert.ok(await gif.isVisible(), 'Still label does not restore animation');
        const reduced = await browser.newPage({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
        reduced.on('pageerror', error => errors.push(error.message));
        await reduced.goto(url('/tools#remblais'), { waitUntil: 'networkidle' });
        await reduced.locator('.remblais-morph').scrollIntoViewIfNeeded();
        await reduced.locator('.remblais-morph').evaluate(image => image.decode());
        assert.ok((await reduced.locator('.remblais-morph').evaluate(image => image.currentSrc)).endsWith('remblais-square-still.png'));
        assert.equal(await reduced.locator('#remblais-still').isVisible(), false, 'redundant Still switch under reduced motion');
        assert.deepEqual(errors, [], 'browser errors');
        if (artifacts) fs.writeFileSync(path.join(artifacts, 'results.json'),
            JSON.stringify({ metadata, records, errors, animation: true, stillSwitch: true, reducedMotion: true }, null, 2));
        console.log('PASS: layout, decoded images, project marks/links, anchors, keyboard menu, GIF, Still switch, reduced motion');
    } finally {
        await browser.close();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
