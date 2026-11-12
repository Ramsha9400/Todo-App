/* =====================================================
   To Do app  |  Created by @stackanddstyle
   Plain JavaScript. ONE requestAnimationFrame loop eases every value
   (hover, press, add, remove, done) toward its target once per frame.
   Keys:  Enter add | / focus | R reset | M sound | arrows move | Del remove
   ===================================================== */
(() => {
  'use strict';

  /* ---------- 1. Settings and elements ---------- */
  const STORE_KEY = 'stackanddstyle-todo-v1';
  const MAX_TASKS = 30;

  const $ = (sel) => document.querySelector(sel);
  const list = $('#list');
  const empty = $('#empty');
  const input = $('#taskInput');
  const form = $('#addForm');
  const clearBtn = $('#clearBtn');
  const resetBtn = $('#resetBtn');
  const soundBtn = $('#soundBtn');

  const svg = (cls, inner) =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    check: svg('', '<polyline points="20 6 9 17 4 12"/>'),
    edit: svg('i-edit',
      '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>'),
    save: svg('i-save', '<polyline points="20 6 9 17 4 12"/>'),
    trash: svg('',
      '<polyline points="3 6 5 6 21 6"/>' +
      '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
      '<path d="M10 11v6M14 11v6"/>' +
      '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  };

  /* ---------- 2. State ---------- */
  let tasks = [];            // [{ id, text, done }]
  let soundOn = true;
  let nextId = 1;
  const rows = new Map();    // id -> row (DOM + animation values)
  const states = new Set();  // hover / press trackers

  let frame = 0;             // frame counter
  let shake = 0;             // input shake amount
  let badFrames = 0;         // red outline countdown
  let emptyV = 1;            // 1 = "No tasks yet" fully shown
  let stickToEnd = false;    // keep the list scrolled to the new task

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionQuery.matches;
  motionQuery.addEventListener('change', (e) => { reduceMotion = e.matches; });

  /* ---------- 3. Saving (never breaks if storage is blocked) ---------- */
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tasks, sound: soundOn }));
    } catch (err) { /* storage unavailable: ignore */ }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      if (data && Array.isArray(data.tasks)) {
        tasks = data.tasks
          .filter((t) => t && typeof t.text === 'string')
          .slice(0, MAX_TASKS)
          .map((t) => ({ id: nextId++, text: t.text, done: !!t.done }));
      }
      if (data && data.sound === false) soundOn = false;
    } catch (err) { /* nothing saved yet */ }
  }

  /* ---------- 4. Sound (short synthesized tones) ---------- */
  const TONES = {                 // [start Hz, end Hz, seconds]
    add:    [520, 780, .16],
    done:   [660, 990, .14],
    edit:   [600, 700, .10],
    remove: [440, 260, .18],
    clear:  [520, 200, .30],
    reset:  [780, 390, .24],
    toggle: [600, 900, .10],
  };
  const soundLog = (window.soundLog = []);   // played tones (for debugging)
  let audio = null;

  function playTone(name) {
    if (!soundOn) return;
    soundLog.push({ name, frame });
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const [f0, f1, len] = TONES[name];
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + len);
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime(.25, t + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, t + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + len + .02);
    } catch (err) { /* audio not available: stay silent */ }
  }

  /* ---------- 5. Hover / press trackers (values eased in tick) ---------- */
  function track(el, press = true) {
    const s = { el, h: 0, p: 0, th: 0, tp: 0, hover: false, focus: false };
    const aim = () => { s.th = s.hover ? 1 : s.focus ? .55 : 0; };
    el.addEventListener('pointerenter', () => { s.hover = true; aim(); });
    el.addEventListener('pointerleave', () => {
      s.hover = false; s.tp = 0; aim();
    });
    el.addEventListener('focus', () => { s.focus = true; aim(); });
    el.addEventListener('blur', () => { s.focus = false; aim(); });
    if (press) {
      el.addEventListener('pointerdown', () => { s.tp = 1; });
      el.addEventListener('pointerup', () => { s.tp = 0; });
      el.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') s.tp = 1;
      });
      el.addEventListener('keyup', () => { s.tp = 0; });
    }
    states.add(s);
    return s;
  }

  [soundBtn, resetBtn, clearBtn, form.querySelector('.add-btn')]
    .forEach((el) => track(el));
  const fieldState = track(input, false);

  /* ---------- 6. Task rows ---------- */
  function createRow(task, delay = 0) {
    const li = document.createElement('li');
    li.className = 'item';
    li.style.setProperty('--e', '0');
    li.innerHTML =
      '<button class="check" type="button" role="checkbox">' +
        ICON.check + '</button>' +
      '<span class="text"></span>' +
      '<button class="btn round edit" type="button">' +
        ICON.edit + ICON.save + '</button>' +
      '<button class="btn round del" type="button">' + ICON.trash + '</button>';

    const row = {
      task, li, delay,
      e: 0, te: 1,                       // enter / exit amount
      d: task.done ? 1 : 0, td: task.done ? 1 : 0,   // done amount
      leaving: false, editing: false, input: null,
      textEl: li.querySelector('.text'),
      check: li.querySelector('.check'),
      editBtn: li.querySelector('.edit'),
      delBtn: li.querySelector('.del'),
      tracked: [],
    };
    li._row = row;

    row.tracked.push(track(li, false), track(row.check, false),
                     track(row.editBtn), track(row.delBtn));
    row.check.addEventListener('click', () => toggleDone(row));
    row.textEl.addEventListener('click', () => toggleDone(row));
    row.editBtn.addEventListener('click', () => toggleEdit(row));
    row.delBtn.addEventListener('click', (e) => removeRow(row, e.detail === 0));

    paintRow(row);
    rows.set(task.id, row);
    list.appendChild(li);
    return row;
  }

  // Text and accessible names (textContent keeps user text safe)
  function paintRow(row) {
    const { text, done } = row.task;
    row.textEl.textContent = text;
    row.check.setAttribute('aria-checked', String(done));
    row.check.setAttribute('aria-label', `Done: ${text}`);
    row.editBtn.setAttribute('aria-label',
      row.editing ? 'Save task' : `Edit: ${text}`);
    row.delBtn.setAttribute('aria-label', `Delete: ${text}`);
  }

  function addTask(raw) {
    const text = raw.trim();
    if (!text || tasks.length >= MAX_TASKS) { nudge(); return; }
    const task = { id: nextId++, text, done: false };
    tasks.push(task);
    createRow(task);
    stickToEnd = true;
    input.value = '';
    save();
    playTone('add');
  }

  function toggleDone(row) {
    if (row.leaving) return;
    row.task.done = !row.task.done;
    row.td = row.task.done ? 1 : 0;
    paintRow(row);
    save();
    playTone('done');
  }

  function removeRow(row, focusNext) {
    if (row.leaving) return;
    const alive = aliveItems();
    const at = alive.indexOf(row.li);
    row.leaving = true;
    row.te = 0;
    tasks = tasks.filter((t) => t !== row.task);
    save();
    playTone('remove');
    if (focusNext) {
      const next = alive[at + 1] || alive[at - 1];
      (next ? next._row.delBtn : input).focus();
    }
  }

  const aliveItems = () =>
    [...list.children].filter((li) => !li._row.leaving);

  function clearAll(tone) {
    const alive = aliveItems();
    alive.forEach((li, i) => {
      li._row.leaving = true;
      li._row.te = 0;
      li._row.delay = i * 5;       // little cascade
    });
    tasks = [];
    save();
    playTone(tone);
    if (!alive.length) nudge();
  }

  function resetAll() {
    if (document.activeElement && document.activeElement.blur) {
      if (document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }
    input.value = '';
    clearAll('reset');
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
    save();
  }

  /* ---------- 7. Editing a task ---------- */
  function toggleEdit(row) {
    if (row.leaving) return;
    row.editing ? finishEdit(row, true) : startEdit(row);
  }

  function startEdit(row) {
    const box = document.createElement('input');
    box.className = 'edit-input';
    box.maxLength = 40;
    box.value = row.task.text;
    box.setAttribute('aria-label', 'Edit task text');
    row.input = box;
    row.editing = true;
    row.li.classList.add('editing');
    row.textEl.replaceWith(box);
    paintRow(row);
    box.focus();
    box.select();

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishEdit(row, true); }
      if (e.key === 'Escape') { e.preventDefault(); finishEdit(row, false); }
    });
    box.addEventListener('blur', (e) => {
      if (e.relatedTarget !== row.editBtn) finishEdit(row, true);
    });
  }

  function finishEdit(row, keep) {
    if (!row.editing) return;
    const text = row.input.value.trim();
    row.editing = false;
    row.li.classList.remove('editing');
    if (keep && text && text !== row.task.text) {
      row.task.text = text;
      save();
      playTone('edit');
    }
    row.input.replaceWith(row.textEl);
    row.input = null;
    paintRow(row);
  }

  /* ---------- 8. Small helpers ---------- */
  function nudge() {                 // empty input / nothing to clear
    badFrames = 40;
    shake = reduceMotion ? 0 : 1;
  }

  function toggleSound() {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    soundBtn.classList.toggle('muted', !soundOn);
    save();
    playTone('toggle');
  }

  /* ---------- 9. Events ---------- */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addTask(input.value);
    input.focus();
  });
  clearBtn.addEventListener('click', () => clearAll('clear'));
  resetBtn.addEventListener('click', resetAll);
  soundBtn.addEventListener('click', toggleSound);

  // Arrow keys move between buttons, Delete removes the focused task
  list.addEventListener('keydown', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const li = btn.closest('.item');
    const btns = [...li.querySelectorAll('button')];
    const at = btns.indexOf(btn);
    const alive = aliveItems();
    const pos = alive.indexOf(li);
    let target = null;

    if (e.key === 'ArrowRight') target = btns[at + 1] || btns[0];
    if (e.key === 'ArrowLeft') target = btns[at - 1] || btns[btns.length - 1];
    if (e.key === 'ArrowDown' && alive[pos + 1]) {
      target = alive[pos + 1].querySelectorAll('button')[at];
    }
    if (e.key === 'ArrowUp' && alive[pos - 1]) {
      target = alive[pos - 1].querySelectorAll('button')[at];
    }
    if (e.key === 'Delete') { e.preventDefault(); removeRow(li._row, true); }
    if (target) { e.preventDefault(); target.focus(); }
  });

  // Global shortcuts (ignored while typing)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches('input, textarea')) {
      if (e.key === 'Escape' && e.target === input) {
        input.value = '';
        input.blur();
      }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === '/') { e.preventDefault(); input.focus(); }
    if (key === 'r') resetAll();
    if (key === 'm') toggleSound();
  });

  /* ---------- 10. The one animation loop ---------- */
  const approach = (value, target, k) => {
    const next = value + (target - value) * k;
    return Math.abs(target - next) < .002 ? target : next;
  };

  function tick() {
    frame++;
    const k = reduceMotion ? 1 : .2;          // easing per frame

    // hover + press on buttons, rows and the input
    for (const s of states) {
      s.h = approach(s.h, s.th, k);
      s.p = approach(s.p, s.tp, Math.min(1, k * 1.6));
      if (s.h !== s.ph) { s.el.style.setProperty('--h', s.h.toFixed(3)); }
      if (s.p !== s.pp && s !== fieldState) {
        s.el.style.setProperty('--p', s.p.toFixed(3));
      }
      s.ph = s.h;
      s.pp = s.p;
    }

    // rows: enter, leave, done
    let entering = false;
    for (const row of rows.values()) {
      if (row.delay > 0) { row.delay--; entering = true; continue; }
      const e = approach(row.e, row.te, k * .8);
      const d = approach(row.d, row.td, k * .9);
      if (e !== row.e) row.li.style.setProperty('--e', e.toFixed(3));
      if (d !== row.d) row.li.style.setProperty('--d', d.toFixed(3));
      row.e = e;
      row.d = d;
      if (row.te === 1 && e < 1) entering = true;

      if (row.te === 0 && e === 0) {          // finished leaving
        row.tracked.forEach((s) => states.delete(s));
        row.li.remove();
        rows.delete(row.task.id);
      }
    }
    if (stickToEnd) {
      list.scrollTop = list.scrollHeight;
      if (!entering) stickToEnd = false;
    }

    // "No tasks yet" fades in when nothing is left
    const nothing = tasks.length === 0;
    const v = approach(emptyV, nothing ? 1 : 0, k);
    if (v !== emptyV) empty.style.setProperty('--v', v.toFixed(3));
    emptyV = v;

    // shake + red outline when the input is empty
    if (shake > .01) {
      shake *= .88;
      const dx = Math.sin(frame * 1.1) * shake * 10;
      input.style.transform = `translateX(${dx}px)`;
    } else if (input.style.transform) {
      shake = 0;
      input.style.transform = '';
    }
    if (badFrames > 0) badFrames--;
    input.classList.toggle('bad', badFrames > 0);

    requestAnimationFrame(tick);
  }

  /* ---------- 11. Start ---------- */
  load();
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
  soundBtn.classList.toggle('muted', !soundOn);
  tasks.forEach((t, i) => createRow(t, i * 6));
  emptyV = tasks.length ? 0 : 1;
  empty.style.setProperty('--v', String(emptyV));
  requestAnimationFrame(tick);
})();
