// Pure decision logic: which task to offer, and what each swipe leads to.
// No DOM, no network — app.js runs the effects this returns.
// Targets Chrome 87: no Array.at, no top-level await, no structuredClone.

export const DAY = 864e5;

// "1) find the thread 2) try /recall; 3. write it up" -> three steps.
export function splitSteps(text) {
  return text.split(/(?:^|\s+)\d+[).:]\s*|\s*[;\n]\s*/).map((t) => t.trim()).filter(Boolean);
}

// Checklists named "Later…" hold steps sorted out as not needed yet ("send it ugly").
export const LATER = 'Later (after it ships)';
const isLater = (cl) => /^later/i.test(cl.name || '');

// Incomplete checklist items, in order. A card with none is its own single hurdle.
export function hurdles(card) {
  const items = [];
  const lists = (card.checklists || []).filter((cl) => !isLater(cl)).sort((a, b) => a.pos - b.pos);
  for (const cl of lists) {
    for (const it of cl.checkItems.slice().sort((a, b) => a.pos - b.pos)) {
      if (it.state !== 'complete') items.push({ id: it.id, name: it.name });
    }
  }
  return items.length ? items : [{ id: null, name: card.name }];
}

// Due within two days (or overdue) and not ticked off.
export function isUrgent(card, now) {
  return !!card.due && !card.dueComplete && new Date(card.due) - now < 2 * DAY;
}

// Urgent cards first (soonest due first), then by list priority, then board order.
export function orderCards(cards, listOrder, now, snoozed) {
  snoozed = snoozed || {};
  const urgent = (c) => (isUrgent(c, now) ? 1 : 0);
  return cards
    .filter((c) => listOrder.indexOf(c.idList) >= 0 && !c.dueComplete && !(snoozed[c.id] > now))
    .sort((a, b) =>
      urgent(b) - urgent(a) ||
      (urgent(a) ? new Date(a.due) - new Date(b.due) : 0) ||
      listOrder.indexOf(a.idList) - listOrder.indexOf(b.idList) ||
      a.pos - b.pos);
}

export function dueText(card, now) {
  if (!card.due) return 'no deadline';
  const due = new Date(card.due);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < -1) return 'overdue by ' + -days + ' days';
  if (days === -1) return 'was due yesterday';
  if (days === 0) return due < now ? 'overdue (today)' : 'due today';
  if (days === 1) return 'due tomorrow';
  if (days < 7) return 'due in ' + days + ' days';
  return 'due ' + due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Cards labelled Personal (or Home) are done at home: put off to the weekend, not the next workday.
export function isHome(card) {
  return !!card && (card.labels || []).some((l) => /^(personal|home)$/i.test((l.name || '').trim()));
}

const isWeekend = (wd) => wd === 0 || wd === 6;
function nextDay(now, ok) {
  const d = startOfDay(now);
  do d.setDate(d.getDate() + 1); while (!ok(d.getDay()));
  return d;
}

// Next weekday (Friday -> Monday).
export const nextWorkday = (now) => nextDay(now, (wd) => !isWeekend(wd));
// Next weekend day (weekday -> Saturday, Saturday -> Sunday).
export const nextHomeday = (now) => nextDay(now, isWeekend);
// The next day this card can be done: home cards at the weekend, the rest on a workday.
export const nextDayFor = (card, now) => (isHome(card) ? nextHomeday : nextWorkday)(now);

export function dayName(d, now) {
  return +d === +startOfDay(+startOfDay(now) + DAY + 3e6) ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long' });
}

// Deadline choices offered when a card gets put off. 17:00 local.
// 'soon' = the next day it can be done; 'later' = a week after that ("Next week" / "Next weekend").
export function deadlineFor(choice, now, card) {
  let d;
  if (choice === 'soon') d = nextDayFor(card, now);
  else if (choice === 'friday') d = nextDay(now, (wd) => wd === 5);
  else if (choice === 'later') d = isHome(card) ? new Date(+nextHomeday(now) + 7 * DAY + 3e6) : new Date(+startOfDay(now) + 7 * DAY + 3e6);
  else return null;
  d = startOfDay(d);
  d.setHours(17);
  return d;
}

// ---- Session: a run of prompts that ends with a task picked (or none). ----
// state = { order: [cardId], ci, hi, step, skips, snoozed }
// steps: hurdle (the card's next step; left puts the card off) -> [ugly -> sort… -> ship] ; delay -> (setdue) ; delay(keep) -> breakdown -> brainday
// skips: cardId -> how many times every step on it was turned down.
// snoozed: cardId -> ms it was put off until (so a second put-off today goes further).

