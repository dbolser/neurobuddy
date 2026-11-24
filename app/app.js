// NeuroBuddy: desk clock that pops up swipeable task cards from a Trello board.
// Chrome 87 target (Galaxy A20e): no top-level await, no Array.at.
import { smoothText } from './smooth.js';
import { FACES, faceParts, faceName, digital, words, dayBar } from './clock.js';
import { orderCards, startSession, startSwitch, promptFor, answer, startOfDay, DAY, LATER, splitSteps } from './flow.js';

const API = 'https://api.trello.com/1';
const MIN = 60e3;
const BUSY = 45; // minutes of quiet after "I'm busy" (on top of the usual offer gap)
const DEFAULTS = { checkin: 20, offer: 15, start: 9, end: 18, poll: 2, face: 'bar+words' }; // minutes / hours
const CHECKIN_SHOWN = 5; // minutes a card the app put up by itself stays, if ignored
const $ = (id) => document.getElementById(id);

// ---------- storage (survives private-mode failures) ----------
function load(k, d) { try { const v = localStorage.getItem('nb.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem('nb.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

// Settings arrive once via #key=..&token=..&board=..&checkin=20 and are then kept.
const cfg = Object.assign({}, DEFAULTS, load('cfg', {}));
if (location.hash.length > 1) {
  new URLSearchParams(location.hash.slice(1)).forEach((v, k) => { cfg[k] = /^\d+$/.test(v) ? +v : v; });
  save('cfg', cfg);
  history.replaceState(null, '', location.pathname);
}

const st = {
  lists: load('lists', {}),        // { today, week, later, done } -> list id
  cards: load('cards', []),
  current: load('current', null),  // { cardId, itemId, name, cardName, since }
  snoozed: load('snoozed', {}),    // cardId -> ms
  skips: load('skips', {}),        // cardId -> times every step was turned down
  lastCheck: load('lastCheck', 0),
  lastOffer: load('lastOffer', 0),
  missed: load('missed', false),     // the last check-in went unanswered
  home: load('home', null),          // { day: 'Mon Nov 23 2026', at: minutes after midnight, done, extended }
  session: null,
  synced: 0,
  error: '',
};

function persist() {
  save('lists', st.lists); save('cards', st.cards); save('current', st.current);
  save('snoozed', st.snoozed); save('skips', st.skips); save('lastCheck', st.lastCheck); save('lastOffer', st.lastOffer);
  save('missed', st.missed); save('home', st.home);
}

// Another window of the app changed state: take it, rather than overwrite it later.
window.addEventListener('storage', (e) => {
  if (!e.key || e.key.indexOf('nb.') !== 0) return;
  ['current', 'snoozed', 'skips', 'lastCheck', 'lastOffer', 'missed', 'home'].forEach((k) => { st[k] = load(k, st[k]); });
  renderClock();
});

function log(entry) {
  const l = load('log', []);
  l.push(Object.assign({ t: new Date().toISOString() }, entry));
  save('log', l.slice(-3000));
}

// ---------- Trello ----------
function trello(method, path, params) {
  const q = new URLSearchParams(Object.assign({ key: cfg.key, token: cfg.token }, params || {}));
  return fetch(API + path + '?' + q, { method: method }).then((r) => {
    if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status);
    return r.json();
  });
}

// Writes whose answer we don't need (done, comments, deadlines) go through the
// outbox: if the phone is offline they wait, and are sent before the next sync,
// so the board never comes back with something you already finished.
const outbox = load('outbox', []);
function send(method, path, params) {
  outbox.push({ method: method, path: path, params: params || {} });
  save('outbox', outbox);
  return flush().catch(() => { st.error = 'offline'; renderClock(); });
}
let flushing = null;
function flush() {
  if (flushing) return flushing;
  const next = () => {
    if (!outbox.length) return Promise.resolve();
    const w = outbox[0];
    return (w.op === 'steps' ? sendSteps(w) : trello(w.method, w.path, w.params)).catch((e) => {
      if (!/→ 4\d\d$/.test(e.message)) throw e; // offline or server trouble: keep it for later
      console.warn('dropped', e); // Trello refused it (e.g. card deleted): don't retry forever
    }).then(() => { outbox.shift(); save('outbox', outbox); return next(); });
  };
  flushing = next().then(() => { flushing = null; }, (e) => { flushing = null; throw e; });
  return flushing;
}

function refresh() {
  return flush().then(() => Promise.all([
    trello('GET', '/boards/' + cfg.board + '/lists', { fields: 'name' }),
    trello('GET', '/boards/' + cfg.board + '/cards', {
      fields: 'name,idList,due,dueComplete,pos', checklists: 'all',
      checklist_fields: 'name,pos', checkItem_fields: 'name,state,pos' }),
  ])).then((r) => {
    const byName = {};
    r[0].forEach((l) => { byName[l.name.trim().toLowerCase()] = l.id; });
    st.lists = { today: byName['today'], week: byName['this week'], later: byName['later'], done: byName['done'] };
    st.cards = r[1];
    st.synced = Date.now();
    st.error = '';
    dropStaleCurrent();
    persist();
    renderClock();
  }).catch((e) => { st.error = 'offline'; console.warn(e); renderClock(); });
}

// Current task finished or deleted elsewhere (e.g. in Trello on the laptop)?
function dropStaleCurrent() {
  const c = st.current;
  if (!c) return;
  const card = byId()[c.cardId];
  const gone = !card || card.idList === st.lists.done || card.dueComplete ||
    (c.itemId && !(card.checklists || []).some((cl) => cl.checkItems.some((i) => i.id === c.itemId && i.state !== 'complete')));
  if (gone) st.current = null;
}

function byId() {
  const m = {};
  st.cards.forEach((c) => { m[c.id] = c; });
  return m;
}

function priorityLists() { return [st.lists.today, st.lists.week, st.lists.later].filter(Boolean); }

// ---------- effects from flow.js ----------
function run(effects) {
  const writes = [];
  effects.forEach((e) => {
    if (e.type === 'start') {
      st.current = { cardId: e.cardId, itemId: e.itemId, name: e.name, cardName: e.cardName, since: Date.now() };
      st.lastCheck = Date.now();
    } else if (e.type === 'comment') {
      writes.push(send('POST', '/cards/' + e.cardId + '/actions/comments', { text: '🧠 NeuroBuddy: ' + e.text }));
    } else if (e.type === 'snooze') {
      st.snoozed[e.cardId] = e.until || +startOfDay(Date.now() + DAY);
    } else if (e.type === 'skipped') {
      st.skips[e.cardId] = (st.skips[e.cardId] || 0) + 1;
    } else if (e.type === 'sorted') {
      st.skips[e.cardId] = 0;
    } else if (e.type === 'later') {
      writes.push(moveToLater(e.cardId, e.itemId).then(() =>
        trello('POST', '/cards/' + e.cardId + '/actions/comments', { text: '🧠 NeuroBuddy: Can follow later: ' + e.name })));
    } else if (e.type === 'setDue') {
      const card = byId()[e.cardId];
      if (card) card.due = e.due;
      writes.push(send('PUT', '/cards/' + e.cardId, { due: e.due }));
    } else if (e.type === 'askStep') {
      askSteps(e.cardId, e.cardName, true);
    } else if (e.type === 'resume') {
      st.lastCheck = Date.now();
    } else if (e.type === 'stop') {
      st.current = null;
    } else if (e.type === 'addSteps') {
      const card = byId()[e.cardId];
      askSteps(e.cardId, card ? card.name : '', false);
    } else if (e.type === 'idle') {
      st.lastOffer = Date.now();
    }
  });
  persist();
  renderClock();
  if (writes.length) Promise.all(writes).then(refresh, (err) => { st.error = 'write failed'; console.warn(err); renderClock(); });
}

// Move a step into the card's "Later" checklist, creating it once (calls are chained per card).
const laterList = {};
function moveToLater(cardId, itemId) {
  if (!laterList[cardId]) {
    const card = byId()[cardId];
    const have = card && (card.checklists || []).filter((cl) => /^later/i.test(cl.name || ''))[0];
    laterList[cardId] = have ? Promise.resolve(have)
      : trello('POST', '/cards/' + cardId + '/checklists', { name: LATER, pos: 'bottom' });
    laterList[cardId].catch(() => { delete laterList[cardId]; });
  }
  laterList[cardId] = laterList[cardId].then((cl) =>
    trello('PUT', '/cards/' + cardId + '/checkItem/' + itemId, { idChecklist: cl.id }).then(() => cl));
  return laterList[cardId];
}

function completeCurrent() {
  const c = st.current;
  st.current = null;
  // Done counts on the phone straight away, online or not.
  const card = byId()[c.cardId];
  if (card && c.itemId) (card.checklists || []).forEach((cl) => cl.checkItems.forEach((i) => { if (i.id === c.itemId) i.state = 'complete'; }));
  else if (card) { card.idList = st.lists.done; card.dueComplete = true; }
  persist();
  if (c.itemId) send('PUT', '/cards/' + c.cardId + '/checkItem/' + c.itemId, { state: 'complete' });
  else send('PUT', '/cards/' + c.cardId, { idList: st.lists.done, dueComplete: 'true' });
  send('POST', '/cards/' + c.cardId + '/actions/comments', { text: '🧠 NeuroBuddy: Done: ' + c.name });
  return Promise.resolve();
}

// Add steps (in order) to the top of the card's main checklist, then start the
// first one if asked to (or if you were on the whole card, not a step of it).
// They show on the phone at once with stand-in ids, and go to Trello through the
// outbox, so typing them offline is never wasted.
function addSteps(cardId, cardName, texts, startFirst) {
  const card = byId()[cardId];
  const tag = 'tmp' + Date.now() + '-';
  const items = texts.map((t, i) => ({ id: tag + i, name: t, state: 'incomplete', pos: -1e9 + i }));
  if (card) {
    card.checklists = card.checklists || [];
    let cl = mainChecklist(card);
    if (!cl) { cl = { id: tag + 'list', name: 'Steps', checkItems: [] }; card.checklists.unshift(cl); }
    cl.checkItems = items.concat(cl.checkItems);
  }
  // Last first, each to the top, so they end up in the order typed.
  outbox.push({ op: 'steps', cardId: cardId, todo: items.slice().reverse().map((x) => ({ tmp: x.id, name: x.name })) });
  save('outbox', outbox);
  const fx = [{ type: 'comment', cardId: cardId, text: 'Added steps: ' + texts.join('; ') }];
  const c = st.current;
  if (startFirst || (c && c.cardId === cardId && !c.itemId)) {
    fx.push({ type: 'start', cardId: cardId, itemId: items[0].id, name: texts[0], cardName: cardName });
  }
  run(fx);
}

function mainChecklist(card) {
  return (card.checklists || []).filter((l) => !/^later/i.test(l.name || '') && !/^tmp/.test(l.id))[0];
}

// One outbox entry of typed steps: send them one at a time, saving progress after
// each, so a dropped connection never posts a step twice.
function sendSteps(w) {
  const card = byId()[w.cardId];
  const have = w.list || (card && mainChecklist(card) || {}).id;
  const list = have ? Promise.resolve(have)
    : trello('POST', '/cards/' + w.cardId + '/checklists', { name: 'Steps' }).then((l) => l.id);
  return list.then((id) => {
    w.list = id; save('outbox', outbox);
    const next = () => {
      if (!w.todo.length) return Promise.resolve();
      const x = w.todo[0];
      return trello('POST', '/checklists/' + id + '/checkItems', { name: x.name, pos: 'top' }).then((item) => {
        w.todo.shift();
        realId(x.tmp, item.id);
        return next();
      });
    };
    return next();
  });
}

// A step reached Trello: swap its stand-in id everywhere it is used.
function realId(tmp, id) {
  if (st.current && st.current.itemId === tmp) st.current.itemId = id;
  outbox.forEach((w) => { if (w.path) w.path = w.path.split(tmp).join(id); });
  save('outbox', outbox);
  persist();
}

// ---------- clock ----------
let lastMinute = -1;
function renderClock() {
  const now = new Date();
  renderFace(now);
  $('date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  renderTask();
  renderHome(now);
  const b = dayBar(now, cfg.start, cfg.end);
  smoothText($('ovTime'), words(now));
  $('ovFill').style.width = (b.frac * 100).toFixed(2) + '%';
  const status = $('status');
  status.textContent = st.error || (st.synced ? 'synced ' + digital(new Date(st.synced)) : '');
  status.className = st.error ? 'bad' : '';
  // Nudge the whole clock a few pixels each minute so nothing burns into the screen.
  if (now.getMinutes() !== lastMinute) {
    lastMinute = now.getMinutes();
    const r = () => Math.round(Math.random() * 24 - 12);
    $('clock').style.transform = 'translate(' + r() + 'px,' + r() + 'px)';
  }
}

// The task strip: what you're on, and a bar that fills up to the next check-in.
function renderTask() {
  const c = st.current;
  $('task').hidden = !c;
  if (c) document.body.setAttribute('data-task', '');
  else { document.body.removeAttribute('data-task'); return; }
  const name = $('taskName');
  name.textContent = c.name;
  if (c.cardName && c.cardName !== c.name) {
    const s = document.createElement('small');
    s.textContent = '  ·  ' + c.cardName;
    name.appendChild(s);
  }
  const frac = (Date.now() - st.lastCheck) / (cfg.checkin * MIN);
  $('taskFill').style.width = (Math.min(frac, 1) * 100).toFixed(1) + '%';
  $('task').classList.toggle('late', frac >= 1);
}

function renderFace(now) {
  const p = faceParts(cfg.face);
  const big = p.words ? 'words' : 'digits';
  document.body.setAttribute('data-big', big);
  if (p.bar) document.body.setAttribute('data-bar', ''); else document.body.removeAttribute('data-bar');
  // While Claude tests over DevTools the clock text is left alone (demos drive it).
  if (!document.body.classList.contains('testing')) smoothText($('time'), big === 'words' ? words(now) : digital(now));
  $('small').textContent = p.words && p.digits ? digital(now) : '';
  $('time').hidden = !p.words && !p.digits;
  $('bar').hidden = !p.bar;
  if (p.bar) {
    const b = dayBar(now, cfg.start, cfg.end);
    const pct = (b.frac * 100).toFixed(2) + '%';
    $('fill').style.width = pct;
    $('now').style.left = pct;
    const t = $('ticks');
    if (t.getAttribute('data-span') !== b.from + '-' + b.to) {
      t.setAttribute('data-span', b.from + '-' + b.to);
      t.innerHTML = '';
      b.ticks.forEach((k) => {
        const el = document.createElement('span');
        el.textContent = k.label;
        el.style.left = (k.at * 100) + '%';
        t.appendChild(el);
      });
    }
  }
  $('faceBtn').textContent = 'Clock: ' + faceName(cfg.face) + '  (tap for next)';
}

// ---------- card overlay ----------
let shown = null; // { prompt, onAnswer }
let expiry = null;

// prompt.timeout (ms): unanswered by then, the card goes away and onTimeout runs.
function show(prompt, onAnswer) {
  shown = { prompt: prompt, onAnswer: onAnswer };
  clearTimeout(expiry);
  const fill = $('expiryFill');
  $('expiry').hidden = !prompt.timeout;
  fill.style.transition = 'none';
  fill.style.width = '100%';
  if (prompt.timeout) {
    const mine = shown;
    expiry = setTimeout(() => { if (shown === mine) { hide(); prompt.onTimeout && prompt.onTimeout(); } }, prompt.timeout);
  }
  const card = $('card');
  card.className = (prompt.danger ? 'danger' : prompt.urgent ? 'urgent' : '');
  card.style.transform = '';
  $('mode').textContent = prompt.mode || '';
  $('q').textContent = prompt.q || '';
  $('title').textContent = prompt.title;
  $('sub').textContent = prompt.sub || '';
  $('stepForm').hidden = !prompt.input;
  $('overlay').classList.toggle('typing', !!prompt.input);
  $('hint').textContent = '';
  const box = $('buttons');
  box.innerHTML = '';
  const btns = prompt.buttons || [{ id: 'left', label: prompt.left }, { id: 'right', label: prompt.right, cls: prompt.danger ? 'danger' : 'yes' }];
  const sw = prompt.swipe || {};
  btns.forEach((b) => {
    const el = document.createElement('button');
    // Arrows show which button a swipe picks (unless the label already says).
    el.textContent = /[←→]/.test(b.label) ? b.label
      : (sw.left === b.id ? '← ' : '') + b.label + (sw.right === b.id ? ' →' : '');
    if (b.cls) el.className = b.cls;
    el.onclick = () => choose(b.id);
    box.appendChild(el);
  });
  if (prompt.busy) {
    const el = document.createElement('button');
    el.textContent = "I'm busy with something else · ask me in an hour";
    el.className = 'quiet';
    el.onclick = () => choose('busy');
    box.appendChild(el);
  }
  $('overlay').hidden = false;
  $('menu').hidden = true;
  if (prompt.timeout) { // start full (now it's visible), then drain
    void fill.offsetWidth;
    fill.style.transition = 'width ' + prompt.timeout + 'ms linear';
    fill.style.width = '0%';
  }
  if (prompt.input) setTimeout(() => $('stepInput').focus(), 50);
  else alertUser();
}

function hide() { shown = null; clearTimeout(expiry); $('overlay').hidden = true; }

function choose(id) {
  if (!shown) return;
  const s = shown;
  hide();
  s.onAnswer(id);
}

// Swipe: drag past ~1/4 screen width to answer. Used on cards and the task strip.
let swiped = 0; // time of the last swipe, so its pointerup doesn't also count as a tap
// `area` takes the touches; `el` is what moves (they differ for the task strip).
function attachSwipe(el, canStart, onSwipe, area) {
  area = area || el;
  let x0 = null, dx = 0;
  area.addEventListener('pointerdown', (e) => {
    if (!canStart() || e.target.tagName === 'INPUT') return;
    x0 = e.clientX; dx = 0; el.classList.remove('snap');
  });
  area.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    // Capture only once it's really a drag, so a plain tap still clicks what's under it.
    if (Math.abs(dx) > 10 && !area.hasPointerCapture(e.pointerId)) area.setPointerCapture(e.pointerId);
    el.style.transform = 'translateX(' + dx + 'px) rotate(' + dx / 25 + 'deg)';
    el.classList.toggle('lean-right', dx > 40);
    el.classList.toggle('lean-left', dx < -40);
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    el.classList.add('snap');
    el.classList.remove('lean-right', 'lean-left');
    if (Math.abs(dx) > 10) swiped = Date.now();
    if (Math.abs(dx) > window.innerWidth / 4) {
      el.style.transform = 'translateX(' + (dx > 0 ? 1 : -1) * window.innerWidth + 'px)';
      setTimeout(() => { onSwipe(dx > 0 ? 'right' : 'left'); el.style.transform = ''; }, 180);
    } else el.style.transform = '';
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
}
// Every card swipes, anywhere on the screen: left = leave me alone, right = done / yes.
attachSwipe($('card'), () => !!(shown && (shown.prompt.left || shown.prompt.swipe)),
  (dir) => shown && choose(shown.prompt.swipe ? shown.prompt.swipe[dir] : dir), $('overlay'));

// ---------- sessions & check-ins ----------
// auto: offered by the app itself (not asked for), so its cards go away if ignored.
function pickTask(firstId, step, auto) {
  const now = new Date();
  st.lastOffer = Date.now();
  st.session = startSession(orderCards(st.cards, priorityLists(), now, st.snoozed), firstId, step, st.skips);
  st.session.snoozed = st.snoozed;
  st.session.auto = !!auto;
  persist();
  nextPrompt();
}

function nextPrompt() {
  const s = st.session;
  if (!s) return;
  const map = byId();
  const prompt = promptFor(s, map, new Date());
  // No "card 1 of 19": a count of what's left feels like a pile.
  prompt.mode = s.quick ? (s.step === 'back' ? 'Your task' : 'Something else?')
    : s.step === 'breakdown' ? 'Breaking it down'
    : /sort|ugly|ship/.test(s.step) ? 'Send it ugly' : 'Choosing a task';
  prompt.busy = s.step !== 'empty' && !s.quick;
  if (s.auto) { // nobody asked: back to the clock if it's ignored
    prompt.timeout = CHECKIN_SHOWN * MIN;
    prompt.onTimeout = () => { st.session = null; log({ kind: 'session', step: s.step, choice: 'ignored' }); };
  }
  show(prompt, (choice) => {
    log({ kind: 'session', step: s.step, cardId: s.order[s.ci], choice: choice });
    if (choice === 'busy') { // already busy with something: no more cards for a while
      st.session = null;
      st.lastOffer = Date.now() + BUSY * MIN;
      persist();
      return;
    }
    const r = answer(s, map, choice, new Date());
    st.session = r.next;
    run(r.effects);
    nextPrompt();
  });
}

// Type steps one at a time: "Go" on the keyboard adds each; Save writes them all.
let typed = null; // steps typed so far on the open card
function askSteps(cardId, cardName, startFirst) {
  typed = [];
  const prompt = { mode: startFirst ? 'Breaking it down' : 'Adding steps', title: cardName, input: true,
    q: startFirst ? 'Smallest next step? Then any more.' : 'Brain dump: one step at a time, "Go" after each.',
    buttons: [{ id: 'cancel', label: 'Never mind' }, { id: 'save', label: startFirst ? 'Save and start the first' : 'Save steps', cls: 'yes' }],
    swipe: { left: 'cancel', right: 'save' } };
  show(prompt, (choice) => {
    const last = $('stepInput').value.trim();
    $('stepInput').value = '';
    if (last) typed.push(last);
    const texts = [].concat.apply([], typed.map(splitSteps));
    typed = null;
    log({ kind: 'steps', cardId: cardId, choice: choice, texts: texts });
    if (choice === 'save' && texts.length) addSteps(cardId, cardName, texts, startFirst);
    else st.lastOffer = Date.now();
  });
}
$('stepForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('stepInput').value.trim();
  if (!t || !typed) return;
  typed.push(t);
  $('stepInput').value = '';
  typed = [].concat.apply([], typed.map(splitSteps));
  $('sub').textContent = typed.map((x, i) => (i + 1) + '. ' + x).join('   ');
});


function checkin(byTap) {
  const c = st.current;
  if (!c) return pickTask();
  st.lastCheck = Date.now();
  persist();
  const mins = Math.round((Date.now() - c.since) / MIN);
  const sub = c.cardName !== c.name ? c.cardName : '';
  // A check-in nobody answers goes away after a few minutes: back to the clock, no nagging.
  // The next one asks why, without blame.
  const missed = st.missed && !byTap;
  const prompt = missed
    ? { mode: 'Check-in', q: 'Missed the last check-in. How come?', title: c.name, sub: sub,
      buttons: [{ id: 'focused', label: 'Hyper-focused', cls: 'yes' }, { id: 'distracted', label: 'Distracted' },
        { id: 'stuck', label: 'Stuck' }, { id: 'done', label: 'Done ✓' }], swipe: { left: 'still', right: 'done' } }
    : { mode: byTap ? 'Your task' : 'Check-in', q: 'Still on this? (' + mins + ' min)', title: c.name, sub: sub,
      buttons: [{ id: 'still', label: 'Still on it', cls: 'yes' }, { id: 'done', label: 'Done ✓' },
        { id: 'steps', label: 'Add steps' }, { id: 'switch', label: 'Switching' }, { id: 'stuck', label: 'Stuck' }],
      swipe: { left: 'still', right: 'done' } };
  if (!byTap) {
    prompt.timeout = CHECKIN_SHOWN * MIN;
    prompt.onTimeout = () => { st.missed = true; persist(); log({ kind: 'checkin', cardId: c.cardId, choice: 'missed', mins: mins }); };
  }
  show(prompt, (choice) => {
    log({ kind: 'checkin', cardId: c.cardId, itemId: c.itemId, choice: choice, mins: mins });
    st.missed = false;
    persist();
    if (choice === 'focused' || choice === 'distracted') {
      run([{ type: 'comment', cardId: c.cardId, text: (choice === 'focused' ? 'Hyper-focused on: ' : 'Got distracted from: ') + c.name + ' (' + mins + ' min in)' }]);
    } else if (choice === 'done') completeCurrent().then(() => pickTask(c.cardId));
    else if (choice === 'steps') askSteps(c.cardId, c.cardName || c.name, false);
    else if (choice === 'switch') {
      run([{ type: 'comment', cardId: c.cardId, text: 'Switched away after ' + mins + ' min from: ' + c.name }]);
      st.current = null;
      pickTask();
    } else if (choice === 'stuck') {
      run([{ type: 'comment', cardId: c.cardId, text: 'Stuck on: ' + c.name + ' (after ' + mins + ' min)' }]);
      st.current = null;
      pickTask(c.cardId, 'breakdown');
    }
  });
}

function workHours(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  const t = homeTime(d);
  return d.getDay() > 0 && d.getDay() < 6 && h >= cfg.start && h < cfg.end && !(t && d >= t);
}

// ---------- home time: a promise to leave at a set time, today only ----------
const HOME_RUNWAY = 30; // minutes of countdown bar before it
const HOME_CHOICES = [null, 17 * 60, 17.5 * 60, 18 * 60, 18.5 * 60];
function homeTime(d) {
  const h = st.home;
  if (!h || h.day !== d.toDateString()) return null;
  const t = new Date(d); t.setHours(0, h.at, 0, 0);
  return t;
}
// A promise is like a train: exact. Words on the hour and half hour, digits otherwise.
function homeWords(t) { return t.getMinutes() % 30 ? digital(t) : words(t); }
function renderHome(now) {
  const t = homeTime(now);
  const left = t ? (t - now) / MIN : Infinity;
  const on = !!t && !st.home.done && left <= HOME_RUNWAY;
  $('home').hidden = !on;
  if (on) {
    smoothText($('homeText'), left > 0 ? 'home at ' + homeWords(t) : 'home time');
    $('homeFill').style.width = (Math.max(0, left) / HOME_RUNWAY * 100).toFixed(1) + '%';
  }
  $('homeBtn').textContent = 'Home time: ' + (t ? homeWords(t) : 'none today') + '  (tap to change)';
}
// The one card that waits for an answer: it's a promise to someone.
function homeCard() {
  const said = homeTime(new Date());
  said.setHours(0, st.home.said || st.home.at, 0, 0);
  show({ mode: 'Home time', q: 'You said you\'d leave at ' + homeWords(said) + '.', title: 'Time to go home 🏠',
    sub: st.current ? 'Your task will be here tomorrow: ' + st.current.name : '',
    buttons: [{ id: 'go', label: 'Leaving now', cls: 'yes' }].concat(st.home.extended ? [] : [{ id: 'more', label: '10 more minutes' }]),
    swipe: { left: st.home.extended ? 'go' : 'more', right: 'go' } },
  (choice) => {
    log({ kind: 'home', choice: choice });
    if (choice === 'more') { st.home.said = st.home.at; st.home.at += 10; st.home.extended = true; } else st.home.done = true;
    persist();
    renderClock();
  });
}

function tick() {
  renderClock();
  const now = new Date();
  // Work's over: cards the app put up by itself go away.
  if (!workHours(now) && shown && shown.prompt.timeout) { hide(); st.session = null; }
  const home = homeTime(now);
  if (home && now >= home && !st.home.done && !shown && $('menu').hidden) return homeCard();
  if (shown || !$('menu').hidden || !cfg.token) return;
  if (!workHours(now)) return;
  if (st.current && Date.now() - st.lastCheck >= cfg.checkin * MIN) checkin();
  else if (!st.current && Date.now() - st.lastOffer >= cfg.offer * MIN) pickTask(undefined, undefined, true);
}

// ---------- attention: beep + buzz when a card appears ----------
let audio = null;
document.addEventListener('pointerdown', () => {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* none */ } }
  if (audio && audio.state === 'suspended') audio.resume();
  keepAwake();
}, true);

