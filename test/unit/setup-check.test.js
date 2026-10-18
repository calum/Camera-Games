import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeGraphics, softwareRendering, accelerationHelp, SetupCheck, SETUP_KEY, setupDone, saveSetupDone, shouldRunSetup, frameBrightness, judgeLight, judgeDistance, judgeSpeed, judgeCamera } from '../../src/setup-check.js';

const W = 1920;
const H = 1080;
// A standing kid: head at `top`, feet at `feet`, shoulders `sw` wide (screen pixels).
function kid({ top = 200, feet = 950, sw = 160 } = {}) {
  const px = Array.from({ length: 33 }, () => ({ x: 960, y: (top + feet) / 2 }));
  px[0] = { x: 960, y: top };
  px[11] = { x: 960 - sw / 2, y: top + 120 };
  px[12] = { x: 960 + sw / 2, y: top + 120 };
  px[27] = { x: 930, y: feet };
  px[28] = { x: 990, y: feet };
  return /** @type {any} */ ({ px, shoulderW: sw });
}

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('it is shown until it has passed once, then remembered; ?setup shows it again, ?nosetup and ?level skip it', () => {
  const s = memory();
  assert.equal(shouldRunSetup(new URLSearchParams(''), s), true);
  saveSetupDone(s);
  assert.equal(s.getItem(SETUP_KEY), '1');
  assert.equal(setupDone(s), true);
  assert.equal(shouldRunSetup(new URLSearchParams(''), s), false);
  assert.equal(shouldRunSetup(new URLSearchParams('setup'), s), true);
  assert.equal(shouldRunSetup(new URLSearchParams('nosetup'), memory()), false);
  assert.equal(shouldRunSetup(new URLSearchParams('level=bubbles'), memory()), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(setupDone(blocked), false, 'blocked storage: just show it');
  assert.doesNotThrow(() => saveSetupDone(blocked));
});

test('brightness of a picture, and plain-word advice about the light', () => {
  assert.equal(frameBrightness([0, 0, 0, 255, 0, 0, 0, 255]), 0);
  assert.equal(frameBrightness([255, 255, 255, 255]), 1);
  assert.ok(Math.abs(frameBrightness([128, 128, 128, 255]) - 0.5) < 0.01);
  assert.equal(judgeLight(null).ok, null);
  assert.equal(judgeLight(0.1).ok, false);
  assert.match(judgeLight(0.1).text, /turn on a light/);
  assert.equal(judgeLight(0.95).ok, false);
  assert.equal(judgeLight(0.5).ok, true);
});

test('distance: head to toe in view is good; cut-off feet or a huge kid means step back; a tiny kid means come closer', () => {
  assert.equal(judgeDistance([], W, H).ok, false);
  assert.match(judgeDistance([], W, H).text, /Step in front/);
  assert.equal(judgeDistance([], W, H, 3).ok, null, 'still looking in the first few tracked frames');
  assert.equal(judgeDistance([kid()], W, H).ok, true);
  assert.match(judgeDistance([kid({ feet: 1200 })], W, H).text, /Step back/);
  assert.match(judgeDistance([kid({ sw: 600 })], W, H).text, /Step back/);
  assert.match(judgeDistance([kid({ top: 5 })], W, H).text, /Step back/);
  assert.match(judgeDistance([kid({ sw: 50 })], W, H).text, /closer/);
  assert.equal(judgeDistance([kid(), kid({ feet: 1200 })], W, H).ok, false, 'every kid has to fit');
});

test('speed: waits for a few tracked frames, then flags slow tracking or a slow camera', () => {
  assert.equal(judgeSpeed(40, 30, 2).ok, null);
  assert.equal(judgeSpeed(40, 30, 10).ok, true);
  assert.equal(judgeSpeed(40, 0, 10).ok, true, 'camera rate not measured yet is not a fault');
  assert.match(judgeSpeed(400, 30, 10).text, /close other tabs/);
  assert.match(judgeSpeed(40, 8, 10).text, /camera is slow/);
  assert.equal(judgeCamera(false).ok, false);
  assert.equal(judgeCamera(true, 'HD Webcam').text, 'Camera: HD Webcam');
});

const good = { camera: { ok: true, text: '' }, light: { ok: true, text: '' }, distance: { ok: true, text: '' }, speed: { ok: true, text: '' } };
const run = (c, secs, checks) => {
  for (let t = 0; t < secs; t += 0.1) c.update(checks, 0.1);
};

test('passes once everything has been fine for a moment (not before 3 s), then says All set and finishes', () => {
  const c = new SetupCheck();
  run(c, 2, good);
  assert.equal(c.passed, false, 'not in the first 3 s, so the grown-up sees it');
  run(c, 1.2, good);
  assert.equal(c.passed, true);
  assert.equal(c.finished, false, 'a moment of "All set!" first');
  run(c, 1.6, good);
  assert.equal(c.finished, true);
});

test('a problem keeps it from passing; after 10 s it is overdue but still passes once the problem is fixed', () => {
  const c = new SetupCheck();
  const dark = { ...good, light: { ok: false, text: 'Too dark' } };
  run(c, 10.5, dark);
  assert.equal(c.passed, false);
  assert.equal(c.overdue, true);
  assert.equal(c.items.find((i) => i.name === 'light').text, 'Too dark');
  run(c, 1.2, good);
  assert.equal(c.passed, true);
  assert.equal(c.overdue, false);
  // still measuring counts as not passed yet
  const m = new SetupCheck();
  run(m, 5, { ...good, speed: { ok: null, text: '' } });
  assert.equal(m.passed, false);
  // a flicker restarts the "fine for a moment" clock
  const f = new SetupCheck();
  run(f, 2.5, good);
  run(f, 0.2, dark);
  run(f, 0.7, good);
  assert.equal(f.passed, false, 'only 0.7 s fine since the flicker');
  run(f, 0.5, good);
  assert.equal(f.passed, true);
});

test('graphics: a software renderer (acceleration off) or a pose model on the CPU is flagged, with where to turn it on', () => {
  assert.equal(judgeGraphics('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'GPU').ok, true);
  assert.equal(judgeGraphics('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'GPU').ok, false);
  assert.equal(judgeGraphics('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'GPU').ok, false);
  assert.equal(judgeGraphics('llvmpipe (LLVM 15.0.7, 256 bits)', 'GPU').ok, false);
  assert.equal(judgeGraphics('no WebGL', 'GPU').ok, false);
  assert.equal(softwareRendering('ANGLE (NVIDIA GeForce RTX 3060)', 'CPU'), true, 'the model fell back to the processor');
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.match(accelerationHelp(edge), /Edge: Settings > System and performance > .*Use graphics acceleration when available/);
  assert.match(accelerationHelp(chrome), /Chrome: Settings > System > /);
  assert.match(accelerationHelp('Mozilla/5.0 Firefox/130.0'), /hardware\) acceleration/);
});
