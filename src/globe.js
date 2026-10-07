// The stylized Earth: painted from embedded coastline numbers, with pins you can fly to.
import * as THREE from 'three';
import geo from './data/geo.json';
import { clamp, lerp, DEG, easeInOut, smoothstep } from './util.js';

export const R = 100; // globe radius in 3D units (1 unit is about 64 km)

// Convert a latitude / longitude into a point on the globe.
export function llToVec(lat, lon, r = R, out = new THREE.Vector3()) {
  const la = lat * DEG, lo = lon * DEG;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

// ---------- unpack the embedded map numbers ----------
function unpack(arr, q) {
  const out = new Float32Array(arr.length);
  let x = 0, y = 0;
  for (let i = 0; i < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; out[i] = x / q; out[i + 1] = y / q; }
  return out;
}
// Round off the corners of a coarse outline (used on the lakes).
function smoothRing(r, times = 2) {
  for (let k = 0; k < times; k++) {
    const n = r.length / 2, o = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], ay = r[i * 2 + 1], bx = r[j * 2], by = r[j * 2 + 1];
      o[i * 4] = ax * 0.75 + bx * 0.25; o[i * 4 + 1] = ay * 0.75 + by * 0.25;
      o[i * 4 + 2] = ax * 0.25 + bx * 0.75; o[i * 4 + 3] = ay * 0.25 + by * 0.75;
    }
    r = o;
  }
  return r;
}

const WORLD = geo.world.map((r) => unpack(r, 100));
const LEVANT = geo.levant.map((r) => unpack(r, 1000));
const LAKES = geo.lakes.map((l) => ({ name: l.name, ring: smoothRing(unpack(l.ring, l.q)) }));
const RIVERS = geo.rivers.map((r) => ({ name: r.name, line: unpack(r.line, 1000) }));
const BOX_L = geo.levantBox;              // high-detail patch: the Levant
const BOX_G = [35.3, 32.6, 35.8, 33.1];   // extra-detail patch: around the Sea of Galilee

// ---------- paint a "mask" picture the shader reads ----------
// red = land, green = how close to a coast, blue = lakes and rivers
function paintMask(w, h, box, o) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const sx = w / (box[2] - box[0]), sy = h / (box[3] - box[1]);
  const X = (lon) => (lon - box[0]) * sx, Y = (lat) => (box[3] - lat) * sy;
  const path = (rings, close) => {
    ctx.beginPath();
    for (const r of rings) {
      ctx.moveTo(X(r[0]), Y(r[1]));
      for (let i = 2; i < r.length; i += 2) ctx.lineTo(X(r[i]), Y(r[i + 1]));
      if (close) ctx.closePath();
    }
  };
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const glow = (px) => {
    for (const [k, v] of [[1, 30], [0.62, 38], [0.32, 46], [0.12, 60]]) { ctx.strokeStyle = `rgb(0,${v},0)`; ctx.lineWidth = px * k; ctx.stroke(); }
  };
  if (o.land) {
    path(o.land, true); ctx.fillStyle = '#ff0000'; ctx.fill('evenodd');
    ctx.globalCompositeOperation = 'lighter';
    glow(o.coastDeg * sx);
  } else {
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
  }
  const lakes = LAKES.map((l) => l.ring);
  path(lakes, true); ctx.fillStyle = '#0000ff'; ctx.fill();
  if (o.lakeGlowDeg) glow(o.lakeGlowDeg * sx);
  for (const r of RIVERS) {
    const jordan = r.name === 'Jordan';
    if (jordan && !o.jordan) continue;
    ctx.strokeStyle = `rgba(0,0,255,${jordan ? o.jordan : o.riverAlpha})`;
    ctx.lineWidth = jordan ? o.jordanPx : o.riverPx;
    path([r.line], false); ctx.stroke();
  }
  return c;
}

