import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hurdles, orderCards, startSession, promptFor, answer, deadlineFor, DAY } from '../app/flow.js';

const now = new Date('2026-11-19T10:00:00');
const L = { today: 'T', week: 'W', later: 'L', done: 'D' };
const order = [L.today, L.week, L.later];
const item = (id, name, pos, state) => ({ id, name, pos, state: state || 'incomplete' });

const yanis = { id: 'y', name: 'Email Yanis', idList: L.today, pos: 1, due: new Date(+now + 2.5 * DAY).toISOString(),
  checklists: [{ pos: 1, checkItems: [item('a', 'Search site', 1), item('b', 'HF review', 2), item('c', 'Done bit', 0, 'complete')] }] };
const wework = { id: 'w', name: 'Reply to WeWork', idList: L.today, pos: 2, due: null, checklists: [] };
const pd = { id: 'p', name: 'PD write-up', idList: L.week, pos: 1, due: new Date(+now + DAY).toISOString(),
  checklists: [{ pos: 1, checkItems: [item('r', 'Rerun', 1)] }] };
const old = { id: 'o', name: 'Done thing', idList: L.done, pos: 1, checklists: [] };
const cards = [yanis, wework, pd, old];
const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

test('hurdles skip completed items and fall back to the card', () => {
  assert.deepEqual(hurdles(yanis).map((h) => h.id), ['a', 'b']);
  assert.deepEqual(hurdles(wework), [{ id: null, name: 'Reply to WeWork' }]);
});

test('urgent cards first, then list order; done and snoozed excluded', () => {
  assert.deepEqual(orderCards(cards, order, now).map((c) => c.id), ['p', 'y', 'w']);
  assert.deepEqual(orderCards(cards, order, now, { p: +now + 1000 }).map((c) => c.id), ['y', 'w']);
});

test('swiping no walks the hurdles, then asks about the deadline', () => {
  let s = startSession(orderCards(cards, order, now));
  assert.equal(promptFor(s, byId, now).title, 'Rerun');
  s = answer(s, byId, 'left', now).next;
  const p = promptFor(s, byId, now);
  assert.equal(s.step, 'delay');
  assert.ok(p.danger, 'urgent card asks about missing the deadline');
});

test('refusing to miss the deadline leads to break-down, then brain-day, then back', () => {
  let s = { order: ['p'], ci: 0, hi: 0, step: 'delay' };
  assert.ok(!promptFor(s, byId, now).right, 'missing a deadline is never a swipe');
  s = answer(s, byId, 'keep', now).next;
  assert.equal(s.step, 'breakdown');
  s = answer(s, byId, 'left', now).next;
  assert.equal(s.step, 'brainday');
  s = answer(s, byId, 'right', now).next;
  assert.equal(s.step, 'hurdle');
});

test('putting off a card with no deadline asks for one', () => {
  let s = startSession([wework]);
  s = answer(s, byId, 'left', now).next;
  const r = answer(s, byId, 'left', now);
  assert.ok(r.effects.some((e) => e.type === 'snooze'));
  assert.equal(r.next.step, 'setdue');
  const r2 = answer(r.next, byId, 'friday', now);
  assert.equal(new Date(r2.effects[0].due).getDay(), 5);
  assert.equal(r2.next.step, 'empty');
});

test('swiping yes starts the task', () => {
  const r = answer(startSession([yanis]), byId, 'right', now);
  assert.equal(r.next, null);
  assert.equal(r.effects[0].type, 'start');
  assert.equal(r.effects[0].itemId, 'a');
});

test('swiping right never puts anything off', () => {
  for (const step of ['hurdle', 'delay', 'breakdown', 'brainday']) {
    for (const id of ['p', 'w']) {
      const r = answer({ order: [id], ci: 0, hi: 0, step: step }, byId, 'right', now);
      assert.ok(!r.effects.some((e) => e.type === 'snooze' || e.type === 'comment' && /Skipped/.test(e.text)), step);
    }
  }
});

test('deadline choices', () => {
  assert.equal(deadlineFor('tomorrow', now).getDate(), 20);
  assert.equal(deadlineFor('friday', new Date('2026-11-20T10:00:00')).getDate(), 27);
  assert.equal(deadlineFor('none', now), null);
});
