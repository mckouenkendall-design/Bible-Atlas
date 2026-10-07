// The Sermon on the Mount scene: a hillside above the Sea of Galilee.
// Everything here is built from code. Compass: +X is east, +Z is south, +Y is up. Units are metres.
import * as THREE from 'three';
import { rng, fbm2, clamp, lerp, smoothstep, DEG, GLSL_NOISE2 } from './util.js';
import { crowdGeometries, teacherGeometries } from './figures.js';

// ---------- the lay of the land ----------
// The lake is modelled as a large oval to the south-east, as the real lake lies from the traditional site.
const LAKE = { cx: 3200, cz: 9850, a: 6500, b: 10500 };
const DOWN = new THREE.Vector2(0.6467, 0.7628);   // downhill direction from the teaching spot (toward the lake)
const SIDE = new THREE.Vector2(0.7628, -0.6467);  // across the slope

export function heightAt(x, z) {
  const ux = (x - LAKE.cx) / LAKE.a, uz = (z - LAKE.cz) / LAKE.b;
  const f = ux * ux + uz * uz;
  const g = Math.hypot(2 * ux / LAKE.a, 2 * uz / LAKE.b);
  let d = g < 1e-7 ? -3000 : Math.max(-3000, (f - 1) / g);       // rough distance to the shoreline (negative = in the lake)
  d += (fbm2(x / 420 + 3.1, z / 420 + 8.7, 3) - 0.5) * 170;       // wobble the shoreline into coves
  if (d < 0) return Math.max(-24, d * 0.045);
  const r2 = x * x + z * z, calm = Math.exp(-r2 / (2 * 95 * 95));
  let h = 2.0 * (1 - Math.exp(-d / 30)) + 118 * smoothstep(40, 1400, d);
  h += smoothstep(900, 4200, d) * (40 + 300 * fbm2(x / 2600 + 7.3, z / 2600 + 1.9, 3));
  h += (fbm2(x / 180 + 20, z / 180 - 4, 3) - 0.5) * 16 * smoothstep(40, 420, d) * (1 - 0.8 * calm);
  h += (fbm2(x / 38 - 9, z / 38 + 13, 2) - 0.5) * 1.5 * smoothstep(15, 140, d) * (1 - 0.85 * calm);
  h += 1.25 * Math.exp(-r2 / (2 * 5.5 * 5.5));                    // the small rise he sits on
  return h;
}
function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.6;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const C = (hex) => new THREE.Color(hex);
const PAL = {
  zenith: C('#3c7bd0'), skyMid: C('#8fbde8'), horizon: C('#d6e6ee'), fog: C('#cfe0ea'),
  sun: C('#fff1d2'), hemiSky: C('#cfe2ff'), hemiGround: C('#8a8f6a'),
  grassA: C('#5d8a3e'), grassB: C('#93b258'), dry: C('#bfb46a'), sand: C('#cdbf96'), bed: C('#6f9a93'), rock: C('#77736b'), farHill: C('#93996a'),
  waterNear: C('#4e97b6'), waterDeep: C('#2c6c9c'),
  robes: ['#b89b74', '#a5855f', '#8c6f52', '#c9b28c', '#9a7b5a', '#7d6b57', '#b6a48a', '#8f8266', '#a08a6c', '#6f5f4d', '#c2a57a', '#94765a', '#9c6b4e', '#7f7a55', '#6c7480', '#a89678', '#bfa98a'].map(C),
  mantles: ['#6e5a45', '#d4c4a3', '#7a6a58', '#8a5f4a', '#5f6658', '#b9a27c', '#4f4a44', '#96785a', '#c7b596'].map(C),
  skins: ['#c69a74', '#b5855f', '#a8754f', '#8f6243', '#d0a57e', '#9c6c4a'].map(C),
  hairs: ['#2a211c', '#3a2c22', '#1f1a17', '#4a3a2c', '#2e2622', '#8a8580'].map(C),
};
const SUN_DIR = new THREE.Vector3(-0.9, 0, 0.3).normalize().multiplyScalar(Math.cos(41 * DEG)).setY(Math.sin(41 * DEG)).normalize();
const SUN_I = 2.3, HEMI_I = 1.4, FOG_D = 0.00012;

const CLOUD_SHADE = /* glsl */`
${GLSL_NOISE2}
float cloudShade(vec2 p, float t){
  float n = vnoise2(p/520.0 + t*vec2(0.012, 0.004))*0.65 + vnoise2(p/190.0 + t*vec2(0.02, 0.008) + 9.0)*0.35;
  return 1.0 - 0.2*smoothstep(0.50, 0.74, n);
}`;

