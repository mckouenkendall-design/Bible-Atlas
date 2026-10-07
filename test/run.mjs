// Automated check: opens the built page in a headless browser set up like a phone held sideways,
// drives it with simulated touches, and saves screenshots to test/shots/.
//   node test/run.mjs            (phone, landscape)
//   node test/run.mjs desktop    (computer, mouse and keyboard)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'test', 'shots'); fs.mkdirSync(shots, { recursive: true });
const mode = process.argv[2] || 'phone';
const only = process.argv[3] || '';
const vp = mode === 'desktop' ? { width: 1280, height: 760 } : mode === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 };
const touch = mode !== 'desktop';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const cdp = await ctx.newCDPSession(page);

const shot = async (name) => { await page.screenshot({ path: path.join(shots, `${mode}-${name}.png`) }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);
const st = () => page.evaluate(() => { const a = window.__atlas; return { state: a.state, alt: +a.globe.view.alt.toFixed(4), lat: +a.globe.view.lat.toFixed(2), lon: +a.globe.view.lon.toFixed(2), mode: a.explorer.st.mode, pos: a.explorer.st.pos.toArray().map((v) => +v.toFixed(1)), yaw: +a.explorer.st.yaw.toFixed(2), pitch: +a.explorer.st.pitch.toFixed(2), pr: a.pr, world: !!a.world }; });
const until = async (fn, ms = 60000, label = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await wait(200); } throw new Error('timed out waiting for ' + label); };

