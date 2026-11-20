import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digital, words, dayBar, faceParts, FACES } from '../app/clock.js';

const at = (h, m, s) => new Date(2026, 10, 19, h, m, s || 0);

test('12-hour digital, no AM/PM', () => {
  assert.equal(digital(at(14, 5)), '2:05');
  assert.equal(digital(at(0, 30)), '12:30');
  assert.equal(digital(at(12, 0)), '12:00');
});

test('time in words, to the nearest quarter', () => {
  assert.equal(words(at(14, 15)), 'quarter past two');
  assert.equal(words(at(14, 17)), 'quarter past two');
  assert.equal(words(at(14, 19)), 'quarter past two', 'no "just after"');
  assert.equal(words(at(11, 52)), 'quarter to twelve');
  assert.equal(words(at(11, 53)), 'nearly twelve');
  assert.equal(words(at(11, 24)), 'nearly half eleven');
  assert.equal(words(at(14, 30)), 'half two');
  assert.equal(words(at(14, 40)), 'nearly quarter to three');
  assert.equal(words(at(14, 58)), "three o'clock");
  assert.equal(words(at(14, 55)), 'nearly three');
  assert.equal(words(at(11, 56)), 'nearly twelve');
  assert.equal(words(at(15, 5)), "three o'clock");
});

test('linear day bar', () => {
  const b = dayBar(at(13, 30), 9, 18);
  assert.equal(b.frac, 0.5);
  assert.equal(b.ticks.length, 10);
  assert.equal(b.ticks[4].label, '1');
  const late = dayBar(at(21, 0), 9, 18);
  assert.equal(late.to, 22);
});

test('faces are mixes of bar, words and digits', () => {
  assert.equal(FACES.length, 7);
  assert.deepEqual(faceParts('bar+words'), { face: 'bar+words', bar: true, words: true, digits: false });
  assert.equal(faceParts('linear').face, 'bar+words+digits');
  assert.equal(faceParts(undefined).face, 'bar+words');
});