export async function buildSermon({ renderer, step }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PAL.fog, FOG_D);
  const R = rng(20260514);
  const T = { value: 0 };                      // shared clock for every moving thing
  const fogU = { uFogC: { value: PAL.fog }, uFogD: { value: FOG_D } };
  const y0 = heightAt(0, 0);
  const updaters = [];
  const quality = [];                          // things that can be thinned out on slower phones
  const arrivalHooks = [];
  const colliders = [];

  // ---------- light ----------
  const sun = new THREE.DirectionalLight(PAL.sun, SUN_I); sun.position.copy(SUN_DIR).multiplyScalar(100); scene.add(sun);
  scene.add(new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, HEMI_I));
  // colour that flat ground receives, so hand-written shaders match the built-in lighting
  const groundLight = PAL.sun.clone().multiplyScalar(SUN_I * SUN_DIR.y).add(PAL.hemiSky.clone().multiplyScalar(HEMI_I)).multiplyScalar(1 / Math.PI);

  // ---------- sky ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(40000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uZ: { value: PAL.zenith }, uM: { value: PAL.skyMid }, uH: { value: PAL.horizon }, uSun: { value: SUN_DIR }, uSunC: { value: PAL.sun } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uZ, uM, uH, uSun, uSunC; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); float t = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uH, uM, smoothstep(0.0, 0.22, t)); col = mix(col, uZ, smoothstep(0.15, 0.85, t));
          float s = max(dot(d, uSun), 0.0);
          col += uSunC * (pow(s, 700.0)*1.6 + pow(s, 40.0)*0.22 + pow(s, 6.0)*0.08);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -100; sky.frustumCulled = false; scene.add(sky);
  await step();

  // ---------- ground ----------
  {
    const N = 240, E = 17000, A = 0.02;
    const warp = (u) => E * (A * u + (1 - A) * u * u * u);   // small squares near the crowd, big ones far away
    const pos = new Float32Array((N + 1) * (N + 1) * 3);
    for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k += 3) {
      const x = warp(i / N * 2 - 1), z = warp(j / N * 2 - 1);
      pos[k] = x; pos[k + 1] = heightAt(x, z); pos[k + 2] = z;
    }
    const idx = new Uint32Array(N * N * 6);
    for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    await step();
    const nor = g.attributes.normal.array, col = new Float32Array(pos.length), grass = new Float32Array(pos.length / 3);
    const c = new THREE.Color();
    for (let k = 0, v = 0; k < pos.length; k += 3, v++) {
      const x = pos[k], h = pos[k + 1], z = pos[k + 2], ny = nor[k + 1];
      const far = smoothstep(1200, 5000, Math.hypot(x, z));
      c.copy(PAL.grassA).lerp(PAL.grassB, 0.5).lerp(PAL.farHill, far * 0.75);
      let gr = 1 - far * 0.7;
      const rocky = smoothstep(0.86, 0.68, ny) * (1 - far * 0.5); c.lerp(PAL.rock, rocky * 0.85); gr *= 1 - rocky;
      const sandy = smoothstep(2.6, 0.5, h); c.lerp(PAL.sand, sandy); gr *= 1 - sandy;
      if (h < 0) c.lerp(PAL.bed, smoothstep(0, -3, h));
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; grass[v] = gr;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = T; s.uniforms.uGA = { value: PAL.grassA }; s.uniforms.uGB = { value: PAL.grassB }; s.uniforms.uDry = { value: PAL.dry };
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGrass; varying float vGrass; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrass = aGrass; vWP = transformed;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uTime; uniform vec3 uGA, uGB, uDry; varying float vGrass; varying vec3 vWP;\n${CLOUD_SHADE}`)
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
          vec2 q1 = vWP.xz, q2 = mat2(0.80, -0.60, 0.60, 0.80) * vWP.xz, q3 = mat2(0.34, 0.94, -0.94, 0.34) * vWP.xz;   // turned copies hide the noise grid
          float ga = vnoise2(q1/57.0)*0.42 + vnoise2(q2/24.0 + 7.0)*0.33 + vnoise2(q3/10.0 + 3.0)*0.25;
          vec3 gcol = mix(uGA, uGB, smoothstep(0.2, 0.8, ga));
          float gd = vnoise2(q2/190.0 + 5.0)*0.5 + vnoise2(q3/71.0 + 2.0)*0.3 + vnoise2(q1/27.0 + 11.0)*0.2;
          gcol = mix(gcol, uDry, smoothstep(0.42, 0.78, gd)*0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, gcol, vGrass);
          float wv = vnoise2(vWP.xz*0.07 - vec2(uTime*0.55, uTime*0.3));
          float gust = smoothstep(0.55, 0.9, vnoise2(vWP.xz*0.012 - vec2(uTime*0.12, uTime*0.07)));
          float nearK = 1.0 - smoothstep(150.0, 700.0, distance(cameraPosition, vWP));
          diffuseColor.rgb *= 1.0 + vGrass*nearK*((wv-0.5)*0.16 + gust*0.10 + (vnoise2(vWP.xz*2.6)-0.5)*0.10);
          diffuseColor.rgb *= cloudShade(vWP.xz, uTime);`);
    };
    m.customProgramCacheKey = () => 'terrain';
    scene.add(new THREE.Mesh(g, m));
  }
  await step();

  // ---------- lake ----------
  {
    const g = new THREE.PlaneGeometry(70000, 70000).rotateX(-Math.PI / 2).translate(LAKE.cx, 0, LAKE.cz);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: T, uCam: { value: new THREE.Vector3() }, uSun: { value: SUN_DIR }, uSunC: { value: PAL.sun }, uNear: { value: PAL.waterNear }, uDeep: { value: PAL.waterDeep }, uSky: { value: PAL.horizon }, ...fogU },
      vertexShader: `varying vec3 vWP; void main(){ vWP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uFogD; uniform vec3 uCam, uSun, uSunC, uNear, uDeep, uSky, uFogC; varying vec3 vWP;
        ${GLSL_NOISE2}
        void main(){
          vec3 toC = uCam - vWP; float dist = length(toC); vec3 V = toC / dist; vec2 p = vWP.xz;
          float fine = 1.0 / (1.0 + dist*0.006);
          float r1 = vnoise2(p*0.33 + vec2(uTime*0.45, uTime*0.2));
          float r2 = vnoise2(p*0.09 - vec2(uTime*0.16, -uTime*0.11));
          float r3 = vnoise2(p*0.011 + vec2(uTime*0.02, uTime*0.013));
          vec3 N = normalize(vec3((r1-0.5)*0.5*fine + (r2-0.5)*0.22, 1.0, (r1-0.5)*0.42*fine - (r2-0.5)*0.2));
          vec3 col = mix(uNear, uDeep, smoothstep(0.0, 2600.0, dist));
          col *= 0.9 + 0.2*r3;
          col *= 0.96 + 0.08*(r2 + (r1-0.5)*fine);
          float fres = pow(1.0 - max(V.y, 0.0), 3.0);
          col = mix(col, uSky, fres*0.6);
          float glint = pow(max(dot(reflect(-V, N), uSun), 0.0), 70.0);
          col += uSunC * glint * 0.9;
          float fog = 1.0 - exp(-uFogD*uFogD*dist*dist);
          col = mix(col, uFogC, fog);
          gl_FragColor = vec4(col, 0.9);
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(g, m); water.frustumCulled = false; scene.add(water);
    updaters.push((dt, t, cam) => m.uniforms.uCam.value.copy(cam.position));
  }

  // ---------- the teacher ----------
  const teacher = new THREE.Group();
  teacher.position.set(0, y0 - 0.03, 0); teacher.rotation.y = Math.atan2(DOWN.x, DOWN.y);
  {
    const colors = [C('#fbf8f0'), C('#c49a74'), C('#ecdcb2'), C('#4a3526')];
    const tg = teacherGeometries(colors);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: C('#fff4dc'), emissiveIntensity: 0.16 });
    teacher.add(new THREE.Mesh(tg.body, mat));
    const arm = new THREE.Mesh(tg.arm, mat); arm.position.set(...tg.shoulder); teacher.add(arm);
    updaters.push((dt, t) => { arm.rotation.x = -0.1 + Math.sin(t * 0.55) * 0.09 + Math.sin(t * 1.3) * 0.03; arm.rotation.z = Math.sin(t * 0.4) * 0.05; });

    // the rock he sits on (dark basalt, which is the local stone)
    const rg = new THREE.IcosahedronGeometry(1, 2); const p = rg.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.82 + 0.3 * fbm2(p.getX(i) * 1.7 + 4, p.getY(i) * 1.7 + p.getZ(i) * 1.3, 2); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
    rg.computeVertexNormals();
    const rock = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: C('#6a665f'), flatShading: true }));
    rock.scale.set(0.82, 0.5, 0.66); rock.position.set(0, 0.04, -0.24); teacher.add(rock);

    // soft glow
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
    const gt = new THREE.CanvasTexture(cv);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: C('#ffe7ae'), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.position.set(0, 1.05, 0); teacher.add(glow);
    // shaft of light, mainly a locator from far away; it fades as you come close
    const sg = new THREE.CylinderGeometry(5, 1.0, 170, 24, 1, true); sg.translate(0, 85, 0);
    const sm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uK: { value: 0.1 }, uC: { value: C('#ffe9b8') } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uK; uniform vec3 uC; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = pow(1.0 - vY, 1.6) * e * uK; gl_FragColor = vec4(uC * a, 1.0); }`,
    });
    const shaft = new THREE.Mesh(sg, sm); teacher.add(shaft);
    const lamp = new THREE.PointLight(C('#ffe2a8'), 9, 15, 2); lamp.position.set(0, 2.1, 0.5); teacher.add(lamp);
    // a pool of warm light on the ground, so he can be found from directly overhead too
    {
      const RINGS = 10, SEG = 36, RAD = 6.5, pp = [0, y0 + 0.07, 0], uu = [0.5, 0.5], ii = [];
      for (let r = 1; r <= RINGS; r++) for (let k = 0; k < SEG; k++) {
        const a = k / SEG * 6.2832, rr = r / RINGS * RAD, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        pp.push(x, heightAt(x, z) + 0.07, z); uu.push(0.5 + Math.cos(a) * r / RINGS * 0.5, 0.5 + Math.sin(a) * r / RINGS * 0.5);
      }
      for (let k = 0; k < SEG; k++) ii.push(0, 1 + (k + 1) % SEG, 1 + k);
      for (let r = 1; r < RINGS; r++) for (let k = 0; k < SEG; k++) {
        const a = 1 + (r - 1) * SEG + k, b = 1 + (r - 1) * SEG + (k + 1) % SEG, c = a + SEG, d = b + SEG;
        ii.push(a, b, c, b, d, c);
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(uu, 2)); pg.setIndex(ii);
      const pool = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: gt, color: C('#ffe3a0'), transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      pool.renderOrder = 2; scene.add(pool);
    }
    const wp = new THREE.Vector3();
    updaters.push((dt, t, cam) => {
      const d = cam.position.distanceTo(wp.set(0, y0 + 1, 0));
      const s = Math.max(3.4, d * 0.075); glow.scale.set(s, s, 1);
      glow.material.opacity = 0.42 + 0.06 * Math.sin(t * 0.8) + 0.4 * smoothstep(30, 140, d);
      sm.uniforms.uK.value = 0.035 + 0.2 * smoothstep(25, 260, d);
    });
    scene.add(teacher);
    colliders.push({ x: 0, z: 0, r: 1.45 });
  }
  await step();

  // ---------- the crowd ----------
  const people = [];   // every figure's spot, used for grass gaps, shadows and walking collisions
  {
    const base = Math.atan2(DOWN.x, DOWN.y);
    const at = (r, phi) => [r * Math.sin(base + phi), r * Math.cos(base + phi)];
    const free = (x, z, min) => { for (const p of people) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < min * min) return false; } return true; };
    const put = (type, x, z, scale) => { people.push({ type, x, z, scale, yaw: Math.atan2(-x, -z) + (R() - 0.5) * 0.36, seated: type.startsWith('seat') }); };
    // the disciples, nearest to him
    for (let i = 0; i < 5; i++) { const [x, z] = at(3.3 + R() * 0.4, lerp(-0.95, 0.95, i / 4) + (R() - 0.5) * 0.1); put(R() < 0.7 ? 'seatA' : 'seatC', x, z, 1); }
    for (let i = 0; i < 7; i++) { const [x, z] = at(4.9 + R() * 0.5, lerp(-1.12, 1.12, i / 6) + (R() - 0.5) * 0.08); put(R() < 0.7 ? 'seatA' : 'seatC', x, z, 1); }
    // the multitude, fanned out down the slope
    let tries = 0;
    while (people.length < 300 && tries++ < 20000) {
      const r = 7.4 + 39 * Math.pow(R(), 0.8), phi = (R() * 2 - 1) * 1.85;
      const keep = (1 - smoothstep(26, 47, r) * 0.8) * (1 - smoothstep(1.0, 1.85, Math.abs(phi)) * 0.85);
      if (R() > keep) continue;
      const [x, z] = at(r, phi);
      if (!free(x, z, 0.94)) continue;
      const pSeat = r < 20 ? 0.88 : r < 33 ? 0.62 : 0.3;
      let type;
      if (R() < pSeat) { const q = R(); type = q < 0.45 ? 'seatA' : q < 0.75 ? 'seatB' : 'seatC'; }
      else type = R() < 0.55 ? 'standA' : 'standB';
      put(type, x, z, 0.93 + R() * 0.14);
      if (R() < 0.1) { const a = R() * 6.28, cx = x + Math.cos(a) * 0.62, cz = z + Math.sin(a) * 0.62; if (free(cx, cz, 0.55)) put('child', cx, cz, 0.85 + R() * 0.3); }
    }
    const geos = crowdGeometries();
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = T;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aPart; attribute vec3 iRobe; attribute vec3 iSkin; attribute vec3 iOver; attribute vec3 iHair; attribute float iPhase; varying vec3 vPart;')
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          vPart = aPart < 0.5 ? iRobe : (aPart < 1.5 ? iSkin : (aPart < 2.5 ? iOver : iHair));
          float sw = sin(uTime*0.9 + iPhase)*0.011 + sin(uTime*0.37 + iPhase*2.3)*0.009;
          transformed.x += sw * transformed.y;
          transformed.z += cos(uTime*0.6 + iPhase*1.7)*0.008 * transformed.y;
          transformed.y *= 1.0 + sin(uTime*1.4 + iPhase*3.1)*0.006;`);
      const before = s.fragmentShader;
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPart;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPart, opacity );');
      if (s.fragmentShader.indexOf('vec4( vPart, opacity )') < 0 || before === s.fragmentShader) console.error('figure shader hook did not apply');
    };
    mat.customProgramCacheKey = () => 'figure';
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    for (const type of Object.keys(geos)) {
      const list = people.filter((p) => p.type === type); if (!list.length) continue;
      const g = geos[type], n = list.length;
      const robe = new Float32Array(n * 3), skin = new Float32Array(n * 3), over = new Float32Array(n * 3), hair = new Float32Array(n * 3), phase = new Float32Array(n);
      const mesh = new THREE.InstancedMesh(g, mat, n);
      list.forEach((p, i) => {
        p.y = heightAt(p.x, p.z) - 0.02;
        q.setFromAxisAngle(up, p.yaw); m4.compose(v.set(p.x, p.y, p.z), q, sc.setScalar(p.scale)); mesh.setMatrixAt(i, m4);
        const r = pick(PAL.robes).clone().offsetHSL(0, (R() - 0.5) * 0.06, (R() - 0.5) * 0.08);
        let o = pick(PAL.mantles); if (R() < 0.3) o = r.clone().offsetHSL(0, 0, -0.07);
        robe.set([r.r, r.g, r.b], i * 3); const s = pick(PAL.skins); skin.set([s.r, s.g, s.b], i * 3);
        over.set([o.r, o.g, o.b], i * 3); const h = pick(PAL.hairs); hair.set([h.r, h.g, h.b], i * 3);
        phase[i] = R() * 6.283;
      });
      g.setAttribute('iRobe', new THREE.InstancedBufferAttribute(robe, 3)); g.setAttribute('iSkin', new THREE.InstancedBufferAttribute(skin, 3));
      g.setAttribute('iOver', new THREE.InstancedBufferAttribute(over, 3)); g.setAttribute('iHair', new THREE.InstancedBufferAttribute(hair, 3));
      g.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phase, 1));
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; scene.add(mesh);
    }
    for (const p of people) colliders.push({ x: p.x, z: p.z, r: p.seated ? 0.5 : 0.36 });
  }
  await step();

  // quick lookup: is there a person near this spot?
  const cell = 2, grid = new Map();
  for (const p of people) { const k = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  const nearPerson = (x, z, d) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = grid.get((cx + i) + ',' + (cz + j)); if (l) for (const p of l) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < d * d) return true; } }
    return false;
  };

  // ---------- trees, rocks, village, boats ----------
  const blobs = [];   // soft ground shadows: [x, z, radius, stretch]
  for (const p of people) blobs.push([p.x, p.z, p.type === 'child' ? 0.3 : p.seated ? 0.52 : 0.4, p.seated ? 1.25 : 1.9]);
  blobs.push([0, -0.1, 1.0, 1.4]);
  {
    // olive and oak trees
    const mk = (trunkH, blobsN, spread, cols) => {
      const parts = []; const tr = new THREE.CylinderGeometry(0.16, 0.3, trunkH, 6).translate(0, trunkH / 2, 0);
      parts.push([tr, C('#6b5a48')]);
      for (let i = 0; i < blobsN; i++) {
        const a = i / blobsN * 6.283 + R(), rr = i === 0 ? 0 : spread * (0.55 + R() * 0.45), s = 0.95 + R() * 0.55;
        const b = new THREE.IcosahedronGeometry(s, 1).scale(1.05, 0.9, 1.05).translate(Math.cos(a) * rr, trunkH + 0.45 + (i === 0 ? 0.9 : R() * 0.7), Math.sin(a) * rr);
        parts.push([b, cols[i % cols.length]]);
      }
      const flat = (g) => (g.index ? g.toNonIndexed() : g);
      let n = 0; for (const [g] of parts) n += flat(g).attributes.position.count;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
      for (const [g0, c] of parts) { const g = flat(g0); pos.set(g.attributes.position.array, o * 3); for (let i = 0; i < g.attributes.position.count; i++) col.set([c.r, c.g, c.b], (o + i) * 3); o += g.attributes.position.count; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
      return g;
    };
    const kinds = [mk(1.25, 5, 1.0, [C('#84987a'), C('#748c6a'), C('#92a585')]), mk(1.7, 6, 1.35, [C('#557a44'), C('#628648'), C('#4b703c')]), mk(1.1, 4, 0.85, [C('#8b9c7c'), C('#7b9070')])];
    const lists = kinds.map(() => []);
    const base = Math.atan2(DOWN.x, DOWN.y);
    let tries = 0, count = 0;
    while (count < 150 && tries++ < 6000) {
      const r = 27 + 1500 * Math.pow(R(), 1.9), a = R() * 6.283, x = r * Math.sin(a), z = r * Math.cos(a);
      let phi = a - base; phi = Math.atan2(Math.sin(phi), Math.cos(phi));
      if (r < 78 && Math.abs(phi) < 2.15) continue;            // keep the listening area and the view to the lake open
      if (r < 260 && Math.abs(phi) < 0.5) continue;
      const h = heightAt(x, z); if (h < 3.5) continue;
      if (fbm2(x / 140 + 31, z / 140 + 17, 2) < 0.47) continue; // groves, not an even scatter
      const k = Math.floor(R() * kinds.length), s = 0.85 + R() * 0.75;
      lists[k].push([x, h - 0.1, z, s, R() * 6.283]); count++;
      blobs.push([x, z, 2.1 * s, 1.5]);
      if (r < 160) colliders.push({ x, z, r: 0.45 });
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    kinds.forEach((g, k) => {
      const mesh = new THREE.InstancedMesh(g, mat, lists[k].length);
      lists[k].forEach(([x, y, z, s, a], i) => { q.setFromAxisAngle(up, a); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)); mesh.setMatrixAt(i, m4); });
      mesh.frustumCulled = false; scene.add(mesh);
    });

    // scattered basalt rocks
    const rg = new THREE.IcosahedronGeometry(1, 1); const p = rg.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.5 * fbm2(p.getX(i) * 2.1 + 1, p.getY(i) * 2.1 + p.getZ(i) * 1.7, 2); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
    const rocks = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ flatShading: true }), 230);
    rocks.geometry.computeVertexNormals();
    const e = new THREE.Euler(), col = new THREE.Color(); let n = 0; tries = 0;
    while (n < 230 && tries++ < 5000) {
      const near = n < 4, r = near ? 1.5 + R() * 1.6 : 9 + 520 * Math.pow(R(), 1.6), a = R() * 6.283;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      if (near) { let phi = a - base; phi = Math.atan2(Math.sin(phi), Math.cos(phi)); if (Math.abs(phi) < 2.2) continue; }
      const h = heightAt(x, z); if (h < 0.2 || nearPerson(x, z, 1.1)) continue;
      const s = near ? 0.25 + R() * 0.3 : 0.15 + Math.pow(R(), 3) * (r < 90 ? 0.75 : 1.4);
      e.set(R() * 3, R() * 6, R() * 3); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, h + s * 0.12, z), q, new THREE.Vector3(s * (0.8 + R() * 0.6), s * (0.5 + R() * 0.4), s * (0.8 + R() * 0.6)));
      rocks.setMatrixAt(n, m4); rocks.setColorAt(n, col.set('#6e6a64').offsetHSL(0, 0, (R() - 0.5) * 0.12)); n++;
      if (s > 0.55 && r < 160) colliders.push({ x, z, r: s * 0.8 });
    }
    rocks.count = n; rocks.frustumCulled = false; scene.add(rocks);

    // a small lakeside village of dark stone houses, where Capernaum lies along the shore to the east
    const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), 46);
    let vx = 1500, vz = -535; { let best = 1e9; for (let dx = -300; dx <= 300; dx += 20) for (let dz = -300; dz <= 300; dz += 20) { const h = heightAt(1500 + dx, -535 + dz); const s = Math.abs(h - 5) + Math.hypot(dx, dz) * 0.01; if (s < best) { best = s; vx = 1500 + dx; vz = -535 + dz; } } }
    for (let i = 0; i < 46; i++) {
      const a = R() * 6.283, r = 95 * Math.sqrt(R()), x = vx + Math.cos(a) * r * 1.5, z = vz + Math.sin(a) * r * 0.8, h = Math.max(1.2, heightAt(x, z));
      q.setFromAxisAngle(up, 0.3 + (R() - 0.5) * 0.3);
      m4.compose(new THREE.Vector3(x, h - 0.5, z), q, new THREE.Vector3(6 + R() * 6, 3.2 + R() * 1.6, 5 + R() * 5));
      houses.setMatrixAt(i, m4); houses.setColorAt(i, col.set(R() < 0.25 ? '#8f887c' : '#5e5a55').offsetHSL(0, 0, (R() - 0.5) * 0.08));
    }
    houses.frustumCulled = false; scene.add(houses);

    // fishing boats on the lake
    const boatMat = new THREE.MeshLambertMaterial({ color: C('#6a4e36') }), sailMat = new THREE.MeshLambertMaterial({ color: C('#efe6cf'), side: THREE.DoubleSide });
    const hullG = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5).scale(1.2, 0.9, 4.1);
    const mastG = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6).translate(0, 2.6, 0.3);
    const sailG = new THREE.PlaneGeometry(3.6, 3.4, 4, 1); { const sp = sailG.attributes.position; for (let i = 0; i < sp.count; i++) sp.setZ(i, 0.45 * Math.cos(sp.getX(i) / 1.8 * 1.4)); sailG.computeVertexNormals(); sailG.translate(0, 3.1, 0.5); }
    const boats = [];
    for (const [fd, fs, head] of [[690, -120, 0.6], [900, 260, 2.2], [1250, -420, 1.1], [1700, 380, 4.0]]) {
      const b = new THREE.Group(); b.add(new THREE.Mesh(hullG, boatMat), new THREE.Mesh(mastG, boatMat), new THREE.Mesh(sailG, sailMat));
      let x = DOWN.x * fd + SIDE.x * fs, z = DOWN.y * fd + SIDE.y * fs;
      for (let k = 0; k < 40 && heightAt(x, z) > -2.5; k++) { x += DOWN.x * 40; z += DOWN.y * 40; }
      b.position.set(x, 0.15, z); b.rotation.y = head; scene.add(b); boats.push([b, R() * 6]);
    }
    updaters.push((dt, t) => { for (const [b, ph] of boats) { b.position.y = 0.15 + Math.sin(t * 0.9 + ph) * 0.07; b.rotation.z = Math.sin(t * 0.7 + ph) * 0.035; b.rotation.x = Math.sin(t * 0.5 + ph * 2) * 0.02; } });
  }
  await step();

  // ---------- soft shadows under people and trees ----------
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: C('#16240f'), transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), blobs.length);
    const away = new THREE.Vector3(-SUN_DIR.x, 0, -SUN_DIR.z).normalize();
    const n = new THREE.Vector3(), ax = new THREE.Vector3(), az = new THREE.Vector3(), m4 = new THREE.Matrix4();
    blobs.forEach(([x, z, r, stretch], i) => {
      const cx2 = x + away.x * r * (stretch - 0.75), cz2 = z + away.z * r * (stretch - 0.75);
      normalAt(cx2, cz2, n); ax.copy(away).addScaledVector(n, -away.dot(n)).normalize(); az.crossVectors(ax, n);
      m4.makeBasis(ax.clone().multiplyScalar(r * stretch), n.clone(), az.clone().multiplyScalar(r));
      m4.setPosition(cx2, heightAt(cx2, cz2) + 0.05, cz2); mesh.setMatrixAt(i, m4);
    });
    mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
  }

  // ---------- grass tufts that sway ----------
  {
    const blades = 5, pos = new Float32Array(blades * 9), aH = new Float32Array(blades * 3);
    for (let b = 0; b < blades; b++) {
      const a = b / blades * 6.283 + R() * 0.8, off = 0.04 + R() * 0.11, h = 0.34 + R() * 0.3, w = 0.035 + R() * 0.02;
      const bx = Math.cos(a) * off, bz = Math.sin(a) * off, px = -Math.sin(a) * w, pz = Math.cos(a) * w, lean = 0.1 + R() * 0.16;
      pos.set([bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean], b * 9); aH.set([0, 0, 1], b * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
    const m = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: T, uLight: { value: groundLight }, ...fogU },
      vertexShader: /* glsl */`
        uniform float uTime, uFogD; attribute float aH; varying vec3 vC; varying float vFog; varying vec2 vXZ;
        ${GLSL_NOISE2}
        void main(){
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float ph = wp.x*0.21 + wp.z*0.17;
          float w = sin(uTime*1.7 + ph)*0.05 + sin(uTime*0.63 + ph*0.37)*0.08;
          float gust = smoothstep(0.55, 0.9, vnoise2(wp.xz*0.012 - vec2(uTime*0.12, uTime*0.07)));
          wp.x += (w + gust*0.16)*aH; wp.z += (w*0.6 + gust*0.09)*aH;
          vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
          vC = instanceColor * mix(0.66, 1.14, aH); vXZ = wp.xz;
          float d = length(mv.xyz); vFog = 1.0 - exp(-uFogD*uFogD*d*d);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uLight, uFogC; varying vec3 vC; varying float vFog; varying vec2 vXZ;
        ${CLOUD_SHADE}
        void main(){
          vec3 col = vC * uLight * cloudShade(vXZ, uTime);
          gl_FragColor = vec4(mix(col, uFogC, vFog), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const MAX = 16000, mesh = new THREE.InstancedMesh(g, m, MAX);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    let n = 0, tries = 0;
    while (n < MAX && tries++ < MAX * 4) {
      const r = 100 * Math.sqrt(R()), a = R() * 6.283, x = r * Math.cos(a), z = r * Math.sin(a);
      if (R() < smoothstep(38, 100, r) * 0.92) continue;
      if (r < 1.5 || nearPerson(x, z, 0.5)) continue;
      const s = 0.6 + R() * 0.55;
      q.setFromAxisAngle(up, R() * 6.283); m4.compose(new THREE.Vector3(x, heightAt(x, z) - 0.02, z), q, new THREE.Vector3(s * 1.15, s * (0.75 + R() * 0.45), s * 1.15));
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, col.copy(PAL.grassA).lerp(PAL.grassB, R()).lerp(PAL.dry, R() * R() * 0.5)); n++;
    }
    mesh.count = n; mesh.frustumCulled = false; scene.add(mesh);
    quality.push((lite) => { mesh.count = lite ? Math.floor(n * 0.4) : n; });
  }
  await step();

  // ---------- wildflowers ----------
  const flowerU = { uPx: { value: 600 }, uLight: { value: groundLight }, ...fogU };
  {
    const cols = ['#d8342c', '#d8342c', '#f1c93b', '#f5f1e6', '#8d6bc4', '#e59ab0'].map(C);
    const N = 5200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3); let n = 0;
    for (let p = 0; p < 60 && n < N; p++) {
      const pr = 8 + 110 * Math.sqrt(R()), pa = R() * 6.283, px = pr * Math.cos(pa), pz = pr * Math.sin(pa), c = cols[Math.floor(R() * cols.length)], spread = 3 + R() * 7;
      const cnt = 50 + Math.floor(R() * 110);
      for (let i = 0; i < cnt && n < N; i++) {
        const r = spread * Math.sqrt(-2 * Math.log(1 - R() * 0.98)) * 0.6, a = R() * 6.283, x = px + r * Math.cos(a), z = pz + r * Math.sin(a);
        if (nearPerson(x, z, 0.45) || x * x + z * z < 3) continue;
        pos.set([x, heightAt(x, z) + 0.2 + R() * 0.22, z], n * 3); col.set([c.r, c.g, c.b], n * 3); n++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, n * 3), 3));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: flowerU,
      vertexShader: /* glsl */`
        uniform float uPx, uFogD; attribute vec3 color; varying vec3 vC; varying float vFog;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz); float px = uPx * 0.12 / d; gl_PointSize = min(px, 64.0); if (px < 1.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = color; vFog = 1.0 - exp(-uFogD*uFogD*d*d); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLight, uFogC; varying vec3 vC; varying float vFog;
        void main(){ vec2 p = gl_PointCoord - 0.5; float r = dot(p, p); if (r > 0.25) discard;
          vec3 col = vC * uLight * (1.0 - r*1.6); gl_FragColor = vec4(mix(col, uFogC, vFog), 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    pts.frustumCulled = false; scene.add(pts);
  }

  // ---------- drifting clouds ----------
  {
    const puffs = [], clouds = [];
    for (let c = 0; c < 34; c++) {
      const cloud = { x: (R() - 0.5) * 14000, y: 400 + R() * 380, z: (R() - 0.5) * 14000 + 2500, s: 1.1 + R() * 1.7, parts: [] };
      const n = 4 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) cloud.parts.push([(R() - 0.5) * 300, (R() - 0.3) * 40, (R() - 0.5) * 150, 55 + R() * 70]);
      clouds.push(cloud); puffs.push(...cloud.parts);
    }
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ color: C('#ffffff'), emissive: C('#c9d6e6'), emissiveIntensity: 0.55 }), puffs.length);   // 34 clouds
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const place = () => { let i = 0; for (const c of clouds) for (const [px, py, pz, r] of c.parts) { m4.compose(v.set(c.x + px * c.s, c.y + py * c.s, c.z + pz * c.s), q, s.set(r * c.s, r * c.s * 0.55, r * c.s * 0.85)); mesh.setMatrixAt(i++, m4); } mesh.instanceMatrix.needsUpdate = true; };
    place(); mesh.frustumCulled = false; scene.add(mesh);
    // a few clouds are parked beside the arrival path so you drop past them on the way in
    arrivalHooks.push(() => { [[-230, 760, 90, 1.5], [260, 640, -120, 1.3], [40, 560, 300, 1.2], [-300, 520, -260, 1.6], [380, 820, 240, 1.7]].forEach(([x, y, z, s], i) => { const c = clouds[i]; c.x = DOWN.x * 60 + x; c.y = y0 + y; c.z = DOWN.y * 60 + z; c.s = s; }); place(); });
    updaters.push((dt) => { for (const c of clouds) { c.x += dt * 9; c.z += dt * 3; if (c.x > 7000) c.x -= 14000; if (c.z > 9500) c.z -= 14000; } place(); });
  }

  // ---------- birds ----------
  {
    const birds = [];
    const mat = new THREE.MeshBasicMaterial({ color: C('#2e2a28'), side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m);
      const flock = i < 5 ? 0 : 1;
      birds.push({ m, g, ph: R() * 6.28, rad: (flock ? 150 : 70) + R() * 40, cx: flock ? DOWN.x * 330 : -40 + R() * 30, cz: flock ? DOWN.y * 330 : 30, h: (flock ? 34 : 58) + R() * 16, sp: (0.11 + R() * 0.05) * (flock ? 1 : -1), off: i * 0.5 });
    }
    updaters.push((dt, t) => {
      for (const b of birds) {
        const a = t * b.sp + b.off, x = b.cx + Math.cos(a) * b.rad, z = b.cz + Math.sin(a) * b.rad * 0.7;
        const y = Math.max(heightAt(x, z), 0) + b.h + Math.sin(t * 0.3 + b.ph) * 5;
        b.m.position.set(x, y, z); b.m.rotation.y = -a - (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI / 2;
        const f = Math.sin(t * 7 + b.ph) * 0.45, p = b.g.attributes.position.array, w = 0.75;
        // two wings hinged along the body
        p.set([0, 0, 0.28, 0, 0, -0.28, -w, f, -0.05, 0, 0, 0.28, 0, 0, -0.28, w, f, -0.05]); b.g.attributes.position.needsUpdate = true;
      }
    });
  }
  await step();

  // ---------- viewpoints ----------
  const look = (px, py, pz, tx, ty, tz) => ({ pos: new THREE.Vector3(px, py, pz), yaw: Math.atan2(-(tx - px), -(tz - pz)), pitch: Math.atan2(ty - py, Math.hypot(tx - px, tz - pz)) });
  const ex = -DOWN.x * 4.5 - SIDE.x * 12, ez = -DOWN.y * 4.5 - SIDE.y * 12;
  const wx = DOWN.x * 33 + SIDE.x * 17, wz = DOWN.y * 33 + SIDE.y * 17;
  const views = {
    establish: look(ex, heightAt(ex, ez) + 3.6, ez, DOWN.x * 8, y0 + 0.1, DOWN.y * 8),
    establishTall: look(ex * 1.25, heightAt(ex * 1.25, ez * 1.25) + 3.4, ez * 1.25, DOWN.x * 1.5, y0 + 0.4, DOWN.y * 1.5),   // for upright phones: aim straight at the teacher
    overhead: { pos: new THREE.Vector3(DOWN.x * 20, y0 + 56, DOWN.y * 20), yaw: 0, pitch: -89 * DEG },
    arrive: { pos: new THREE.Vector3(DOWN.x * 60, y0 + 980, DOWN.y * 60), yaw: 0, pitch: -89.5 * DEG },
    walk: look(wx, heightAt(wx, wz) + 1.62, wz, 0, y0 + 1.1, 0),
  };

  return {
    scene, heightAt, colliders, views,
    focus: new THREE.Vector3(0, y0 + 1.1, 0),
    walk: { radius: 128, eye: 1.62, minHeight: 0.6 },
    fly: { radius: 3800, ceiling: 1000 },
    stats: { people: people.length + 1 },
    setLite(lite) { for (const q of quality) q(lite); },
    onArrive() { for (const h of arrivalHooks) h(); },
    resize(hPx, fovDeg) { flowerU.uPx.value = hPx * 0.5 / Math.tan(fovDeg * DEG / 2); },
    update(dt, t, cam) { T.value = t; sky.position.copy(cam.position); for (const u of updaters) u(dt, t, cam); },
  };
}