// After this many full turn-downs, a card with 3+ steps gets the "send it ugly" sort.
export const UGLY_AFTER = 2;

export function startSession(order, firstId, step, skips) {
  const ids = order.map((c) => c.id);
  if (firstId) {
    const i = ids.indexOf(firstId);
    if (i > 0) ids.unshift(ids.splice(i, 1)[0]);
    if (i < 0) step = 'hurdle'; // that card isn't on offer (e.g. snoozed): normal session
  }
  if (!ids.length) return { order: [], ci: 0, hi: 0, step: 'empty', skips: skips || {} };
  return { order: ids, ci: 0, hi: 0, step: step || 'hurdle', skips: skips || {} };
}

// Swiped left on the task you're on: show a few other cards (one swipe each),
// then come back to it with big buttons. current = { cardId, name }.
export const SWITCH_CHOICES = 3;
export function startSwitch(order, current) {
  const ids = order.map((c) => c.id).filter((id) => id !== current.cardId).slice(0, SWITCH_CHOICES);
  return { order: ids, ci: 0, hi: 0, step: ids.length ? 'hurdle' : 'back', skips: {}, quick: true,
    back: current.cardId, backItem: current.itemId || null, backName: current.name };
}

// The steps of a card still to do, other than the one you're on.
function otherSteps(card, itemId) {
  return card ? hurdles(card).filter((h) => h.id && h.id !== itemId) : [];
}

// Swipe up deals another thing to do. The deck: the other steps of the task you're
// on, then tasks started today (latest first), then the rest in the usual order
// (one entry per task: its next step). Leaves out what's already on screen.
// order: cards on offer (orderCards); recent: card ids started today, latest first.
export function dealDeck(order, byId, current, recent, stack) {
  const out = [];
  const seen = {};
  const live = {};
  order.forEach((c) => { live[c.id] = true; });
  const add = (card, h) => out.push({ cardId: card.id, itemId: h.id, name: h.name, cardName: card.name });
  if (current && byId[current.cardId]) {
    const card = byId[current.cardId];
    otherSteps(card, current.itemId).filter((h) => !stack || h.id !== stack.itemId).forEach((h) => add(card, h));
    seen[card.id] = true;
  }
  if (stack) seen[stack.cardId] = true;
  (recent || []).filter((id) => live[id]).concat(order.map((c) => c.id)).forEach((id) => {
    if (seen[id] || !byId[id]) return;
    seen[id] = true;
    add(byId[id], hurdles(byId[id])[0]);
  });
  return out;
}

// A task with steps is done one step at a time: on the whole card, move to its first step.
export function narrow(current, card) {
  if (!current || current.itemId || !card) return current;
  const h = hurdles(card)[0];
  return h.id ? Object.assign({}, current, { itemId: h.id, name: h.name, cardName: card.name }) : current;
}

function nextCard(s) {
  if (s.quick) return s.ci + 1 < s.order.length ? with_(s, { ci: s.ci + 1, hi: 0 }) : with_(s, { step: 'back' });
  return s.ci + 1 < s.order.length
    ? with_(s, { ci: s.ci + 1, hi: 0, step: 'hurdle' })
    : with_(s, { hi: 0, step: 'empty' });
}

function with_(s, patch) {
  return Object.assign({}, s, patch);
}

// Putting it off to the next day it can be done would miss the deadline (due before noon that day).
export function missesDeadline(card, now) {
  return !!card.due && !card.dueComplete && new Date(card.due) < +nextDayFor(card, now) + DAY / 2;
}

// First step that wasn't sorted to Later (the last step is never offered for sorting).
function firstKept(s) {
  return s.items.filter((h) => s.moved.indexOf(h.id) < 0)[0];
}

// Left swipe on "When, then?": later today, unless it was already put off today.
function leftDelay(s, card, now) {
  const until = (s.snoozed || {})[card.id];
  if (!(until >= +startOfDay(now))) return 'later';
  return missesDeadline(card, now) ? 'move' : 'tomorrow';
}

// Put the card off: 'later' (90 min), 'tomorrow' (the next day it can be done: next workday,
// or the weekend for home cards) or 'move' (new deadline).
function putOff(s, card, how, now, fx) {
  if (how === 'later') {
    fx.push({ type: 'snooze', cardId: card.id, until: +now + 90 * 60e3 });
    fx.push({ type: 'comment', cardId: card.id, text: 'Put off until later today' });
    return { next: nextCard(s), effects: fx };
  }
  const day = nextDayFor(card, now);
  fx.push({ type: 'snooze', cardId: card.id, until: +day });
  if (how === 'tomorrow') fx.push({ type: 'comment', cardId: card.id, text: 'Put off until ' + dayName(day, now) });
  // Moving the deadline (or a card without one) asks for the new date.
  return { next: card.due && how === 'tomorrow' ? nextCard(s) : with_(s, { step: 'setdue' }), effects: fx };
}

