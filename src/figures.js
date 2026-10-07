// Builds the simple faceless people: smooth heads, robe shapes, ball-joint style limbs.
// Each body is assembled from basic shapes (balls, tubes) in code. No model files.
import * as THREE from 'three';

// part numbers: 0 = robe, 1 = skin, 2 = mantle or head covering, 3 = hair
const ROBE = 0, SKIN = 1, OVER = 2, HAIR = 3;
const UP = new THREE.Vector3(0, 1, 0);

class Builder {
  constructor() { this.parts = []; }
  add(geom, part, pos, rot, scale) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(pos || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))),
      new THREE.Vector3(...(scale || [1, 1, 1])),
    );
    geom.applyMatrix4(m); this.parts.push([geom, part]); return this;
  }
  ball(part, pos, r, scale, seg = 8) { return this.add(new THREE.SphereGeometry(r, seg, Math.max(3, Math.round(seg * 0.6))), part, pos, null, scale); }
  // a tube between two points (arms, legs)
  limb(part, a, b, r0, r1 = r0) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, L, 6, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    this.parts.push([g, part]);
    this.parts.push([new THREE.SphereGeometry(r0 * 1.04, 6, 3).translate(A.x, A.y, A.z), part]);   // the ball joint
    return this;
  }
  // head with optional hair or head covering
  head(y, z, r, cover, longHair) {
    this.ball(SKIN, [0, y, z], r, null, 10);
    this.add(new THREE.CylinderGeometry(r * 0.42, r * 0.5, r * 0.9, 6, 1, true), SKIN, [0, y - r * 1.2, z * 0.8]);
    if (cover) {
      this.add(new THREE.SphereGeometry(r * 1.14, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.6), OVER, [0, y + r * 0.04, z - r * 0.06], [-0.35, 0, 0]);
      this.add(new THREE.CylinderGeometry(r * 1.1, r * 1.75, r * 2.5, 9, 1, true, Math.PI * 0.42, Math.PI * 1.16), OVER, [0, y - r * 1.25, z - r * 0.1]);
    } else {
      this.add(new THREE.SphereGeometry(r * 1.07, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), HAIR, [0, y + r * 0.03, z - r * 0.06], [-0.6, 0, 0]);
      if (longHair) this.add(new THREE.CylinderGeometry(r * 1.02, r * 1.12, r * 1.5, 9, 1, true, Math.PI * 0.5, Math.PI), HAIR, [0, y - r * 0.75, z - r * 0.08]);
    }
    return this;
  }
  build(colors) {
    let n = 0;
    const flat = this.parts.map(([g, p]) => { const f = g.index ? g.toNonIndexed() : g; n += f.attributes.position.count; return [f, p]; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), part = new Float32Array(n);
    const col = colors ? new Float32Array(n * 3) : null;
    let o = 0;
    for (const [g, p] of flat) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      const c = g.attributes.position.count;
      for (let i = 0; i < c; i++) { part[o + i] = p; if (col) { const k = colors[p]; col[(o + i) * 3] = k.r; col[(o + i) * 3 + 1] = k.g; col[(o + i) * 3 + 2] = k.b; } }
      o += c; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
}

// All figures face +Z (toward the camera in a default view) with feet at y = 0.
function standing({ k = 1, headK = 1, cover = false, folded = false, mantle = true } = {}) {
  const b = new Builder(), s = (v) => v * k;
  b.add(new THREE.CylinderGeometry(s(0.15), s(0.27), s(1.24), 9, 1), ROBE, [0, s(0.7), 0], null, [1, 1, 0.8]);
  if (!mantle) b.ball(ROBE, [0, s(1.3), 0], s(0.2), [1.14, 0.5, 0.8], 9);
  if (mantle) {
    b.add(new THREE.CylinderGeometry(s(0.175), s(0.24), s(0.66), 10, 1, true, 0.5, Math.PI * 1.55), OVER, [0, s(1.0), 0], null, [1, 1, 0.84]);
    b.ball(OVER, [0, s(1.31), 0], s(0.21), [1.16, 0.5, 0.84], 9);
  }
  b.head(s(1.3) + 0.115 * k * headK * 2.05, 0, 0.112 * k * headK, cover);
  for (const sx of [-1, 1]) {
    const sh = [sx * s(0.235), s(1.27), 0];
    if (folded) {
      const el = [sx * s(0.27), s(0.98), s(0.04)], hd = [sx * s(0.06), s(0.98), s(0.2)];
      b.limb(ROBE, sh, el, s(0.058), s(0.052)); b.limb(ROBE, el, hd, s(0.052), s(0.046)); b.ball(SKIN, hd, s(0.046), null, 5);
    } else {
      const hd = [sx * s(0.28), s(0.8), s(0.04)];
      b.limb(ROBE, sh, hd, s(0.058), s(0.048)); b.ball(SKIN, [hd[0], hd[1] - s(0.04), hd[2]], s(0.046), null, 5);
    }
    b.ball(SKIN, [sx * s(0.09), s(0.035), s(0.1)], s(0.06), [1, 0.6, 1.9], 5);
  }
  return b.build();
}

function seatedCross({ cover = false } = {}) {
  const b = new Builder();
  b.ball(ROBE, [0, 0.13, 0.1], 0.3, [1.2, 0.45, 1.05], 10);
  b.add(new THREE.CylinderGeometry(0.15, 0.21, 0.52, 9, 1), ROBE, [0, 0.43, 0.01], [0.1, 0, 0], [1, 1, 0.82]);
  b.ball(OVER, [0, 0.69, 0.035], 0.205, [1.15, 0.5, 0.84], 9);
  b.add(new THREE.CylinderGeometry(0.17, 0.225, 0.4, 10, 1, true, 0.6, Math.PI * 1.5), OVER, [0, 0.5, 0.02], [0.1, 0, 0], [1, 1, 0.86]);
  b.head(0.915, 0.06, 0.112, cover);
  for (const sx of [-1, 1]) {
    const sh = [sx * 0.225, 0.65, 0.04], el = [sx * 0.29, 0.4, 0.12], hd = [sx * 0.22, 0.27, 0.34];
    b.limb(ROBE, sh, el, 0.056, 0.05); b.limb(ROBE, el, hd, 0.05, 0.044); b.ball(SKIN, hd, 0.046, null, 5);
    b.ball(ROBE, [sx * 0.29, 0.15, 0.26], 0.12, [1, 0.85, 1], 6);
  }
  return b.build();
}

function seatedKnees() {
  const b = new Builder();
  b.ball(ROBE, [0, 0.12, -0.02], 0.27, [1.05, 0.45, 0.9], 9);
  b.add(new THREE.CylinderGeometry(0.15, 0.2, 0.5, 9, 1), ROBE, [0, 0.4, -0.02], [0.2, 0, 0], [1, 1, 0.82]);
  b.ball(OVER, [0, 0.65, 0.035], 0.205, [1.15, 0.5, 0.84], 9);
  b.head(0.875, 0.09, 0.112, false);
  for (const sx of [-1, 1]) {
    const hip = [sx * 0.11, 0.16, 0.06], knee = [sx * 0.13, 0.44, 0.34], foot = [sx * 0.13, 0.07, 0.52];
    b.limb(ROBE, hip, knee, 0.1, 0.085); b.limb(ROBE, knee, foot, 0.085, 0.07);
    b.ball(SKIN, [foot[0], 0.035, 0.58], 0.055, [1, 0.6, 1.8], 5);
    const sh = [sx * 0.225, 0.61, 0.05], el = [sx * 0.27, 0.42, 0.24], hd = [sx * 0.05, 0.4, 0.42];
    b.limb(ROBE, sh, el, 0.056, 0.05); b.limb(ROBE, el, hd, 0.05, 0.044); b.ball(SKIN, hd, 0.046, null, 5);
  }
  return b.build();
}

export function crowdGeometries() {
  return {
    standA: standing({}),
    standB: standing({ cover: true, folded: true }),
    seatA: seatedCross({}),
    seatB: seatedCross({ cover: true }),
    seatC: seatedKnees(),
    child: standing({ k: 0.64, headK: 1.22, mantle: false }),
  };
}

// The seated teacher. Built separately so he can carry his own colours and a gentle gesture.
// Returns the body and the raised right arm as two pieces. Seat height is 0.5 m.
export function teacherGeometries(colors) {
  const b = new Builder();
  // legs under the robe: thighs forward along the seat, shins down to the ground
  for (const sx of [-1, 1]) {
    const hip = [sx * 0.1, 0.57, 0.0], knee = [sx * 0.125, 0.55, 0.36], ankle = [sx * 0.115, 0.1, 0.44];
    b.limb(ROBE, hip, knee, 0.115, 0.1); b.limb(ROBE, knee, ankle, 0.1, 0.08);
    b.ball(SKIN, [sx * 0.115, 0.04, 0.5], 0.06, [1, 0.6, 1.9], 6);
  }
  b.ball(ROBE, [0, 0.56, 0.16], 0.2, [1.1, 0.5, 1.15], 10);                                                    // cloth across the lap
  b.add(new THREE.CylinderGeometry(0.2, 0.25, 0.46, 12, 1), ROBE, [0, 0.3, 0.4], [-0.1, 0, 0], [1, 1, 0.42]);   // cloth hanging between the knees
  b.add(new THREE.CylinderGeometry(0.155, 0.2, 0.62, 12, 1), ROBE, [0, 0.88, 0], [0.03, 0, 0], [1, 1, 0.82]);   // torso
  b.ball(ROBE, [0, 1.17, 0.01], 0.205, [1.14, 0.5, 0.8], 12);                                                   // shoulders
  // mantle: over the left shoulder and across the body to the right hip
  b.ball(OVER, [0.13, 1.185, 0.01], 0.15, [1.05, 0.55, 1.05], 9);
  b.limb(OVER, [0.17, 1.15, 0.1], [-0.15, 0.68, 0.15], 0.085, 0.095);
  b.limb(OVER, [0.17, 1.15, -0.1], [-0.15, 0.68, -0.13], 0.085, 0.095);
  b.limb(OVER, [-0.16, 0.66, -0.12], [-0.17, 0.62, 0.2], 0.095, 0.09);
  b.head(1.405, 0.02, 0.115, false, true);
  // left arm resting on the lap
  { const sh = [0.235, 1.13, 0.01], el = [0.29, 0.86, 0.1], hd = [0.17, 0.7, 0.33];
    b.limb(ROBE, sh, el, 0.058, 0.052); b.limb(ROBE, el, hd, 0.052, 0.046); b.ball(SKIN, hd, 0.048, null, 7); }
  const body = b.build(colors);

  // right arm, modelled around its shoulder so it can swing gently
  const a = new Builder();
  { const sh = [0, 0, 0], el = [-0.07, -0.25, 0.14], hd = [-0.05, -0.08, 0.42];
    a.limb(ROBE, sh, el, 0.058, 0.052); a.limb(ROBE, el, hd, 0.052, 0.046);
    a.ball(SKIN, hd, 0.048, [0.75, 1.15, 1], 7); }
  const arm = a.build(colors);
  return { body, arm, shoulder: [-0.235, 1.13, 0.01] };
}
