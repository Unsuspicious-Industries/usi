// Field Notes — topic filtering.
// Content is server-rendered; this only derives the Topics rail from the
// subject tags already in the DOM and toggles visibility. The page is fully
// readable with JS disabled — this is pure enhancement.
(function () {
  'use strict';

  // "a/b/c" -> ["a", "a/b", "a/b/c"] so a parent topic matches its children.
  function prefixes(tag) {
    var out = [], acc = '';
    tag.split('/').forEach(function (p) { acc = acc ? acc + '/' + p : p; out.push(acc); });
    return out;
  }

  function subjectsOf(el) {
    return Array.prototype.map.call(el.querySelectorAll('.fn-tag'), function (t) {
      return t.getAttribute('data-s');
    }).filter(Boolean);
  }

  var resources = Array.prototype.slice.call(document.querySelectorAll('.fn-resource'));
  var notes = Array.prototype.slice.call(document.querySelectorAll('.fn-note'));
  var items = resources.concat(notes);
  var rail = document.getElementById('fn-topics-list');
  if (!items.length || !rail) return;

  // ---- topic set + item counts (a topic counts an item once) ----
  var counts = {};
  items.forEach(function (el) {
    var seen = {};
    subjectsOf(el).forEach(function (tag) {
      prefixes(tag).forEach(function (p) { seen[p] = true; });
    });
    Object.keys(seen).forEach(function (p) { counts[p] = (counts[p] || 0) + 1; });
  });
  var topics = Object.keys(counts).sort();

  function topicButton(label, value, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fn-topic' + (cls ? ' ' + cls : '');
    b.setAttribute('data-subject', value);
    if (value) b.style.paddingLeft = (0.5 + (value.split('/').length - 1) * 0.85) + 'rem';
    var name = document.createElement('span');
    name.className = 'fn-topic-label';
    name.textContent = label;
    b.appendChild(name);
    if (value) {
      var n = document.createElement('span');
      n.className = 'fn-topic-count';
      n.textContent = counts[value];
      b.appendChild(n);
    }
    return b;
  }

  rail.appendChild(topicButton('All', '', 'fn-topic-all'));
  topics.forEach(function (t) { rail.appendChild(topicButton(t, t)); });

  // ---- filtering ----
  var active = null;
  var empty = document.getElementById('fn-empty');

  function matches(el) {
    if (!active) return true;
    return subjectsOf(el).some(function (t) {
      return t === active || t.indexOf(active + '/') === 0;
    });
  }

  function render() {
    var visibleNotes = 0;
    items.forEach(function (el) {
      var show = matches(el);
      el.classList.toggle('is-hidden', !show);
      if (show && el.classList.contains('fn-note')) visibleNotes++;
    });
    if (empty) empty.hidden = visibleNotes !== 0;

    Array.prototype.forEach.call(rail.querySelectorAll('.fn-topic'), function (b) {
      b.classList.toggle('is-active', (b.getAttribute('data-subject') || '') === (active || ''));
    });

    var hash = active ? '#topic=' + encodeURIComponent(active) : location.pathname;
    if (history.replaceState) history.replaceState(null, '', hash);

    if (typeof refreshFades === 'function') refreshFades();
  }

  function setActive(s) { active = s || null; render(); }

  // ---- scroll affordance: fade an edge only when there is more to scroll ----
  var scrollUpdaters = [];
  ['fn-resources', 'fn-notes'].forEach(function (id) {
    var list = document.getElementById(id);
    if (!list) return;
    var box = list.parentNode; // .fn-scroll
    function update() {
      box.classList.toggle('more-above', list.scrollTop > 1);
      box.classList.toggle('more-below', list.scrollHeight - list.clientHeight - list.scrollTop > 1);
    }
    list.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    scrollUpdaters.push(update);
  });
  function refreshFades() { scrollUpdaters.forEach(function (u) { u(); }); }

  document.addEventListener('click', function (e) {
    var topic = e.target.closest('.fn-topic');
    if (topic) { setActive(topic.getAttribute('data-subject')); return; }
    var tag = e.target.closest('.fn-tag');
    if (tag && tag.getAttribute('data-s')) { setActive(tag.getAttribute('data-s')); }
  });

  // ---- deep link: #topic=… ----
  var m = location.hash.match(/^#topic=(.+)$/);
  if (m) active = decodeURIComponent(m[1]);
  render();
})();
