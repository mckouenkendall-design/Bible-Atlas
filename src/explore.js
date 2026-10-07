// Moving around inside a scene: a free flying camera and a first-person walk.
// Any future scene can reuse this. A scene only has to supply heightAt(), colliders and viewpoints.
import * as THREE from 'three';
import { clamp, lerp, easeInOut, DEG } from './util.js';

export function createExplorer(camera) {
  const st = {
    mode: 'fly', pos: new THREE.Vector3(), yaw: 0, pitch: 0, tween: null, world: null,
    vel: new THREE.Vector3(), grid: null,
  };
  // what the player is asking for this frame (filled in by main.js from touch, keys and mouse)
  const input = { mx: 0, my: 0, up: 0, fast: false, lookX: 0, lookY: 0, dolly: 0 };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3();

  function setWorld(world) {
    st.world = world; st.grid = new Map();
    for (const c of world.colliders) {
      const k = Math.floor(c.x / 3) + ',' + Math.floor(c.z / 3);
      (st.grid.get(k) || st.grid.set(k, []).get(k)).push(c);
    }
  }
  const ground = (x, z) => Math.max(st.world.heightAt(x, z), 0);

  function snap(view) { st.pos.copy(view.pos); st.yaw = view.yaw; st.pitch = view.pitch; st.vel.set(0, 0, 0); st.tween = null; apply(); }
  // Glide smoothly to a viewpoint. lookDelay holds the old viewing angle for the first part of the move.
  function goTo(view, T = 1.6, { lookDelay = 0, onDone } = {}) {
    let dy = view.yaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.tween = { t: 0, T, p0: st.pos.clone(), p1: view.pos.clone(), y0: st.yaw, y1: st.yaw + dy, a0: st.pitch, a1: view.pitch, lookDelay, onDone };
    st.vel.set(0, 0, 0);
  }

  // keep the walker from passing through people, trees and rocks
  function collide(p) {
    const cx = Math.floor(p.x / 3), cz = Math.floor(p.z / 3);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = st.grid.get((cx + i) + ',' + (cz + j)); if (!l) continue;
      for (const c of l) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + 0.28;
        if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; }
      }
    }
  }
  function clampWalk(p) {
    const w = st.world.walk, r = Math.hypot(p.x, p.z);
    if (r > w.radius) { p.x *= w.radius / r; p.z *= w.radius / r; }
  }

  function setMode(mode) {
    if (mode === st.mode || !st.world) return;
    const w = st.world;
    if (mode === 'walk') {
      const p = st.pos.clone(); clampWalk(p); collide(p); collide(p);
      p.y = w.heightAt(p.x, p.z) + w.walk.eye;
      const far = st.pos.distanceTo(p);
      // if we were high up, turn to face the teacher as we land so the walk starts oriented
      let yaw = st.yaw, pitch = clamp(st.pitch, -0.3, 0.25);
      if (far > 25) { yaw = Math.atan2(-(w.focus.x - p.x), -(w.focus.z - p.z)); pitch = 0; }
      st.mode = 'walk';
      goTo({ pos: p, yaw, pitch }, clamp(far / 55, 0.8, 2.6));
    } else {
      st.mode = 'fly';
      const p = st.pos.clone(); p.y += 4;
      p.x += Math.sin(st.yaw) * 5; p.z += Math.cos(st.yaw) * 5;
      goTo({ pos: p, yaw: st.yaw, pitch: Math.min(st.pitch, -0.12) }, 0.9);
    }
  }

  function apply() {
    camera.position.copy(st.pos);
    camera.rotation.set(st.pitch, st.yaw, 0, 'YXZ');
    if (st.world) {
      const h = st.pos.y - ground(st.pos.x, st.pos.z);
      const near = clamp(h * 0.15, 0.22, 25);
      if (Math.abs(near - camera.near) > camera.near * 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
    }
    camera.updateMatrixWorld();
  }

  function update(dt) {
    if (!st.world) return;
    const w = st.world;
    if (st.tween) {
      const tw = st.tween; tw.t += dt;
      const p = clamp(tw.t / tw.T, 0, 1), e = easeInOut(p), l = easeInOut(clamp((p - tw.lookDelay) / (1 - tw.lookDelay), 0, 1));
      st.pos.lerpVectors(tw.p0, tw.p1, e);
      st.yaw = lerp(tw.y0, tw.y1, l); st.pitch = lerp(tw.a0, tw.a1, l);
      if (p >= 1) { st.tween = null; st.yaw = Math.atan2(Math.sin(st.yaw), Math.cos(st.yaw)); tw.onDone && tw.onDone(); }
      input.lookX = input.lookY = input.dolly = 0;
      apply(); return;
    }
    st.yaw -= input.lookX; st.pitch = clamp(st.pitch - input.lookY, -89.5 * DEG, 80 * DEG);
    input.lookX = input.lookY = 0;
    fwd.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)); right.set(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
    let mx = input.mx, my = input.my; const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }

    if (st.mode === 'fly') {
      const h = st.pos.y - ground(st.pos.x, st.pos.z);
      const speed = clamp(7 + h * 0.85, 7, 230) * (input.fast ? 2.2 : 1);
      want.set(0, 0, 0).addScaledVector(fwd, my * speed).addScaledVector(right, mx * speed);
      want.y = input.up * speed * 0.75;
      st.vel.lerp(want, 1 - Math.exp(-7 * dt));
      st.pos.addScaledVector(st.vel, dt);
      if (input.dolly) { // mouse wheel: move along the direction you are looking
        const cp = Math.cos(st.pitch);
        st.pos.x += -Math.sin(st.yaw) * cp * input.dolly; st.pos.z += -Math.cos(st.yaw) * cp * input.dolly; st.pos.y += Math.sin(st.pitch) * input.dolly;
        input.dolly = 0;
      }
      const r = Math.hypot(st.pos.x, st.pos.z); if (r > w.fly.radius) { st.pos.x *= w.fly.radius / r; st.pos.z *= w.fly.radius / r; }
      st.pos.y = clamp(st.pos.y, ground(st.pos.x, st.pos.z) + 1.3, w.fly.ceiling);
    } else {
      const speed = input.fast ? 5.2 : 2.9;
      want.set(0, 0, 0).addScaledVector(fwd, my * speed).addScaledVector(right, mx * speed);
      st.vel.lerp(want, 1 - Math.exp(-10 * dt));
      const px = st.pos.x, pz = st.pos.z;
      st.pos.x += st.vel.x * dt; st.pos.z += st.vel.z * dt;
      collide(st.pos); clampWalk(st.pos);
      if (w.heightAt(st.pos.x, st.pos.z) < w.walk.minHeight) { st.pos.x = px; st.pos.z = pz; st.vel.set(0, 0, 0); } // do not wade into the lake
      const bob = Math.sin(performance.now() * 0.011) * 0.025 * Math.min(1, Math.hypot(st.vel.x, st.vel.z) / 2.5);
      st.pos.y = lerp(st.pos.y, w.heightAt(st.pos.x, st.pos.z) + w.walk.eye + bob, 1 - Math.exp(-14 * dt));
      input.dolly = 0;
    }
    apply();
  }

  return { st, input, setWorld, snap, goTo, setMode, update, apply };
}
