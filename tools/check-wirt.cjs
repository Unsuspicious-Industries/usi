/* Website checks only. Every /playground request is intercepted: this cannot
   qualify a live backend or spend GPU time, even when pointed at a public URL. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkWirt(browser, base, artifacts) {
    const page = await browser.newPage();
    const errors = [], calls = [], records = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
        '../static/wirt/c-addition-qwen3.5-0.8b.json')));
    let mode = 'refuse', generateCount = 0;
    await page.route('**/playground/**', async route => {
        const request = route.request();
        const endpoint = new URL(request.url()).pathname;
        calls.push({ endpoint, method: request.method(), body: request.postDataJSON() });
        const reply = (body, status = 200, headers = {}) => route.fulfill({
            status, contentType: 'application/json', headers, body: JSON.stringify(body) });
        if (mode === 'refuse') return reply({ error: { message: 'MOCK API unavailable', retryable: true } }, 503);
        if (endpoint === '/playground/capabilities') return reply({ generate: true,
            model: 'MOCK-NOT-A-LIVE-MODEL', max_tokens: 128, think_budget: 128 });
        if (endpoint === '/playground/grammars') return reply({ grammars: [fixture.grammar,
            { name: 'toy', description: 'MOCK grammar', source: "Value ::= 'beep'" }] });
        if (endpoint === '/playground/fixtures') return reply({ fixtures: [fixture] });
        if (endpoint === '/playground/grammar-check') return reply({ loads: true,
            completeness: ['syntactic', []], diagnostics: [] });
        if (endpoint === '/playground/generate') {
            generateCount++;
            if (generateCount === 1) return reply({ error: { message: 'MOCK queue full', retryable: true } }, 429, { 'Retry-After': '1' });
            if (generateCount === 3) return reply({ error: { message: 'MOCK decode failed', retryable: false } }, 500);
            return reply(fixture, 200, { 'X-Playground-Cache': 'hit' });
        }
        throw new Error(`Unexpected API request: ${endpoint}`);
    });
    try {
        for (const width of [320, 390, 768, 800, 1024, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            const response = await page.goto(new URL('/wirt', base).href, { waitUntil: 'networkidle' });
            assert.equal(response.status(), 200);
            const connect = page.getByRole('button', { name: 'Connect / start GPU', exact: true });
            assert.ok(await connect.isEnabled());
            assert.match(await connect.getAttribute('aria-describedby'), /pg-connect-note/);
            assert.ok(await page.locator('#pg-check').isDisabled());
            assert.ok(await page.locator('#pg-run').isDisabled());
            await page.locator('#pg-source').fill("Value ::= 'edited'");
            await page.locator('#pg-prompt').fill('visitor prompt');
            await page.locator('#pg-grammar').dispatchEvent('change');
            await page.waitForTimeout(500); // Catch the old debounced automatic check.
            assert.equal(calls.length, 0, 'load/typing/selection contacted the GPU API');
            await page.getByRole('button', { name: 'Replay recorded C addition — no GPU', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('#pg-result-note').textContent === 'recorded run — replayed locally');
            assert.equal(await page.locator('#pg-source').inputValue(), fixture.grammar.source);
            assert.equal(await page.locator('#pg-prompt').inputValue(), fixture.prompt);
            for (const arm of ['unconstrained', 'constrained', 'mixed']) {
                assert.equal(await page.locator(`#pg-arm-${arm} .pg-out`).textContent(), fixture.arms[arm].generation.completion);
                assert.match(await page.locator(`#pg-arm-${arm}`).textContent(), /well typed/);
            }
            assert.match(await page.locator('#pg-arm-mixed').textContent(), /reasoning closed for it/);
            await page.locator('#pg-arm-mixed summary').click();
            assert.equal(await page.locator('#pg-arm-mixed .pg-think-body').textContent(), fixture.arms.mixed.generation.thoughts);
            await page.locator('#pg-grammar').selectOption('c');
            await page.locator('#pg-source').fill('edited again');
            await page.waitForTimeout(500);
            assert.equal(calls.length, 0, 'static replay/selection/edit contacted the GPU API');
            const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
            assert.ok(scroll <= width + 1, `Wirt overflow ${scroll} at ${width}`);
            assert.equal(await page.locator('footer').count(), 1, 'site footer duplicated/missing');
            records.push({ width, scroll, apiRequests: calls.length, staticReplay: true });
            if (artifacts && [390, 1440].includes(width)) await page.screenshot({
                path: path.join(artifacts, `wirt-${width}.png`), fullPage: true });
        }
        // Keyboard activation of the native Connect control; mocked refusal only.
        const connect = page.getByRole('button', { name: 'Connect / start GPU', exact: true });
        await connect.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Retry connection', exact: true }).waitFor();
        assert.match(await page.locator('#pg-capability').textContent(), /MOCK API unavailable/);
        await page.waitForTimeout(1100);
        assert.equal(calls.length, 1, 'connection failure automatically retried');
        mode = 'mock';
        await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
        await page.getByRole('button', { name: 'Connected — refresh API', exact: true }).waitFor();
        assert.deepEqual(calls.slice(1).map(c => c.endpoint).sort(),
            ['/playground/capabilities', '/playground/fixtures', '/playground/grammars'].sort());
        const beforeEdit = calls.length;
        await page.locator('#pg-grammar').selectOption('toy');
        await page.locator('#pg-source').fill("Value ::= 'visitor edit'");
        await page.waitForTimeout(700);
        assert.equal(calls.length, beforeEdit, 'connected selection/edit auto-checked grammar');
        await page.getByRole('button', { name: 'Check grammar', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#pg-diag-chips').textContent.includes('no diagnostics'));
        assert.deepEqual(calls.at(-1).body, { grammar_source: "Value ::= 'visitor edit'" });
        await page.locator('#pg-grammar').selectOption('c');
        await page.locator('#pg-seed').fill('7');
        await page.locator('#pg-max').fill('128');
        await page.locator('#pg-think-budget').fill('128');
        const run = page.getByRole('button', { name: 'Run all three arms', exact: true });
        await run.click();
        await page.waitForFunction(() => document.querySelector('#pg-status').textContent.includes('queue is full'));
        await page.waitForTimeout(1300);
        assert.equal(generateCount, 1, '429 automatically retried');
        await run.click();
        await page.waitForFunction(() => document.querySelector('#pg-result-note').textContent === "served from the server's cache");
        const request = calls.filter(c => c.endpoint === '/playground/generate').at(-1);
        assert.deepEqual(Object.keys(request.body).sort(), ['grammar_name', 'grammar_source', 'prompt',
            'seed', 'max_tokens', 'think_budget', 'temperature', 'aufbau_context'].sort());
        assert.equal(request.body.temperature, 0);
        assert.equal(request.body.grammar_source, fixture.grammar.source);
        await run.click();
        await page.waitForFunction(() => document.querySelector('#pg-result-note').textContent.includes('cached in this browser'));
        assert.equal(generateCount, 2, 'browser cache issued a duplicate request');
        await page.locator('#pg-prompt').fill('different request for failure path');
        await run.click();
        await page.waitForFunction(() => document.querySelector('#pg-status').textContent.includes('MOCK decode failed'));
        assert.match(await page.locator('#pg-result-note').textContent(), /no new result.*earlier run/);
        assert.equal(await page.locator('#pg-arm-constrained .pg-out').textContent(), fixture.arms.constrained.generation.completion);
        assert.deepEqual(errors, []);
        if (artifacts) fs.writeFileSync(path.join(artifacts, 'wirt-results.json'),
            JSON.stringify({ qualification: 'MOCK paths and static replay only; NOT live E2E', records, calls, errors }, null, 2));
        console.log('PASS: Wirt zero API calls on load/typing/selection; static real replay; keyboard Connect; responsive layout; MOCK connection/error/check/generation/cache/429 (NOT live E2E)');
    } finally {
        await page.close();
    }
};
