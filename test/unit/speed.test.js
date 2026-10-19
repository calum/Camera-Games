// Running slowly (speed.js): when the game says so, and which fix it suggests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeedWatch, speedAdvice as advice, adviceText, SLOW, FINE } from '../../src/speed.js';

const speedAdvice = (c) => adviceText(advice(c));

// Feed `seconds` of drawn frames at `fps`, with `tracked` tracked frames a second. Returns the times it turned slow.
function run(watch, { seconds, fps = 30, tracked, bodies = 1, t0 = 0, seq0 = 0 }) {
  const turned = [];
  let seq = seq0;
  for (let i = 0; i <= seconds * fps; i++) {
    const t = t0 + i / fps;
    seq = seq0 + Math.floor(t * tracked - t0 * tracked);
    if (watch.update(t, seq, bodies)) turned.push(t);
  }
  return { turned, end: t0 + seconds, seq };
}

test('SpeedWatch: slow tracking for a few seconds turns it slow, once; a short dip does not', () => {
  const w = new SpeedWatch();
  run(w, { seconds: SLOW.for - 2, tracked: 5 });
  assert.equal(w.slow, false, 'a dip shorter than SLOW.for');
  const w2 = new SpeedWatch();
  const r = run(w2, { seconds: SLOW.for + 3, tracked: 5, bodies: 2 });
  assert.equal(w2.slow, true);
  assert.equal(r.turned.length, 1, 'says so once');
  assert.ok(Math.abs(w2.bodies - 2) < 0.01);
  const fast = new SpeedWatch();
  run(fast, { seconds: 30, tracked: 18 });
  assert.equal(fast.slow, false, '18 tracked frames a second is fine');
});

test('SpeedWatch: slow drawing alone counts too', () => {
  const w = new SpeedWatch();
  run(w, { seconds: SLOW.for + 3, fps: 10, tracked: 10 });
  assert.equal(w.slow, true);
});

test('SpeedWatch: back to fine only after a long quick spell, so the note does not flicker', () => {
  const w = new SpeedWatch();
  const a = run(w, { seconds: SLOW.for + 3, tracked: 5 });
  const b = run(w, { seconds: FINE.for - 3, tracked: 18, t0: a.end, seq0: a.seq });
  assert.equal(w.slow, true, 'still slow before FINE.for');
  run(w, { seconds: 6, tracked: 18, t0: b.end, seq0: b.seq });
  assert.equal(w.slow, false);
});

test('SpeedWatch: a sleeping tab (a gap between frames) is not lag', () => {
  const w = new SpeedWatch();
  // a frame every 3 s: each one is a gap, so nothing is ever counted
  for (let t = 0; t < 60; t += 3) w.update(t, 0, 1);
  assert.equal(w.slow, false);
});

test('speedAdvice: picks the likeliest fix first', () => {
  assert.match(speedAdvice({ software: true, accelerationHelp: 'Edge: Settings', charging: false }), /turn on graphics acceleration\. Edge: Settings/);
  assert.match(speedAdvice({ charging: false, cameraFps: 10 }), /plug the laptop in/);
  assert.match(speedAdvice({ charging: true, cameraFps: 10 }), /dim light/);
  assert.match(speedAdvice({ charging: null, cameraFps: 30, pressure: 'critical' }), /flat out/);
  assert.match(speedAdvice({ cameraFps: 30, bodies: 3.2 }), /sees 3 people/);
  assert.equal(advice({ charging: false }).tip, 'Running slowly: plug the laptop in.', 'the short form, for the note');
  assert.match(speedAdvice({ cores: 4, bodies: 1 }), /slow side/);
  assert.match(speedAdvice({ cores: 8, memoryGB: 8, bodies: 2 }), /Two players/);
  assert.match(speedAdvice({ cores: 8, memoryGB: 8, bodies: 1, cameraFps: 0 }), /close other tabs and apps, and plug/);
});