function alertUser() {
  try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch (e) { /* ignore */ }
  if (!audio || audio.state !== 'running') return;
  [0, 0.18].forEach((t) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 660; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination);
    o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.12);
  });
}

// ---------- keep the screen on ----------
let lock = null;
function keepAwake() {
  if (lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  navigator.wakeLock.request('screen').then((l) => { lock = l; l.addEventListener('release', () => { lock = null; }); }, () => {});
}
document.addEventListener('visibilitychange', () => { keepAwake(); if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', refresh); // wifi back: send what waited

// ---------- the task strip: swipe right = done, left = something else, tap = check in ----------
// Swipe anywhere on the clock screen; the task strip is what moves.
attachSwipe($('task'), () => !shown && !!st.current && $('menu').hidden && $('setup').hidden, (dir) => {
  const c = st.current;
  log({ kind: 'strip', cardId: c.cardId, itemId: c.itemId, choice: dir });
  if (dir === 'right') completeCurrent().then(() => pickTask(c.cardId));
  else switchAway();
}, document.body);
$('task').addEventListener('click', () => { if (!shown && Date.now() - swiped > 400) checkin(true); });

function switchAway() {
  st.lastOffer = Date.now();
  st.session = startSwitch(orderCards(st.cards, priorityLists(), new Date(), st.snoozed), st.current);
  st.session.snoozed = st.snoozed;
  nextPrompt();
}

// ---------- menu (tap the clock) ----------
$('clock').addEventListener('click', () => { if (cfg.token && Date.now() - swiped > 400) $('menu').hidden = false; });
$('menu').addEventListener('click', (e) => {
  const act = e.target.getAttribute('data-act');
  if (!act) return;
  $('menu').hidden = true;
  if (act === 'home') { // cycle: none, 5, half 5, 6, half 6
    const t = homeTime(new Date());
    const cur = t ? st.home.at : null;
    const next = HOME_CHOICES[(HOME_CHOICES.indexOf(cur) + 1) % HOME_CHOICES.length];
    st.home = next === null ? null : { day: new Date().toDateString(), at: next };
    persist();
    renderClock();
    $('menu').hidden = false; // stay open so you can tap again
  } else if (act === 'face') {
    cfg.face = FACES[(FACES.indexOf(faceParts(cfg.face).face) + 1) % FACES.length];
    save('cfg', cfg);
    renderClock();
    $('menu').hidden = false; // stay open so you can keep cycling
  } else if (act === 'pick') pickTask();
  else if (act === 'checkin') checkin();
  else if (act === 'clear') { log({ kind: 'clear', cardId: st.current && st.current.cardId }); st.current = null; persist(); renderClock(); }
  else if (act === 'refresh') refresh();
});

// ---------- start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
renderClock();
if (!cfg.key || !cfg.token || !cfg.board) $('setup').hidden = false;
else {
  refresh().then(() => { keepAwake(); tick(); });
  setInterval(tick, 15e3);
  setInterval(refresh, cfg.poll * MIN);
}

// ---------- remote testing (over DevTools): red border so Dan knows not to touch ----------
// nbTesting(true) before driving the phone, nbTesting(false) after; it clears itself after 10 min.
let testingTimer = null;
window.nbTesting = (on) => {
  document.body.classList.toggle('testing', !!on);
  clearTimeout(testingTimer);
  if (on) testingTimer = setTimeout(() => window.nbTesting(false), 10 * MIN);
  return !!on;
};
window.nbSmooth = smoothText; // for remote testing
