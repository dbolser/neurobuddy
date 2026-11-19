import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digital, words, dayBar } from '../app/clock.js';

const at = (h, m, s) => new Date(2026, 10, 19, h, m, s || 0);

test('12-hour digital, no AM/PM', () => {
  assert.equal(digital(at(14, 5)), '2:05');
  assert.equal(digital(at(0, 30)), '12:30');
  assert.equal(digital(at(12, 0)), '12:00');
});

test('time in words', () => {
  assert.equal(words(at(14, 15)), 'quarter past two');
  assert.equal(words(at(14, 17)), 'just after quarter past two');
  assert.equal(words(at(14, 13)), 'nearly quarter past two');
  assert.equal(words(at(14, 30)), 'half past two');
  assert.equal(words(at(14, 40)), 'twenty to three');
  assert.equal(words(at(14, 58)), "nearly three o'clock");
  assert.equal(words(at(11, 59)), "nearly twelve o'clock");
  assert.equal(words(at(15, 0)), "three o'clock");
});

test('linear day bar', () => {
  const b = dayBar(at(13, 30), 9, 18);
  assert.equal(b.frac, 0.5);
  assert.equal(b.ticks.length, 10);
  assert.equal(b.ticks[4].label, '1');
  const late = dayBar(at(21, 0), 9, 18);
  assert.equal(late.to, 22);
});
