// PoseTracker bookkeeping that doesn't need a camera: model fallback on slow machines, and how the
// skeleton is drawn. (A tiny fake `document` lets the browser-only module load in Node.)
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { createElement: () => ({}) };
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
