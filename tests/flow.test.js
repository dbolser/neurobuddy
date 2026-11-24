import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hurdles, orderCards, startSession, promptFor, answer, deadlineFor, missesDeadline, splitSteps, startSwitch, dealDeck, narrow, LATER, DAY } from '../app/flow.js';

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

test('one card per task: its next step; left puts the task off and moves on', () => {
  let s = startSession(orderCards(cards, order, now));
  assert.equal(promptFor(s, byId, now).title, 'Rerun');
  const r = answer(s, byId, 'left', now);
  assert.equal(r.effects.filter((e) => e.type === 'snooze')[0].until, +now + 90 * 60e3, 'later today');
  s = r.next;
  assert.equal(s.step, 'hurdle');
  assert.equal(promptFor(s, byId, now).title, 'Search site', 'next task, not the same task again');
  s = answer(s, byId, 'left', now).next;
  assert.equal(promptFor(s, byId, now).title, 'Reply to WeWork', 'not the second step of the same card');
});

test('keeping it leads to break-down, then brain-day, then back', () => {
  let s = { order: ['p'], ci: 0, hi: 0, step: 'delay' };
  assert.equal(promptFor(s, byId, now).right, 'keep', 'right swipe keeps it');
  s = answer(s, byId, 'keep', now).next;
  assert.equal(s.step, 'breakdown');
  s = answer(s, byId, 'left', now).next;
  assert.equal(s.step, 'brainday');
  s = answer(s, byId, 'right', now).next;
  assert.equal(s.step, 'hurdle');
});

test('putting off a card with no deadline asks for one', () => {
  const s = { order: ['w'], ci: 0, hi: 0, step: 'delay', skips: {} };
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
  const r = answer(startSession([big], null, null, { b: 1 }), bigMap, 'left', now);
  assert.ok(r.effects.some((e) => e.type === 'snooze'), 'just put off');
});

test('numbered brain dumps split into steps', () => {
  assert.deepEqual(splitSteps('1) Find the thread. 2) Try the /recall skill on it 3) write up'),
    ['Find the thread.', 'Try the /recall skill on it', 'write up']);
  assert.deepEqual(splitSteps('email Julian; check figures'), ['email Julian', 'check figures']);
  assert.deepEqual(splitSteps('Run v2 of the model'), ['Run v2 of the model']);
});

test('swipe left on the current task: a few quick alternatives, then back to it', () => {
  const cur = { cardId: 'y', name: 'Search site' };
  let s = startSwitch(orderCards(cards, order, now), cur);
  assert.deepEqual(s.order, ['p', 'w'], 'the current card is not offered');
  s = answer(s, byId, 'left', now).next;
  assert.equal(s.ci, 1, 'one swipe per card, no hurdle walk');
  s = answer(s, byId, 'left', now).next;
  assert.equal(s.step, 'back');
  assert.equal(promptFor(s, byId, now).title, 'Search site');
  assert.equal(answer(s, byId, 'keep', now).effects[0].type, 'resume');
  const off = answer(s, byId, 'putoff', now);
  assert.equal(off.effects[0].type, 'stop');
  assert.equal(off.next.step, 'delay');
  const sw = answer(startSwitch(orderCards(cards, order, now), cur), byId, 'right', now);
  assert.equal(sw.effects[0].cardId, 'p');
  assert.ok(sw.effects.some((e) => e.cardId === 'y' && /Switched away/.test(e.text)));
});

test('left on "when, then?": later today first, then further if already put off today', () => {
  const free = { id: 'f', name: 'Dashboard', due: null, checklists: [] };
  const due = { id: 'n', name: 'Alex list', due: '2026-11-19T12:00:00', checklists: [] };
  const map = { f: free, n: due };
  const at = (id, snoozed) => ({ order: [id], ci: 0, hi: 0, step: 'delay', skips: {}, snoozed: snoozed });
  const first = answer(at('f', {}), map, 'left', now);
  assert.equal(first.effects[0].until, +now + 90 * 60e3);
  assert.ok(/← Later today/.test(promptFor(at('f', {}), map, now).buttons[1].label));
  const again = { f: +now - 60e3, n: +now - 60e3 }; // put off earlier today, now back
  const second = answer(at('f', again), map, 'left', now);
  assert.ok(/Put off until/.test(second.effects[1].text) && !/later today/.test(second.effects[1].text));
  assert.equal(answer(at('n', again), map, 'left', now).next.step, 'setdue', 'would miss the deadline: ask for a new one');
  const old = { f: +now - 2 * 86400e3 }; // put off days ago: counts afresh
  assert.equal(answer(at('f', old), map, 'left', now).effects[0].until, +now + 90 * 60e3);
  assert.equal(answer(at('f', {}), map, 'right', now).next.step, 'breakdown', 'right keeps it');
});

test('swipe up deals: other steps of this task, then today\'s tasks, then the rest', () => {
  const ord = orderCards(cards, order, now); // p, y, w
  const cur = { cardId: 'y', itemId: 'a', name: 'Search site' };
  const d = dealDeck(ord, byId, cur, ['w']);
  assert.deepEqual(d.map((e) => e.cardId + ':' + e.itemId), ['y:b', 'w:null', 'p:r']);
  const k = dealDeck(ord, byId, cur, ['w'], { cardId: 'w', itemId: null });
  assert.deepEqual(k.map((e) => e.cardId), ['y', 'p'], 'what is waiting underneath is not dealt again');
  assert.deepEqual(dealDeck(ord, byId, null, ['o', 'w']).map((e) => e.cardId), ['w', 'p', 'y'], 'done cards are never dealt');
});

test('a whole-card task with steps becomes its first step', () => {
  const c = narrow({ cardId: 'y', itemId: null, name: 'Email Yanis', since: 5 }, yanis);
  assert.equal(c.itemId, 'a');
  assert.equal(c.name, 'Search site');
  assert.equal(c.since, 5);
  const w = { cardId: 'w', itemId: null, name: 'Reply to WeWork' };
  assert.equal(narrow(w, wework), w, 'no steps: unchanged');
});

test('"Back to this?" offers the next step when the task already has steps', () => {
  const s = startSwitch([], { cardId: 'y', itemId: 'a', name: 'Search site' });
  const p = promptFor(s, byId, now);
  assert.ok(p.buttons.some((b) => b.id === 'nextstep' && /HF review/.test(b.label)));
  const r = answer(s, byId, 'nextstep', now);
  assert.equal(r.effects[0].type, 'start');
  assert.equal(r.effects[0].itemId, 'b');
  const w = promptFor(startSwitch([], { cardId: 'w', itemId: null, name: 'Reply to WeWork' }), byId, now);
  assert.ok(w.buttons.some((b) => b.id === 'steps'), 'no steps yet: break it down');
});
