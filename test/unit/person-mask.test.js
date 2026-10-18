// The cut-out logic: pose silhouette + motion + persistence. Tiny synthetic scenes (a bright
// rectangle = "a kid" in front of a flat grey room) let us state exactly what should happen when
// pose tracking works, glitches, or is lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonMask, downsampleMaxInto } from '../../src/person-mask.js';

const W = 48;
const H = 36;
const ROOM = 90;
const KID = 200;

const rect = (x, y, w, h) => ({ x, y, w, h });
const inRect = (r, i, j) => r && i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h;

function grayOf(rects, { room = ROOM, shift = 0 } = {}) {
  const g = new Uint8Array(W * H).fill(Math.max(0, Math.min(255, room + shift)));
  for (const r of rects) if (r) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (inRect(r, i, j)) g[j * W + i] = KID;
  return g;
}
function poseOf(r) {
  if (!r) return null;
  const m = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (inRect(r, i, j)) m[j * W + i] = 1;
  return m;
}
// mean opacity (0..255) inside / outside a rectangle
const inside = (pm, r) => {
  let s = 0;
  let n = 0;
  for (let j = r.y + 1; j < r.y + r.h - 1; j++) for (let i = r.x + 1; i < r.x + r.w - 1; i++, n++) s += pm.alpha[j * W + i];
  return s / n;
};
const outsideMax = (pm, r, margin = 4) => {
  let m = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!inRect({ x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin }, i, j)) m = Math.max(m, pm.alpha[j * W + i]);
  return m;
};

// Advance the mask for `seconds`. kid(t) / pose(t) give the kid rectangle and pose-model rectangle (or null).
function run(pm, seconds, { fps = 30, t0 = 0, kid = () => null, pose = () => null, grayOpts = {} } = {}) {
  const dt = 1 / fps;
  const steps = Math.round(seconds * fps);
  for (let k = 0; k < steps; k++) {
    const t = t0 + (k + 1) * dt;
    const kr = kid(t);
    const p = pose(t);
    pm.update(grayOf(kr ? (Array.isArray(kr) ? kr : [kr]) : [], grayOpts), p instanceof Float32Array ? p : poseOf(p), dt);
  }
  return t0 + steps * dt;
}
// An empty room for a second so the background model has learned it.
const learned = (opts) => {
  const pm = new PersonMask(W, H, opts);
  const t = run(pm, 1.2);
  return { pm, t };
};
const KID_AT = rect(18, 8, 10, 22);

// ---- basics ---------------------------------------------------------------------------------------
test('an empty room produces no cut-out', () => {
  const { pm } = learned();
  run(pm, 3);
  assert.equal(Math.max(...pm.alpha), 0);
});

