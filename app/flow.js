// Pure decision logic: which task to offer, and what each swipe leads to.
// No DOM, no network — app.js runs the effects this returns.
// Targets Chrome 87: no Array.at, no top-level await, no structuredClone.

export const DAY = 864e5;

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

// Deadline choices offered when a card without one gets put off. 17:00 local.
export function deadlineFor(choice, now) {
  const d = startOfDay(now);
  if (choice === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (choice === 'friday') d.setDate(d.getDate() + (((5 - d.getDay() + 7) % 7) || 7));
  else if (choice === 'nextweek') d.setDate(d.getDate() + 7);
  else return null;
  d.setHours(17);
  return d;
}

// ---- Session: a run of prompts that ends with a task picked (or none). ----
// state = { order: [cardId], ci, hi, step, skips }
// steps: hurdle -> [ugly -> sort… -> ship] -> delay -> (setdue) ; delay(keep) -> breakdown -> brainday
// skips: cardId -> how many times every step on it was turned down.

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

function nextCard(s) {
  return s.ci + 1 < s.order.length
    ? with_(s, { ci: s.ci + 1, hi: 0, step: 'hurdle' })
    : with_(s, { hi: 0, step: 'empty' });
}

function with_(s, patch) {
  return Object.assign({}, s, patch);
}

// Putting it off until tomorrow would miss the deadline (due before tomorrow noon).
export function missesDeadline(card, now) {
  return !!card.due && !card.dueComplete && new Date(card.due) < +startOfDay(now) + 1.5 * DAY;
}

// First step that wasn't sorted to Later (the last step is never offered for sorting).
function firstKept(s) {
  return s.items.filter((h) => s.moved.indexOf(h.id) < 0)[0];
}

// What to show. left/right label the swipe directions; `buttons` means pick one.
export function promptFor(s, byId, now) {
  if (s.step === 'empty') {
    return { title: 'Nothing picked', sub: "That's fine. Take a proper break — I'll ask again later.",
      buttons: [{ id: 'ok', label: 'OK' }] };
  }
  const card = byId[s.order[s.ci]];
  if (s.step === 'hurdle') {
    const h = hurdles(card)[s.hi];
    return { q: 'Do this now?', title: h.name,
      sub: (h.id ? card.name + ' · ' : '') + dueText(card, now),
      urgent: isUrgent(card, now), left: 'Not now', right: 'Do it' };
  }
  // Right (green) always moves towards doing the task. Missing a deadline is a
  // button only, so a stray swipe can never do it.
  if (s.step === 'delay') {
    const miss = missesDeadline(card, now);
    return { q: 'Not now. When, then?', title: card.name, sub: dueText(card, now), danger: miss,
      buttons: [{ id: 'keep', label: 'Keep it now', cls: 'yes' }, { id: 'later', label: 'Later today' },
        miss ? { id: 'miss', label: 'Tomorrow (misses the deadline)', cls: 'danger' } : { id: 'tomorrow', label: 'Tomorrow' }] };
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
    return { q: 'Give it a deadline?', title: card.name,
      buttons: [{ id: 'tomorrow', label: 'Tomorrow' }, { id: 'friday', label: 'Friday' },
        { id: 'nextweek', label: 'Next week' }, { id: 'none', label: 'No deadline' }] };
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
  const card = byId[s.order[s.ci]];
  const fx = [];

  if (s.step === 'hurdle') {
    const hs = hurdles(card);
    const h = hs[s.hi];
    if (choice === 'right') {
      fx.push({ type: 'start', cardId: card.id, itemId: h.id, name: h.name, cardName: card.name });
      fx.push({ type: 'comment', cardId: card.id, text: 'Started: ' + h.name });
      return { next: null, effects: fx };
    }
    if (s.hi + 1 < hs.length) return { next: with_(s, { hi: s.hi + 1 }), effects: fx };
    // Every step turned down.
    fx.push({ type: 'skipped', cardId: card.id });
    const ugly = hs.length >= 3 && hs[0].id && (s.skips[card.id] || 0) >= UGLY_AFTER;
    return { next: with_(s, { hi: 0, step: ugly ? 'ugly' : 'delay' }), effects: fx };
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
    if (choice === 'later') {
      fx.push({ type: 'snooze', cardId: card.id, until: +now + 90 * 60e3 });
      fx.push({ type: 'comment', cardId: card.id, text: 'Put off until later today' });
      return { next: nextCard(s), effects: fx };
    }
    if (choice === 'tomorrow' || choice === 'miss') {
      fx.push({ type: 'snooze', cardId: card.id, until: +startOfDay(+now + DAY) });
      fx.push({ type: 'comment', cardId: card.id,
        text: choice === 'miss' ? 'Chose to miss the deadline (' + dueText(card, now) + ')' : 'Put off until tomorrow' });
      return { next: card.due ? nextCard(s) : with_(s, { step: 'setdue' }), effects: fx };
    }
    return { next: with_(s, { step: 'breakdown' }), effects: fx };
  }

  if (s.step === 'setdue') {
    const due = deadlineFor(choice, now);
    if (due) fx.push({ type: 'setDue', cardId: card.id, due: due.toISOString() });
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
