// Clock faces as pure functions (testable without a DOM).

// A face is any mix of three parts: the day bar, the time in words, the digits.
// The menu steps through every mix; the first is the default.
export const FACES = ['bar+words', 'words', 'bar+digits', 'digits', 'words+digits', 'bar+words+digits', 'bar'];
const OLD = { digital: 'digits', words: 'words+digits', linear: 'bar+words+digits' };

export function faceParts(face) {
  const f = FACES.indexOf(face) >= 0 ? face : OLD[face] || FACES[0];
  const has = (p) => f.split('+').indexOf(p) >= 0;
  return { face: f, bar: has('bar'), words: has('words'), digits: has('digits') };
}

export function faceName(face) {
  const p = faceParts(face);
  return [p.bar && 'day bar', p.words && 'words', p.digits && '2:05'].filter(Boolean).join(' + ');
}

export function hour12(h) { return h % 12 || 12; }

// 14:05 -> "2:05". AM/PM left implied.
export function digital(d) {
  const m = d.getMinutes();
  return hour12(d.getHours()) + ':' + (m < 10 ? '0' : '') + m;
}

const NUM = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];

// Loose on purpose. "nearly" only before the hour or the half hour (time to get ready);
// "just after" only after the hour. Minutes past the hour -> words:
//   57–2  twelve o'clock      3–9  just after twelve    10–22 quarter past twelve
//   23–27 nearly half past twelve    28–39 half past twelve
//   40–52 quarter to one      53–56 nearly one
const PHRASES = [
  [3, (h) => h + " o'clock"],
  [10, (h) => 'just after ' + h],
  [23, (h) => 'quarter past ' + h],
  [28, (h) => 'nearly half past ' + h],
  [40, (h) => 'half past ' + h],
  [53, (h, n) => 'quarter to ' + n],
  [57, (h, n) => 'nearly ' + n],
  [60, (h, n) => n + " o'clock"],
];

export function words(d) {
  const min = d.getMinutes() + d.getSeconds() / 60;
  const h = NUM[d.getHours() % 12], n = NUM[(d.getHours() + 1) % 12];
  for (let i = 0; i < PHRASES.length; i++) if (min < PHRASES[i][0]) return PHRASES[i][1](h, n);
  return n + " o'clock";
}

// Linear day: span from the work-day start to end, widened to include now.
// Returns the fraction elapsed and the hour ticks (with 12-hour labels).
export function dayBar(d, start, end) {
  const now = d.getHours() + d.getMinutes() / 60;
  const from = Math.min(start, Math.floor(now));
  const to = Math.max(end, Math.ceil(now + 0.01));
  const ticks = [];
  for (let h = from; h <= to; h++) ticks.push({ at: (h - from) / (to - from), label: String(hour12(h % 24)) });
  return { from: from, to: to, frac: (now - from) / (to - from), ticks: ticks };
}
