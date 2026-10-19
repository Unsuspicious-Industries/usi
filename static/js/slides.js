/* Slides viewer. Plays a deck as pdfpc does: a page with a duration (/Dur in the PDF,
   `dur` in the manifest) advances by itself after that many seconds, a page without one
   waits for the reader. Pictures and manifest come from tools/slides.py. No dependencies.
   Without this script the page keeps the first slide and the link to the PDF. */
(function () {
    'use strict';
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.slides').forEach(init);

    function init(root) {
        var src = root.dataset.src, stage = root.querySelector('.slides-stage'), img = root.querySelector('.slides-img');
        var count = root.querySelector('.slides-count'), range = root.querySelector('.slides-range');
        var play = root.querySelector('[data-act=play]');
        fetch(src + '/manifest.json').then(function (r) { return r.json(); }).then(function (m) { run(m); });

        function run(m) {
            var pages = m.pages, n = pages.length, i = 0, paused = reduced, token = 0, cache = {};
            root.querySelectorAll('[hidden]').forEach(function (e) { e.hidden = false; });
            range.max = n;
            img.width = m.width; img.height = m.height;

            function load(k) {
                if (k < 0 || k >= n) return Promise.resolve();
                if (!cache[k]) {
                    var im = new Image();
                    cache[k] = new Promise(function (ok) { im.onload = im.onerror = ok; });
                    im.src = src + '/' + pages[k].img;
                }
                return cache[k];
            }
            function timed(k) { return pages[k].dur !== null; }
            function show(k) {
                var mine = ++token;
                i = Math.max(0, Math.min(n - 1, k));
                load(i).then(function () {
                    if (mine !== token) return;
                    img.src = src + '/' + pages[i].img;
                    img.alt = pages[i].text || 'Slide ' + (i + 1);
                });
                count.textContent = (i + 1) + ' / ' + n;
                range.value = i + 1;
                history.replaceState(null, '', '#slides-' + (i + 1));
                for (var a = 1; a <= 8; a++) load(i + a);
                if (!paused && timed(i) && i < n - 1) {
                    Promise.all([new Promise(function (ok) { setTimeout(ok, pages[i].dur * 1000); }), load(i + 1)])
                        .then(function () { if (mine === token) show(i + 1); });
                }
            }
            function step(d) {
                var j = i + d;
                if (reduced) while (j > 0 && j < n - 1 && timed(j)) j += d;
                show(j);
            }
            function toggle() {
                paused = !paused;
                play.textContent = paused ? 'Play' : 'Pause';
                show(i);
            }
            function full() {
                if (document.fullscreenElement) document.exitFullscreen();
                else if (stage.requestFullscreen) stage.requestFullscreen();
            }

            var h = /^#slides-(\d+)$/.exec(location.hash);
            play.textContent = paused ? 'Play' : 'Pause';
            show(h ? +h[1] - 1 : 0);
            if (h) load(i).then(function () { root.scrollIntoView(); });

            root.addEventListener('click', function (e) {
                var act = e.target.closest('[data-act]');
                if (!act) return;
                var a = act.dataset.act;
                if (a === 'next') step(1); else if (a === 'prev') step(-1);
                else if (a === 'play') toggle(); else if (a === 'full') full();
            });
            range.addEventListener('input', function () { show(+range.value - 1); });
            img.addEventListener('click', function (e) {
                var box = img.getBoundingClientRect();
                step(e.clientX - box.left < box.width / 3 ? -1 : 1);
            });
            stage.addEventListener('keydown', function (e) {
                var k = e.key, d = { ArrowRight: 1, PageDown: 1, ' ': 1, Enter: 1, ArrowLeft: -1, PageUp: -1, Backspace: -1 }[k];
                if (d) step(d);
                else if (k === 'Home') show(0);
                else if (k === 'End') show(n - 1);
                else if (k === 'f') full();
                else if (k === 'p') toggle();
                else return;
                e.preventDefault();
            });
            var x0 = null;
            stage.addEventListener('pointerdown', function (e) { x0 = e.pointerType === 'touch' ? e.clientX : null; });
            stage.addEventListener('pointerup', function (e) {
                if (x0 !== null && Math.abs(e.clientX - x0) > 40) step(e.clientX < x0 ? 1 : -1);
                x0 = null;
            });
        }
    }
})();
