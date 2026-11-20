// NeuroBuddy: desk clock that pops up swipeable task cards from a Trello board.
// Chrome 87 target (Galaxy A20e): no top-level await, no Array.at.
import { smoothText } from './smooth.js';
import { FACES, faceParts, faceName, digital, words, dayBar } from './clock.js';
import { orderCards, startSession, startSwitch, promptFor, answer, startOfDay, DAY, LATER, splitSteps } from './flow.js';

const API = 'https://api.trello.com/1';
const MIN = 60e3;
const BUSY = 45; // minutes of quiet after "I'm busy" (on top of the usual offer gap)
const DEFAULTS = { checkin: 20, offer: 15, start: 9, end: 18, poll: 2, face: 'bar+words' }; // minutes / hours
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
  session: null,
  synced: 0,
  error: '',
};

function persist() {
  save('lists', st.lists); save('cards', st.cards); save('current', st.current);
  save('snoozed', st.snoozed); save('skips', st.skips); save('lastCheck', st.lastCheck); save('lastOffer', st.lastOffer);
}

// Another window of the app changed state: take it, rather than overwrite it later.
window.addEventListener('storage', (e) => {
  if (!e.key || e.key.indexOf('nb.') !== 0) return;
  ['current', 'snoozed', 'skips', 'lastCheck', 'lastOffer'].forEach((k) => { st[k] = load(k, st[k]); });
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

function refresh() {
  return Promise.all([
    trello('GET', '/boards/' + cfg.board + '/lists', { fields: 'name' }),
    trello('GET', '/boards/' + cfg.board + '/cards', {
      fields: 'name,idList,due,dueComplete,pos', checklists: 'all',
      checklist_fields: 'name,pos', checkItem_fields: 'name,state,pos' }),
  ]).then((r) => {
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
      writes.push(trello('POST', '/cards/' + e.cardId + '/actions/comments', { text: '🧠 NeuroBuddy: ' + e.text }));
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
      writes.push(trello('PUT', '/cards/' + e.cardId, { due: e.due }));
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
  persist();
  const done = c.itemId
    ? trello('PUT', '/cards/' + c.cardId + '/checkItem/' + c.itemId, { state: 'complete' })
    : trello('PUT', '/cards/' + c.cardId, { idList: st.lists.done, dueComplete: 'true' });
  return done
    .then(() => trello('POST', '/cards/' + c.cardId + '/actions/comments', { text: '🧠 NeuroBuddy: Done: ' + c.name }))
    .then(refresh, (e) => { st.error = 'write failed'; console.warn(e); });
}

// Add steps (in order) to the top of the card's main checklist, then start the
// first one if asked to (or if you were on the whole card, not a step of it).
function addSteps(cardId, cardName, texts, startFirst) {
  const card = byId()[cardId];
  const cl = card && (card.checklists || []).filter((l) => !/^later/i.test(l.name || ''))[0];
  let chain = cl ? Promise.resolve(cl) : trello('POST', '/cards/' + cardId + '/checklists', { name: 'Steps' });
  const items = [];
  // Last first, each to the top, so they end up in the order typed.
  texts.slice().reverse().forEach((t) => {
    chain = chain.then((l) => trello('POST', '/checklists/' + l.id + '/checkItems', { name: t, pos: 'top' })
      .then((item) => { items.unshift(item); return l; }));
  });
  return chain.then(() => {
    const fx = [{ type: 'comment', cardId: cardId, text: 'Added steps: ' + texts.join('; ') }];
    const c = st.current;
    if (startFirst || (c && c.cardId === cardId && !c.itemId)) {
      fx.push({ type: 'start', cardId: cardId, itemId: items[0].id, name: texts[0], cardName: cardName });
    }
    run(fx);
  });
}

// ---------- clock ----------
let lastMinute = -1;
function renderClock() {
  const now = new Date();
  renderFace(now);
  $('date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  renderTask();
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
  smoothText($('time'), big === 'words' ? words(now) : digital(now));
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

function show(prompt, onAnswer) {
  shown = { prompt: prompt, onAnswer: onAnswer };
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
  btns.forEach((b) => {
    const el = document.createElement('button');
    el.textContent = b.label;
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
  if (prompt.input) setTimeout(() => $('stepInput').focus(), 50);
  else alertUser();
}

function hide() { shown = null; $('overlay').hidden = true; }

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
    x0 = e.clientX; dx = 0; el.classList.remove('snap'); area.setPointerCapture(e.pointerId);
  });
  area.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
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
attachSwipe($('card'), () => !!(shown && shown.prompt.left), choose);

// ---------- sessions & check-ins ----------
function pickTask(firstId, step) {
  const now = new Date();
  st.lastOffer = Date.now();
  st.session = startSession(orderCards(st.cards, priorityLists(), now, st.snoozed), firstId, step, st.skips);
  persist();
  nextPrompt();
}

function nextPrompt() {
  const s = st.session;
  if (!s) return;
  const map = byId();
  const prompt = promptFor(s, map, new Date());
  prompt.mode = s.quick ? (s.step === 'back' ? 'Your task' : 'Something else? · ' + (s.ci + 1) + ' of ' + s.order.length)
    : s.step === 'empty' ? 'Choosing a task'
    : s.step === 'breakdown' ? 'Breaking it down'
    : (/sort|ugly|ship/.test(s.step) ? 'Send it ugly' : 'Choosing a task') + ' · card ' + (s.ci + 1) + ' of ' + s.order.length;
  prompt.busy = s.step !== 'empty' && !s.quick;
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
    buttons: [{ id: 'cancel', label: 'Never mind' }, { id: 'save', label: startFirst ? 'Save and start the first' : 'Save steps', cls: 'yes' }] };
  show(prompt, (choice) => {
    const last = $('stepInput').value.trim();
    $('stepInput').value = '';
    if (last) typed.push(last);
    const texts = [].concat.apply([], typed.map(splitSteps));
    typed = null;
    log({ kind: 'steps', cardId: cardId, choice: choice, texts: texts });
    if (choice === 'save' && texts.length) addSteps(cardId, cardName, texts, startFirst).catch((e) => { st.error = 'write failed'; console.warn(e); renderClock(); });
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
  show({ mode: byTap ? 'Your task' : 'Check-in', q: 'Still on this? (' + mins + ' min)', title: c.name, sub: c.cardName !== c.name ? c.cardName : '',
    buttons: [{ id: 'still', label: 'Still on it', cls: 'yes' }, { id: 'done', label: 'Done ✓' },
      { id: 'steps', label: 'Add steps' }, { id: 'switch', label: 'Switching' }, { id: 'stuck', label: 'Stuck' }] }, (choice) => {
    log({ kind: 'checkin', cardId: c.cardId, itemId: c.itemId, choice: choice, mins: mins });
    if (choice === 'done') completeCurrent().then(() => pickTask(c.cardId));
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
  return d.getDay() > 0 && d.getDay() < 6 && h >= cfg.start && h < cfg.end;
}

function tick() {
  renderClock();
  if (shown || !$('menu').hidden || !cfg.token) return;
  const now = new Date();
  if (!workHours(now)) return;
  if (st.current && Date.now() - st.lastCheck >= cfg.checkin * MIN) checkin();
  else if (!st.current && Date.now() - st.lastOffer >= cfg.offer * MIN) pickTask();
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
  nextPrompt();
}

// ---------- menu (tap the clock) ----------
$('clock').addEventListener('click', () => { if (cfg.token && Date.now() - swiped > 400) $('menu').hidden = false; });
$('menu').addEventListener('click', (e) => {
  const act = e.target.getAttribute('data-act');
  if (!act) return;
  $('menu').hidden = true;
  if (act === 'face') {
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
