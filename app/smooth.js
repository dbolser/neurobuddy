// Smoothly change one line of text into another, letter by letter.
// The shared start and end stay put (and glide as the line re-centres); letters
// that go shrink and fade, left to right; new letters grow and fade in, left to right.
// "half eleven" -> "just after half eleven": the j appears, then u, s, t…
// Pure-ish: only touches `el`. Chrome 87: no Array.at, no replaceChildren.

const WIDTH_MS = 380;  // each letter opening or closing
const STAGGER_MS = 55; // gap between neighbouring letters starting

// Shared start and end, at character level.
export function diff(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { keepStart: a.slice(0, p), out: a.slice(p, a.length - s), in: b.slice(p, b.length - s), keepEnd: a.slice(a.length - s) };
}

const timers = new WeakMap();

export function smoothText(el, text) {
  const old = el.getAttribute('data-text');
  if (old === text) return;
  el.setAttribute('data-text', text);
  clearTimeout(timers.get(el));
  if (old === null || document.hidden) { build(el, units(text, 'keep')); return; }

  const d = diff(old, text);
  const oldSpans = el.querySelectorAll('.c');
  const widths = [];
  for (let i = 0; i < oldSpans.length; i++) widths.push(oldSpans[i].getBoundingClientRect().width);
  const outW = widths.slice(d.keepStart.length, d.keepStart.length + d.out.length);

  const outs = units(d.out, 'out');
  const ins = units(d.in, 'in');
  const spans = build(el, units(d.keepStart, 'keep').concat(outs, ins, units(d.keepEnd, 'keep')));
  const outEls = spans.filter((s) => s.st === 'out').map((s) => s.el);
  const inEls = spans.filter((s) => s.st === 'in').map((s) => s.el);

  // Starting point: leaving letters at full width, new letters measured then shut.
  outEls.forEach((e, i) => { e.style.maxWidth = (outW[i] || 0) + 'px'; });
  const inW = inEls.map((e) => e.getBoundingClientRect().width);
  inEls.forEach((e) => { e.style.maxWidth = '0px'; e.style.opacity = '0'; });
  void el.offsetWidth; // commit the starting point before transitioning

  outEls.forEach((e, i) => go(e, i * STAGGER_MS, '0px', '0'));
  // A whole new phrase waits for the old one to go, so they never overlap.
  const wait = outEls.length && inEls.length ? WIDTH_MS + (outEls.length - 1) * STAGGER_MS * 0.5 : 0;
  inEls.forEach((e, i) => go(e, wait + i * STAGGER_MS, inW[i] + 'px', '1'));

  const total = wait + Math.max(outEls.length, inEls.length) * STAGGER_MS + WIDTH_MS + 100;
  timers.set(el, setTimeout(() => build(el, units(text, 'keep')), total));
}

function go(e, delay, width, opacity) {
  e.style.transition = 'max-width ' + WIDTH_MS + 'ms ease-in-out ' + delay + 'ms, opacity ' +
    WIDTH_MS + 'ms ease-in-out ' + (delay + (opacity === '1' ? WIDTH_MS / 3 : 0)) + 'ms';
  e.style.maxWidth = width;
  e.style.opacity = opacity;
}

function units(str, st) {
  return str.split('').map((ch) => ({ ch: ch, st: st }));
}

// Letters are inline-blocks (so their width can animate) grouped into no-wrap
// words; a zero-width space after each space keeps line wrapping between words.
function build(el, list) {
  while (el.firstChild) el.removeChild(el.firstChild);
  const out = [];
  let word = null;
  list.forEach((u) => {
    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = u.ch === ' ' ? ' ' : u.ch;
    out.push({ el: c, st: u.st });
    if (u.ch === ' ') {
      el.appendChild(c);
      el.appendChild(document.createTextNode('​'));
      word = null;
    } else {
      if (!word) { word = document.createElement('span'); word.className = 'w'; el.appendChild(word); }
      word.appendChild(c);
    }
  });
  return out;
}
