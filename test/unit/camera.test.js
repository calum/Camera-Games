// Camera choices: picture size, switching between cameras, remembering the pick, frame-rate fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES,
  parseMode,
  cameraConstraints,
  nextCameraId,
  describeCamera,
  loadSavedCamera,
  saveCamera,
  CAMERA_KEY,
  FpsGuard,
  withRetry,
  isTransientCameraError,
} from '../../src/camera.js';

const cam = (deviceId, label = `Cam ${deviceId}`) => ({ kind: 'videoinput', deviceId, label });
const mic = (deviceId) => ({ kind: 'audioinput', deviceId, label: 'mic' });

// ---- what we ask the camera for -----------------------------------------------------------------
test('by default we ask for 16:9 720p so a webcam uses its full field of view', () => {
  const c = cameraConstraints();
  assert.deepEqual(c.video.width, { ideal: 1280 });
  assert.deepEqual(c.video.height, { ideal: 720 });
  assert.deepEqual(c.video.frameRate, { ideal: 30 });
  assert.equal(c.audio, false);
  assert.equal(MODES.wide.width / MODES.wide.height, 16 / 9);
});

test('standard mode asks for 640x480', () => {
  const c = cameraConstraints({ mode: 'standard' });
  assert.deepEqual([c.video.width.ideal, c.video.height.ideal], [640, 480]);
});

test('sizes are wishes, never demands, so a camera that cannot do 720p still works', () => {
  const v = cameraConstraints().video;
  for (const k of ['width', 'height', 'frameRate']) {
    assert.ok('ideal' in v[k] && !('exact' in v[k]) && !('min' in v[k]), k);
  }
});

test('with no camera chosen we ask for the front/default one; with one chosen we insist on exactly it', () => {
  const none = cameraConstraints().video;
  assert.equal(none.facingMode, 'user');
  assert.equal(none.deviceId, undefined);
  const chosen = cameraConstraints({ deviceId: 'abc' }).video;
  assert.deepEqual(chosen.deviceId, { exact: 'abc' });
  assert.equal(chosen.facingMode, undefined, 'a facing mode would fight the chosen camera');
});

test('an unknown mode falls back to wide; parseMode only accepts the two real ones', () => {
  assert.equal(cameraConstraints({ mode: 'nonsense' }).video.width.ideal, 1280);
  assert.equal(parseMode('wide'), 'wide');
  assert.equal(parseMode('standard'), 'standard');
  assert.equal(parseMode('hd'), null);
  assert.equal(parseMode(null), null);
});

// ---- switching between cameras ------------------------------------------------------------------
test('C cycles through the cameras and wraps round', () => {
  const devs = [cam('a'), cam('b'), cam('c')];
  assert.equal(nextCameraId(devs, 'a'), 'b');
  assert.equal(nextCameraId(devs, 'b'), 'c');
  assert.equal(nextCameraId(devs, 'c'), 'a');
});

test('with one camera (or none) there is nothing to switch to', () => {
  assert.equal(nextCameraId([cam('a')], 'a'), null);
  assert.equal(nextCameraId([], 'a'), null);
});

test('microphones and unlabeled/empty entries are ignored', () => {
  const devs = [mic('m1'), cam('a'), { kind: 'videoinput', deviceId: '', label: '' }, mic('m2'), cam('b')];
  assert.equal(nextCameraId(devs, 'a'), 'b');
  assert.equal(nextCameraId(devs, 'b'), 'a');
});

test('if the current camera has vanished (phone app closed) we go to the first one', () => {
  assert.equal(nextCameraId([cam('a'), cam('b')], 'gone'), 'a');
  assert.equal(nextCameraId([cam('a'), cam('b')], null), 'a');
});

test('the on-screen description says which camera, out of how many, and uses a fallback name', () => {
  const devs = [cam('a', 'Laptop webcam'), cam('b', ''), mic('m')];
  assert.deepEqual(describeCamera(devs, 'a'), { index: 1, count: 2, label: 'Laptop webcam' });
  assert.deepEqual(describeCamera(devs, 'b'), { index: 2, count: 2, label: 'Camera 2' });
});

test('a camera missing from the list (hidden while in use) is counted as one more, never "Camera 0"', () => {
  const d = describeCamera([cam('a', 'First'), cam('c', 'Third')], 'b', 'Second');
  assert.deepEqual(d, { index: 3, count: 3, label: 'Second' });
  assert.equal(describeCamera([], 'x').index, 1);
});

// ---- remembering the choice -----------------------------------------------------------------------
function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

test('the chosen camera is saved and loaded back', () => {
  const s = fakeStorage();
  assert.equal(loadSavedCamera(s), null);
  saveCamera(s, 'phone-1');
  assert.equal(s.data.get(CAMERA_KEY), 'phone-1');
  assert.equal(loadSavedCamera(s), 'phone-1');
  saveCamera(s, null);
  assert.equal(loadSavedCamera(s), null, 'clearing works');
});

