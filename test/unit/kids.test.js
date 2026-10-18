// Regression tests for small kids and glitchy tracking.
//
// Background: a young child could not do the dance poses even though adults could. A real toddler
// photo (both arms clearly up) came back as "no pose" because the thresholds were scaled to torso
// length, which is badly off for kids (big head, short arms, hips often mis-tracked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures } from '../../src/tracker.js';
import { OneEuro } from '../../src/filter.js';

// deterministic noise so tests never flake
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a skeleton from the few points that matter. Everything else sits at the chest.
function skeleton({ nose, sh, shoulderW, hipDrop = shoulderW * 1.6, wl, wr }) {
  const px = Array.from({ length: 33 }, () => ({ x: sh.x, y: sh.y }));
  const set = (i, x, y) => (px[i] = { x, y });
  set(0, nose.x, nose.y);
  set(11, sh.x - shoulderW / 2, sh.y);
  set(12, sh.x + shoulderW / 2, sh.y);
  set(23, sh.x - shoulderW * 0.35, sh.y + hipDrop);
  set(24, sh.x + shoulderW * 0.35, sh.y + hipDrop);
  set(25, sh.x - shoulderW * 0.35, sh.y + hipDrop * 1.8);
  set(26, sh.x + shoulderW * 0.35, sh.y + hipDrop * 1.8);
  set(15, wl.x, wl.y);
  set(16, wr.x, wr.y);
  set(19, wl.x, wl.y);
  set(20, wr.x, wr.y);
  return px;
}
const player = (px) => ({ px, jumps: 0, lastJump: -99, wasJump: false });
const poseOf = (px) => {
  const p = player(px);
  computeFeatures(p, 1);
  return p.pose;
};

// ---- real measurements from the toddler photo (arms up) -----------------------------------------
test('toddler with both arms up (real tracked numbers) is recognised as arms up', () => {
  // shoulders 110px wide at (764,436); nose (774,391); wrists (888,327) and (655,316); torso 184px.
  // The wrists are only ~65-75px above the nose; the old rule wanted 0.6*torso = 110px.
  const px = skeleton({
    nose: { x: 774, y: 391 },
    sh: { x: 764, y: 436 },
    shoulderW: 110,
    hipDrop: 184,
    wl: { x: 888, y: 327 },
    wr: { x: 655, y: 316 },
  });
  assert.deepEqual(poseOf(px), { armsUp: true, airplane: false, handsHead: false, duck: false });
});

// ---- small-kid proportions: shoulders 70px, big head, short arms --------------------------------
const kid = { nose: { x: 500, y: 300 }, sh: { x: 500, y: 355 }, shoulderW: 70 };

test('small kid: arms up, airplane, hands on head are each recognised (and only that pose)', () => {
  const armsUp = poseOf(skeleton({ ...kid, wl: { x: 450, y: 250 }, wr: { x: 550, y: 250 } }));
  assert.deepEqual(armsUp, { armsUp: true, airplane: false, handsHead: false, duck: false });

  const airplane = poseOf(skeleton({ ...kid, wl: { x: 405, y: 360 }, wr: { x: 595, y: 360 } }));
  assert.deepEqual(airplane, { armsUp: false, airplane: true, handsHead: false, duck: false });

  const handsHead = poseOf(skeleton({ ...kid, wl: { x: 470, y: 290 }, wr: { x: 530, y: 290 } }));
  assert.deepEqual(handsHead, { armsUp: false, airplane: false, handsHead: true, duck: false });
});

test('small kid standing with arms down is not doing any pose', () => {
  const down = poseOf(skeleton({ ...kid, wl: { x: 465, y: 450 }, wr: { x: 535, y: 450 } }));
  assert.deepEqual(down, { armsUp: false, airplane: false, handsHead: false, duck: false });
});

test('arms bent halfway up still counts as arms up for a small kid', () => {
  const bent = poseOf(skeleton({ ...kid, wl: { x: 440, y: 270 }, wr: { x: 560, y: 270 } }));
  assert.equal(bent.armsUp, true);
});

test('poses do not depend on where the hips are (small kids\' hips are often mis-tracked)', () => {
  for (const hipDrop of [20, 70, 112, 400, 1500]) {
    const p = poseOf(skeleton({ ...kid, hipDrop, wl: { x: 405, y: 360 }, wr: { x: 595, y: 360 } }));
    assert.equal(p.airplane, true, `hipDrop=${hipDrop}`);
  }
});