// A soft blob drawn with a fading edge.
function blob(ctx, W, H, lat, lon, rx, ry, rgb, a) {
  const x = (lon + 180) / 360 * W, y = (90 - lat) / 180 * H;
  ctx.save(); ctx.translate(x, y); ctx.scale(rx / 360 * W, ry / 180 * H);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.55, `rgba(${rgb},${a * 0.75})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
}

// A rough "how dry is it here" picture (red) and "is it icy" picture (green).
// This is my approximation from general geography, not measured data.
function paintBiome() {
  const W = 1024, H = 512;
  const A = document.createElement('canvas'); A.width = W; A.height = H;
  const a = A.getContext('2d');
  const g = a.createLinearGradient(0, 0, 0, H);
  const stops = [[90, 0.25], [60, 0.2], [45, 0.3], [36, 0.5], [31, 0.68], [22, 0.74], [14, 0.46], [6, 0.16], [-6, 0.16], [-14, 0.34], [-24, 0.6], [-33, 0.4], [-45, 0.22], [-90, 0.2]];
  for (const [lat, v] of stops) { const s = Math.round(v * 255); g.addColorStop((90 - lat) / 180, `rgb(${s},${s},${s})`); }
  a.fillStyle = g; a.fillRect(0, 0, W, H);
  const dry = (lat, lon, rx, ry, s = 0.85) => blob(a, W, H, lat, lon, rx, ry, '235,235,235', s);
  const wet = (lat, lon, rx, ry, s = 0.85) => blob(a, W, H, lat, lon, rx, ry, '30,30,30', s);
  // deserts outside the dry latitude band
  dry(42, 62, 13, 6); dry(41, 92, 21, 6); dry(33, 56, 8, 5); dry(32.6, 40, 4.5, 3.2); dry(39, -116, 6, 5, 0.7);
  dry(-44, -69, 3, 7, 0.7); dry(8, 47, 5, 5, 0.8); dry(30, 34.3, 1.6, 1.6, 0.6);
  // green places inside the dry band
  wet(25, 110, 18, 10); wet(22, 80, 9, 9, 0.7); wet(32, -86, 11, 6); wet(-25, -52, 10, 8); wet(-22, 32, 6, 8, 0.7); wet(-28, 151, 4, 10, 0.7);
  wet(41, 35, 9, 1.6, 0.6); wet(37.2, 30.5, 4, 1.2, 0.6); wet(41.6, 44, 5, 1.6, 0.6); wet(37, 51, 3, 0.9, 0.7);
  wet(15, 44, 1.6, 2.2, 0.6); wet(10, 38.5, 4, 5, 0.8);
  wet(33.4, 35.75, 0.9, 2.3, 0.9); wet(32.75, 35.35, 0.7, 0.7, 0.9); wet(31.9, 35.05, 0.45, 0.9, 0.6); wet(35.6, 36.2, 0.8, 1.6, 0.7);
  wet(30.9, 31.2, 1.1, 0.8, 0.9);
  // the great river valleys are green ribbons through the desert
  a.lineCap = 'round'; a.lineJoin = 'round';
  for (const r of RIVERS) {
    if (r.name === 'Jordan') continue;
    a.beginPath();
    for (let i = 0; i < r.line.length; i += 2) { const x = (r.line[i] + 180) / 360 * W, y = (90 - r.line[i + 1]) / 180 * H; i ? a.lineTo(x, y) : a.moveTo(x, y); }
    const main = r.name === 'Nile' || r.name === 'Tigris' || r.name === 'Euphrates' || r.name === 'Dicle' || r.name === 'Firat' || r.name === 'Al Furat';
    if (!main) continue;
    a.strokeStyle = 'rgba(30,30,30,0.3)'; a.lineWidth = 2.2; a.stroke();
    a.strokeStyle = 'rgba(30,30,30,0.4)'; a.lineWidth = 0.9; a.stroke();
  }
  a.globalCompositeOperation = 'multiply'; a.fillStyle = '#ff0000'; a.fillRect(0, 0, W, H);
  // ice
  const B = document.createElement('canvas'); B.width = W; B.height = H;
  const b = B.getContext('2d');
  const gi = b.createLinearGradient(0, 0, 0, H);
  for (const [lat, v] of [[90, 1], [76, 1], [64, 0], [-58, 0], [-64, 1], [-90, 1]]) gi.addColorStop((90 - lat) / 180, `rgb(0,${Math.round(v * 255)},0)`);
  b.fillStyle = gi; b.fillRect(0, 0, W, H);
  blob(b, W, H, 72, -41, 19, 11, '0,255,0', 1);
  a.globalCompositeOperation = 'lighter'; a.drawImage(B, 0, 0);
  return A;
}

function tex(canvas, renderer, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

const NOISE3 = /* glsl */`
float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a*vn3(p); p = p*2.07 + 3.1; a *= 0.5; } return s/0.875; }
`;

export function createGlobe(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070b16');
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 5000);
  const FOVT = Math.tan(21 * DEG);

  // ---- textures ----
  const big = renderer.capabilities.maxTextureSize >= 4096;
  const WW = big ? 4096 : 2048;
  const tWorld = tex(paintMask(WW, WW / 2, [-180, -90, 180, 90], { land: WORLD, coastDeg: 1.5, riverAlpha: 0.5, riverPx: WW / 4096 * 1.3 }), renderer, true);
  const tLevant = tex(paintMask(2048, 2048, BOX_L, { land: LEVANT, coastDeg: 0.42, lakeGlowDeg: 0.05, riverAlpha: 0.85, riverPx: 2.4, jordan: 0.8, jordanPx: 1.6 }), renderer, false);
  const tGal = tex(paintMask(1024, 1024, BOX_G, { lakeGlowDeg: 0.022, riverAlpha: 0.9, riverPx: 5, jordan: 0.95, jordanPx: 5 }), renderer, false);
  const tBiome = tex(paintBiome(), renderer, true);

  // ---- the planet ----
  const uniforms = {
    tWorld: { value: tWorld }, tLevant: { value: tLevant }, tGal: { value: tGal }, tBiome: { value: tBiome },
    uBoxL: { value: new THREE.Vector4(...BOX_L) }, uBoxG: { value: new THREE.Vector4(...BOX_G) },
    uLight: { value: new THREE.Vector3(0.4, 0.5, 0.8) }, uCam: { value: new THREE.Vector3() }, uAlt: { value: 1 },
  };
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 256, 128),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vP;
        void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D tWorld, tLevant, tGal, tBiome;
        uniform vec4 uBoxL, uBoxG; uniform vec3 uLight, uCam; uniform float uAlt;
        varying vec2 vUv; varying vec3 vP;
        ${NOISE3}
        float boxw(vec2 a, float m){ return smoothstep(0.0, m, a.x)*smoothstep(1.0, 1.0-m, a.x)*smoothstep(0.0, m, a.y)*smoothstep(1.0, 1.0-m, a.y); }
        void main(){
          vec3 N = normalize(vP), V = normalize(uCam - vP);
          vec2 ll = vec2((vUv.x-0.5)*360.0, (vUv.y-0.5)*180.0);
          vec4 m = texture2D(tWorld, vUv);
          vec2 a = (ll - uBoxL.xy)/(uBoxL.zw - uBoxL.xy);
          m = mix(m, texture2D(tLevant, clamp(a, 0.0, 1.0)), boxw(a, 0.06));
          vec2 b = (ll - uBoxG.xy)/(uBoxG.zw - uBoxG.xy);
          m = mix(m, texture2D(tGal, clamp(b, 0.0, 1.0)), boxw(b, 0.1));
          float land = m.r, coast = m.g, inland = m.b;

          float zoom = smoothstep(0.3, 0.03, uAlt);
          float close = smoothstep(0.03, 0.004, uAlt);
          float n1 = fbm3(N*5.0), n2 = fbm3(N*40.0);
          float n3 = zoom > 0.0 ? fbm3(N*520.0) : 0.5;
          float n4 = close > 0.0 ? fbm3(N*5200.0) : 0.5;

          vec4 bio = texture2D(tBiome, vUv);
          float arid = bio.r + (n1-0.5)*0.2 + (n2-0.5)*0.1 + (n3-0.5)*0.08*zoom;
          vec3 green = mix(vec3(0.38,0.58,0.32), vec3(0.58,0.70,0.40), n2);
          vec3 steppe = mix(vec3(0.70,0.72,0.46), vec3(0.78,0.74,0.50), n2);
          vec3 sand  = mix(vec3(0.91,0.81,0.62), vec3(0.80,0.67,0.47), n2);
          vec3 landC = mix(green, steppe, smoothstep(0.34, 0.50, arid));
          landC = mix(landC, sand, smoothstep(0.47, 0.64, arid));
          landC *= 0.93 + 0.14*mix(0.5, n3, zoom);
          landC *= 0.95 + 0.10*mix(0.5, n4, close);
          landC = mix(landC, vec3(0.96,0.97,0.99), smoothstep(0.35, 0.7, bio.g + (n2-0.5)*0.35));
          landC = mix(landC, vec3(0.94,0.89,0.72), smoothstep(0.5, 1.0, coast)*0.3);

          vec3 sea = mix(vec3(0.10,0.28,0.50), vec3(0.17,0.43,0.65), smoothstep(0.0, 0.4, coast));
          sea = mix(sea, vec3(0.40,0.72,0.80), smoothstep(0.4, 1.0, coast));
          sea *= 0.95 + 0.10*n2;

          float isLand = smoothstep(0.40, 0.60, land);
          vec3 col = mix(sea, landC, isLand);
          vec3 lakeC = mix(vec3(0.22,0.50,0.72), vec3(0.36,0.66,0.80), smoothstep(0.3, 1.0, coast)*close);
          col = mix(col, lakeC, smoothstep(0.25, 0.75, inland)*isLand);
          float edge = 1.0 - smoothstep(0.0, 0.8, abs(land-0.5)*2.0);
          col = mix(col, vec3(0.98,0.95,0.84), edge*0.45);

          float lit = 0.72 + 0.32*smoothstep(-0.4, 0.9, dot(N, uLight));
          col *= lit;
          col += pow(max(dot(reflect(-uLight, N), V), 0.0), 40.0)*(1.0-isLand)*0.18;
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
          col = mix(col, vec3(0.62,0.82,1.0), rim*0.7);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(earth);

  // ---- soft atmosphere ring around the planet ----
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.09, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: { uCam: uniforms.uCam },
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; uniform vec3 uCam; varying vec3 vP;
        void main(){
          vec3 rd = normalize(vP - uCam);
          float tca = dot(-uCam, rd);
          float d = sqrt(max(dot(uCam, uCam) - tca*tca, 0.0));
          float g = 1.0 - clamp((d - ${R.toFixed(1)}) / ${(R * 0.09).toFixed(2)}, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.36, 0.62, 1.0) * pow(g, 3.0) * 0.85, 1.0);
        }`,
    }),
  );
  scene.add(halo);

  // ---- drifting clouds (they thin out as you zoom in so the land stays readable) ----
  const cloudU = { uFade: { value: 1 }, uCamN: { value: new THREE.Vector3() }, uLight: uniforms.uLight, uT: { value: 0 } };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.008, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: cloudU, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vL; varying vec3 vW; void main(){ vL = normalize(position); vW = normalize((modelMatrix*vec4(position,1.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; uniform float uFade, uT; uniform vec3 uCamN, uLight; varying vec3 vL; varying vec3 vW;
        ${NOISE3}
        void main(){
          float n = fbm3(vL*3.3 + vec3(0.0, uT*0.01, 0.0))*0.65 + fbm3(vL*9.0 + 7.0)*0.35;
          float a = smoothstep(0.52, 0.70, n)*0.82;
          a *= uFade * (0.3 + 0.7*smoothstep(0.93, 0.62, dot(vW, uCamN)));
          float lit = 0.82 + 0.2*smoothstep(-0.3, 0.9, dot(vW, uLight));
          gl_FragColor = vec4(vec3(lit), a);
        }`,
    }),
  );
  scene.add(clouds);

  // ---- stars ----
  {
    const n = 1600, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - z * z);
      p.set([r * Math.cos(a) * 3000, z * 3000, r * Math.sin(a) * 3000], i * 3);
      const b = 0.35 + Math.random() * 0.65; c.set([b, b, b * (0.9 + Math.random() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    stars.frustumCulled = false; scene.add(stars);
  }

  // ---- pins ----
  const pins = [];
  const GOLD = new THREE.Color('#ffd978');
  function addPin(loc) {
    const g = new THREE.Group();
    const n = llToVec(loc.lat, loc.lon, 1);
    g.position.copy(n).multiplyScalar(R * 1.0004);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const mat = (o) => new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...o });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.74, 1, 48), mat({ opacity: 0.95 }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), mat({ color: new THREE.Color('#fff6dc') }));
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), mat({ opacity: 0.6 }));
    const beamGeo = new THREE.CylinderGeometry(0.02, 0.3, 4.4, 12, 1, true); beamGeo.rotateX(Math.PI / 2); beamGeo.translate(0, 0, 2.2);
    const beam = new THREE.Mesh(beamGeo, mat({ opacity: 0.26, blending: THREE.AdditiveBlending }));
    for (const m of [beam, pulse, ring, dot]) { m.renderOrder = 10; g.add(m); }
    scene.add(g);
    const pin = { loc, group: g, normal: n, pulse, sx: 0, sy: 0, visible: false };
    pins.push(pin); return pin;
  }

  // ---- camera state: where over the Earth we are, and how high ----
  const view = { lat: 30.5, lon: 36, alt: 1.9 };
  const vel = { lat: 0, lon: 0 };
  const size = { w: 1, h: 1 };
  let fly = null;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  function fitAlt() { // altitude at which the whole globe just fits on screen
    const half = Math.min(Math.atan(FOVT * camera.aspect), 21 * DEG);
    return clamp(1 / Math.sin(half) - 1, 1.2, 6) * 1.12;
  }
  function resize(w, h) {
    size.w = w; size.h = h; camera.aspect = w / h; camera.updateProjectionMatrix();
    api.maxAlt = fitAlt() * 1.25;
  }
  function placeCamera() {
    view.lat = clamp(view.lat, -84, 84);
    llToVec(view.lat, view.lon, R * (1 + view.alt), camera.position);
    camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
    const d = view.alt * R;
    camera.near = Math.max(0.01, d * 0.25); camera.far = d + R * 1.4 + 3200;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  const kPerPx = () => Math.min(2 * FOVT * view.alt / size.h, 0.0052) / DEG; // degrees of turn per pixel dragged

  const api = {
    scene, camera, view, pins, minAlt: 0.0072, maxAlt: 3, flying: () => !!fly,
    addPin, resize, fitAlt,
    drag(dx, dy) {
      if (fly) return;
      const k = kPerPx();
      const dLon = -dx * k / Math.max(0.2, Math.cos(view.lat * DEG)), dLat = dy * k;
      view.lon += dLon; view.lat += dLat;
      vel.lon = lerp(vel.lon, dLon * 60, 0.5); vel.lat = lerp(vel.lat, dLat * 60, 0.5);
    },
    stopSpin() { vel.lat = vel.lon = 0; },
    zoom(factor) { if (!fly) view.alt = clamp(view.alt * factor, api.minAlt, api.maxAlt); },
    // Glide over to a place at a comfortable height (used by the "Holy Land" button).
    glideTo(lat, lon, alt, T = 1.6) {
      fly = { t: 0, T, a0: view.alt, a1: alt, d0: llToVec(view.lat, view.lon, 1), d1: llToVec(lat, lon, 1), mode: 'glide' };
    },
    // Fly from wherever we are down onto a pin. Calls back with a 0..1 "cloud cover" value.
    flyTo(loc, onDone) {
      const d0 = llToVec(view.lat, view.lon, 1), d1 = llToVec(loc.lat, loc.lon, 1);
      const ang = d0.angleTo(d1);
      const T = 2.3 + 1.5 * clamp(ang / 1.2, 0, 1) + 0.2 * Math.abs(Math.log(view.alt / 0.0016));
      fly = { t: 0, T, a0: view.alt, a1: 0.0016, d0, d1, mode: 'in', onDone };
    },
    // Rise back up from a pin to a regional view.
    flyOut(loc, onDone) {
      view.lat = loc.lat; view.lon = loc.lon; view.alt = 0.0016; vel.lat = vel.lon = 0;
      const d = llToVec(loc.lat, loc.lon, 1);
      fly = { t: 0, T: 2.8, a0: 0.0016, a1: 0.22, d0: d, d1: d.clone(), mode: 'out', onDone };
    },
    // 0 = clear, 1 = fully inside the cloud layer (drives the white veil)
    veil() { return smoothstep(Math.log(0.0068), Math.log(0.0022), Math.log(view.alt)); },
    project(lat, lon, out) {
      const n = llToVec(lat, lon, 1, tmp);
      const facing = n.dot(tmp2.copy(camera.position).normalize());
      const vis = facing > 1 / (1 + view.alt);   // on our side of the horizon
      n.multiplyScalar(R).project(camera);
      out.x = (n.x * 0.5 + 0.5) * size.w; out.y = (-n.y * 0.5 + 0.5) * size.h; out.visible = vis && n.z < 1;
      return out;
    },
    pick(x, y) {
      let best = null, bd = 40;
      for (const p of pins) { if (!p.visible) continue; const d = Math.hypot(p.sx - x, p.sy - y); if (d < bd) { bd = d; best = p; } }
      return best;
    },
    // angle in degrees between the centre of the view and a place
    angleTo(loc) { return llToVec(view.lat, view.lon, 1, tmp).angleTo(llToVec(loc.lat, loc.lon, 1, tmp2)) / DEG; },
    update(dt, time) {
      if (fly) {
        fly.t += dt; const p = clamp(fly.t / fly.T, 0, 1);
        let r, z;
        if (fly.mode === 'in') { r = easeInOut(clamp(p / 0.55, 0, 1)); z = easeInOut(clamp((p - 0.18) / 0.82, 0, 1)); }
        else { r = easeInOut(p); z = easeInOut(p); }
        const ang = fly.d0.angleTo(fly.d1);
        if (ang > 1e-5) {
          const s = Math.sin(ang);
          tmp.copy(fly.d0).multiplyScalar(Math.sin((1 - r) * ang) / s).addScaledVector(fly.d1, Math.sin(r * ang) / s).normalize();
        } else tmp.copy(fly.d1);
        view.lat = Math.asin(clamp(tmp.y, -1, 1)) / DEG; view.lon = Math.atan2(-tmp.z, tmp.x) / DEG;
        let la = lerp(Math.log(fly.a0), Math.log(fly.a1), z);
        if (fly.mode === 'in') la += Math.sin(Math.PI * clamp(p / 0.6, 0, 1)) * Math.min(0.5, ang * 0.5) * (fly.a0 < 0.6 ? 1 : 0.2); // small hop up on long trips
        view.alt = Math.exp(la);
        if (p >= 1) { const f = fly; fly = null; vel.lat = vel.lon = 0; f.onDone && f.onDone(); }
      } else {
        const damp = Math.exp(-4.5 * dt);
        if (Math.abs(vel.lat) + Math.abs(vel.lon) > 0.01 && !api.holding) { view.lat += vel.lat * dt; view.lon += vel.lon * dt; }
        vel.lat *= damp; vel.lon *= damp;
      }
      placeCamera();
      uniforms.uCam.value.copy(camera.position); uniforms.uAlt.value = view.alt;
      // light comes from over the viewer's upper-left shoulder so whatever you look at is lit
      tmp.set(-0.55, 0.5, 0.67).normalize().transformDirection(camera.matrixWorld); uniforms.uLight.value.copy(tmp);
      cloudU.uFade.value = smoothstep(0.1, 0.55, view.alt); cloudU.uT.value = time;
      cloudU.uCamN.value.copy(camera.position).normalize();
      clouds.visible = cloudU.uFade.value > 0.002; clouds.rotation.y = time * 0.006;
      // pins keep the same size on screen at any zoom
      for (const pin of pins) {
        const dist = camera.position.distanceTo(pin.group.position);
        pin.group.scale.setScalar(dist * FOVT * (2 * 13 / size.h));
        const o = api.project(pin.loc.lat, pin.loc.lon, { x: 0, y: 0, visible: false });
        pin.sx = o.x; pin.sy = o.y; pin.visible = o.visible; pin.group.visible = o.visible;
        const ph = (time * 0.7) % 1; pin.pulse.scale.setScalar(1 + ph * 1.8); pin.pulse.material.opacity = 0.6 * (1 - ph);
      }
    },
  };
  return api;
}
