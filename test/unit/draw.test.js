import test from 'node:test';
import assert from 'node:assert/strict';
import { popScale, drawRock, roundRectPath } from '../../src/draw.js';

test('popScale: starts small, overshoots, then settles at full size', () => {
  assert.equal(popScale(-1), 0.4);
  assert.equal(popScale(0), 0.4);
  assert.ok(Math.abs(popScale(0.12) - 1.25) < 1e-9);
  assert.ok(popScale(0.2) > 1 && popScale(0.2) < 1.25);
  assert.equal(popScale(0.3), 1);
  assert.equal(popScale(5), 1);
});

// The rock is drawn the size of its hit circle: every point of its outline is within 15% inside to 5% outside r.
test('drawRock: the outline matches the hit circle and keeps its shape as it spins', () => {
  const outline = (rot) => {
    const pts = [];
    let depth = 0;
    const ctx = new Proxy(
      {},
      {
        get: (t, k) => {
          if (k === 'save') return () => depth++;
          if (k === 'restore') return () => depth--;
          if (k === 'moveTo' || k === 'lineTo') return (x, y) => pts.length < 9 && depth === 1 && pts.push(Math.hypot(x, y));
          return () => {};
        },
        set: () => true,
      },
    );
    drawRock(ctx, 500, 400, 60, rot, 1234, 1);
    return pts;
  };
  const a = outline(0);
  assert.equal(a.length, 9);
  for (const d of a) assert.ok(d <= 60 * 1.05 && d >= 60 * 0.85, `outline point at ${d}`);
  assert.deepEqual(outline(2.5), a); // same lumps whatever the rotation
});

// Older tablets (Safari before 16) have no ctx.roundRect: the HUD's timer bar threw on every frame there.
test('roundRectPath: square corners when the browser has no roundRect', () => {
  const calls = [];
  const old = { beginPath: () => calls.push('begin'), rect: () => calls.push('rect') };
  roundRectPath(old, 0, 0, 10, 10, 5);
  assert.deepEqual(calls, ['begin', 'rect']);
  const modern = { beginPath: () => calls.push('begin'), roundRect: () => calls.push('round'), rect: () => calls.push('rect') };
  calls.length = 0;
  roundRectPath(modern, 0, 0, 10, 10, 5);
  assert.deepEqual(calls, ['begin', 'round']);
});
