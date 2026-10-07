// Ties everything together: the globe, the fly-down, the scene, and the on-screen controls.
import * as THREE from 'three';
import { createGlobe } from './globe.js';
import { buildSermon } from './sermon.js';
import { createExplorer } from './explore.js';
import { LOCATIONS, LABELS, SERMON_TEXT } from './content.js';
import { clamp, DEG } from './util.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SCENES = { sermon: { build: buildSermon, text: SERMON_TEXT } };

function boot() {
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
  } catch (e) {
    $('loading').classList.add('err');
    $('loading-note').textContent = 'This browser could not start 3D graphics (WebGL). Try a current version of Chrome or Safari.';
    return;
  }
  const mouseLike = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.body.classList.toggle('mouse', mouseLike);
  if (mouseLike) $('hint-globe').textContent = 'Drag to spin. Scroll to zoom. Click the gold pin.';

  // ---------- sharpness vs speed ----------
  // Start sharp, and if the device struggles, quietly lower the internal resolution.
  const maxPR = clamp(+params.get('pr') || Math.min(window.devicePixelRatio || 1, 2), 0.5, 3);
  let pr = maxPR; const fixedPR = params.has('pr');
  let W = 1, H = 1;
  const globe = createGlobe(renderer);
  const sceneCam = new THREE.PerspectiveCamera(60, 1, 0.25, 60000);
  const explorer = createExplorer(sceneCam);

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
    globe.resize(W, H);
    sceneCam.aspect = W / H; sceneCam.fov = W / H < 1 ? 72 : 60; sceneCam.updateProjectionMatrix();
    if (world) world.resize(H * pr, sceneCam.fov);
    placeStick();
  }

  // ---------- state ----------
  // 'globe' -> 'diving' -> 'arriving' -> 'scene' -> 'leaving' -> 'rising' -> 'globe'
  let state = 'globe', world = null, worldReady = null, current = null, veil = 0, veilTarget = null;
  let lastInput = 0;
  const api = window.__atlas = { autoDive: true, timeScale: 1 };   // also used by the automated tests

  for (const loc of LOCATIONS) globe.addPin(loc);

  // ---------- place names and pin buttons ----------
  const labelEls = LABELS.map((l) => { const e = document.createElement('div'); e.className = 'lab ' + l.kind; e.textContent = l.t; $('labels').appendChild(e); return e; });
  const labelW = labelEls.map((e) => e.offsetWidth);   // measured once, so the loop below never forces a re-layout
  const chipEls = globe.pins.map((pin) => {
    const b = document.createElement('button'); b.className = 'chip';
    b.innerHTML = `<b></b><span></span>`; b.firstChild.textContent = pin.loc.name; b.lastChild.textContent = pin.loc.ref + ' · tap to visit';
    b.addEventListener('click', () => visit(pin.loc)); $('labels').appendChild(b); return b;
  });
  const chipH = chipEls.map((e) => e.offsetHeight);
  const proj = { x: 0, y: 0, visible: false };
  function layoutLabels() {
    const on = state === 'globe' || state === 'diving' || state === 'rising';
    const a = globe.view.alt;
    LABELS.forEach((l, i) => {
      const e = labelEls[i]; globe.project(l.lat, l.lon, proj);
      const show = on && proj.visible && a >= l.minAlt && a <= l.maxAlt && proj.x > -50 && proj.x < W + 50 && proj.y > 40 && proj.y < H;
      e.style.opacity = show ? 1 : 0;
      if (show) e.style.transform = `translate(${Math.round(proj.x - (l.kind === 'town' ? 3 : labelW[i] / 2))}px, ${Math.round(proj.y - 8)}px)`;
    });
    globe.pins.forEach((p, i) => {
      const e = chipEls[i], show = state === 'globe' && p.visible;
      e.style.opacity = show ? 1 : 0; e.style.pointerEvents = show ? 'auto' : 'none'; e.tabIndex = show ? 0 : -1;
      if (p.visible) e.style.transform = `translate(${Math.round(p.sx + 16)}px, ${Math.round(p.sy - chipH[i] - 12)}px)`;
    });
  }

  // ---------- going to and from a scene ----------
  function ensureWorld(loc) {
    if (!worldReady) {
      worldReady = SCENES[loc.scene].build({ renderer, step: () => new Promise((r) => setTimeout(r, 0)) }).then((w) => {
        world = w; explorer.setWorld(w); w.resize(H * pr, sceneCam.fov);
        try { renderer.compile(w.scene, sceneCam); } catch (e) { /* warm-up only */ }
        return w;
      });
    }
    return worldReady;
  }
  function visit(loc) {
    if (state !== 'globe') return;
    state = 'diving'; current = loc; noteInput();
    $('hint-globe').classList.add('off');
    ensureWorld(loc);
    globe.flyTo(loc, () => {
      veilTarget = 1; $('veil-note').style.opacity = world ? 0 : 1;
      worldReady.then(() => {
        $('veil-note').style.opacity = 0;
        const text = SCENES[loc.scene].text;
        $('where-title').textContent = text.title; $('where-sub').textContent = text.sub;
        $('cap-title').textContent = text.title; $('cap-sub').textContent = text.sub;
        fillPanel(text);
        state = 'arriving'; $('hud-globe').hidden = true;
        explorer.st.mode = 'fly'; syncMode();
        world.onArrive(); explorer.snap(world.views.arrive);
        veilTarget = 0;
        setTimeout(() => $('caption').classList.add('on'), 1500);
        setTimeout(() => $('caption').classList.remove('on'), 6200);
        explorer.goTo(homeView(), 5.2, { lookDelay: 0.38, onDone: () => { state = 'scene'; $('hud-scene').hidden = false; placeStick(); } });
      });
    });
  }
  function leave() {
    if (state !== 'scene') return;
    state = 'leaving'; closePanel(); $('hud-scene').hidden = true; $('caption').classList.remove('on');
    const up = { pos: explorer.st.pos.clone().setY(world.views.arrive.pos.y), yaw: 0, pitch: -89.5 * DEG };
    veilTarget = 1;
    explorer.goTo(up, 1.7, { onDone: () => {
      state = 'rising'; $('hud-globe').hidden = false; veilTarget = null;
      globe.flyOut(current, () => { state = 'globe'; });
    } });
  }

  // ---------- scripture panel ----------
  let panelTab = 'text', panelText = null;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function fillPanel(text) { panelText = text; renderPanel(); }
  function renderPanel() {
    const t = panelText, body = $('panel-body'); body.textContent = ''; if (!t) return;
    const verses = (list) => list.forEach(([n, v]) => { const p = el('p', 'verse'); p.appendChild(el('sup', null, n)); p.appendChild(document.createTextNode(v)); body.appendChild(p); });
    const notes = (list) => { const ul = el('ul', 'notes'); list.forEach((s) => ul.appendChild(el('li', null, s))); body.appendChild(ul); };
    if (panelTab === 'text') {
      body.appendChild(el('h2', null, t.title)); body.appendChild(el('p', 'ver', 'Matthew, ' + t.version));
      body.appendChild(el('h3', null, 'He went up into a mountain')); verses(t.opening);
      body.appendChild(el('h3', null, 'The Beatitudes')); verses(t.beatitudes);
      body.appendChild(el('h3', null, 'The sermon continues'));
      const ol = el('ul', 'outline'); t.outline.forEach(([r, s]) => { const li = el('li'); li.appendChild(el('i', null, r)); li.appendChild(el('span', null, s)); ol.appendChild(li); }); body.appendChild(ol);
      body.appendChild(el('h3', null, 'When he had ended')); verses(t.closing);
    } else {
      body.appendChild(el('h2', null, 'What is from scripture, and what is not'));
      body.appendChild(el('p', 'ver', 'So you always know which details are the text and which are an artist’s choice.'));
      body.appendChild(el('h3', null, 'Stated in Matthew')); notes(t.fromScripture);
      body.appendChild(el('h3', null, 'Visual choices made for this scene')); notes(t.myChoices);
      body.appendChild(el('h3', null, 'About the location')); notes(t.location);
    }
    $('tab-text').setAttribute('aria-selected', panelTab === 'text'); $('tab-notes').setAttribute('aria-selected', panelTab === 'notes');
    body.scrollTop = 0;
  }
  function openPanel() { $('panel').hidden = false; requestAnimationFrame(() => $('panel').classList.add('open')); }
  function closePanel() { $('panel').classList.remove('open'); setTimeout(() => { if (!$('panel').classList.contains('open')) $('panel').hidden = true; }, 340); }
  $('btn-scripture').onclick = () => ($('panel').classList.contains('open') ? closePanel() : openPanel());
  $('btn-close').onclick = closePanel;
  $('tab-text').onclick = () => { panelTab = 'text'; renderPanel(); };
  $('tab-notes').onclick = () => { panelTab = 'notes'; renderPanel(); };
  const help = (on) => { $('help').hidden = !on; };
  $('btn-help-g').onclick = $('btn-help-s').onclick = () => help(true);
  $('btn-help-x').onclick = () => help(false);
  $('help').addEventListener('click', (e) => { if (e.target === $('help')) help(false); });

  // ---------- buttons ----------
  const home = LOCATIONS[0];
  $('btn-home').onclick = () => { if (state === 'globe') globe.glideTo(31.95, 35.4, 0.08); };
  $('btn-zin').onclick = () => globe.zoom(0.6); $('btn-zout').onclick = () => globe.zoom(1 / 0.6);
  $('btn-back').onclick = leave;
  function syncMode() {
    const fly = explorer.st.mode === 'fly';
    $('btn-fly').setAttribute('aria-pressed', fly); $('btn-walk').setAttribute('aria-pressed', !fly);
    $('vert').style.visibility = fly ? 'visible' : 'hidden';
  }
  const setMode = (m) => { if (state === 'scene' && !explorer.st.tween) { explorer.setMode(m); syncMode(); } };
  $('btn-fly').onclick = () => setMode('fly'); $('btn-walk').onclick = () => setMode('walk');
  const jump = (view, T) => { if (state !== 'scene' || explorer.st.tween) return; explorer.st.mode = 'fly'; syncMode(); explorer.goTo(view, T); };
  $('btn-over').onclick = () => jump(world.views.overhead, 1.8);
  $('btn-reset').onclick = () => jump(homeView(), 1.8);
  function homeView() { return W < H && world.views.establishTall ? world.views.establishTall : world.views.establish; }
  const hold = (id, v) => { const b = $(id); const on = (e) => { e.preventDefault(); explorer.input.up = v; b.setPointerCapture && e.pointerId != null && b.setPointerCapture(e.pointerId); }; const off = () => { if (explorer.input.up === v) explorer.input.up = 0; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off); };
  hold('btn-up', 1); hold('btn-down', -1);

  // ---------- touch and mouse on the 3D view ----------
  const pts = new Map();      // fingers currently down
  let stickId = null, stickAt = { x: 0, y: 0 }, pinch = 0, tap = null;
  const STICK_R = 46;
  function placeStick(x, y) {
    const s = $('stick'); if (!s) return;
    stickAt = { x: x ?? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl')) || 0) + 92, y: y ?? H - 92 };
    s.style.left = stickAt.x + 'px'; s.style.top = stickAt.y + 'px'; $('knob').style.transform = '';
  }
  function noteInput() { lastInput = performance.now(); }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); noteInput();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: e.timeStamp, type: e.pointerType });
    if (state === 'globe') {
      globe.holding = true; globe.stopSpin();
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); tap = null; }
      else tap = e.pointerId;
    } else if (state === 'scene' && e.pointerType !== 'mouse' && stickId === null && e.clientX < W * 0.42 && e.clientY > 64) {
      stickId = e.pointerId; placeStick(e.clientX, e.clientY); $('stick').classList.add('live');
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (state === 'globe') {
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) globe.zoom(pinch / d); pinch = d;
        globe.drag(dx * 0.5, dy * 0.5);
      } else globe.drag(dx, dy);
      $('hint-globe').classList.add('off');
    } else if (state === 'scene') {
      if (e.pointerId === stickId) {
        let vx = e.clientX - stickAt.x, vy = e.clientY - stickAt.y; const l = Math.hypot(vx, vy);
        if (l > STICK_R) { vx *= STICK_R / l; vy *= STICK_R / l; }
        $('knob').style.transform = `translate(${vx}px, ${vy}px)`;
        const dead = (v) => (Math.abs(v) < 0.12 ? 0 : v);
        touchMove.x = dead(vx / STICK_R); touchMove.y = dead(-vy / STICK_R);
      } else {
        const k = (p.type === 'mouse' ? 0.0032 : 0.0046) * (sceneCam.fov / 60);
        explorer.input.lookX += dx * k; explorer.input.lookY += dy * k;
        $('look-tip').style.opacity = 0;
      }
    }
  });
  const touchMove = { x: 0, y: 0 };
  function release(e) {
    const p = pts.get(e.pointerId); if (!p) return; pts.delete(e.pointerId);
    if (e.pointerId === stickId) { stickId = null; touchMove.x = touchMove.y = 0; $('stick').classList.remove('live'); placeStick(); }
    if (state === 'globe') {
      if (pts.size < 2) pinch = 0;
      if (pts.size === 0) globe.holding = false;
      if (tap === e.pointerId && e.type === 'pointerup' && Math.hypot(p.x - p.sx, p.y - p.sy) < 10) {   // a touch that did not move = a tap
        const pin = globe.pick(p.x, p.y); if (pin) visit(pin.loc);
      }
      tap = null;
    }
  }
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); noteInput();
    const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    if (state === 'globe') { globe.zoom(Math.exp(clamp(d, -240, 240) * 0.0022)); $('hint-globe').classList.add('off'); }
    else if (state === 'scene' && explorer.st.mode === 'fly') {
      const h = Math.max(2, explorer.st.pos.y - Math.max(world.heightAt(explorer.st.pos.x, explorer.st.pos.z), 0));
      explorer.input.dolly += -clamp(d, -240, 240) * 0.004 * clamp(h * 0.6, 3, 120);
    }
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // stop the page itself from zooming or scrolling on phones
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('#panel, .card')) e.preventDefault(); }, { passive: false });

  // ---------- keyboard ----------
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.add(k); noteInput();
    if (state === 'scene' && 'wasdqe'.includes(k)) $('hint-scene').classList.add('off');
    if (k === 'Escape') { if (!$('help').hidden) help(false); else if ($('panel').classList.contains('open')) closePanel(); else if (state === 'scene') leave(); return; }
    if (state === 'globe') {
      if (k === 'Enter' && document.activeElement === canvas) visit(home);
      if (k === '+' || k === '=') globe.zoom(0.7); if (k === '-' || k === '_') globe.zoom(1 / 0.7);
    } else if (state === 'scene' && !e.repeat) {
      if (k === 'f') setMode(explorer.st.mode === 'fly' ? 'walk' : 'fly');
      if (k === 'b') $('btn-over').click(); if (k === 'r') $('btn-reset').click(); if (k === 'g') leave();
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k) && document.activeElement === canvas) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener('blur', () => { keys.clear(); explorer.input.up = 0; });
  function readKeys(dt) {
    const has = (...k) => k.some((x) => keys.has(x));
    if (state === 'globe') {
      const s = 190 * dt;
      if (has('ArrowLeft')) globe.drag(s, 0); if (has('ArrowRight')) globe.drag(-s, 0);
      if (has('ArrowUp')) globe.drag(0, s); if (has('ArrowDown')) globe.drag(0, -s);
    } else if (state === 'scene') {
      const i = explorer.input;
      i.mx = touchMove.x + (has('d') ? 1 : 0) - (has('a') ? 1 : 0);
      i.my = touchMove.y + (has('w') ? 1 : 0) - (has('s') ? 1 : 0);
      const ku = (has('e', ' ') ? 1 : 0) - (has('q', 'c') ? 1 : 0); if (ku || keyUp) i.up = ku; keyUp = ku;
      i.fast = has('Shift');
      const t = 1.5 * dt;
      if (has('ArrowLeft')) i.lookX -= t; if (has('ArrowRight')) i.lookX += t;
      if (has('ArrowUp')) i.lookY -= t; if (has('ArrowDown')) i.lookY += t;
    }
  }
  let keyUp = 0, lite = false;

  // ---------- main loop ----------
  let last = performance.now(), time = 0, acc = 0, frames = 0, cool = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(raw, 0.1) * api.timeScale; time += dt;
    readKeys(dt);

    const inScene = state === 'arriving' || state === 'scene' || state === 'leaving';
    if (inScene && world) {
      explorer.update(dt); world.update(dt, time, sceneCam);
      renderer.render(world.scene, sceneCam);
    } else {
      // zoom in far enough right over a pin and you dive in automatically
      if (state === 'globe' && api.autoDive && !globe.flying() && pts.size === 0 && globe.view.alt < 0.0125) {
        for (const p of globe.pins) if (globe.angleTo(p.loc) < Math.max(0.25, globe.view.alt * 28)) { visit(p.loc); break; }
      }
      globe.update(dt, time);
      renderer.render(globe.scene, globe.camera);
    }
    // the white cloud veil that hides the hand-off between the globe and the scene
    if (veilTarget === null) veil = globe.veil();               // on the globe, the veil simply follows altitude
    else veil += clamp(veilTarget - veil, -dt / 1.7, dt / 1.1);  // in a scene, fade toward the target
    $('veil').style.opacity = veil.toFixed(3);
    layoutLabels();

    // adaptive resolution
    if (!fixedPR && raw < 0.25) {
      acc += raw; frames++; cool -= raw;
      if (frames >= 45) {
        const avg = acc / frames; acc = 0; frames = 0;
        if (cool <= 0) {
          if (avg > 1 / 38 && pr > 1) { pr = Math.max(1, pr - 0.25); cool = 2.5; resize(); }
          else if (avg > 1 / 30 && pr <= 1 && world && !lite && state === 'scene') { lite = true; world.setLite(true); cool = 4; }   // last resort: thin the grass
          else if (avg < 1 / 57 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.25); cool = 6; resize(); }
        }
      }
    }
  }

  window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();
  globe.view.alt = globe.fitAlt();   // start with the whole Earth in view, whatever the screen shape
  globe.update(0, 0); renderer.render(globe.scene, globe.camera);
  requestAnimationFrame(frame);
  $('loading').style.opacity = 0; setTimeout(() => { $('loading').hidden = true; }, 750);
  // build the hillside quietly in the background so the first fly-down is not held up
  setTimeout(() => ensureWorld(home), 600);
  setTimeout(() => { if (performance.now() - lastInput > 9000) $('hint-globe').classList.add('off'); }, 12000);

  // handles for automated testing
  Object.assign(api, { globe, explorer, visit, leave, renderer, syncMode });
  Object.defineProperties(api, { state: { get: () => state }, world: { get: () => world }, pr: { get: () => pr } });
}

boot();