test('blocked or missing storage never breaks the game', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(loadSavedCamera(throwing), null);
  assert.doesNotThrow(() => saveCamera(throwing, 'x'));
  assert.equal(loadSavedCamera(undefined), null);
  assert.doesNotThrow(() => saveCamera(undefined, 'x'));
});

// ---- frame-rate fallback ----------------------------------------------------------------------------
function feed(guard, fps, seconds, t0 = 100) {
  const n = Math.round(fps * seconds);
  for (let i = 0; i <= n; i++) guard.frame(t0 + i / fps);
  return guard;
}

test('a camera delivering 30 fps at 720p is judged fine', () => {
  const g = feed(new FpsGuard(), 30, 6);
  assert.equal(g.verdict(), 'ok');
  assert.ok(Math.abs(g.fps - 30) < 1.5, `measured ${g.fps.toFixed(1)}`);
});

test('a cheap webcam limping along at 8 fps is judged too slow', () => {
  const g = feed(new FpsGuard(), 8, 8);
  assert.equal(g.verdict(), 'slow');
});

test('no verdict is given too early (cameras start slowly)', () => {
  const g = new FpsGuard();
  assert.equal(g.verdict(), 'pending');
  feed(g, 5, 1.5); // still inside warm-up + measuring window, and slow
  assert.equal(g.verdict(), 'pending');
});

test('a slow start does not condemn a camera that then runs smoothly', () => {
  const g = new FpsGuard();
  feed(g, 3, 0.9, 100); // crawling during the first second (ignored)
  feed(g, 30, 6, 101.2); // then fine
  assert.equal(g.verdict(), 'ok');
});

test('the threshold is adjustable', () => {
  assert.equal(feed(new FpsGuard({ minFps: 25 }), 20, 8).verdict(), 'slow');
  assert.equal(feed(new FpsGuard({ minFps: 10 }), 20, 8).verdict(), 'ok');
});

test('frame rate from a frame counter ignores how often a busy page looked (a slow laptop is not a slow camera)', () => {
  // the camera delivers 30 fps, but the page only gets a look every 150 ms (6-7 callbacks a second)
  const g = new FpsGuard();
  for (let t = 100; t <= 108; t += 0.15) g.sample(t, Math.round((t - 100) * 30));
  assert.equal(g.verdict(), 'ok');
  assert.ok(Math.abs(g.fps - 30) < 2, `measured ${g.fps.toFixed(1)}`);
  // counting callbacks instead would have said ~6.7 fps, "slow"
  const naive = new FpsGuard();
  for (let t = 100; t <= 108; t += 0.15) naive.frame(t);
  assert.equal(naive.verdict(), 'slow');
});

test('frame counter: a camera really delivering 8 fps is still judged slow', () => {
  const g = new FpsGuard();
  for (let t = 100; t <= 108; t += 0.1) g.sample(t, Math.round((t - 100) * 8));
  assert.equal(g.verdict(), 'slow');
});

// ---- retrying while a camera lets go ---------------------------------------------------------------------
const err = (name) => Object.assign(new Error(name), { name });

test('a camera that is briefly "not found" or "in use" after being released is retried', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await withRetry(
    async () => {
      if (++calls < 3) throw err(calls === 1 ? 'NotFoundError' : 'NotReadableError');
      return 'stream';
    },
    { delayMs: 250, sleep: async (ms) => sleeps.push(ms) },
  );
  assert.equal(result, 'stream');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [250, 250], 'paused between attempts');
});

test('it gives up after the allowed number of tries and reports the last error', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw err('NotFoundError'); }, { tries: 3, sleep: async () => {} }),
    /NotFoundError/,
  );
  assert.equal(calls, 3);
});

test('errors that waiting will not fix (permission denied, camera really gone) are not retried', async () => {
  for (const name of ['NotAllowedError', 'OverconstrainedError', 'SecurityError', 'TypeError']) {
    let calls = 0;
    const sleeps = [];
    await assert.rejects(withRetry(async () => { calls++; throw err(name); }, { sleep: async (ms) => sleeps.push(ms) }));
    assert.equal(calls, 1, name);
    assert.equal(sleeps.length, 0, name);
  }
  assert.equal(isTransientCameraError(err('NotFoundError')), true);
  assert.equal(isTransientCameraError(err('NotAllowedError')), false);
  assert.equal(isTransientCameraError(null), false);
});

test('success on the first try never waits', async () => {
  const sleeps = [];
  assert.equal(await withRetry(async () => 42, { sleep: async (ms) => sleeps.push(ms) }), 42);
  assert.deepEqual(sleeps, []);
});
