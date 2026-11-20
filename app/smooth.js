// Smoothly change one line of text into another, letter by letter.
// Shared words stay (and glide as the line re-centres); gone letters close up
// from both ends; new letters open and fade in left to right, at the same time.
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

// Word-level plan: which words stay, go, or arrive, as a list of letter units
// { ch, st: 'keep'|'out'|'in', d: delay in letter steps }. Shared words are matched
// (longest common subsequence), so "quarter to twelve" -> "nearly twelve o'clock"
// keeps "twelve" and swaps the words around it at the same time.
export function plan(a, b) {
  if (a.indexOf(' ') < 0 && b.indexOf(' ') < 0) { // single token (digits): letter-level
    const d = diff(a, b);
    return seq(d.keepStart, 'keep').concat(edges(seq(d.out, 'out')), seq(d.in, 'in'), seq(d.keepEnd, 'keep'));
  }
  const A = a.split(' '), B = b.split(' ');
  const L = [];
  for (let i = A.length; i >= 0; i--) {
    L[i] = [];
    for (let j = B.length; j >= 0; j--) {
      L[i][j] = i === A.length || j === B.length ? 0
        : A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  // Walk the table into runs: kept words, and changed segments (gone words, then new words).
  const words = []; // { w, old, new }
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { words.push({ w: A[i], old: true, new: true }); i++; j++; }
    else if (j < B.length && (i === A.length || L[i][j + 1] >= L[i + 1][j])) { words.push({ w: B[j], old: false, new: true }); j++; }
    else { words.push({ w: A[i], old: true, new: false }); i++; }
  }
  // Put each changed segment's gone words before its new words.
  const ordered = [];
  for (let k = 0; k < words.length;) {
    if (words[k].old && words[k].new) { ordered.push(words[k++]); continue; }
    const seg = [];
    while (k < words.length && !(words[k].old && words[k].new)) seg.push(words[k++]);
    seg.filter((w) => w.old).concat(seg.filter((w) => !w.old)).forEach((w) => ordered.push(w));
  }
  // Letters, with a space before every word but the first. A space exists in the
  // old text if its word was old and an old word came before; same for new.
  const out = [];
  let seenOld = false, seenNew = false, segOut = [], segIn = [], gap = null;
  const flush = () => {
    edges(segOut).forEach((u) => out.push(u));
    if (gap) out.push(gap);
    segIn.forEach((u, n) => { u.d = n; out.push(u); });
    segOut = []; segIn = []; gap = null;
  };
  ordered.forEach((w, k) => {
    const st = w.old && w.new ? 'keep' : w.old ? 'out' : 'in';
    if (k > 0) {
      const so = w.old && seenOld, sn = w.new && seenNew;
      // 'gap': in neither text; keeps a gone word and a new word apart while they swap.
      const sp = { ch: ' ', st: so && sn ? 'keep' : so ? 'out' : sn ? 'in' : 'gap', d: 0 };
      if (sp.st === 'keep') { flush(); out.push(sp); }
      else if (sp.st === 'gap') gap = sp;
      else (sp.st === 'out' ? segOut : segIn).push(sp);
    }
    if (st === 'keep') flush();
    w.word = seq(w.w, st);
    if (st === 'keep') w.word.forEach((u) => out.push(u));
    else w.word.forEach((u) => (st === 'out' ? segOut : segIn).push(u));
    seenOld = seenOld || w.old; seenNew = seenNew || w.new;
  });
  flush();
  return out;
}

function seq(str, st) { return str.split('').map((ch) => ({ ch: ch, st: st, d: 0 })); }

// Gone letters close from both ends of their segment inwards.
function edges(list) {
  list.forEach((u, n) => { u.d = Math.min(n, list.length - 1 - n); });
  return list;
}

const timers = new WeakMap();

export function smoothText(el, text) {
  const old = el.getAttribute('data-text');
  if (old === text) return;
  el.setAttribute('data-text', text);
  if (old === null || document.hidden) { clearTimeout(timers.get(el)); timers.delete(el); build(el, seq(text, 'keep')); return; }
  // Still animating the last change: settle it first so the letters line up.
  if (timers.has(el)) { clearTimeout(timers.get(el)); timers.delete(el); build(el, seq(old, 'keep')); }

  const oldSpans = el.querySelectorAll('.c');
  const widths = [];
  for (let i = 0; i < oldSpans.length; i++) widths.push(oldSpans[i].getBoundingClientRect().width);
  const list = plan(old, text);
  // Old letters (kept or gone) appear in the plan in their old order: hand them their widths.
  let w = 0;
  list.forEach((u) => { if (u.st === 'keep' || u.st === 'out') u.w = widths[w++] || 0; });

  const spans = build(el, list);
  const outs = spans.filter((s) => s.u.st === 'out');
  const ins = spans.filter((s) => s.u.st === 'in');
  outs.forEach((s) => { s.el.style.maxWidth = s.u.w + 'px'; });
  const gaps = spans.filter((s) => s.u.st === 'gap');
  ins.concat(gaps).forEach((s) => { s.w = s.el.getBoundingClientRect().width; s.el.style.maxWidth = '0px'; s.el.style.opacity = '0'; });
  void el.offsetWidth; // commit the starting point before transitioning

  // Gone and new letters move at the same time, so the kept words glide only as far as they must.
  outs.forEach((s) => go(s.el, s.u.d * STAGGER_MS, '0px', '0'));
  ins.forEach((s) => go(s.el, s.u.d * STAGGER_MS, s.w + 'px', '1'));

  const steps = Math.max.apply(null, [0].concat(list.map((u) => u.d)));
  gaps.forEach((s) => { // open at once, close as the last letters finish
    go(s.el, 0, s.w + 'px', '0');
    setTimeout(() => go(s.el, 0, '0px', '0'), steps * STAGGER_MS + WIDTH_MS * 0.4);
  });
  timers.set(el, setTimeout(() => { timers.delete(el); build(el, seq(text, 'keep')); }, steps * STAGGER_MS + WIDTH_MS * 1.4 + 100));
}

function go(e, delay, width, opacity) {
  e.style.transition = 'max-width ' + WIDTH_MS + 'ms ease-in-out ' + delay + 'ms, opacity ' +
    WIDTH_MS + 'ms ease-in-out ' + (delay + (opacity === '1' ? WIDTH_MS / 3 : 0)) + 'ms';
  e.style.maxWidth = width;
  e.style.opacity = opacity;
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
    out.push({ el: c, u: u });
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
