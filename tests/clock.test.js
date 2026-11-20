import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digital, words, dayBar, faceParts, FACES } from '../app/clock.js';

const at = (h, m, s) => new Date(2026, 10, 19, h, m, s || 0);

test('12-hour digital, no AM/PM', () => {
  assert.equal(digital(at(14, 5)), '2:05');
  assert.equal(digital(at(0, 30)), '12:30');
  assert.equal(digital(at(12, 0)), '12:00');
});

test('time in words: nearly before the hour and half hour, just after only after the hour', () => {
  const say = (m) => words(at(12, m));
  assert.equal(say(0), "twelve o'clock");
  assert.equal(say(4), 'just after twelve');
  assert.equal(say(12), 'quarter past twelve');
  assert.equal(say(25), 'nearly half past twelve');
  assert.equal(say(30), 'half past twelve');
  assert.equal(say(38), 'half past twelve');
  assert.equal(say(45), 'quarter to one');
  assert.equal(say(55), 'nearly one');
  assert.equal(say(58), "one o'clock");
  assert.equal(words(at(23, 58)), "twelve o'clock");
  assert.equal(words(at(0, 5)), 'just after twelve');
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
