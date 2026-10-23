/* The p7 playground client.
 *
 * Everything here talks to wirt at a RELATIVE path. That is deliberate and it
 * is the whole CORS/mixed-content story: indus serves this page and proxies
 * /playground/ to wherever the API actually runs, so the browser only ever
 * sees one origin and no preflight is ever issued.
 *
 * The server side of this contract is small and sharp-edged, so this file is
 * written to respect it rather than to discover it by trial:
 *
 *   - /playground/generate takes an EXACT field set and rejects a `model` key
 *     outright. The model is the server's choice; asking for one is how a
 *     stranger makes a GPU we rent by the second fetch something arbitrary.
 *   - temperature must be exactly 0, which is what makes the server's cache
 *     key exact — and lets us keep the same key here and never ask twice.
 *   - one live decode with two waiters. A third concurrent request is a 429,
 *     so the button is a latch, not a trigger, and a 429 is a countdown rather
 *     than a retry loop. Hammering a single GPU slot is how you turn a slow
 *     demo into a dead one.
 *   - even metadata GETs can wake a metered GPU. Connect is explicit, and
 *     grammar checks are manual; page views and edits never contact the API.
 */
(() => {
    "use strict";

    const $ = (id) => document.getElementById(id);

    const el = {
        capability: $("pg-capability"),
        connect: $("pg-connect"),
        grammar: $("pg-grammar"),
        grammarNote: $("pg-grammar-note"),
        source: $("pg-source"),
        diagChips: $("pg-diag-chips"),
        diagList: $("pg-diag-list"),
        prompt: $("pg-prompt"),
        seed: $("pg-seed"),
        max: $("pg-max"),
        think: $("pg-think-budget"),
        run: $("pg-run"),
        check: $("pg-check"),
        status: $("pg-status"),
        cacheNote: $("pg-cache-note"),
        fixtures: $("pg-fixtures"),
        resultNote: $("pg-result-note"),
        constrained: $("pg-arm-constrained"),
        unconstrained: $("pg-arm-unconstrained"),
        mixed: $("pg-arm-mixed"),
    };

    const state = {
        connected: false,
        connecting: false,
        canGenerate: false,
        model: null,
        maxTokens: 128,
        // The mixed arm's reasoning ceiling, the visitor's to set. The
        // server's value is both default and maximum, and arrives with
        // capabilities.
        thinkBudget: 1024,
        grammars: [],
        fixtures: [],
        lastChecked: null,   // source string whose check result is on screen
        checkAbort: null,
        busy: false,
        cooldown: 0,
        // The last prompt this page put in the box. Anything else is the
        // visitor's, and is never overwritten.
        suggestedPrompt: null,
    };

    // Same key the server caches on: (model, grammar source, prompt, seed,
    // max_tokens, think_budget) at temperature 0. An identical repeat then
    // costs no request at all. Bounded, since a demo tab stays open all day.
    const CACHE_LIMIT = 32;
    const cache = new Map();

    const cacheKey = (source, prompt, seed, maxTokens, thinkBudget) =>
        JSON.stringify([state.model, source, prompt, seed, maxTokens, thinkBudget]);

    function cacheGet(key) {
        if (!cache.has(key)) return null;
        const value = cache.get(key);
        cache.delete(key);           // reinsert to keep LRU order
        cache.set(key, value);
        return value;
    }

    function cachePut(key, value) {
        cache.set(key, value);
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }

    const text = (s) => (s === null || s === undefined ? "" : String(s));

    function chip(kind, label) {
        const span = document.createElement("span");
        span.className = `pg-chip pg-${kind}`;
        span.textContent = label;
        return span;
    }

    function setChips(target, chips) {
        target.replaceChildren(...chips);
    }

    function setStatus(message, kind) {
        el.status.textContent = text(message);
        el.status.style.color = kind === "bad" ? "var(--bad)" : "var(--ink-dim)";
    }

    /* ── HTTP ─────────────────────────────────────────────────────────────
     * One place that knows the error envelope, so no call site invents its
     * own handling. The server always answers {error: {message, retryable}}
     * on a refusal, and Retry-After on the two responses that mean "later".
     */
    async function api(path, options = {}) {
        // A cold GPU may take minutes to start. Bound the wait without an
        // automatic retry: another request is another deliberate user action.
        const controller = new AbortController();
        const cancel = () => controller.abort();
        if (options.signal) {
            options.signal.addEventListener("abort", cancel, { once: true });
            if (options.signal.aborted) cancel();
        }
        const timer = setTimeout(cancel, 360000);
        try {
            const response = await fetch(path, {
                ...options,
                signal: controller.signal,
                headers: { "Content-Type": "application/json", ...(options.headers || {}) },
            });
            let body = null;
            try {
                body = await response.json();
            } catch (error) {
                if (controller.signal.aborted) throw error;
            }
            if (!response.ok) {
                const error = new Error(
                    (body && body.error && body.error.message) || `HTTP ${response.status}`
                );
                error.status = response.status;
                error.retryable = Boolean(body && body.error && body.error.retryable);
                error.retryAfter = Number(response.headers.get("Retry-After")) || 0;
                throw error;
            }
            if (!body || typeof body !== "object") throw new Error("The API returned an invalid JSON response.");
            return { body, headers: response.headers };
        } catch (error) {
            if (error.name === "AbortError" && !(options.signal && options.signal.aborted)) {
                throw new Error("The API wait timed out. The GPU may still be starting; retry explicitly.");
            }
            throw error;
        } finally {
            clearTimeout(timer);
            if (options.signal) options.signal.removeEventListener("abort", cancel);
        }
    }

    // No API traffic on page view, grammar selection or typing. This API
    // lives on the GPU provider: even a metadata GET can wake a paid worker.
    async function connect() {
        if (state.connecting) return;
        state.connecting = true;
        el.connect.disabled = true;
        el.connect.textContent = "Starting GPU…";
        banner("idle", "Connecting — a cold GPU can take several minutes. No generation has been requested.");
        setStatus("waiting for the API / cold start…");
        try {
            // One initial request, not three concurrent cold-start waiters.
            const capabilities = await api("/playground/capabilities");
            state.connected = true;
            applyCapabilities(capabilities.body);
            el.check.disabled = false;
            const [grammars, fixtures] = await Promise.allSettled([
                api("/playground/grammars"), api("/playground/fixtures"),
            ]);
            const failures = [];
            if (grammars.status === "fulfilled") {
                state.grammars = grammars.value.body.grammars || [];
                fillGrammars();
            } else {
                el.grammarNote.textContent = "library unavailable";
                failures.push(`library: ${grammars.reason.message}`);
            }
            if (fixtures.status === "fulfilled") {
                state.fixtures = fixtures.value.body.fixtures || [];
                fillFixtures();
            } else {
                el.fixtures.replaceChildren(hint("recorded runs unavailable"));
                failures.push(`recorded runs: ${fixtures.reason.message}`);
            }
            if (failures.length) throw new Error(failures.join("; "));
            el.connect.textContent = "Connected — refresh API";
        } catch (error) {
            banner("bad", `Connection incomplete: ${error.message} Use Retry connection; nothing retries automatically.`);
            setStatus(error.message, "bad");
            el.connect.textContent = "Retry connection";
        } finally {
            state.connecting = false;
            el.connect.disabled = false;
        }
    }

    function hint(message) {
        const p = document.createElement("p");
        p.className = "pg-hint";
        p.textContent = message;
        return p;
    }

    function banner(kind, message) {
        el.capability.className = `pg-banner pg-${kind}`;
        el.capability.replaceChildren(Object.assign(document.createElement("p"), { textContent: message }));
        el.capability.hidden = false;
    }

    function applyCapabilities(caps) {
        state.canGenerate = Boolean(caps.generate);
        state.model = caps.model || null;
        if (Number.isInteger(caps.max_tokens) && caps.max_tokens > 0) {
            state.maxTokens = caps.max_tokens;
        }
        el.max.max = String(state.maxTokens);
        if (Number(el.max.value) > state.maxTokens) el.max.value = String(state.maxTokens);
        if (Number.isInteger(caps.think_budget) && caps.think_budget >= 0) {
            state.thinkBudget = caps.think_budget;
        }
        if (el.think) {
            el.think.max = String(state.thinkBudget);
            // The ceiling is also the default, so an untouched box showing
            // it says what the request will do.
            if (!el.think.value.trim() || Number(el.think.value) > state.thinkBudget) {
                el.think.value = String(state.thinkBudget);
            }
        }

        el.run.disabled = !state.canGenerate || state.busy || state.cooldown > 0;
        if (state.canGenerate) {
            el.capability.hidden = true;
            setStatus(`model ${state.model} · up to ${state.maxTokens} tokens`);
        } else {
            // Say so before the click rather than after: the button that
            // returns 400 to everyone who presses it is worse than no button.
            banner("warn", "This deployment serves the grammar library, the checker and the recorded runs, but has no model attached — live decoding is off. Every recorded run below still replays in full.");
            setStatus("live decoding unavailable here");
        }
    }

    function fillGrammars() {
        el.grammar.replaceChildren();
        for (const grammar of state.grammars) {
            const option = document.createElement("option");
            option.value = grammar.name;
            option.textContent = grammar.name;
            option.title = grammar.description || "";
            el.grammar.append(option);
        }
        el.grammarNote.textContent = `${state.grammars.length} in the library`;
        if (state.grammars.length && !el.source.value.trim()) selectGrammar(defaultGrammar());
    }

    // These surfaces belong to the pinned grammar, not the full language.
    // In particular TypeScript has no arithmetic; Fun is simply typed, so
    // self-application has no finite type. Witnesses are checked in tests.
    const PROMPTS = {
        c: "Write a C function int add(int a, int b) that returns a plus b. Reply with C code only, no Markdown.",
        typescript: "Write a TypeScript expression statement containing the number 1. End it with a semicolon. Reply with code only, no Markdown.",
        imp: "Write an Imp block with braces: declare x using let x: Int = 1; then assign x = x + 1;. Reply with the block only.",
        toy: "Write one Toy value: a word beep, boop or blorp, followed by a colon and type Fizz. Reply with the typed value only.",
        stlc: "Write the identity lambda with binder x of type A. Use the syntax λx:A.x, not a programming language function. Reply with the term only.",
        fun: "Write a Fun function that adds 1 to an Int argument x. Use typed arrow syntax (x: Int) => body. Reply with the expression only.",
        ml: "Write one OCaml definition let identity (x : int) : int = followed by a body returning x. Reply with code only, no Markdown.",
        sums: "Show that Bool equals Unit + Unit using the Sums syntax (x : Bool) ~ (y : Unit + Unit). Reply with that expression only.",
    };

    function promptFor(name) {
        return PROMPTS[name] || `Write a short program this grammar accepts. Reply with code only.`;
    }

    // Prefer a familiar surface with ordinary code tokens. This is a
    // usability choice, not evidence that generation satisfies the prompt.
    function defaultGrammar() {
        const preferred = ["c", "imp", "typescript", "toy", "fun"];
        for (const name of preferred) {
            if (state.grammars.some((g) => g.name === name)) return name;
        }
        return state.grammars[0].name;
    }

    function selectGrammar(name) {
        const grammar = state.grammars.find((g) => g.name === name);
        if (!grammar) return;
        el.grammar.value = name;
        el.source.value = grammar.source;
        el.grammarNote.textContent = grammar.description || `${state.grammars.length} in the library`;
        if (name === "typescript") {
            el.grammarNote.textContent += " Pinned subset is incomplete: optional productions are undefined; basic expression statements work, but functions and declarations do not. Checks here are syntactic, not TypeScript typechecking.";
        }
        // Move the prompt with the grammar — but never over something the
        // visitor wrote. Only a prompt we put there ourselves is ours to
        // replace.
        if (!el.prompt.value.trim() || el.prompt.value === state.suggestedPrompt) {
            el.prompt.value = promptFor(name);
            state.suggestedPrompt = el.prompt.value;
        }
        invalidateCheck();
    }

    /* Grammar edits invalidate the display but never contact the provider.
     * Checking is manual even after connecting: idle workers scale to zero. */
    function invalidateCheck() {
        if (state.checkAbort) state.checkAbort.abort();
        state.lastChecked = null;
        setChips(el.diagChips, [chip("idle", "edited — not checked")]);
        el.diagList.hidden = true;
    }

    async function runCheck() {
        if (!state.connected) return setStatus("Connect / start GPU before checking a grammar.");
        const source = el.source.value;
        if (!source.trim()) {
            state.lastChecked = null;
            setChips(el.diagChips, [chip("idle", "empty grammar")]);
            el.diagList.hidden = true;
            return;
        }
        if (source === state.lastChecked) return;

        if (state.checkAbort) state.checkAbort.abort();
        const controller = new AbortController();
        state.checkAbort = controller;

        setChips(el.diagChips, [chip("idle", "checking…")]);
        try {
            const { body } = await api("/playground/grammar-check", {
                method: "POST",
                body: JSON.stringify({ grammar_source: source }),
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            state.lastChecked = source;
            renderCheck(body);
        } catch (error) {
            if (error.name === "AbortError") return;
            state.lastChecked = null;
            const label = error.status === 408 ? "check timed out" : `check failed — ${error.message}`;
            setChips(el.diagChips, [chip("bad", label)]);
            el.diagList.hidden = true;
        } finally {
            if (state.checkAbort === controller) state.checkAbort = null;
        }
    }

    function renderCheck(report) {
        const chips = [];
        if (!report.loads) {
            chips.push(chip("bad", "does not load"));
            setChips(el.diagChips, chips);
            el.diagList.replaceChildren(diagItem("error", text(report.error)));
            el.diagList.hidden = false;
            return;
        }
        chips.push(chip("ok", "loads"));

        // completeness is (verdict, blockers). The three verdicts are not a
        // scale, and only one of them is a caveat:
        //
        //   syntactic  no typing rules, so live ⇔ realizable — exact
        //   inhabited  every ascribed sort has a universal inhabitant
        //   sound      neither certificate applies; a live prefix may still
        //              be unrealizable, and `blockers` says where
        //
        // is_complete() upstream is `not Sound`, so `syntactic` is a clean
        // result and not a lesser one — reading it as a warning is exactly
        // backwards. Rendered defensively: the pair is the contract, but a
        // broken shape should degrade to something readable, not to a crash.
        const completeness = report.completeness;
        if (Array.isArray(completeness) && completeness.length) {
            const verdict = text(completeness[0]);
            const blockers = Array.isArray(completeness[1]) ? completeness[1] : [];
            const sound = /^sound/i.test(verdict);
            const label = sound
                ? `completeness: sound — ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`
                : `completeness: ${verdict}`;
            chips.push(chip(sound ? "warn" : "ok", label));
        } else if (completeness) {
            chips.push(chip("idle", `completeness: ${text(completeness)}`));
        }

        const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
        const errors = diagnostics.filter((d) => /error/i.test(text(d.severity))).length;
        const warnings = diagnostics.length - errors;
        if (errors) chips.push(chip("bad", `${errors} error${errors === 1 ? "" : "s"}`));
        if (warnings) chips.push(chip("warn", `${warnings} warning${warnings === 1 ? "" : "s"}`));
        if (!diagnostics.length) chips.push(chip("ok", "no diagnostics"));
        setChips(el.diagChips, chips);

        const items = [];
        // Only `sound` carries blockers worth naming; the other two verdicts
        // list nothing, so this loop is empty exactly when it should be.
        const blockers = Array.isArray(completeness) && Array.isArray(completeness[1]) ? completeness[1] : [];
        for (const blocker of blockers) items.push(diagItem("blocker", text(blocker)));
        for (const d of diagnostics) items.push(diagItem(`${text(d.severity)} ${text(d.code)}`.trim(), text(d.message)));
        el.diagList.replaceChildren(...items);
        el.diagList.hidden = items.length === 0;
    }

    function diagItem(label, message) {
        const li = document.createElement("li");
        const code = document.createElement("code");
        code.textContent = label;
        li.append(code, document.createTextNode(` — ${message}`));
        return li;
    }

    /* ── The live decode ─────────────────────────────────────────────────── */
    async function runGenerate() {
        if (state.busy || !state.connected || !state.canGenerate) return;

        const source = el.source.value;
        const prompt = el.prompt.value;
        const seed = Number.parseInt(el.seed.value, 10);
        let maxTokens = Number.parseInt(el.max.value, 10);
        let thinkBudget = el.think ? Number.parseInt(el.think.value, 10) : state.thinkBudget;

        if (!source.trim()) return setStatus("the grammar is empty", "bad");
        if (!prompt.trim()) return setStatus("the prompt is empty", "bad");
        if (!Number.isInteger(seed) || seed < 0) return setStatus("seed must be a non-negative integer", "bad");
        if (!Number.isInteger(maxTokens) || maxTokens < 1) return setStatus("max tokens must be at least 1", "bad");
        if (!Number.isInteger(thinkBudget) || thinkBudget < 0) return setStatus("the thinking budget must be zero or more", "bad");
        // Clamp rather than let the server refuse it: the ceiling is the
        // server's and the visitor did not choose it.
        if (maxTokens > state.maxTokens) {
            maxTokens = state.maxTokens;
            el.max.value = String(maxTokens);
        }
        if (thinkBudget > state.thinkBudget) {
            thinkBudget = state.thinkBudget;
            if (el.think) el.think.value = String(thinkBudget);
        }

        const key = cacheKey(source, prompt, seed, maxTokens, thinkBudget);
        const cached = cacheGet(key);
        if (cached) {
            render(cached, "cached in this browser — no request made");
            setStatus("");
            return;
        }

        setBusy(true, "decoding all three arms…");
        try {
            const { body, headers } = await api("/playground/generate", {
                method: "POST",
                body: JSON.stringify({
                    // The fields the server requires, plus the one it accepts,
                    // and deliberately no `model`: the server fixes that.
                    grammar_name: el.grammar.value || "custom",
                    grammar_source: source,
                    prompt,
                    seed,
                    max_tokens: maxTokens,
                    think_budget: thinkBudget,
                    temperature: 0,
                    aufbau_context: {},
                }),
            });
            cachePut(key, body);
            const served = headers.get("X-Playground-Cache") === "hit" ? "served from the server's cache" : "freshly decoded";
            render(body, served);
            setStatus("");
        } catch (error) {
            el.resultNote.textContent = "request failed — no new result; any displayed output is from an earlier run";
            if (error.status === 429) {
                cooldown(error.retryAfter || 5);
            } else {
                setStatus(error.message, "bad");
            }
        } finally {
            setBusy(false);
        }
    }

    function setBusy(busy, message) {
        state.busy = busy;
        el.run.disabled = busy || !state.canGenerate || state.cooldown > 0;
        el.run.textContent = busy ? "decoding…" : "Run all three arms";
        if (message) setStatus(message);
    }

    // A 429 means the one decode slot and both its waiters are taken. The
    // honest response is to wait the time the server named, visibly, and not
    // to add a fourth request to the pile.
    function cooldown(seconds) {
        state.cooldown = seconds;
        el.run.disabled = true;
        setStatus(`the decode queue is full — retrying is possible in ${state.cooldown}s`, "bad");
        const tick = setInterval(() => {
            state.cooldown -= 1;
            if (state.cooldown <= 0) {
                clearInterval(tick);
                state.cooldown = 0;
                el.run.disabled = !state.canGenerate || state.busy;
                setStatus("ready");
            } else {
                setStatus(`the decode queue is full — retrying is possible in ${state.cooldown}s`, "bad");
            }
        }, 1000);
    }

    /* ── Recorded runs ────────────────────────────────────────────────────
     * Fetched on explicit connection and replayed from memory. A visitor can compare
     * every recorded run without touching the API again, which is the point:
     * the interesting part of this demo does not need a GPU.
     */
    function fillFixtures() {
        if (!state.fixtures.length) {
            el.fixtures.replaceChildren(hint("no recorded runs on this server"));
            return;
        }
        const buttons = state.fixtures.map((fixture, index) => {
            const button = document.createElement("button");
            button.className = "pg-run";
            button.type = "button";
            button.setAttribute("aria-pressed", "false");
            const name = (fixture.grammar && fixture.grammar.name) || `run ${index + 1}`;
            button.textContent = fixture.synthetic ? `${name} (synthetic)` : name;
            button.title = fixture.prompt || "";
            button.addEventListener("click", () => {
                for (const other of buttons) other.setAttribute("aria-pressed", "false");
                button.setAttribute("aria-pressed", "true");
                replay(fixture);
            });
            return button;
        });
        el.fixtures.replaceChildren(...buttons);
    }

    function replay(fixture) {
        // Load the recorded inputs into the controls too, so "run it yourself"
        // is one click away and starts from exactly what was recorded.
        if (fixture.grammar && typeof fixture.grammar.source === "string") {
            el.source.value = fixture.grammar.source;
            const known = state.grammars.some((g) => g.name === fixture.grammar.name);
            if (known) el.grammar.value = fixture.grammar.name;
            invalidateCheck();
        }
        if (typeof fixture.prompt === "string") el.prompt.value = fixture.prompt;
        if (Number.isInteger(fixture.seed)) el.seed.value = String(fixture.seed);
        if (Number.isInteger(fixture.max_tokens)) el.max.value = String(fixture.max_tokens);
        // Fixtures older than the mixed arm carry no budget to load.
        if (el.think && Number.isInteger(fixture.think_budget)) {
            el.think.value = String(Math.min(fixture.think_budget, state.thinkBudget));
        }
        render(fixture, fixture.synthetic ? "recorded run — synthetic, display only" : "recorded run — replayed locally");
    }

    /* ── Rendering a run ──────────────────────────────────────────────── */
    function render(run, note) {
        el.resultNote.textContent = note || "";
        el.cacheNote.textContent = run.model ? `model ${run.model}` : "";
        const arms = run.arms || {};
        renderArm(el.constrained, arms.constrained, run.synthetic);
        renderArm(el.unconstrained, arms.unconstrained, run.synthetic);
        // `mixed` is optional in the fixture contract: a run recorded before
        // the arm existed is still valid, so say it is absent rather than
        // rendering an empty panel that looks like a failure.
        renderArm(el.mixed, arms.mixed, run.synthetic, "this run predates the mixed arm");
    }

    function renderArm(target, arm, synthetic, absentNote) {
        target.replaceChildren();
        if (!arm) {
            target.append(hint(absentNote || "no data for this arm"));
            return;
        }
        const generation = arm.generation || {};
        const judgement = arm.judgement || {};

        // The reasoning, above the answer, collapsed. It is deliberately not
        // part of the completion — the engine grades the program alone — so it
        // is presented as something you open, not as output.
        if (generation.thoughts) {
            const details = document.createElement("details");
            details.className = "pg-think";
            const summary = document.createElement("summary");
            const count = Number(generation.think_tokens) || 0;
            summary.textContent = `reasoning — ${count} token${count === 1 ? "" : "s"}`;
            const body = document.createElement("pre");
            body.className = "pg-think-body";
            body.textContent = text(generation.thoughts);
            details.append(summary, body);
            target.append(details);
        }

        const out = document.createElement("pre");
        out.className = "pg-out";
        const completion = text(generation.completion);
        if (completion) {
            out.textContent = completion;
        } else {
            out.classList.add("pg-out-empty");
            out.textContent = "— nothing emitted —";
        }
        target.append(out);

        const chips = [];
        const status = judgement.engine_status;
        const incomplete = status === "live" || status === "incomplete";
        const parseLabel = incomplete ? "incomplete prefix"
            : judgement.parses ? "parses" : "does not parse";
        chips.push(chip(incomplete ? "warn" : judgement.parses ? "ok" : "bad", parseLabel));
        chips.push(chip(judgement.well_typed ? "ok" : "warn", judgement.well_typed ? "well typed" : "not well typed"));
        if (judgement.inferred_type) chips.push(chip("idle", `: ${text(judgement.inferred_type)}`));
        if (judgement.ambiguous) chips.push(chip("warn", "ambiguous"));
        if (judgement.engine_status) chips.push(chip("idle", `engine: ${text(judgement.engine_status)}`));
        chips.push(chip(generation.complete ? "ok" : "warn", generation.complete ? "generation complete" : "generation incomplete"));
        chips.push(chip(generation.reason === "error" ? "bad" : "idle", `reason: ${text(generation.reason) || "unknown"}`));
        // Closure is a decoding intervention, not a task-correctness verdict.
        // Zero-token thinking can also be force-closed; do not hide that state.
        if (generation.think_forced_close) {
            chips.push(chip("warn", "reasoning closed for it"));
        } else if (generation.think_closed) {
            chips.push(chip("ok", "closed its own reasoning"));
        } else if (generation.think_tokens > 0) {
            chips.push(chip("warn", "reasoning did not close"));
        }
        if (synthetic) chips.push(chip("warn", "synthetic"));

        const chipRow = document.createElement("div");
        chipRow.className = "pg-chips";
        setChips(chipRow, chips);
        target.append(chipRow);

        target.append(telemetry(generation, synthetic));
    }

    function telemetry(generation, synthetic) {
        const wrap = document.createElement("div");
        wrap.className = "pg-tel-wrap";

        const ids = Array.isArray(generation.step_token_ids) ? generation.step_token_ids : [];
        const pre = Array.isArray(generation.step_pre_entropies) ? generation.step_pre_entropies : [];
        const post = Array.isArray(generation.step_entropies) ? generation.step_entropies : [];
        const retries = Array.isArray(generation.step_retries) ? generation.step_retries : [];

        if (!ids.length) {
            const p = document.createElement("p");
            p.className = "pg-cap";
            // tokens_generated is authoritative even when the step arrays are
            // empty, which is the normal shape of an unconstrained arm.
            p.textContent = `${text(generation.tokens_generated) || 0} token(s) generated; no per-token telemetry recorded for this arm.`;
            wrap.append(p);
            return wrap;
        }

        // Empty arrays mean unavailable, not zero. The engine backend records
        // selected IDs but does not report p7's retry-sampler telemetry.
        const hasSamplingTelemetry = pre.length > 0 || post.length > 0 || retries.length > 0;
        const table = document.createElement("table");
        table.className = "pg-tel";
        const head = document.createElement("tr");
        const labels = hasSamplingTelemetry
            ? ["step", "token id", "entropy before (bits)", "entropy after (bits)", "retries"]
            : ["step", "token id"];
        for (const label of labels) {
            const th = document.createElement("th");
            th.textContent = label;
            head.append(th);
        }
        table.append(head);

        const fixed = (value) => (typeof value === "number" ? value.toFixed(2) : "—");
        ids.forEach((id, index) => {
            const tr = document.createElement("tr");
            const values = hasSamplingTelemetry
                ? [index, id, fixed(pre[index]), fixed(post[index]), retries[index] ?? "—"]
                : [index, id];
            for (const value of values) {
                const td = document.createElement("td");
                td.textContent = String(value);
                tr.append(td);
            }
            table.append(tr);
        });
        wrap.append(table);

        const caption = document.createElement("p");
        caption.className = "pg-cap";
        const total = retries.reduce((sum, n) => sum + (Number(n) || 0), 0);
        caption.textContent = synthetic
            ? "Synthetic run: these numbers illustrate the format and are not measurements."
            : hasSamplingTelemetry
                ? `${total} candidate(s) refused across ${ids.length} accepted token(s). Retry-sampler entropy after removes only the refused candidates; it is an upper bound and may exceed entropy before.`
                : `${ids.length} selected token(s). Entropy and retry counts are unavailable on this backend, not zero.`;
        wrap.append(caption);
        return wrap;
    }

    /* ── Wiring ──────────────────────────────────────────────────────── */
    el.grammar.addEventListener("change", () => selectGrammar(el.grammar.value));
    el.source.addEventListener("input", invalidateCheck);
    el.check.addEventListener("click", () => {
        state.lastChecked = null;      // an explicit press means "check it again"
        runCheck();
    });
    el.run.addEventListener("click", runGenerate);

    // Whatever the markup shipped counts as ours until the visitor edits it.
    state.suggestedPrompt = el.prompt.value;

    // Website-only static replay: never goes through the metered API.
    const localReplay = $("pg-local-replay");
    if (localReplay) localReplay.addEventListener("click", async () => {
        localReplay.disabled = true;
        try {
            const { body } = await api(localReplay.dataset.fixture);
            if (!state.connected) {
                state.grammars = [body.grammar];
                fillGrammars();
            }
            replay(body);
            setStatus("Static recording loaded — no GPU request made.");
        } catch (error) {
            setStatus(`Static recording unavailable: ${error.message}`, "bad");
        } finally {
            localReplay.disabled = false;
        }
    });

    el.connect.addEventListener("click", connect);
    el.run.disabled = true;
    el.check.disabled = true;
    setStatus("disconnected — no GPU request made");
})();
