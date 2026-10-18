// PoseTracker bookkeeping that doesn't need a camera: model fallback on slow machines, and how the
// skeleton is drawn. (A tiny fake `document` lets the browser-only module load in Node.)
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { createElement: () => ({ play: async () => {}, srcObject: null, videoWidth: 1280, videoHeight: 720 }) };
const { PoseTracker } = await import('../../src/tracker.js');
const { drawSkeleton } = await import('../../src/draw.js');

// ---- model choice ---------------------------------------------------------------------------------
function trackerWith(opts) {
  const t = new PoseTracker(opts);
  t.switched = [];
  t._switchModel = (name) => t.switched.push(name); // don't actually load anything
  return t;
}
const feed = (t, ms, n = 130) => {
  for (let i = 0; i < n; i++) t._watchSpeed(i < 30 ? 400 : ms); // first frames are always slow (warm-up)
  return t.switched;
};

test('starts on the more accurate full model unless told otherwise', () => {
  assert.equal(new PoseTracker().modelName, 'full');
  assert.equal(new PoseTracker({ model: 'lite' }).modelName, 'lite');
  assert.equal(new PoseTracker({ model: 'bogus' }).modelName, 'full');
});

test('a fast machine keeps the full model', () => {
  assert.deepEqual(feed(trackerWith(), 25), []);
});

test('a slow machine drops to the lite model (once), ignoring warm-up frames', () => {
  assert.deepEqual(feed(trackerWith(), 90), ['lite']);
});

test('warm-up spikes alone do not trigger the fallback', () => {
  assert.deepEqual(feed(trackerWith(), 20), []);
});

test('an explicit ?model=full is never overridden', () => {
  assert.deepEqual(feed(trackerWith({ model: 'full' }), 200), []);
});

// ---- drawing: kids stay visible ---------------------------------------------------------------------
// A fake canvas context that records how thick each stroke is.
function fakeCtx() {
  const strokes = [];
  const state = { lineWidth: 1, globalAlpha: 1 };
  return new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'strokes') return strokes;
        if (k === 'stroke') return () => strokes.push({ lineWidth: state.lineWidth, alpha: state.globalAlpha });
        if (k in state) return state[k];
        return () => {};
      },
      set: (_, k, v) => ((state[k] = v), true),
    },
  );
}
const skel = () => {
  const px = Array.from({ length: 33 }, (_, i) => ({ x: 400 + i * 3, y: 300 + i * 5 }));
  return { present: true, color: '#4dd0ff', px, shoulderW: 100, score: 0, hitUntil: 0, flashUntil: 0 };
};
const gfx = (skeleton) => ({ u: 1, now: 10, fx: true, skeleton });

test('default skeleton is a thin line so the kid underneath stays visible', () => {
  const ctx = fakeCtx();
  drawSkeleton(ctx, skel(), gfx('thin'));
  const widest = Math.max(...ctx.strokes.map((s) => s.lineWidth));
  assert.ok(widest <= 8, `thin mode strokes at most ${widest}px`);
});

test('bold mode is the old chunky look', () => {
  const ctx = fakeCtx();
  drawSkeleton(ctx, skel(), gfx('bold'));
  assert.ok(Math.max(...ctx.strokes.map((s) => s.lineWidth)) >= 16);
});

test('skeleton "off" draws no lines at all', () => {
  const ctx = fakeCtx();
  drawSkeleton(ctx, skel(), gfx('off'));
  assert.equal(ctx.strokes.length, 0);
});

test('a jump result or a rock hit still flashes bold, even with the skeleton off or thin', () => {
  for (const mode of ['thin', 'off']) {
    const flash = fakeCtx();
    drawSkeleton(flash, { ...skel(), flashUntil: 11, flashColor: '#4dff88' }, gfx(mode));
    assert.ok(Math.max(...flash.strokes.map((s) => s.lineWidth)) >= 24, `flash in ${mode}`);
    const hit = fakeCtx();
    drawSkeleton(hit, { ...skel(), hitUntil: 11 }, gfx(mode));
    assert.ok(Math.max(...hit.strokes.map((s) => s.lineWidth)) >= 16, `hit in ${mode}`);
  }
});

test('kids who sat out are drawn very faintly', () => {
  const ctx = fakeCtx();
  drawSkeleton(ctx, { ...skel(), excluded: true }, gfx('thin'));
  assert.ok(ctx.strokes.every((s) => s.alpha < 0.4));
});

// ---- camera operations ----------------------------------------------------------------------------------
// A fake camera system: records how many getUserMedia calls overlap, can hide the in-use camera from the
// device list (as one test browser does), and can fail on demand.
function fakeCameras({ ids = ['a', 'b', 'c'], hideActive = false, failFirst = false, failTimes = 0, emptyLists = 0, delay = 15 } = {}) {
  const state = { active: 0, maxActive: 0, calls: [], activeId: null, stopped: 0, failNext: failFirst, failTimes, emptyLists };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(c) {
          state.calls.push(c);
          state.active++;
          state.maxActive = Math.max(state.maxActive, state.active);
          await new Promise((r) => setTimeout(r, delay));
          state.active--;
          if (state.failNext) {
            state.failNext = false;
            throw new Error('camera busy');
          }
          if (state.failTimes > 0) {
            state.failTimes--;
            throw Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });
          }
          const id = c.video.deviceId?.exact ?? ids[0];
          state.activeId = id;
          const track = { label: `Camera ${id}`, getSettings: () => ({ deviceId: id }), stop() { state.stopped++; if (state.activeId === id) state.activeId = null; } };
          return { getVideoTracks: () => [track], getTracks: () => [track] };
        },
        async enumerateDevices() {
          if (state.emptyLists > 0) {
            state.emptyLists--;
            return []; // nothing listed for a moment
          }
          const list = ids.filter((id) => !(hideActive && id === state.activeId));
          return list.map((id) => ({ kind: 'videoinput', deviceId: id, label: `Camera ${id}` }));
        },
      },
    },
  });
  return state;
}

