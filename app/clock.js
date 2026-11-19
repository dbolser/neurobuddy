// Clock faces as pure functions (testable without a DOM).

export const FACES = ['digital', 'words', 'linear'];
export const FACE_NAMES = { digital: '12-hour', words: 'Words', linear: 'Linear day' };

export function hour12(h) { return h % 12 || 12; }

// 14:05 -> "2:05". AM/PM left implied.
export function digital(d) {
  const m = d.getMinutes();
  return hour12(d.getHours()) + ':' + (m < 10 ? '0' : '') + m;
}

const NUM = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const PAST = { 5: 'five past', 10: 'ten past', 15: 'quarter past', 20: 'twenty past', 25: 'twenty-five past', 30: 'half past' };
const TO = { 35: 'twenty-five to', 40: 'twenty to', 45: 'quarter to', 50: 'ten to', 55: 'five to' };

// 14:17 -> "just after quarter past two"; 14:58 -> "nearly three o'clock".
export function words(d) {
  const min = d.getMinutes() + d.getSeconds() / 60;
  let m5 = Math.round(min / 5) * 5;
  let h = d.getHours();
  const off = min - m5;
  if (m5 === 60) { m5 = 0; h += 1; }
  const prefix = off >= 1 ? 'just after ' : off <= -1 ? 'nearly ' : '';
  let core;
  if (m5 === 0) core = NUM[h % 12] + " o'clock";
  else if (m5 <= 30) core = PAST[m5] + ' ' + NUM[h % 12];
  else core = TO[m5] + ' ' + NUM[(h + 1) % 12];
  return prefix + core;
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
