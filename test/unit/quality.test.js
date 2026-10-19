// The tracking quality ladder (quality.js): which rung to start on, and when to step down or back up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityLadder, QUALITY, SLOW_MS, FAST_MS, WARMUP_S, MEASURE_S, FAST_S } from '../../src/quality.js';

// Feed `seconds` of tracked frames at `fps`, each taking `ms`, from time `t0`. Returns every move made.
function run(ladder, ms, seconds, { fps = 10, t0 = 0, canLeaveWorker = false } = {}) {
  const moves = [];
  for (let i = 0; i < seconds * fps; i++) {
    const m = ladder.watch(typeof ms === 'function' ? ms(i) : ms, t0 + i / fps, canLeaveWorker);
    if (m) moves.push(m.type === 'leave-worker' ? m.type : `${m.type} ${m.to.name}`);
  }
  return moves;
}

test('the ladder goes from best to cheapest', () => {
  assert.deepEqual(QUALITY.map((q) => q.name), ['high', 'medium', 'low', 'lowest']);
  assert.equal(QUALITY[0].model, 'full');
  assert.ok(QUALITY.slice(1).every((q) => q.model === 'lite'));
  assert.equal(QUALITY.at(-1).masks, false, 'the bottom rung has no silhouettes');
  assert.ok(FAST_MS < SLOW_MS);
});

test('where it starts: the top, a chosen rung, or the rung of a pinned model', () => {
  assert.equal(new QualityLadder().quality.name, 'high');
  assert.equal(new QualityLadder({ startQuality: 'medium' }).quality.name, 'medium');
  assert.equal(new QualityLadder({ startQuality: 'nonsense' }).quality.name, 'high');
  assert.equal(new QualityLadder({ quality: 'low' }).quality.name, 'low');
  assert.equal(new QualityLadder({ quality: 'nonsense', startQuality: 'medium' }).quality.name, 'medium', 'an unknown ?quality= pins nothing');
  assert.equal(new QualityLadder({ model: 'lite' }).quality.name, 'medium');
  assert.equal(new QualityLadder({ model: 'full', startQuality: 'low' }).quality.name, 'high');
  assert.equal(new QualityLadder({ model: 'bogus' }).quality.name, 'high');
});

test('slow tracking steps down one rung at a time, measuring afresh after each step', () => {
  const l = new QualityLadder();
  const moves = run(l, SLOW_MS * 2, 5);
  assert.deepEqual(moves, ['down medium'], 'one step, not straight to the bottom');
  assert.deepEqual(run(l, SLOW_MS * 2, 30, { t0: 5 }), ['down low', 'down lowest']);
  assert.equal(l.quality.name, 'lowest');
  assert.deepEqual(run(l, SLOW_MS * 2, 30, { t0: 34 }), [], 'nowhere lower to go (and no worker to leave)');
});

test('a step down waits for the warm-up and a few seconds of measuring', () => {
  const l = new QualityLadder();
  // warm-up frames are always slow (shaders compile) and are not counted
  assert.deepEqual(run(l, (i) => (i < WARMUP_S * 10 ? 2000 : 10), 10), []);
  const m = new QualityLadder();
  const moves = [];
  let at = -1;
  for (let i = 0; i < 100 && !moves.length; i++) {
    const move = m.watch(SLOW_MS * 2, i / 10);
    if (move) moves.push(move), (at = i / 10);
  }
  assert.ok(at >= WARMUP_S + MEASURE_S - 1e-9, `stepped down at ${at} s`);
  assert.ok(at <= WARMUP_S + MEASURE_S + 0.5, `but promptly (${at} s)`);
  assert.equal(moves[0].from.name, 'high');
  assert.ok(moves[0].avg > SLOW_MS);
});

test('a frame averaging just under the limit is not slow', () => {
  assert.deepEqual(run(new QualityLadder(), SLOW_MS - 1, 30), []);
});

test('a long fast spell steps back up, and one slow frame restarts the spell', () => {
  const l = new QualityLadder({ startQuality: 'low' });
  assert.deepEqual(run(l, FAST_MS / 2, FAST_S + 3), ['up medium']);
  const m = new QualityLadder({ startQuality: 'low' });
  // fast, except one frame every 10 s that is merely OK: never a long enough fast spell
  assert.deepEqual(run(m, (i) => (i % 100 === 99 ? FAST_MS + 5 : FAST_MS / 2), 60), []);
  assert.deepEqual(run(new QualityLadder(), FAST_MS / 2, 120), [], 'already at the top: nothing to do');
});

test('at the bottom and still slow, it says to try the main thread, but only if that is possible', () => {
  const l = new QualityLadder({ startQuality: 'lowest' });
  assert.deepEqual(run(l, SLOW_MS * 2, 6, { canLeaveWorker: true }), ['leave-worker']);
  assert.deepEqual(run(new QualityLadder({ startQuality: 'lowest' }), SLOW_MS * 2, 6), []);
  // a pinned model (lite here, so it starts on 'medium') steps down to the bottom but never leaves the worker
  assert.deepEqual(run(new QualityLadder({ model: 'lite' }), SLOW_MS * 2, 60, { canLeaveWorker: true }), ['down low', 'down lowest']);
});

test('?quality= pins every rung, ?model= only the model', () => {
  const pinned = new QualityLadder({ quality: 'medium' });
  assert.deepEqual(run(pinned, SLOW_MS * 4, 30), []);
  assert.deepEqual(run(pinned, 1, 60, { t0: 30 }), []);
  assert.equal(pinned.step(0), null);
  // a pinned full model can't step down at all (every lower rung is lite)
  assert.deepEqual(run(new QualityLadder({ model: 'full' }), SLOW_MS * 4, 30, { canLeaveWorker: true }), []);
  // a pinned lite model can still shrink the frame and drop silhouettes, but never goes up to full
  const lite = new QualityLadder({ model: 'lite' });
  assert.deepEqual(run(lite, SLOW_MS * 2, 30), ['down low', 'down lowest']);
  assert.deepEqual(run(lite, 1, 120, { t0: 30 }), ['up low', 'up medium']);
  assert.equal(lite.quality.model, 'lite');
});