test('camera operations never overlap, however fast they are requested', async () => {
  const cams = fakeCameras();
  const t = new PoseTracker();
  await Promise.all([t.startCamera({ deviceId: 'a' }), t.nextCamera(), t.nextCamera(), t.startCamera({ deviceId: 'c' })]);
  assert.equal(cams.maxActive, 1, 'only one camera request in flight at a time');
  assert.equal(t.deviceId, 'c', 'the last request wins');
});

test('a failed camera operation does not block the ones after it', async () => {
  fakeCameras({ failFirst: true });
  const t = new PoseTracker();
  await assert.rejects(t.startCamera(), /camera busy/);
  await t.startCamera({ deviceId: 'b' });
  assert.equal(t.deviceId, 'b');
});

test('switching works even if the system hides the camera in use from the device list', async () => {
  fakeCameras({ hideActive: true });
  const t = new PoseTracker();
  await t.startCamera({ deviceId: 'a' });
  const next = await t.nextCamera();
  assert.equal(t.deviceId, 'b');
  assert.equal(next.count, 3, 'counts the hidden camera too');
  assert.ok(next.index >= 1 && next.index <= next.count, `sensible number (${next.index})`);
  assert.equal(next.label, 'Camera b');
});

test('with a single camera, switching reports "nothing to switch to" and carries on with it', async () => {
  fakeCameras({ ids: ['only'], hideActive: true });
  const t = new PoseTracker();
  await t.startCamera();
  assert.equal(await t.nextCamera(), null);
  assert.equal(t.deviceId, 'only');
  assert.ok(t.video.srcObject, 'camera is running again');
});

test('a saved camera that has gone away falls back to the default one instead of failing', async () => {
  const cams = fakeCameras();
  const realGum = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c.video.deviceId?.exact === 'gone') throw new Error('Requested device not found');
    return realGum(c);
  };
  const t = new PoseTracker();
  await t.startCamera({ deviceId: 'gone' });
  assert.equal(t.deviceId, 'a', 'used the default camera');
  assert.ok(cams.calls.length >= 1);
});

test('starting a camera clears the old kids and masks (the picture may be a different size)', async () => {
  fakeCameras();
  const t = new PoseTracker();
  t.players = [{ id: 1 }];
  t.maskLow = new Float32Array(4);
  await t.startCamera({ deviceId: 'b' });
  assert.deepEqual(t.players, []);
  assert.equal(t.maskLow, null);
});

test('isPortrait notices a phone held upright', () => {
  const t = new PoseTracker();
  t.video.videoWidth = 720;
  t.video.videoHeight = 1280;
  assert.equal(t.isPortrait, true);
  t.video.videoWidth = 1280;
  t.video.videoHeight = 720;
  assert.equal(t.isPortrait, false);
});

test('a camera that is briefly "not found" while the previous one is released is retried, not given up on', async () => {
  const cams = fakeCameras({ failTimes: 2 });
  const t = new PoseTracker({ retryDelayMs: 1 });
  await t.startCamera({ deviceId: 'b' });
  assert.equal(t.deviceId, 'b');
  assert.equal(cams.calls.length, 3, 'two failed attempts, then it worked');
});

test('the camera list being empty for a moment after a release does not stop switching', async () => {
  fakeCameras({ ids: ['a', 'b'], hideActive: true });
  const t = new PoseTracker({ retryDelayMs: 1 });
  await t.startCamera({ deviceId: 'a' });
  navigator.mediaDevices.enumerateDevices = (() => {
    let n = 0;
    const real = navigator.mediaDevices.enumerateDevices;
    return async () => (n++ >= 2 && n <= 4 ? [] : real());
  })();
  const next = await t.nextCamera();
  assert.equal(t.deviceId, 'b');
  assert.ok(next, 'switched');
});

test('if the chosen camera cannot be opened, the game ends up on a working one and reports which', async () => {
  fakeCameras();
  const real = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c.video.deviceId?.exact === 'b') throw Object.assign(new Error('nope'), { name: 'OverconstrainedError' });
    return real(c);
  };
  const t = new PoseTracker({ retryDelayMs: 1 });
  await t.startCamera({ deviceId: 'a' });
  const next = await t.nextCamera(); // wants 'b', which fails
  assert.equal(t.deviceId, 'a', 'still on a camera that works');
  assert.ok(t.video.srcObject, 'picture is live');
  assert.equal(next.label, 'Camera a', 'tells the truth about which camera is in use');
});

test('a switch that fails completely puts the previous camera back and reports the error', async () => {
  const cams = fakeCameras();
  const t = new PoseTracker({ retryDelayMs: 1 });
  await t.startCamera({ deviceId: 'a' });
  const real = navigator.mediaDevices.getUserMedia;
  let failsLeft = 2;
  navigator.mediaDevices.getUserMedia = async (c) => {
    // the chosen camera AND the default fallback both fail; then asking for the old camera again works
    if (failsLeft > 0 && c.video.deviceId?.exact !== 'a') {
      failsLeft--;
      throw Object.assign(new Error('boom'), { name: 'NotAllowedError' });
    }
    return real(c);
  };
  await assert.rejects(t.nextCamera(), /boom/);
  assert.equal(t.deviceId, 'a', 'the previous camera was put back');
  assert.ok(cams.activeId === 'a', 'and is live');
});
