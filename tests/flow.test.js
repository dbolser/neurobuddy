import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hurdles, orderCards, startSession, promptFor, answer, deadlineFor, missesDeadline, splitSteps, LATER, DAY } from '../app/flow.js';

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
  assert.ok(p.buttons.some((b) => b.id === 'move'), 'due 10am tomorrow: offers a new deadline');
});

test('keeping it leads to break-down, then brain-day, then back', () => {
  let s = { order: ['p'], ci: 0, hi: 0, step: 'delay' };
  assert.ok(!promptFor(s, byId, now).right, 'putting off is never a swipe');
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
  const r = answer(s, byId, 'tomorrow', now);
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
  assert.equal(deadlineFor('tomorrow', new Date('2026-11-20T10:00:00')).getDate(), 23, 'Friday -> Monday');
  assert.equal(deadlineFor('friday', new Date('2026-11-20T10:00:00')).getDate(), 27);
  assert.equal(deadlineFor('none', now), null);
});

test('not now on a card due later today offers later today, and only warns when tomorrow would miss it', () => {
  const noon = { id: 'n', name: 'Alex list', due: '2026-11-19T12:00:00', checklists: [] };
  const map = { n: noon };
  const p = promptFor({ order: ['n'], ci: 0, hi: 0, step: 'delay', skips: {} }, map, now);
  assert.deepEqual(p.buttons.map((b) => b.id), ['keep', 'later', 'move']);
  assert.ok(!p.danger, 'no harsh red card');
  const mv = answer({ order: ['n'], ci: 0, hi: 0, step: 'delay', skips: {} }, map, 'move', now);
  assert.equal(mv.next.step, 'setdue');
  assert.equal(promptFor(mv.next, map, now).q, 'New deadline?');
  const set = answer(mv.next, map, 'friday', now);
  assert.equal(set.effects[0].type, 'setDue');
  assert.ok(/Moved the deadline/.test(set.effects[1].text));
  const r = answer({ order: ['n'], ci: 0, hi: 0, step: 'delay', skips: {} }, map, 'later', now);
  assert.equal(r.effects[0].until, +now + 90 * 60e3);
  assert.ok(!missesDeadline(yanis, now), 'due in 2.5 days: tomorrow is fine');
});

const big = { id: 'b', name: 'Email Yanis', due: null, checklists: [
  { name: 'Steps', pos: 1, checkItems: [item('s1', 'Sign off site', 1), item('s2', 'HF review', 2), item('s3', 'Lit review', 3), item('s4', 'Send the email', 4)] },
  { name: LATER, pos: 2, checkItems: [item('z', 'Old later thing', 1)] }] };
const bigMap = { b: big };

test('send it ugly: after repeated skips, sort the steps, then ship with what is needed', () => {
  assert.deepEqual(hurdles(big).map((h) => h.id), ['s1', 's2', 's3', 's4'], 'Later checklist is not a hurdle');
  let s = startSession([big], null, null, { b: 2 });
  for (let i = 0; i < 3; i++) s = answer(s, bigMap, 'left', now).next;
  const r = answer(s, bigMap, 'left', now);
  assert.ok(r.effects.some((e) => e.type === 'skipped'));
  s = r.next;
  assert.equal(s.step, 'ugly');
  s = answer(s, bigMap, 'right', now).next;
  assert.equal(promptFor(s, bigMap, now).title, 'Sign off site');
  s = answer(s, bigMap, 'right', now).next;          // sign off: needed
  const later = answer(s, bigMap, 'left', now);       // HF review: later
  assert.equal(later.effects[0].type, 'later');
  s = answer(later.next, bigMap, 'left', now).next;   // lit review: later -> done sorting (send is never sorted)
  assert.equal(s.step, 'ship');
  assert.equal(promptFor(s, bigMap, now).title, 'Sign off site');
  const go = answer(s, bigMap, 'right', now);
  assert.equal(go.effects[0].itemId, 's1');
});

test('send it ugly waits for repeated skips', () => {
  let s = startSession([big], null, null, { b: 1 });
  for (let i = 0; i < 4; i++) s = answer(s, bigMap, 'left', now).next;
  assert.equal(s.step, 'delay');
});

test('numbered brain dumps split into steps', () => {
  assert.deepEqual(splitSteps('1) Find the thread. 2) Try the /recall skill on it 3) write up'),
    ['Find the thread.', 'Try the /recall skill on it', 'write up']);
  assert.deepEqual(splitSteps('email Julian; check figures'), ['email Julian', 'check figures']);
  assert.deepEqual(splitSteps('Run v2 of the model'), ['Run v2 of the model']);
});