// What to show. left/right label the swipe directions; `buttons` means pick one,
// and `swipe` says which button each swipe direction picks. Every card swipes.
export function promptFor(s, byId, now) {
  if (s.step === 'back') {
    // Steps already there: offer the next one rather than breaking it down again.
    const next = otherSteps(byId[s.back], s.backItem)[0];
    return { q: 'None of those. Back to this?', title: s.backName,
      buttons: [{ id: 'keep', label: 'Keep going', cls: 'yes' },
        next ? { id: 'nextstep', label: 'Next step: ' + next.name } : { id: 'steps', label: 'Break it down' },
        { id: 'putoff', label: 'Put it off' }], swipe: { left: 'putoff', right: 'keep', up: 'up' } };
  }
  if (s.step === 'empty') {
    return { title: 'Nothing picked', sub: "That's fine. Take a proper break — I'll ask again later.",
      buttons: [{ id: 'ok', label: 'OK' }], swipe: { left: 'ok', right: 'ok', up: 'up' } };
  }
  const card = byId[s.order[s.ci]];
  if (s.step === 'hurdle') {
    const h = hurdles(card)[s.hi];
    return { q: 'Do this now?', title: h.name,
      sub: (h.id ? card.name + ' · ' : '') + dueText(card, now),
      urgent: isUrgent(card, now), left: 'Not now', right: 'Do it', up: true };
  }
  // Right (green) always moves towards doing the task. Left puts it off, and the
  // more often today, the later: later today first, then the next workday (or a
  // new deadline). The arrows show where a swipe goes.
  if (s.step === 'delay') {
    const miss = missesDeadline(card, now);
    const far = miss ? { id: 'move', label: 'New deadline' } : { id: 'tomorrow', label: dayName(nextDayFor(card, now), now) };
    const near = { id: 'later', label: 'Later today' };
    const left = leftDelay(s, card, now);
    [near, far].forEach((b) => { if (b.id === left) b.label = '← ' + b.label; });
    return { q: 'Not now. When, then?', title: card.name, sub: dueText(card, now), left: 'later', right: 'keep',
      buttons: [{ id: 'keep', label: 'Keep it now →', cls: 'yes' }, near, far] };
  }
  if (s.step === 'ugly') {
    return { q: 'You keep skipping this. Too many steps?', title: card.name,
      sub: 'Sort the steps: which are really needed before it ships?', left: 'No', right: 'Sort them' };
  }
  if (s.step === 'sort') {
    const items = s.items;
    return { q: 'Needed before it ships?', title: items[s.hi].name,
      sub: card.name + ' · it ships with: ' + items[items.length - 1].name, left: 'Later', right: 'Needed' };
  }
  if (s.step === 'ship') {
    const h = firstKept(s);
    return { q: 'Ship it ugly?', title: h.name, sub: card.name + ' · the rest can follow',
      left: 'Not now', right: 'Do it' };
  }
  if (s.step === 'setdue') {
    // Right = the soonest day it can be done, left = a week later. Friday only when it's a different day.
    const soon = nextDayFor(card, now);
    const home = isHome(card);
    const buttons = [{ id: 'soon', label: dayName(soon, now) }];
    if (!home && soon.getDay() !== 5) buttons.push({ id: 'friday', label: 'Friday' });
    buttons.push({ id: 'later', label: home ? 'Next weekend' : 'Next week' }, { id: 'none', label: 'No deadline' });
    return { q: card.due ? 'New deadline?' : 'Give it a deadline?', title: card.name,
      sub: card.due ? 'Was ' + dueText(card, now) : '', buttons: buttons,
      swipe: { left: 'later', right: 'soon' } };
  }
  if (s.step === 'breakdown') {
    return { q: 'Break it down?', title: card.name, sub: "What's the smallest next step?",
      left: 'No', right: 'Yes' };
  }
  if (s.step === 'brainday') {
    return { q: 'Bad brain day?', title: 'Do something completely different',
      sub: 'Skip ' + card.name + ' for now', left: 'Yes, skip it', right: 'No, back to it' };
  }
  throw new Error('unknown step ' + s.step);
}

