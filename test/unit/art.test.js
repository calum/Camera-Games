import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pictures that say whether they loaded, as the browser's Image does.
const made = [];
globalThis.Image = /** @type {any} */ (
  class {
    onload = () => {};
    onerror = () => {};
    src = '';
    constructor() {
      made.push(this);
    }
  }
);
const { loadArt, artVersion, drawCover, registerArt } = await import('../../src/art.js');

test('a family picture arriving late bumps artVersion, so cached drawings (picker thumbnails) are redrawn', () => {
  registerArt({ bg_test: { file: 'bg_test.png' } });
  loadArt();
  const before = artVersion();
  const ctx = { drawImage() {} };
  assert.equal(drawCover(ctx, 'bg_test', 100, 50), false, 'nothing yet: the cartoon scene is drawn');
  const img = made.find((m) => m.src.endsWith('/assets/bg_test.png'));
  img.width = 200;
  img.height = 100;
  img.onerror(); // a missing file changes nothing
  assert.equal(artVersion(), before);
  img.onload();
  assert.equal(artVersion(), before + 1);
  assert.equal(drawCover(ctx, 'bg_test', 100, 50), true, 'and now the picture is used');
});
