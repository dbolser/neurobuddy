import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff } from '../app/smooth.js';

test('text diff keeps the shared start and end', () => {
  assert.deepEqual(diff('half eleven', 'just after half eleven'),
    { keepStart: '', out: '', in: 'just after ', keepEnd: 'half eleven' });
  assert.deepEqual(diff('nearly half eleven', 'half eleven'),
    { keepStart: '', out: 'nearly ', in: '', keepEnd: 'half eleven' });
  assert.deepEqual(diff('aaa', 'aaa'), { keepStart: 'aaa', out: '', in: '', keepEnd: '' });
  assert.deepEqual(diff('11:59', '12:00'), { keepStart: '1', out: '1:59', in: '2:00', keepEnd: '' });
});

import { plan } from '../app/smooth.js';
const show = (list) => list.map((u) => (u.st === 'keep' ? u.ch : u.st === 'out' ? '-' : u.st === 'gap' ? '_' : '+')).join('');
const text = (list, side) => list.filter((u) => u.st === 'keep' || u.st === side).map((u) => u.ch).join('');

test('word plan keeps shared words and swaps the rest in place', () => {
  const cases = [['quarter to twelve', "nearly twelve o'clock"], ['half eleven', 'just after half eleven'],
    ['nearly half eleven', 'half eleven'], ['just after quarter to twelve', "nearly twelve o'clock"],
    ["twelve o'clock", 'just after twelve o\'clock'], ['11:59', '12:00']];
  for (const [a, b] of cases) {
    const p = plan(a, b);
    assert.equal(text(p, 'out'), a, 'old text intact: ' + a);
    assert.equal(text(p, 'in'), b, 'new text intact: ' + b);
  }
  assert.equal(show(plan('quarter to twelve', "nearly twelve o'clock")), '----------_++++++ twelve++++++++');
  assert.equal(show(plan('half eleven', 'just after half eleven')), '+++++++++++half eleven');
});
