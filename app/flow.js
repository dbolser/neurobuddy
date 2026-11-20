// Pure decision logic: which task to offer, and what each swipe leads to.
// No DOM, no network — app.js runs the effects this returns.
// Targets Chrome 87: no Array.at, no top-level await, no structuredClone.

export const DAY = 864e5;

// Incomplete checklist items, in order. A card with none is its own single hurdle.
export function hurdles(card) {
  const items = [];
  const lists = (card.checklists || []).slice().sort((a, b) => a.pos - b.pos);
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
// state = { order: [cardId], ci, hi, step }
// steps: hurdle -> delay -> (setdue) ; delay(no) -> breakdown -> brainday

export function startSession(order, firstId, step) {
  const ids = order.map((c) => c.id);
  if (firstId) {
    const i = ids.indexOf(firstId);
    if (i > 0) ids.unshift(ids.splice(i, 1)[0]);
    if (i < 0) step = 'hurdle'; // that card isn't on offer (e.g. snoozed): normal session
  }
  if (!ids.length) return { order: [], ci: 0, hi: 0, step: 'empty' };
  return { order: ids, ci: 0, hi: 0, step: step || 'hurdle' };
}

function nextCard(s) {
  return s.ci + 1 < s.order.length
    ? { order: s.order, ci: s.ci + 1, hi: 0, step: 'hurdle' }
    : { order: s.order, ci: s.ci, hi: 0, step: 'empty' };
}

function with_(s, patch) {
  return Object.assign({}, s, patch);
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
    return isUrgent(card, now)
      ? { q: 'Then you miss the deadline?', title: card.name, sub: dueText(card, now), danger: true,
        buttons: [{ id: 'keep', label: 'No, keep it', cls: 'yes' }, { id: 'miss', label: 'Yes, miss it', cls: 'danger' }] }
      : { q: 'Put it off until tomorrow?', title: card.name, sub: dueText(card, now),
        left: 'Put it off', right: 'No, keep it' };
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
    return { next: s.hi + 1 < hs.length ? with_(s, { hi: s.hi + 1 }) : with_(s, { step: 'delay' }), effects: fx };
  }

  if (s.step === 'delay') {
    if (choice === 'left' || choice === 'miss') {
      const urgent = isUrgent(card, now);
      fx.push({ type: 'snooze', cardId: card.id });
      fx.push({ type: 'comment', cardId: card.id,
        text: urgent ? 'Chose to miss the deadline (' + dueText(card, now) + ')' : 'Put off until tomorrow' });
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
