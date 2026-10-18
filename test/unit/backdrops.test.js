// Backdrop scenes run against a fake canvas context: every scene must draw something, never throw,
// at any screen size and any moment in time, and the cached "static" layer must only be rebuilt when
// the scene or the screen size changes.
import test from 'node:test';
import assert from 'node:assert/strict';

// A fake 2D context: remembers how many drawing calls were made, hands out gradient objects.
function fakeCtx() {
  const calls = { n: 0 };
  const state = {};
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy(
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
  return ctx;
}
globalThis.document = {
  createElement: () => {
    const ctx = fakeCtx();
    return { width: 0, height: 0, getContext: () => ctx, ctx };
  },
};

const { Backdrops, SCENES } = await import('../../src/backdrops.js');
const IDS = ['menu', 'bubbles', 'dodge', 'jump', 'dance', 'finale'];

test('there is a scene for the menu, the finale and each of the four levels', async () => {
  const { LEVELS } = await import('../../src/levels/index.js');
  assert.deepEqual(Object.keys(SCENES).sort(), [...IDS].sort());
  for (const level of LEVELS) assert.ok(SCENES[level.id], `level "${level.id}" has a backdrop`);
});

test('every scene draws a lot of shapes, at several sizes and moments, without throwing', () => {
  for (const id of IDS) {
    for (const [W, H] of [[1280, 720], [1920, 1080], [800, 600], [3840, 2160]]) {
      for (const t of [0, 0.016, 3.7, 125.5, 99999]) {
        const b = new Backdrops();
        const ctx = fakeCtx();
        b.draw(ctx, id, W, H, t);
        assert.ok(ctx.calls.n > 5, `${id} ${W}x${H} t=${t} drew ${ctx.calls.n} things`);
        assert.ok(b.cctx.calls.n > 20, `${id} static layer has real content`);
      }
    }
  }
});

test('an unknown scene id falls back to the menu meadow instead of crashing', () => {
  const b = new Backdrops();
  assert.doesNotThrow(() => b.draw(fakeCtx(), 'no-such-level', 1280, 720, 1));
});

test('the static layer is cached: rebuilt only when the scene or screen size changes', () => {
  const b = new Backdrops();
  const ctx = fakeCtx();
  const build = () => b.cctx.calls.n;
  b.draw(ctx, 'jump', 1280, 720, 0);
  const afterFirst = build();
  for (let i = 1; i < 30; i++) b.draw(ctx, 'jump', 1280, 720, i / 30);
  assert.equal(build(), afterFirst, 'no rebuild across frames');
  b.draw(ctx, 'dance', 1280, 720, 1);
  assert.ok(build() > afterFirst, 'rebuilt for a different scene');
  const afterDance = build();
  b.draw(ctx, 'dance', 1920, 1080, 1);
  assert.ok(build() > afterDance, 'rebuilt for a different screen size');
});

// Log every drawing command (with its numbers) a scene's animated layer issues at time t.
function dynamicLog(id, t) {
  const log = [];
  const state = {};
  const ctx = new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (k in state) return state[k];
        return (...a) => log.push(k + JSON.stringify(a));
      },
      set: (_, k, v) => ((state[k] = v), true),
    },
  );
  SCENES[id].dynamic(ctx, 1280, 720, 720 / 1080, t);
  return log.join('|');
}

test('animated parts really move: the drawing commands differ from one moment to the next', () => {
  for (const id of IDS) {
    assert.ok(dynamicLog(id, 1).length > 100, `${id} animates something`);
    assert.notEqual(dynamicLog(id, 1), dynamicLog(id, 1.4), `${id} changes over time`);
    assert.equal(dynamicLog(id, 2.5), dynamicLog(id, 2.5), `${id} is deterministic (same moment, same picture)`);
  }
});