test('a kid found by the pose model appears almost at once, and only where the kid is', () => {
  const { pm, t } = learned();
  run(pm, 0.2, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  assert.ok(inside(pm, KID_AT) > 240, `inside ${inside(pm, KID_AT)}`);
  assert.ok(outsideMax(pm, KID_AT) < 20, `outside ${outsideMax(pm, KID_AT)}`);
});

test('when a kid leaves, the cut-out fades away within about a second and a half', () => {
  const { pm, t } = learned();
  const t1 = run(pm, 1, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  run(pm, 1.5, { t0: t1, kid: () => null, pose: () => null });
  assert.equal(Math.max(...pm.alpha), 0);
});

// ---- pose tracking glitches -----------------------------------------------------------------------
test('pose lost while the kid keeps moving: the cut-out follows the kid by motion alone', () => {
  const { pm, t } = learned();
  const sway = (t) => rect(14 + Math.round(4 * Math.sin(t * 3)), 8, 10, 22); // dancing around
  const t1 = run(pm, 1, { t0: t, kid: sway, pose: sway });
  // pose goes away; kid carries on dancing for 3 more seconds
  for (let k = 0; k < 90; k++) {
    const tt = t1 + (k + 1) / 30;
    run(pm, 1 / 30, { t0: tt - 1 / 30, kid: sway, pose: () => null });
    assert.ok(inside(pm, sway(tt)) > 200, `frame ${k}: ${inside(pm, sway(tt)).toFixed(0)}`);
  }
});

test('pose lost while the kid stands still in a known room: kept for a few seconds, then let go', () => {
  const { pm, t } = learned();
  const t1 = run(pm, 1, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  const t2 = run(pm, 3, { t0: t1, kid: () => KID_AT, pose: () => null });
  assert.ok(inside(pm, KID_AT) > 200, 'still there 3s after pose loss (motion sees a person-shaped difference)');
  run(pm, 4, { t0: t2, kid: () => KID_AT, pose: () => null });
  assert.ok(inside(pm, KID_AT) < 10, 'absorbed into the background after a while, so moved furniture cannot haunt the screen');
});

test('pose lost where the room was never seen empty: no sudden pop, a smooth fade instead', () => {
  const pm = new PersonMask(W, H);
  const t1 = run(pm, 2, { kid: () => KID_AT, pose: () => KID_AT }); // kid there from the very start
  assert.ok(inside(pm, KID_AT) > 240);
  const seen = [];
  for (let k = 0; k < 60; k++) {
    run(pm, 1 / 30, { t0: t1 + k / 30, kid: () => KID_AT, pose: () => null });
    seen.push(inside(pm, KID_AT));
  }
  assert.ok(seen[0] > 230, `first frame after loss still ${seen[0].toFixed(0)}/255`);
  assert.ok(seen[3] > 150, `0.1s later ${seen[3].toFixed(0)}/255`);
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] <= seen[k - 1] + 1, 'fades monotonically, never flickers back');
  assert.ok(seen[59] < 10, 'gone after ~2s');
  const biggestDrop = Math.max(...seen.slice(1).map((v, k) => seen[k] - v));
  assert.ok(biggestDrop < 90, `largest single-frame drop ${biggestDrop.toFixed(0)}/255 (a pop would be ~255)`);
});

test('a one-frame pose dropout is invisible', () => {
  const { pm, t } = learned();
  const t1 = run(pm, 1, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  run(pm, 1 / 30, { t0: t1, kid: () => KID_AT, pose: () => null });
  assert.ok(inside(pm, KID_AT) > 245);
});

test('one kid lost while another is still tracked: the lost kid is held by motion, not dropped', () => {
  const { pm, t } = learned();
  const a = rect(6, 8, 9, 22);
  const sway = (t) => rect(30 + Math.round(3 * Math.sin(t * 3)), 8, 9, 22);
  // both kids found for a second...
  const t1 = run(pm, 1, { t0: t, kid: (t) => [a, sway(t)], pose: (t) => poseOfBoth(a, sway(t)) });
  // ...then the pose model only finds kid A for the next 2 seconds
  const t2 = run(pm, 2, { t0: t1, kid: (t) => [a, sway(t)], pose: () => a });
  assert.ok(inside(pm, a) > 240);
  assert.ok(inside(pm, sway(t2)) > 150, `lost kid still shown (${inside(pm, sway(t2)).toFixed(0)})`);
});
test('motion fills gaps in the pose silhouette (e.g. a hand the pose model missed)', () => {
  const { pm, t } = learned();
  const body = rect(18, 8, 8, 22);
  const hand = (t) => rect(26, 12 + Math.round(2 * Math.sin(t * 6)), 5, 4); // waving, just outside the pose mask
  const t1 = run(pm, 1, { t0: t, kid: (t) => [body, hand(t)], pose: () => body });
  assert.ok(inside(pm, hand(t1)) > 100, `hand ${inside(pm, hand(t1)).toFixed(0)}`);
});

// ---- things that must NOT become people ------------------------------------------------------------
test('movement far from any known person is ignored', () => {
  const { pm, t } = learned();
  const t1 = run(pm, 1, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  const far = (t) => rect(2 + Math.round(2 * Math.sin(t * 4)), 26, 5, 6); // a pet running about in the corner
  run(pm, 2, { t0: t1, kid: (t) => [KID_AT, far(t)], pose: () => KID_AT });
  assert.equal(pm.alpha[28 * W + 4], 0);
});

test('the whole picture getting brighter (webcam auto-exposure) does not make a ghost kid', () => {
  const { pm, t } = learned();
  run(pm, 3, { t0: t, kid: () => null, pose: () => null, grayOpts: { shift: 30 } });
  assert.equal(Math.max(...pm.alpha), 0);
});

test('a camera bump / lights switching (huge global change) is ignored rather than showing everything', () => {
  const { pm, t } = learned();
  const t1 = run(pm, 1, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  run(pm, 1, { t0: t1, kid: () => KID_AT, pose: () => KID_AT, grayOpts: { shift: 100 } });
  assert.ok(outsideMax(pm, KID_AT) < 20, `outside ${outsideMax(pm, KID_AT)}`);
  assert.ok(inside(pm, KID_AT) > 240, 'the kid is still shown (from the pose mask)');
});

// ---- other properties -------------------------------------------------------------------------------
test('fading takes the same real time at any frame rate (15, 30, 60 fps)', () => {
  const at = (fps) => {
    const pm = new PersonMask(W, H);
    const t1 = run(pm, 2, { fps, kid: () => KID_AT, pose: () => KID_AT });
    run(pm, 0.45, { fps, t0: t1, kid: () => KID_AT, pose: () => null });
    return inside(pm, KID_AT);
  };
  const [a, b, c] = [at(15), at(30), at(60)];
  assert.ok(Math.abs(a - c) < 30 && Math.abs(b - c) < 30, `${a.toFixed(0)} / ${b.toFixed(0)} / ${c.toFixed(0)}`);
});

test('a second kid arriving mid-game is picked up immediately by the pose model', () => {
  const { pm, t } = learned();
  const a = rect(6, 8, 9, 22);
  const b = rect(32, 8, 9, 22);
  const t1 = run(pm, 1, { t0: t, kid: () => a, pose: () => a });
  run(pm, 0.2, { t0: t1, kid: () => [a, b], pose: () => poseOfBoth(a, b) });
  assert.ok(inside(pm, b) > 240);
});
function poseOfBoth(a, b) {
  const m = poseOf(a);
  const mb = poseOf(b);
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], mb[i]);
  return m;
}

test('stats report what is going on (for the debug overlay)', () => {
  const { pm, t } = learned();
  run(pm, 0.5, { t0: t, kid: () => KID_AT, pose: () => KID_AT });
  assert.equal(pm.stats.poseActive, true);
  assert.ok(pm.stats.coverage > 0.1 && pm.stats.coverage < 0.4, `coverage ${pm.stats.coverage}`);
  run(pm, 0.5, { t0: t + 0.5, kid: () => KID_AT, pose: () => null });
  assert.equal(pm.stats.poseActive, false);
});

// ---- helpers ---------------------------------------------------------------------------------------
test('downsampleMaxInto averages blocks and merges several people with max()', () => {
  const src = new Float32Array(8 * 4);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) src[j * 8 + i] = i < 4 ? 1 : 0; // left half on
  const out = new Float32Array(4 * 2);
  downsampleMaxInto(src, 8, 4, out, 4, 2);
  assert.deepEqual([...out], [1, 1, 0, 0, 1, 1, 0, 0]);
  const other = new Float32Array(8 * 4);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) other[j * 8 + i] = i >= 4 ? 0.5 : 0;
  downsampleMaxInto(other, 8, 4, out, 4, 2);
  assert.deepEqual([...out], [1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5]);
  const half = new Float32Array(8 * 4).fill(0.5);
  const o2 = new Float32Array(4 * 2);
  downsampleMaxInto(half, 8, 4, o2, 4, 2);
  assert.ok(o2.every((v) => Math.abs(v - 0.5) < 1e-6));
});
