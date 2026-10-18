// The new levels' backdrops run against a fake canvas context: each must draw plenty, never throw,
// at any screen size and moment, and plug into Backdrops without changing it.
import test from 'node:test';
import assert from 'node:assert/strict';

function fakeCtx() {
  const calls = { n: 0 };
  const state = {};
  const gradient = () => ({ addColorStop() {} });
  return new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'calls') return calls;
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return gradient;
        if (k in state) return state[k];
        return () => {
          calls.n++;
        };
      },
      set: (_, k, v) => ((state[k] = v), true),
    },
  );
}
globalThis.document = {
  createElement: () => {
    const ctx = fakeCtx();
    return { width: 0, height: 0, getContext: () => ctx, ctx };
  },
};

const { EXTRA_SCENES } = await import('../../src/backdrops-extra.js');
const { Backdrops, SCENES } = await import('../../src/backdrops.js');

test('there is a backdrop for each new level, with the same shape as the built-in scenes', () => {
  assert.deepEqual(Object.keys(EXTRA_SCENES).sort(), ['avalanche', 'balloons', 'dig', 'meteor', 'wall']);
  for (const [id, s] of Object.entries(EXTRA_SCENES)) {
    assert.equal(typeof s.static, 'function', id);
    assert.equal(typeof s.dynamic, 'function', id);
    assert.ok(!(id in SCENES), `${id} does not clash with a built-in scene`);
  }
});

test('every new backdrop draws a lot of shapes, at several sizes and moments, without throwing', () => {
  for (const [id, s] of Object.entries(EXTRA_SCENES)) {
    for (const [W, H] of [[1280, 720], [1920, 1080], [800, 600], [3840, 2160]]) {
      const u = H / 1080;
      const st = fakeCtx();
      s.static(st, W, H, u);
      assert.ok(st.calls.n > 20, `${id} ${W}x${H} static drew ${st.calls.n} things`);
      for (const t of [0, 0.016, 3.7, 125.5, 99999]) {
        const dy = fakeCtx();
        s.dynamic(dy, W, H, u, t);
        assert.ok(dy.calls.n > 5, `${id} ${W}x${H} t=${t} dynamic drew ${dy.calls.n} things`);
      }
    }
  }
});

test('each new level uses its own backdrop, and Backdrops.draw paints it', async () => {
  const { LEVELS } = await import('../../src/levels/index.js');
  for (const [id, scene] of Object.entries(EXTRA_SCENES)) {
    const level = LEVELS.find((l) => l.id === id);
    assert.ok(level, `level "${id}" is in the game`);
    assert.equal(level.backdrop, scene, id);
    const b = new Backdrops();
    b.draw(fakeCtx(), id, 1280, 720, 1, scene);
    assert.ok(b.cctx.calls.n > 20, `${id} static layer drawn`);
  }
});