test('a sloppy airplane (arms drooping or lifted a little) still counts', () => {
  for (const dy of [-45, -25, 25, 45]) {
    const p = poseOf(skeleton({ ...kid, wl: { x: 410, y: 355 + dy }, wr: { x: 590, y: 355 + dy } }));
    assert.equal(p.airplane, true, `arms ${dy}px off shoulder height`);
  }
});

// ---- glitchy tracking ---------------------------------------------------------------------------
const GOOD = () => skeleton({ ...kid, wl: { x: 405, y: 360 }, wr: { x: 595, y: 360 } }); // airplane
const BAD = () => skeleton({ ...kid, wl: { x: 465, y: 450 }, wr: { x: 535, y: 450 } }); // arms down glitch

function run(frames) {
  const p = player(GOOD());
  const states = [];
  frames.forEach((f, i) => {
    p.px = f();
    computeFeatures(p, i / 30);
    states.push(p.pose.airplane);
  });
  return states;
}

test('glitchy frames: isolated bad frames never flip a held pose off', () => {
  const frames = Array.from({ length: 60 }, (_, i) => (i % 9 === 4 ? BAD : GOOD));
  const states = run(frames);
  assert.ok(states.every(Boolean), 'airplane stayed on through every single-frame glitch');
});

test('glitchy frames: an isolated good frame does not switch a pose on', () => {
  const frames = Array.from({ length: 60 }, (_, i) => (i % 9 === 4 ? GOOD : BAD));
  const states = run(frames).slice(1); // (the very first frame seeds the state)
  assert.ok(states.every((s) => !s));
});

test('a pose that really ends turns off within about a fifth of a second', () => {
  const frames = [...Array(30).fill(GOOD), ...Array(30).fill(BAD)];
  const states = run(frames);
  const off = states.findIndex((s, i) => i >= 30 && !s);
  assert.ok(off >= 30 && off - 30 <= 6, `turned off after ${off - 30} frames`);
});

test('a pose that really starts turns on within about a fifth of a second', () => {
  const frames = [...Array(30).fill(BAD), ...Array(30).fill(GOOD)];
  const states = run(frames);
  const on = states.findIndex((s, i) => i >= 30 && s);
  assert.ok(on >= 30 && on - 30 <= 6, `turned on after ${on - 30} frames`);
});

test('jittery tracking: noisy wrists (+-15px on a 70px-wide kid) still hold the pose steadily', () => {
  const r = rng(42);
  const noisy = () => {
    const j = () => (r() - 0.5) * 30;
    return skeleton({ ...kid, wl: { x: 405 + j(), y: 360 + j() }, wr: { x: 595 + j(), y: 360 + j() } });
  };
  const states = run(Array.from({ length: 300 }, () => noisy));
  const onFrac = states.filter(Boolean).length / states.length;
  assert.ok(onFrac > 0.97, `pose held ${(onFrac * 100).toFixed(0)}% of the time`);
  let flips = 0;
  for (let i = 1; i < states.length; i++) if (states[i] !== states[i - 1]) flips++;
  assert.ok(flips <= 2, `${flips} on/off flips`);
});

// ---- the motion filter --------------------------------------------------------------------------
test('One Euro filter: strongly reduces jitter on a joint that is standing still', () => {
  const r = rng(7);
  const f = new OneEuro();
  const raw = [];
  const out = [];
  for (let i = 0; i < 300; i++) {
    const x = 500 + (r() - 0.5) * 16;
    raw.push(x);
    out.push(f.filter(x, i / 30));
  }
  const spread = (a) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  };
  assert.ok(spread(out.slice(30)) < spread(raw.slice(30)) * 0.5, 'at least halves the jitter');
});

test('One Euro filter: still follows a fast arm swing without much lag', () => {
  const f = new OneEuro();
  for (let i = 0; i < 30; i++) f.filter(300, i / 30); // at rest
  let t = 1;
  let x = 300;
  let reached = -1;
  for (let i = 1; i <= 15; i++) {
    x += 120; // 3600 px/s sweep, like a wave of the arm
    const y = f.filter(x, (30 + i) / 30);
    if (reached < 0 && y > x - 0.25 * (x - 300)) reached = i;
    t = y;
  }
  assert.ok(reached > 0 && reached <= 3, `caught up within ${reached} frames`);
  assert.ok(Math.abs(x - t) < 0.2 * (x - 300), 'ends close to the true position');
});

test('One Euro filter: first sample passes straight through, and a stalled clock does not break it', () => {
  const f = new OneEuro();
  assert.equal(f.filter(123, 5), 123);
  assert.ok(Number.isFinite(f.filter(130, 5))); // same timestamp twice
  assert.ok(Number.isFinite(f.filter(140, 4.9))); // clock going backwards
});
