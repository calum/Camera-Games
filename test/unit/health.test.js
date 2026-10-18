import test from 'node:test';
import assert from 'node:assert/strict';
import { Health, retryDelay } from '../../src/health.js';

// A healthy stream: the picture moves on every frame and each tracked frame is answered quickly.
const ok = (now, extra = {}) => ({ now, trackLive: true, videoTime: now, waiting: false, sent: Math.floor(now * 10), detectMs: 40, warm: true, ...extra });

// Runs the checks at 60 frames a second from t0 to t1 and returns the last verdict.
function run(h, t0, t1, state) {
  let r;
  for (let t = t0; t <= t1; t += 1 / 60) r = h.check(state(t));
  return r;
}

test('a healthy camera and tracker are left alone', () => {
  const h = new Health();
  const r = run(h, 0, 30, (t) => ok(t));
  assert.deepEqual(r, { camera: 'ok', tracker: 'ok', woke: false });
});

test('an unplugged camera (its track has ended) is lost at once', () => {
  const h = new Health();
  run(h, 0, 2, (t) => ok(t));
  assert.equal(h.check(ok(2.02, { trackLive: false })).camera, 'lost');
});

test('a frozen picture counts as a lost camera after a few seconds, not straight away', () => {
  const h = new Health();
  run(h, 0, 2, (t) => ok(t));
  assert.equal(run(h, 2, 4, (t) => ok(t, { videoTime: 2 })).camera, 'ok', 'a short hiccup is not a lost camera');
  assert.equal(run(h, 4, 6, (t) => ok(t, { videoTime: 2 })).camera, 'lost');
  assert.equal(h.check(ok(6.1)).camera, 'ok', 'and it is fine again as soon as the picture moves');
});

test('a tracker that never answers is stalled after the limit; a slow but answering one is not', () => {
  const h = new Health();
  run(h, 0, 2, (t) => ok(t));
  // one frame sent at t=2 that never comes back
  assert.equal(run(h, 2, 11, (t) => ok(t, { waiting: true, sent: 999 })).tracker, 'ok');
  assert.equal(run(h, 11, 13, (t) => ok(t, { waiting: true, sent: 999 })).tracker, 'stalled');

  // a very slow device (2 s a frame) keeps sending and getting answers: never stalled
  const slow = new Health();
  const r = run(slow, 0, 60, (t) => ok(t, { waiting: true, sent: Math.floor(t / 2), detectMs: 2000 }));
  assert.equal(r.tracker, 'ok');
});

test('the stall limit stretches with the usual round trip, and a fresh model gets longer for its first answer', () => {
  const slow = new Health();
  // usual round trip 3 s: 8 rounds = 24 s before giving up on an answer
  assert.equal(run(slow, 0, 20, (t) => ok(t, { waiting: true, sent: 1, detectMs: 3000 })).tracker, 'ok');
  assert.equal(run(slow, 20, 25, (t) => ok(t, { waiting: true, sent: 1, detectMs: 3000 })).tracker, 'stalled');

  const fresh = new Health();
  assert.equal(run(fresh, 0, 25, (t) => ok(t, { waiting: true, sent: 1, detectMs: 0, warm: false })).tracker, 'ok');
  assert.equal(run(fresh, 25, 31, (t) => ok(t, { waiting: true, sent: 1, detectMs: 0, warm: false })).tracker, 'stalled');
});

test('coming back from a sleeping tab is not mistaken for a frozen camera or a hung tracker', () => {
  const h = new Health();
  run(h, 0, 2, (t) => ok(t, { waiting: true, sent: 5 }));
  // the tab slept for a minute: the picture and the answer both look ancient, but the clocks restart
  const back = h.check(ok(62, { videoTime: 2, waiting: true, sent: 5 }));
  assert.deepEqual(back, { camera: 'ok', tracker: 'ok', woke: true });
  assert.equal(run(h, 62, 64, (t) => ok(t, { videoTime: 2, waiting: true, sent: 5 })).camera, 'ok');
  assert.equal(run(h, 64, 66, (t) => ok(t, { videoTime: 2, waiting: true, sent: 5 })).camera, 'lost', 'still frozen after waking: reconnect');
});

test('reconnect attempts start quickly and then settle at every few seconds', () => {
  assert.equal(retryDelay(0), 0.5);
  assert.ok(retryDelay(1) > retryDelay(0));
  assert.equal(retryDelay(20), 5);
});
