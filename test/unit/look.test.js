import test from 'node:test';
import assert from 'node:assert/strict';
import { lookOf } from '../../src/look.js';

// A 40x30 picture: red top-left quarter, blue bottom-left quarter, white elsewhere.
function picture() {
  const w = 40, h = 30;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const left = x < w / 2;
      const [r, g, b] = left ? (y < h / 2 ? [255, 0, 0] : [0, 0, 255]) : [255, 255, 255];
      rgba.set([r, g, b, 255], i);
    }
  return { rgba, w, h };
}
const lm = (sh, hip, knee) => {
  const a = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
  a[11] = { x: sh[0], y: sh[1] };
  a[12] = { x: sh[2], y: sh[1] };
  a[23] = { x: hip[0], y: hip[1] };
  a[24] = { x: hip[2], y: hip[1] };
  a[25] = { x: knee[0], y: knee[1] };
  a[26] = { x: knee[2], y: knee[1] };
  return a;
};

test('the look is the colour of the top and of the legs', () => {
  const { rgba, w, h } = picture();
  const person = lm([0.05, 0.05, 0.45], [0.1, 0.45, 0.4], [0.1, 0.95, 0.4]); // standing in the left half
  const look = lookOf(rgba, w, h, person);
  assert.deepEqual(look.map((v) => Math.round(v * 10) / 10), [1, 0, 0, 0, 0, 1]);
});

test('a body outside the picture has no look', () => {
  const { rgba, w, h } = picture();
  assert.equal(lookOf(rgba, w, h, lm([1.2, 0.1, 1.4], [1.2, 0.5, 1.4], [1.2, 0.9, 1.4])), null);
});