// Returns { next: state|null, effects: [...] }. next null = session over.
// choice: 'left' | 'right' | button id. Right always leads towards doing the task.
export function answer(s, byId, choice, now) {
  if (s.step === 'empty') return { next: null, effects: [{ type: 'idle' }] };
  if (s.step === 'back') {
    if (choice === 'keep') return { next: null, effects: [{ type: 'resume' }] };
    if (choice === 'steps') return { next: null, effects: [{ type: 'addSteps', cardId: s.back }] };
    if (choice === 'nextstep') {
      const card = byId[s.back];
      const h = otherSteps(card, s.backItem)[0];
      return { next: null, effects: [{ type: 'start', cardId: card.id, itemId: h.id, name: h.name, cardName: card.name },
        { type: 'comment', cardId: card.id, text: 'Moved on to: ' + h.name }] };
    }
    // Put it off: stop the task, then ask when (the usual later today / tomorrow / new deadline).
    return { next: { order: [s.back], ci: 0, hi: 0, step: 'delay', skips: {}, snoozed: s.snoozed }, effects: [{ type: 'stop' }] };
  }
  const card = byId[s.order[s.ci]];
  const fx = [];

  if (s.step === 'hurdle') {
    const hs = hurdles(card);
    const h = hs[s.hi];
    if (choice === 'right') {
      fx.push({ type: 'start', cardId: card.id, itemId: h.id, name: h.name, cardName: card.name });
      fx.push({ type: 'comment', cardId: card.id, text: 'Started: ' + h.name });
      if (s.back) fx.push({ type: 'comment', cardId: s.back, text: 'Switched away from: ' + s.backName });
      return { next: null, effects: fx };
    }
    if (s.quick) return { next: nextCard(s), effects: fx }; // one swipe per card
    // One card per task (its next step): left puts the whole task off, no second "when?" card.
    fx.push({ type: 'skipped', cardId: card.id });
    const ugly = hs.length >= 3 && hs[0].id && (s.skips[card.id] || 0) >= UGLY_AFTER;
    if (ugly) return { next: with_(s, { hi: 0, step: 'ugly' }), effects: fx };
    return putOff(s, card, leftDelay(s, card, now), now, fx);
  }

  if (s.step === 'ugly') {
    // Snapshot the steps: the board may sync mid-sort and shift them.
    return { next: choice === 'right'
      ? with_(s, { hi: 0, step: 'sort', items: hurdles(card), moved: [] })
      : with_(s, { hi: 0, step: 'delay' }), effects: fx };
  }

  if (s.step === 'sort') {
    const h = s.items[s.hi];
    let moved = s.moved;
    if (choice === 'left') {
      fx.push({ type: 'later', cardId: card.id, itemId: h.id, name: h.name });
      moved = moved.concat([h.id]);
    }
    if (s.hi + 2 < s.items.length) return { next: with_(s, { hi: s.hi + 1, moved: moved }), effects: fx };
    fx.push({ type: 'sorted', cardId: card.id });
    return { next: with_(s, { hi: 0, step: 'ship', moved: moved }), effects: fx };
  }

  if (s.step === 'ship') {
    if (choice === 'right') {
      const h = firstKept(s);
      fx.push({ type: 'start', cardId: card.id, itemId: h.id, name: h.name, cardName: card.name });
      fx.push({ type: 'comment', cardId: card.id, text: 'Shipping it ugly; started: ' + h.name });
      return { next: null, effects: fx };
    }
    return { next: with_(s, { step: 'delay' }), effects: fx };
  }

  if (s.step === 'delay') {
    if (choice === 'left') choice = leftDelay(s, card, now);
    if (choice === 'later' || choice === 'tomorrow' || choice === 'move') return putOff(s, card, choice, now, fx);
    return { next: with_(s, { step: 'breakdown' }), effects: fx };
  }

  if (s.step === 'setdue') {
    const due = deadlineFor(choice, now, card);
    if (due) fx.push({ type: 'setDue', cardId: card.id, due: due.toISOString() });
    if (card.due) fx.push({ type: 'comment', cardId: card.id,
      text: 'Moved the deadline from ' + dueText(card, now) + ' to ' + (due ? dueText({ due: due }, now) : 'none') });
    return { next: nextCard(s), effects: fx };
  }

  if (s.step === 'breakdown') {
    if (choice === 'right') return { next: null, effects: [{ type: 'askStep', cardId: card.id, cardName: card.name }] };
    return { next: with_(s, { step: 'brainday' }), effects: fx };
  }

  if (s.step === 'brainday') {
    if (choice === 'left') {
      fx.push({ type: 'comment', cardId: card.id, text: 'Skipped (bad brain day)' });
      return { next: nextCard(s), effects: fx };
    }
    return { next: with_(s, { hi: 0, step: 'hurdle' }), effects: fx };
  }
  throw new Error('unknown step ' + s.step);
}
