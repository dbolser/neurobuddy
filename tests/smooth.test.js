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
