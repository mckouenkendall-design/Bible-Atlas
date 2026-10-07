// Turns public-domain Natural Earth map files (in ./raw) into one small
// file of numbers (src/data/geo.json) that gets baked into the page.
// Run:  node tools/make-geo.mjs
// Source data: https://github.com/nvkelso/natural-earth-vector (public domain)
import fs from 'node:fs';

const read = (n) => JSON.parse(fs.readFileSync(new URL(`../raw/${n}.geojson`, import.meta.url)));

// ---------- helpers ----------
function ringsOf(geom) {
  // returns array of polygons, each polygon = array of rings (outer + holes)
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function linesOf(geom) {
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}
function bbox(ring) {
  let a = [1e9, 1e9, -1e9, -1e9];
  for (const [x, y] of ring) { a[0] = Math.min(a[0], x); a[1] = Math.min(a[1], y); a[2] = Math.max(a[2], x); a[3] = Math.max(a[3], y); }
  return a;
}
function area(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
  return Math.abs(s) / 2;
}
// Douglas-Peucker line simplification (drops points that barely change the shape)
function simplify(pts, eps) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      // closed rings start and end on the same point, so fall back to plain distance there
      const d = L < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// Clip a polygon ring to a lon/lat box (Sutherland-Hodgman)
function clipRing(ring, [x0, y0, x1, y1]) {
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); }
      else if (pi) out.push(cut(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}
// store as whole numbers, each point saved as the step from the previous one (smaller file)
function pack(pts, q) {
  const out = []; let px = 0, py = 0;
  for (const [x, y] of pts) {
    const qx = Math.round(x * q), qy = Math.round(y * q);
    if (out.length && qx === px && qy === py) continue;
    out.push(qx - px, qy - py); px = qx; py = qy;
  }
  return out;
}

// ---------- 1. whole-world land (medium detail) ----------
const land50 = read('ne_50m_land');
const world = [];
const MIDEAST = [10, 5, 65, 48];
for (const f of land50.features) for (const poly of ringsOf(f.geometry)) for (const ring of poly) {
  const b = bbox(ring);
  const inME = b[2] > MIDEAST[0] && b[0] < MIDEAST[2] && b[3] > MIDEAST[1] && b[1] < MIDEAST[3];
  if (!inME && area(ring) < 0.02) continue;            // drop specks far from the region we care about
  const s = simplify(ring, inME ? 0.004 : 0.02);
  if (s.length < 4) continue;
  world.push(pack(s, 100));
}

// ---------- 2. Levant land (high detail, clipped to a box) ----------
const LEVANT = [28.5, 25.5, 42.5, 38.5];
const land10 = read('ne_10m_land');
const levant = [];
for (const f of land10.features) for (const poly of ringsOf(f.geometry)) for (const ring of poly) {
  const b = bbox(ring);
  if (b[2] < LEVANT[0] || b[0] > LEVANT[2] || b[3] < LEVANT[1] || b[1] > LEVANT[3]) continue;
  const pad = [LEVANT[0] - 0.5, LEVANT[1] - 0.5, LEVANT[2] + 0.5, LEVANT[3] + 0.5];
  const c = clipRing(ring, pad);
  if (c.length < 4) continue;
  levant.push(pack(simplify(c, 0.0008), 1000));
}

// ---------- 3. lakes that existed in Bible times (modern reservoirs left out on purpose) ----------
const KEEP_LAKES = new Set(['Sea of Galilee', 'Dead Sea', 'Lake Van', 'Lake Urmia', 'Lake Tuz', 'Lake Sevan', 'Beyşehir', 'Eğirdir']);
const lakes = [];
for (const f of read('ne_10m_lakes').features) {
  if (!KEEP_LAKES.has(f.properties.name)) continue;
  for (const poly of ringsOf(f.geometry)) {
    let ring = poly[0];
    if (f.properties.name === 'Sea of Galilee') {
      // The free dataset draws this lake with only 28 points and its north-west corner bulges
      // about 1 km too far, which would put the Mount of Beatitudes in the water. Two well known
      // shoreline sites fix it: Tabgha (32.8733 N, 35.5489 E) and Capernaum (32.8811 N, 35.5750 E).
      ring = ring.flatMap((p) => (Math.abs(p[0] - 35.555) < 0.002 && Math.abs(p[1] - 32.881) < 0.002)
        ? [[35.5492, 32.8722], [35.5625, 32.8745], [35.5752, 32.8800]] : [p]);
    }
    lakes.push({ name: f.properties.name, ring: pack(ring, 10000), q: 10000 });
  }
}

// ---------- 4. rivers ----------
const KEEP_RIVERS = new Set(['Jordan', 'Nile', 'Rosetta Branch', 'Damietta Branch', 'Tigris', 'Dicle', 'Euphrates', 'Firat', 'Al Furat', 'Shatt al Arab', 'El Bahr el Azraq', 'Abay', 'Atbara']);
const rivers = [];
for (const f of read('ne_10m_rivers_lake_centerlines').features) {
  if (!f.geometry || !KEEP_RIVERS.has(f.properties.name)) continue;
  for (const line of linesOf(f.geometry)) {
    const b = bbox(line);
    if (b[2] < 20 || b[0] > 55 || b[3] < 3 || b[1] > 42) continue;
    const big = f.properties.name === 'Jordan' ? 0.0005 : 0.004;
    rivers.push({ name: f.properties.name, line: pack(simplify(line, big), 1000) });
  }
}

const out = { world, levant, levantBox: LEVANT, lakes, rivers };
fs.mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(new URL('../src/data/geo.json', import.meta.url), json);
const count = (a) => a.reduce((s, r) => s + (r.ring || r.line || r).length / 2, 0);
console.log(`world rings ${world.length} pts ${count(world)} | levant rings ${levant.length} pts ${count(levant)} | lakes ${lakes.length} | rivers ${rivers.length} pts ${count(rivers)} | ${(json.length / 1024).toFixed(0)} KB`);

// sanity: is the pin on land, and how far from the lake edge?
const PIN = [35.5556, 32.8806];
const galPacked = lakes.find((l) => l.name === 'Sea of Galilee').ring;
const gal = []; { let x = 0, y = 0; for (let i = 0; i < galPacked.length; i += 2) { x += galPacked[i]; y += galPacked[i + 1]; gal.push([x / 10000, y / 10000]); } }
let inside = false;
for (let i = 0, j = gal.length - 1; i < gal.length; j = i++) {
  const [xi, yi] = gal[i], [xj, yj] = gal[j];
  if ((yi > PIN[1]) !== (yj > PIN[1]) && PIN[0] < (xj - xi) * (PIN[1] - yi) / (yj - yi) + xi) inside = !inside;
}
let md = 1e9;
for (let i = 0; i < gal.length - 1; i++) {
  const [ax, ay] = gal[i], [bx, by] = gal[i + 1];
  const kx = 93.6, ky = 110.9; // km per degree here
  const px = (PIN[0] - ax) * kx, py = (PIN[1] - ay) * ky, dx = (bx - ax) * kx, dy = (by - ay) * ky;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  md = Math.min(md, Math.hypot(px - dx * t, py - dy * t));
}
console.log(`pin inside Sea of Galilee outline: ${inside}; distance to outline: ${md.toFixed(2)} km; outline points: ${gal.length}`);