// simulated fingers
const tp = (pts, type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
async function swipe(x0, y0, x1, y1, steps = 12, holdMs = 0) {
  await tp([[x0, y0, 1]], 'touchStart');
  for (let i = 1; i <= steps; i++) { await tp([[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, 1]], 'touchMove'); await wait(16); }
  if (holdMs) await wait(holdMs);
  await tp([], 'touchEnd');
}
async function pinch(cx, cy, d0, d1, steps = 14) {
  await tp([[cx - d0, cy, 1], [cx + d0, cy, 2]], 'touchStart');
  for (let i = 1; i <= steps; i++) { const d = d0 + (d1 - d0) * i / steps; await tp([[cx - d, cy, 1], [cx + d, cy, 2]], 'touchMove'); await wait(16); }
  await tp([], 'touchEnd');
}
const tap = async (x, y) => { await tp([[x, y, 1]], 'touchStart'); await wait(40); await tp([], 'touchEnd'); };

const t0 = Date.now();
const PR = process.env.PR || 1;
await page.goto('file://' + path.join(root, 'index.html') + '?pr=' + PR);
await until(() => !!window.__atlas, 30000, 'page start');
await wait(1500);
await page.evaluate(() => { window.__atlas.autoDive = false; });
const settle = () => until(() => !window.__atlas.globe.flying(), 90000, 'globe to settle');
console.log('started in', Date.now() - t0, 'ms', await st());
await shot('01-globe-start');

if (only !== 'scene' && only !== 'quick') {
  if (touch) {
    await swipe(vp.width * 0.6, vp.height * 0.5, vp.width * 0.35, vp.height * 0.6); await wait(900);
    console.log('after spin', await st()); await shot('02-globe-spun');
    await pinch(vp.width / 2, vp.height / 2, 40, 150); await wait(300); await pinch(vp.width / 2, vp.height / 2, 40, 150); await wait(600);
    console.log('after pinch', await st()); await shot('03-globe-pinched');
  } else {
    await page.mouse.move(640, 380); await page.mouse.down(); await page.mouse.move(520, 420, { steps: 10 }); await page.mouse.up(); await wait(900);
    await page.mouse.wheel(0, -600); await wait(600);
    console.log('after mouse', await st()); await shot('02-globe-mouse');
  }
  await page.click('#btn-home'); await wait(300); await settle(); await wait(400);
  console.log('holy land', await st()); await shot('04-holy-land');
  // closer looks at the region, set directly so the pictures are repeatable
  for (const [name, lat, lon, alt] of [['05-levant', 32.2, 35.4, 0.03], ['06-galilee', 32.84, 35.57, 0.008], ['06b-closest', 32.87, 35.56, 0.004], ['00-mideast', 30, 38, 0.45]]) {
    await page.evaluate(([la, lo, al]) => { const v = window.__atlas.globe.view; v.lat = la; v.lon = lo; v.alt = al; }, [lat, lon, alt]);
    await wait(700); await shot(name);
  }
  await page.evaluate(() => { const v = window.__atlas.globe.view; v.lat = 31.95; v.lon = 35.4; v.alt = 0.08; }); await wait(1500);
}

// tap the pin
await until(() => !!window.__atlas.world, 90000, 'scene build');
const pin = await page.evaluate(() => { const p = window.__atlas.globe.pins[0]; return { x: p.sx, y: p.sy, v: p.visible }; });
console.log('pin at', pin);
await page.evaluate(() => { window.__atlas.timeScale = 0.12; });
if (touch) await tap(pin.x, pin.y); else await page.mouse.click(pin.x, pin.y);
await wait(300);
console.log('after tap', await st());
for (const [i, a] of [[1, 0.02], [2, 0.006], [3, 0.0035], [4, 0.0022]]) { await page.waitForFunction((x) => window.__atlas.globe.view.alt < x || window.__atlas.state !== 'diving', a, { timeout: 120000, polling: 100 }); await shot(`07-dive-${i}`); const s = await st(); console.log(i, s.state, s.alt); }
await until(() => window.__atlas.state === 'arriving' || window.__atlas.state === 'scene', 60000, 'arrival');
for (const [i, h] of [[1, 940], [2, 700], [3, 380], [4, 120]]) { await page.waitForFunction((x) => window.__atlas.explorer.st.pos.y < x + window.__atlas.world.focus.y || window.__atlas.state === 'scene', h, { timeout: 120000, polling: 100 }); await shot(`08-arrive-${i}`); }
await page.evaluate(() => { window.__atlas.timeScale = 1; });
await until(() => window.__atlas.state === 'scene', 90000, 'scene state');
await wait(800); console.log('in scene', await st(), await page.evaluate(() => { const i = window.__atlas.renderer.info; return { triangles: i.render.triangles, drawCalls: i.render.calls, people: window.__atlas.world.stats.people }; }));
const y0q = await page.evaluate(() => window.__atlas.world.focus.y);
const view = async (name, pos, dir, pitch, mode2 = 'fly') => { await page.evaluate(([p, d, pi, m]) => { const a = window.__atlas, e = a.explorer; e.st.mode = m; a.syncMode(); e.st.tween = null; e.st.pos.set(...p); e.st.yaw = Math.atan2(-d[0], -d[1]); e.st.pitch = pi; }, [pos, dir, pitch, mode2]); await wait(1200); await shot(name); };
await shot('09-scene-establish');
if (only === 'quick') { await view('13q-walk', [0.6467 * 24 + 9, y0q - 1.2, 0.7628 * 24 - 7], [-0.6467 * 24 - 9, -0.7628 * 24 + 7], 0.03, 'walk'); console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no console errors or warnings'); await browser.close(); process.exit(0); }

// look around and move with touch
if (touch) {
  await swipe(vp.width * 0.75, vp.height * 0.5, vp.width * 0.55, vp.height * 0.55); await wait(500);
  console.log('after look', await st()); await shot('10-look');
  await swipe(120, vp.height - 110, 120, vp.height - 170, 6, 6000); await wait(300);
  console.log('after stick forward', await st()); await shot('11-moved');
} else {
  await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(560, 430, { steps: 8 }); await page.mouse.up(); await wait(400);
  await page.keyboard.down('w'); await wait(1500); await page.keyboard.up('w');
  await page.keyboard.down('e'); await wait(800); await page.keyboard.up('e');
  console.log('after keys', await st()); await shot('10-keys');
}
await page.click('#btn-over'); await wait(300); await until(() => !window.__atlas.explorer.st.tween, 60000, 'overhead'); await wait(500);
console.log('overhead', await st()); await shot('12-overhead');
await page.click('#btn-walk'); await wait(300); await until(() => !window.__atlas.explorer.st.tween, 60000, 'walk'); await wait(500);
console.log('walk', await st()); await shot('13-walk');
if (touch) { await swipe(120, vp.height - 110, 120, vp.height - 170, 6, 9000); await wait(200); } else { await page.keyboard.down('w'); await wait(2500); await page.keyboard.up('w'); }
console.log('walked', await st()); await shot('14-walked');
// close views set directly for inspection
const D = [0.6467, 0.7628];
const y0 = await page.evaluate(() => window.__atlas.world.focus.y);
await view('15-teacher-front', [D[0] * 6.5 + 1.2, y0 + 0.4, D[1] * 6.5 - 1.0], [-D[0] * 6.5 - 1.2, -D[1] * 6.5 + 1.0], 0.02);
await view('15b-teacher-close', [D[0] * 2.6 + 0.8, y0 + 0.25, D[1] * 2.6 - 0.6], [-D[0] * 2.6 - 0.8, -D[1] * 2.6 + 0.6], 0.0);
await view('16-crowd-from-behind-him', [-D[0] * 5 + 0.5, y0 + 2.4, -D[1] * 5], D, -0.22);
await view('17-far', [-260, y0 + 120, -160], [260, 160], -0.3);
await view('18-lake-shore', [D[0] * 430, 5, D[1] * 430], [-D[0], -D[1]], 0.08);
await view('18b-toward-lake', [D[0] * 52, y0 - 3.2, D[1] * 52], [D[0], D[1] * 0.6], -0.02);
await page.evaluate(() => window.__atlas.world.setLite(true)); await view('18c-lite-mode', [D[0] * 30 + 12, y0 - 0.3, D[1] * 30 - 10], [-D[0] * 30 - 12, -D[1] * 30 + 10], 0.05); await page.evaluate(() => window.__atlas.world.setLite(false));
await page.click('#btn-reset'); await wait(300); await until(() => !window.__atlas.explorer.st.tween, 60000, 'reset');
await page.click('#btn-scripture'); await wait(900); await shot('19-scripture');
await page.click('#tab-notes'); await wait(400); await shot('20-notes');
await page.click('#btn-close'); await wait(500);
await page.click('#btn-help-s'); await wait(400); await shot('21-help'); await page.click('#btn-help-x');
// back to the globe
await page.evaluate(() => { window.__atlas.timeScale = 0.4; });
await page.click('#btn-back'); await wait(1500); await shot('22-leaving');
await until(() => window.__atlas.state === 'rising', 240000, 'rising'); await page.waitForFunction(() => window.__atlas.globe.view.alt > 0.01, null, { timeout: 120000, polling: 100 }); await shot('22b-rising'); await page.evaluate(() => { window.__atlas.timeScale = 1; });
await until(() => window.__atlas.state === 'globe', 240000, 'back on globe'); await wait(600);
console.log('back', await st()); await shot('23-back-on-globe');

console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no console errors or warnings');
await browser.close();
