// End-to-end tests: a real browser, the real server, the real MediaPipe pose model,
// and a fake webcam that shows a photo of a person. No camera or kids needed.
//
//   npm run test:e2e        (needs Edge or Chrome; set BROWSER_PATH if it isn't found)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, startServer, makeFakeWebcamFile, launch, openGame, openWithCameras, waitForState, waitForPerson, wait } from './helpers.js';
import { createGameServer } from '../../server.mjs';

// Start a level by id (keys 1-9 only reach the first nine levels in src/levels/index.js).
const playLevel = (page, id) => page.evaluate((id) => window.__game.startLevel(window.__game.levels.findIndex((l) => l.id === id)), id);

const here = path.dirname(fileURLToPath(import.meta.url));
const photo = path.join(here, '..', 'fixtures', 'pose.jpg'); // man with arms straight out = "airplane"
const exe = findBrowser();
const skip = exe ? false : 'no Edge/Chrome found (set BROWSER_PATH)';

let server, url, webcamFile;

before(async () => {
  if (skip) return;
  ({ server, url } = await startServer());
  const b = await launch(exe);
  webcamFile = await makeFakeWebcamFile(b, photo);
  await b.close();
});

after(() => {
  server?.close();
  if (webcamFile) fs.rmSync(webcamFile, { force: true });
});

test('REAL CAMERA PIPELINE: model loads, camera starts, a person is found and their pose recognised', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url);
    await waitForState(page, 'menu', 60000); // wasm + model + camera all loaded
    const result = await page.evaluate(() => window.__game.g.notice);
    assert.equal(result, '', 'no "no camera" fallback notice, so the real camera path was used');

    await waitForPerson(page);
    const info = await page.evaluate(() => {
      const t = window.__game.tracker;
      const p = t.players[0];
      return {
        count: t.players.length,
        pose: p.pose,
        jumps: p.jumps,
        cx: p.cx,
        W: window.__game.g.W,
        shoulderW: p.shoulderW,
        delegate: t.delegate,
        detectMs: t.detectMs,
        videoSize: [t.video.videoWidth, t.video.videoHeight],
      };
    });
    assert.deepEqual(info.videoSize, [640, 480]);
    assert.equal(info.count, 1, 'exactly one person detected');
    assert.equal(info.pose.airplane, true, 'arms-out photo is recognised as the airplane pose');
    assert.equal(info.pose.armsUp, false);
    assert.equal(info.pose.handsHead, false);
    assert.equal(info.jumps, 0, 'a still photo never produces a jump');
    assert.ok(Math.abs(info.cx - info.W / 2) < info.W * 0.15, `person is near the screen centre (cx=${info.cx})`);
    assert.ok(info.shoulderW > 40, 'skeleton has a sensible size');
    // Only a "is it completely stuck?" check: the test browser uses a software renderer and the
    // average includes model warm-up. Judge real speed on the real laptop with the D key.
    assert.ok(info.detectMs < 3000, `tracking is not absurdly slow (${info.detectMs.toFixed(0)}ms)`);

    // The skeleton must be drawn over the camera picture (mirrored, aligned): screen is not blank.
    const nonBlank = await page.evaluate(() => {
      const c = document.getElementById('c').getContext('2d').getImageData(0, 0, 1280, 720).data;
      let lit = 0;
      for (let i = 0; i < c.length; i += 4 * 97) if (c[i] + c[i + 1] + c[i + 2] > 120) lit++;
      return lit;
    });
    assert.ok(nonBlank > 200, 'camera image is rendered behind the game');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('REAL CAMERA PLAY-THROUGH: start with the keyboard, hold the airplane pose in the dance level and score', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url);
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);

    await page.keyboard.press('Space'); // grown-up starts the game: the level picker
    await waitForState(page, 'pick', 5000);
    await page.keyboard.press('1'); // ...and picks level 1
    await waitForState(page, 'intro', 5000);
    assert.equal(await page.evaluate(() => window.__game.g.level.id), 'bubbles', 'key 1 plays level 1');
    await waitForState(page, 'play', 8000); // 3-second intro

    // jump straight to the dance level and make this round the "airplane" one (the photo's pose), for as long
    // as the test needs. Rounds are random: waiting for an airplane round to come up by chance failed ~1 run in 20.
    await playLevel(page, 'dance');
    await waitForState(page, 'play', 8000);
    await page.evaluate(() => {
      const level = window.__game.g.level;
      level.cur = { key: 'airplane', name: 'Be an airplane!' };
      level.roundT = -1000;
    });
    await page.waitForFunction(
      () => {
        const g = window.__game.g;
        return g.team.score >= 3 && g.players[0].score >= 3;
      },
      { timeout: 20000 }, // the pose has to be held for 0.8 s of tracking, which can be ~1 frame a second here
    );
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('FULL COLOUR (camera view): kids see the camera picture at full brightness, with only a thin skeleton on top; K cycles the look', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?view=camera');
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    await page.keyboard.press('Space');
    await playLevel(page, 'dance'); // dance level: nothing drawn over the left side of the screen
    await waitForState(page, 'play', 10000);
    await wait(500);

    const r = await page.evaluate(() => {
      const t = window.__game.tracker;
      const rect = t.videoRect();
      const c = document.getElementById('c');
      // what the camera picture alone looks like at this size
      const off = document.createElement('canvas');
      off.width = c.width;
      off.height = c.height;
      const x = off.getContext('2d');
      x.translate(rect.x + rect.w, rect.y);
      x.scale(-1, 1);
      x.drawImage(t.video, 0, 0, rect.w, rect.h);
      const lum = (ctx, sx, sy, w, h) => {
        const d = ctx.getImageData(sx, sy, w, h).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        return s / (d.length / 4);
      };
      const region = [Math.round(c.width * 0.03), Math.round(c.height * 0.55), Math.round(c.width * 0.2), Math.round(c.height * 0.25)];
      return { game: lum(c.getContext('2d'), ...region), camera: lum(x, ...region), skeleton: window.__game.g.skeleton };
    });
    assert.ok(r.camera > 60, `test picture is not black (${r.camera.toFixed(0)})`);
    const ratio = r.game / r.camera;
    assert.ok(ratio > 0.88 && ratio < 1.1, `game shows the camera at ${(ratio * 100).toFixed(0)}% brightness (was ~65% before)`);
    assert.equal(r.skeleton, 'thin');

    // K cycles thin -> bold -> off -> thin
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('k');
      seen.push(await page.evaluate(() => window.__game.g.skeleton));
    }
    assert.deepEqual(seen, ['bold', 'off', 'thin']);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

// Average colour of a small square of the game canvas around (fx, fy) given as fractions of the screen.
const patch = (page, fx, fy, r = 6) =>
  page.evaluate(
    (fx, fy, r) => {
      const c = document.getElementById('c');
      const d = c.getContext('2d').getImageData(Math.round(c.width * fx) - r, Math.round(c.height * fy) - r, 2 * r, 2 * r).data;
      const n = d.length / 4;
      let R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
      return { r: R / n, g: G / n, b: B / n };
    },
    fx,
    fy,
    r,
  );

// What is behind the kids right now? Compare the game's pixels, over several spots on the left side of
// the screen (clear of the kid and the HUD), with (a) the cartoon backdrop drawn alone at this very
// instant and (b) the raw camera picture. Returns the mean colour distance to each. (A fixed colour
// check is flaky: the disco's spotlight beams sweep across any single patch.)
const backgroundSource = (page) =>
  page.evaluate(() => {
    const { g, backdrops, tracker } = window.__game;
    const c = document.getElementById('c');
    const W = c.width;
    const H = c.height;
    const off = () => {
      const o = document.createElement('canvas');
      o.width = W;
      o.height = H;
      return o;
    };
    const bd = off();
    backdrops.draw(bd.getContext('2d'), g.level?.id ?? 'menu', W, H, g.now);
    const cam = off();
    const cx = cam.getContext('2d');
    const r = tracker.videoRect();
    cx.translate(r.x + r.w, r.y);
    cx.scale(-1, 1);
    cx.drawImage(tracker.video, 0, 0, r.w, r.h);
    const avg = (ctx, fx, fy) => {
      const d = ctx.getImageData(Math.round(W * fx) - 6, Math.round(H * fy) - 6, 12, 12).data;
      let R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
      const n = d.length / 4;
      return [R / n, G / n, B / n];
    };
    const spots = [[0.04, 0.3], [0.04, 0.6], [0.04, 0.75], [0.1, 0.3], [0.1, 0.6], [0.1, 0.75]];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let dBackdrop = 0, dCamera = 0;
    for (const [fx, fy] of spots) {
      const game = avg(c.getContext('2d'), fx, fy);
      dBackdrop += dist(game, avg(bd.getContext('2d'), fx, fy));
      dCamera += dist(game, avg(cx, fx, fy));
    }
    return { dBackdrop: dBackdrop / spots.length, dCamera: dCamera / spots.length };
  });

test('CUT-OUT: only the kid is shown (cut out of the camera picture) in front of a cartoon world', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    // ?model=full pins the model so it can't be swapped mid-test on a slow machine
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    await page.keyboard.press('Space');
    await playLevel(page, 'dance'); // dance level = dark purple disco
    await waitForState(page, 'play', 10000);
    await page.waitForFunction(() => window.__game.cutoutReady && window.__game.cutout.stats.coverage > 0.01, { timeout: 15000 });
    await wait(400);

    const stats = await page.evaluate(() => ({ ...window.__game.cutout.stats, view: window.__game.g.view }));
    assert.equal(stats.view, 'cutout', 'cut-out is the default view');
    assert.equal(stats.poseActive, true, 'driven by the pose model silhouette');
    assert.ok(stats.coverage > 0.02 && stats.coverage < 0.3, `only a person-sized part of the screen is shown (${(stats.coverage * 100).toFixed(1)}%)`);

    // The photo's background is bright blue sky / sea; the game must show the disco there instead.
    const src = await backgroundSource(page);
    assert.ok(src.dBackdrop < 25, `background matches the cartoon backdrop (distance ${src.dBackdrop.toFixed(0)})`);
    assert.ok(src.dCamera > 40, `...and is NOT the camera's sky and sea (distance ${src.dCamera.toFixed(0)})`);
    // ...while the man's face (warm skin tones) is shown where he stands.
    const face = await patch(page, 0.52, 0.4, 5);
    assert.ok(face.r > face.b + 15 && face.r > 70, `the kid is visible (${face.r.toFixed(0)},${face.g.toFixed(0)},${face.b.toFixed(0)})`);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CUT-OUT: B switches between the cut-out and the whole camera picture', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    await page.keyboard.press('Space');
    await playLevel(page, 'dance');
    await waitForState(page, 'play', 10000);
    await wait(1200);
    const showsCamera = async () => {
      const s = await backgroundSource(page);
      return s.dCamera < 25 && s.dBackdrop > 40;
    };
    const showsBackdrop = async () => {
      const s = await backgroundSource(page);
      return s.dBackdrop < 25 && s.dCamera > 40;
    };
    assert.equal(await showsBackdrop(), true, 'cut-out view: the cartoon backdrop is behind the kid');
    await page.keyboard.press('b');
    await wait(300);
    assert.equal(await page.evaluate(() => window.__game.g.view), 'camera');
    assert.equal(await showsCamera(), true, 'camera view: the real camera picture fills the screen');
    await page.keyboard.press('b');
    await wait(300);
    assert.equal(await page.evaluate(() => window.__game.g.view), 'cutout');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CUT-OUT: a pose-tracking glitch fades the kid out gently instead of popping, and they return when tracking does', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    await page.keyboard.press('Space');
    await playLevel(page, 'dance');
    await waitForState(page, 'play', 10000);
    await page.waitForFunction(() => window.__game.cutoutReady && window.__game.cutout.stats.coverage > 0.02, { timeout: 15000 });
    await wait(1500);

    // make the pose model "lose" everyone on demand (the tracker's test switch: answers arrive, but empty)
    await page.evaluate(() => {
      Object.defineProperty(window, '__lost', { set: (v) => (window.__game.tracker.simulateLost = v), get: () => window.__game.tracker.simulateLost, configurable: true });
    });
    const coverage = () => page.evaluate(() => window.__game.cutout.stats.coverage);
    const before = await coverage();
    assert.ok(before > 0.02, `kid shown before the glitch (${before})`);

    // tracking runs at its own pace (slowly in a software-rendered test browser), so start the clock when
    // the first empty answer has really come back from the model
    const seq = await page.evaluate(() => ((window.__lost = true), window.__game.tracker.frameSeq));
    await page.waitForFunction((s) => window.__game.tracker.frameSeq > s, { timeout: 10000 }, seq);
    await wait(250);
    const early = await coverage();
    assert.ok(early > before * 0.6, `0.25s after losing the pose the kid is still there (${early.toFixed(3)} vs ${before.toFixed(3)})`);
    assert.equal(await page.evaluate(() => window.__game.cutout.stats.poseActive), false, 'the pose mask really is gone');

    await wait(5500);
    const late = await coverage();
    assert.ok(late < before * 0.2, `a kid whose tracking never comes back eventually fades out (${late.toFixed(3)})`);

    await page.evaluate(() => (window.__lost = false));
    await page.waitForFunction((b) => window.__game.cutout.stats.coverage > b * 0.8, { timeout: 5000 }, before);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

// Play-test bug: half way through a game the picture of the kids vanished and only skeletons were left. The
// quality ladder had stepped down to its last rung, where the model gives no silhouettes for the cut-out.
test('CUT-OUT: on the cheapest tracking rung (no silhouettes from the model) the kid is still shown', { skip }, async () => {
  const browser = await launch(exe, camArgs());
  try {
    const { page, problems } = await openGame(browser, url + '?quality=lowest');
    await waitForState(page, 'menu', 60000);
    await page.waitForFunction(() => window.__game.tracker.players.some((p) => p.present), { timeout: 20000 });
    await page.keyboard.press('Space');
    await playLevel(page, 'dance');
    await waitForState(page, 'play', 10000);
    // well past the ~0.9 s it takes a kid with no silhouette to fade out
    const seq = await page.evaluate(() => window.__game.tracker.frameSeq);
    await page.waitForFunction((s) => window.__game.tracker.frameSeq >= s + 8, { timeout: 60000 }, seq);
    const stats = await page.evaluate(() => ({ ...window.__game.cutout.stats, ready: window.__game.cutoutReady, masks: window.__game.tracker.quality.masks }));
    assert.equal(stats.masks, false, 'the model really runs without silhouettes');
    assert.equal(stats.ready, true);
    assert.ok(stats.coverage > 0.02 && stats.coverage < 0.3, `the kid is still cut out (${(stats.coverage * 100).toFixed(1)}% of the picture)`);
    const face = await patch(page, 0.52, 0.4, 5);
    assert.ok(face.r > face.b + 15 && face.r > 70, `the kid is visible (${face.r.toFixed(0)},${face.g.toFixed(0)},${face.b.toFixed(0)})`);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('BACKDROPS: every level has its own cartoon world and they all draw cleanly', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    const sigs = await page.evaluate(() => {
      const { backdrops } = window.__game;
      const W = 1280, H = 720;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      const out = {};
      for (const id of ['menu', 'bubbles', 'dodge', 'jump', 'dance', 'finale']) {
        x.clearRect(0, 0, W, H);
        backdrops.draw(x, id, W, H, 3.7);
        // 4x4 grid of average colours = a fingerprint of the scene
        const sig = [];
        for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
          const d = x.getImageData((gx * W) / 4, (gy * H) / 4, W / 4, H / 4).data;
          let r = 0, g = 0, b = 0, a = 0;
          for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; }
          const n = d.length / 16;
          sig.push([r / n, g / n, b / n, a / n]);
        }
        out[id] = sig;
      }
      return out;
    });
    const ids = Object.keys(sigs);
    for (const id of ids) {
      assert.ok(sigs[id].every((p) => p[3] > 250), `${id} fills the whole screen`);
    }
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const d = sigs[ids[i]].reduce((s, p, k) => s + Math.hypot(p[0] - sigs[ids[j]][k][0], p[1] - sigs[ids[j]][k][1], p[2] - sigs[ids[j]][k][2]), 0) / 16;
        assert.ok(d > 25, `${ids[i]} and ${ids[j]} look different (distance ${d.toFixed(0)})`);
      }
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

// Runs inside the page before the game: records every camera request the game makes.
const spyOnCamera = () => {
  window.__gum = [];
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => {
    window.__gum.push(JSON.parse(JSON.stringify(c)));
    return real(c);
  };
};
// ...and pretends the camera only delivers 8 frames a second (like a cheap webcam struggling at 720p).
const slowCamera = () => {
  HTMLVideoElement.prototype.requestVideoFrameCallback = function (cb) {
    setTimeout(() => cb(performance.now()), 125);
    return 1;
  };
};
const camArgs = (extra = []) => [`--use-file-for-fake-video-capture=${webcamFile}`, ...extra];

test('CAMERA: asks for 16:9 720p by default so the webcam uses its full field of view; ?cam=standard asks for 640x480', { skip }, async () => {
  let browser = await launch(exe, camArgs());
  try {
    let { page, problems } = await openGame(browser, url + '?model=full', { init: spyOnCamera });
    await waitForState(page, 'menu', 60000);
    let gum = await page.evaluate(() => window.__gum);
    assert.equal(gum.length, 1, 'one camera request');
    assert.deepEqual([gum[0].video.width.ideal, gum[0].video.height.ideal, gum[0].video.frameRate.ideal], [1280, 720, 30]);
    assert.equal(gum[0].video.facingMode, 'user');
    assert.deepEqual(problems, []);

    ({ page, problems } = await openGame(browser, url + '?model=full&cam=standard', { init: spyOnCamera }));
    await waitForState(page, 'menu', 60000);
    gum = await page.evaluate(() => window.__gum);
    assert.deepEqual([gum[0].video.width.ideal, gum[0].video.height.ideal], [640, 480]);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CAMERA: C switches between cameras, says which one on screen, and the choice is remembered', { skip }, async () => {
  // three built-in test cameras (with the photo-as-webcam flag the browser only reports one camera)
  const { browser, page, problems } = await openWithCameras(exe, url + '?model=full', { init: spyOnCamera });
  try {
    const first = await page.evaluate(() => ({ id: window.__game.tracker.deviceId }));
    assert.ok(first.id, 'knows which camera it is using');

    await page.keyboard.press('c');
    await page.waitForFunction((id) => window.__game.tracker.deviceId !== id, { timeout: 15000 }, first.id);
    // the message and the saved choice are written just after the switch completes
    await page.waitForFunction(() => /Camera \d of \d/.test(window.__game.g.toast?.text ?? '') && localStorage.getItem('kcg.camera') === window.__game.tracker.deviceId, { timeout: 10000 });
    const second = await page.evaluate(() => ({
      id: window.__game.tracker.deviceId,
      toast: window.__game.g.toast?.text,
      saved: localStorage.getItem('kcg.camera'),
    }));
    assert.notEqual(second.id, first.id, 'a different camera');
    assert.match(second.toast, /Camera \d of \d/);
    assert.equal(second.saved, second.id, 'choice saved');
    const gum = await page.evaluate(() => window.__gum);
    assert.deepEqual(gum.at(-1).video.deviceId, { exact: second.id }, 'asked for exactly that camera');
    // the new camera is live
    await page.waitForFunction(() => window.__game.tracker.video.readyState >= 2 && window.__game.tracker.video.videoWidth > 0, { timeout: 30000 });

    // pressing C enough times comes back round to the first camera
    for (let i = 0; i < 2; i++) {
      const before = await page.evaluate(() => window.__game.tracker.deviceId);
      await page.keyboard.press('c');
      await page.waitForFunction((id) => window.__game.tracker.deviceId !== id && localStorage.getItem('kcg.camera') === window.__game.tracker.deviceId, { timeout: 15000 }, before);
    }
    assert.equal(await page.evaluate(() => window.__game.tracker.deviceId), first.id, 'wraps round');

    // a fresh page start picks up the remembered camera
    await page.keyboard.press('c');
    await page.waitForFunction((id) => window.__game.tracker.deviceId !== id && localStorage.getItem('kcg.camera') === window.__game.tracker.deviceId, { timeout: 15000 }, first.id);
    const remembered = await page.evaluate(() => localStorage.getItem('kcg.camera'));
    const page2 = (await openGame(browser, url + '?model=full', { init: spyOnCamera })).page;
    await waitForState(page2, 'menu', 60000);
    assert.equal(await page2.evaluate(() => window.__game.tracker.deviceId), remembered, 'starts on the remembered camera');
    assert.deepEqual((await page2.evaluate(() => window.__gum))[0].video.deviceId, { exact: remembered });
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CAMERA: mashing C does not start overlapping switches (extra presses are ignored until the switch is done)', { skip }, async () => {
  const { browser, page, problems } = await openWithCameras(exe, url + '?model=full', { init: spyOnCamera });
  try {
    const before = await page.evaluate(() => window.__gum.length);
    for (let i = 0; i < 8; i++) await page.keyboard.press('c'); // hammered in a few milliseconds
    await page.waitForFunction(() => /Camera \d of \d/.test(window.__game.g.toast?.text ?? ''), { timeout: 15000 });
    await wait(1500);
    const used = await page.evaluate((b) => window.__gum.length - b, before);
    assert.ok(used <= 2, `8 quick presses opened the camera ${used} time(s), not 8`);
    assert.equal(await page.evaluate(() => window.__game.tracker.video.readyState >= 2), true, 'and the camera is still live');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CAMERA: with only one camera, C explains instead of breaking', { skip }, async () => {
  const browser = await launch(exe, camArgs());
  try {
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    const id = await page.evaluate(() => window.__game.tracker.deviceId);
    await page.keyboard.press('c');
    await page.waitForFunction(() => /Only one camera/.test(window.__game.g.toast?.text ?? ''), { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__game.tracker.deviceId), id, 'still on the same camera');
    assert.equal(await page.evaluate(() => window.__game.tracker.video.readyState >= 2), true, 'and still live');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CAMERA: a webcam that struggles at 720p (about 8 fps) is quietly switched to 640x480', { skip }, async () => {
  const browser = await launch(exe, camArgs());
  try {
    const { page, problems } = await openGame(browser, url + '?model=full', { init: [spyOnCamera, slowCamera] });
    await waitForState(page, 'menu', 60000);
    await page.waitForFunction(() => window.__gum.length >= 2, { timeout: 30000 });
    const gum = await page.evaluate(() => window.__gum);
    assert.equal(gum[0].video.width.ideal, 1280, 'first tried 720p');
    assert.equal(gum[1].video.width.ideal, 640, 'then fell back to 640x480');
    await page.waitForFunction(() => window.__game.tracker.mode === 'standard', { timeout: 15000 });
    await page.waitForFunction(() => window.__game.tracker.video.readyState >= 2, { timeout: 15000 });
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('CAMERA: ?cam=wide pins the picture size: a slow camera is NOT switched', { skip }, async () => {
  const browser = await launch(exe, camArgs());
  try {
    const { page, problems } = await openGame(browser, url + '?model=full&cam=wide', { init: [spyOnCamera, slowCamera] });
    await waitForState(page, 'menu', 60000);
    await wait(7000); // longer than the fallback needs to decide
    assert.equal((await page.evaluate(() => window.__gum)).length, 1);
    assert.equal(await page.evaluate(() => window.__game.tracker.mode), 'wide');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('ON-SCREEN TEXT: every string the game paints is intact, in the menu, the picker, every level and the end of a level', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    // record every string drawn to the canvas
    await page.evaluate(() => {
      window.__texts = new Set();
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (s, ...a) {
        window.__texts.add(String(s));
        return orig.call(this, s, ...a);
      };
    });
    await page.mouse.move(640, 300);
    await wait(400);
    const ids = await page.evaluate(() => window.__game.levels.map((l) => l.id));
    for (const id of ids) {
      await playLevel(page, id);
      await waitForState(page, 'play', 10000);
      if (id === 'dance') for (const k of ['q', 'w', 'e']) await page.keyboard.down(k); // hold every pose
      for (let i = 0; i < 55; i++) {
        await page.mouse.move(200 + ((i * 97) % 900), 150 + ((i * 53) % 400));
        if ((id === 'jump' || id === 'duckjump') && i % 8 === 0) {
          await page.mouse.down();
          await wait(40);
          await page.mouse.up();
        }
        await wait(100);
      }
      for (const k of ['q', 'w', 'e']) await page.keyboard.up(k);
    }
    await page.evaluate(() => window.__game.g.endLevel('Level complete!')); // the end-of-level screen
    await waitForState(page, 'outro', 5000);
    await waitForState(page, 'pick', 8000); // then the picker
    await wait(600);

    const texts = await page.evaluate(() => [...window.__texts]);
    // Garbled UTF-8 shows up as a Latin lead letter (char code 0xE2, 0xC3 or 0xF0) followed by a junk character.
    const LEAD = [0xe2, 0xc3, 0xf0];
    const garbled = texts.filter((s) => [...s].some((c, i, arr) => LEAD.includes(c.charCodeAt(0)) && i + 1 < arr.length));
    assert.deepEqual(garbled, [], 'no garbled text on screen');
    // ...and the real symbols did get drawn: wave arrows, score stars, dance ticks, winner crown
    const joined = texts.join('\n');
    for (const [sym, what] of [['→', 'wave countdown arrow'], ['★', 'score star'], ['✓', 'dance tick'], ['👑', 'winner crown']])
      assert.ok(joined.includes(sym), `${what} was drawn`);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('MOUSE MODE: every level in the list can be started (keys 1-9) and played without errors', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.mouse.move(640, 300);

    const ids = await page.evaluate(() => window.__game.levels.map((l) => l.id));
    assert.ok(ids.length >= 4, `levels: ${ids}`);
    for (const [i, id] of ids.slice(0, 9).entries()) {
      await page.keyboard.press(String(i + 1));
      await waitForState(page, 'play', 8000);
      assert.equal(await page.evaluate(() => window.__game.g.level.id), id);
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(200 + ((i * 131) % 900), 150 + ((i * 71) % 400));
        await wait(60);
      }
    }
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('MOUSE MODE: popping bubbles scores for the player and the team', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.keyboard.press('1');
    await waitForState(page, 'play', 8000);
    // Park the "hand" on whatever bubble is on screen until something pops.
    await page.waitForFunction(
      () => {
        const g = window.__game.g;
        const b = g.level.items[0];
        if (b) window.__game.tracker.pos = { x: b.x, y: b.y };
        return g.team.score > 0;
      },
      { polling: 30, timeout: 20000 },
    );
    const s = await page.evaluate(() => ({ team: window.__game.g.team.score, p: window.__game.g.players[0].score }));
    assert.ok(s.team >= 1 && s.p >= 1);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('MOUSE MODE: a well-timed jump scores in the jump level, standing still does not', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.mouse.move(640, 300);
    await page.keyboard.press('3');
    await waitForState(page, 'play', 8000);

    const waveNear = () =>
      page.waitForFunction(
        () => window.__game.g.level.waves.some((w) => w.t >= 0 && ((w.dir > 0 && w.x > 300 && w.x < 560) || (w.dir < 0 && w.x < 980 && w.x > 720))),
        { polling: 20, timeout: 15000 },
      );

    const firstFeedback = async () => {
      await page.waitForFunction(() => window.__game.g.level.feedback.length > 0, { polling: 20, timeout: 5000 });
      return page.evaluate(() => {
        const p = window.__game.g.players[0];
        return { ...window.__game.g.level.feedback[0], flashing: p.flashUntil > window.__game.g.now };
      });
    };

    await waveNear(); // 1st wave: stand still
    const miss = await firstFeedback();
    assert.equal(miss.ok, false);
    assert.match(miss.text, /SPLASH|EARLY/, 'a miss is clearly announced on screen');
    assert.equal(miss.flashing, true, 'and the skeleton flashes');
    assert.equal(await page.evaluate(() => window.__game.g.players[0].score), 0, 'no jump, no points');

    await page.waitForFunction(() => window.__game.g.level.feedback.length === 0, { timeout: 5000 }); // message goes away
    await waveNear(); // 2nd wave: jump
    await page.mouse.down();
    await wait(120);
    await page.mouse.up();
    const hit = await firstFeedback();
    assert.equal(hit.ok, true);
    assert.match(hit.text, /NICE JUMP/, 'a good jump is clearly celebrated on screen');
    assert.equal(hit.flashing, true);
    assert.equal(await page.evaluate(() => window.__game.g.players[0].score), 1, 'one jump, one point');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('PICKER (mouse mode): scroll to a level and hold both arms up to play it, then come back to the picker, not the next level', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.mouse.move(640, 650);
    await page.keyboard.press('Space');
    await waitForState(page, 'pick', 3000);
    const ids = await page.evaluate(() => window.__game.levels.map((l) => l.id));
    assert.equal(await page.evaluate(() => window.__game.carousel.index), 0, 'starts on the first game');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => window.__game.carousel.index), 3);
    // both arms up (Q in mouse mode) until the ring fills
    const t0 = Date.now();
    await page.keyboard.down('q');
    await waitForState(page, 'intro', 8000);
    await page.keyboard.up('q');
    assert.ok(Date.now() - t0 > 700, 'it takes a deliberate hold');
    assert.equal(await page.evaluate(() => window.__game.g.level.id), ids[3]);
    // finish the level: back to the picker, with no level running and the game just played in the middle
    await waitForState(page, 'play', 8000);
    await page.evaluate(() => window.__game.g.endLevel('Level complete!'));
    await waitForState(page, 'pick', 10000);
    assert.equal(await page.evaluate(() => window.__game.g.level), null, 'no level runs on by itself');
    assert.equal(await page.evaluate(() => window.__game.carousel.index), 3, '"again!" is one arms-up away');
    await wait(3000);
    assert.equal(await page.evaluate(() => window.__game.state), 'pick', 'still waiting for a choice');
    // the grown-up can tap: a side card scrolls to it, the middle card plays
    const tapCard = async (off) => {
      const pt = await page.evaluate((off) => {
        const c = document.getElementById('c');
        const r = window.__game.pickCards().find((card) => Math.round(card.off) === off).rect;
        const k = c.getBoundingClientRect().width / c.width;
        return { x: (r.x + r.w / 2) * k, y: (r.y + r.h / 2) * k };
      }, off);
      await page.mouse.click(pt.x, pt.y);
    };
    await tapCard(1);
    await wait(500);
    assert.equal(await page.evaluate(() => window.__game.carousel.index), 4);
    assert.equal(await page.evaluate(() => window.__game.state), 'pick', 'a side card only scrolls');
    await tapCard(0);
    await waitForState(page, 'intro', 2000);
    assert.equal(await page.evaluate(() => window.__game.g.level.id), ids[4]);
    // Esc: from a level back to the picker, then to the join screen
    await page.keyboard.press('Escape');
    await waitForState(page, 'pick', 2000);
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu', 2000);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('AUTO-START (real camera): a kid holding their arms out starts the game by themselves after ~3 seconds', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]); // photo = arms out
  try {
    const { page, problems } = await openGame(browser, url);
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    const t0 = Date.now();
    // The game counts the hold in game time: each frame adds at most 0.05 s, so on a slow test machine game time
    // falls behind the clock. Count game time the same way, so the upper limit doesn't fail just because frames are slow.
    await page.evaluate(() => {
      window.__gameSecs = 0;
      let last = performance.now();
      const tick = (ts) => {
        window.__gameSecs += Math.min(0.05, (ts - last) / 1000);
        last = ts;
        if (window.__game.state === 'menu') requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    assert.equal(await page.evaluate(() => window.__game.state), 'menu', 'does not start instantly');
    await waitForState(page, 'pick', 60000); // nobody touched the keyboard: on to the level picker
    const secs = (Date.now() - t0) / 1000;
    const gameSecs = await page.evaluate(() => window.__gameSecs);
    assert.ok(secs >= 2.5, `not before ~3 s of arms-out (${secs.toFixed(1)} s)`);
    assert.ok(gameSecs < 8, `started after ${gameSecs.toFixed(1)} s of game time (${secs.toFixed(1)} s on the clock)`);
    const joined = await page.evaluate(() => ({ playing: window.__game.g.activePlayers().length, excluded: window.__game.g.players.filter((p) => p.excluded).length }));
    assert.deepEqual(joined, { playing: 1, excluded: 0 });
    // the kid keeps their arms out like an airplane in the picker: that is both hands out at once, so it must
    // neither scroll nor play a game
    const seq = await page.evaluate(() => window.__game.tracker.frameSeq);
    await page.waitForFunction((s) => window.__game.tracker.frameSeq >= s + 6, { timeout: 60000 }, seq);
    assert.deepEqual(await page.evaluate(() => ({ state: window.__game.state, index: window.__game.carousel.index })), { state: 'pick', index: 0 });
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('PLAY SPACE (real camera): after joining, the kids show their play space before the picker; P redoes it, Space skips it, a new group from the menu walks again', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full', { calibrate: true });
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    await page.keyboard.press('Space');
    await waitForState(page, 'calibrate', 5000);
    // the photo kid stands still, so each side is believed after a few seconds where they stand
    await waitForState(page, 'pick', 120000);
    const r = await page.evaluate(() => ({ area: window.__game.g.area, cx: window.__game.g.players[0]?.cx / window.__game.g.W }));
    assert.ok(r.area, 'the play space was measured');
    assert.ok(r.area.x0 <= r.cx && r.cx <= r.area.x1, `the kid is inside their play space (${JSON.stringify(r)})`);
    assert.ok(r.area.x1 - r.area.x0 >= 0.3 - 1e-9, 'a kid who stood still never shrinks the game to nothing');
    assert.ok(r.area.reach0 <= r.area.x0 && r.area.reach1 >= r.area.x1);
    // P in the picker measures it again; a grown-up can skip with Space, back to the picker
    await page.keyboard.press('p');
    await waitForState(page, 'calibrate', 3000);
    await page.keyboard.press('Space');
    await waitForState(page, 'pick', 3000);
    // back to the join screen and a new group starts: they show the game their own play space
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu', 3000);
    await page.keyboard.press('Space');
    await waitForState(page, 'calibrate', 3000);
    await page.keyboard.press('Space'); // skipping keeps the space measured before
    await waitForState(page, 'pick', 3000);
    assert.ok(await page.evaluate(() => window.__game.g.area), 'a skipped walk keeps the last play space');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('AUTO-START (mouse mode): holding the airplane pose (W) for 3s starts the game; releasing early does not', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.mouse.move(640, 300);

    await page.keyboard.down('w'); // arms out for only ~1.5s...
    await wait(1500);
    await page.keyboard.up('w');
    await wait(1200); // ...then drop them: countdown is cancelled
    assert.equal(await page.evaluate(() => window.__game.state), 'menu');
    assert.equal(await page.evaluate(() => window.__game.g.activePlayers()[0].excluded), undefined);

    const t0 = Date.now();
    await page.keyboard.down('w');
    await waitForState(page, 'pick', 10000);
    await page.keyboard.up('w');
    const secs = (Date.now() - t0) / 1000;
    assert.ok(secs >= 2.8 && secs < 5, `took ${secs.toFixed(1)}s`);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('JOINING: a kid who does not put their arms out is left out of the game (no score, no hits, not in finale)', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.mouse.move(400, 300);

    // Add a second, visible kid standing at the right who never does the airplane pose.
    await page.evaluate(async () => {
      const { computeFeatures } = await import('/src/tracker.js');
      const t = window.__game.tracker;
      const orig = t.update.bind(t);
      let bystander = null;
      const stand = (cx) => {
        const px = Array.from({ length: 33 }, () => ({ x: cx, y: 360 }));
        const set = (i, x, y) => (px[i] = { x, y });
        set(0, cx, 130); set(11, cx - 33, 200); set(12, cx + 33, 200);
        set(23, cx - 27, 335); set(24, cx + 27, 335); set(25, cx - 27, 470); set(26, cx + 27, 470);
        set(15, cx - 40, 300); set(16, cx + 40, 300); set(19, cx - 40, 310); set(20, cx + 40, 310);
        return px;
      };
      t.update = (now) => {
        const ps = orig(now);
        bystander ??= { id: 99, color: '#ffffff', score: 0, jumps: 0, lastJump: -99, hitUntil: 0, pose: {}, px: stand(1000) };
        bystander.seen = now;
        bystander.present = true;
        computeFeatures(bystander, now, { skipJump: true });
        bystander.pose = { armsUp: false, airplane: false, handsHead: false };
        return [...ps, bystander];
      };
      window.__bystander = () => bystander;
    });
    await wait(300);
    assert.equal(await page.evaluate(() => window.__game.g.activePlayers().length), 2, 'both kids visible in the lobby');

    await page.keyboard.down('w');
    await waitForState(page, 'pick', 10000);
    await page.keyboard.up('w');
    await page.keyboard.press('1'); // bubbles

    const after = await page.evaluate(() => ({
      playing: window.__game.g.activePlayers().map((p) => p.id),
      bystanderExcluded: window.__bystander().excluded,
    }));
    assert.deepEqual(after.playing, [1], 'only the kid with arms out is playing');
    assert.equal(after.bystanderExcluded, true);

    // They stay out of the action: bubbles popped by the bystander's hands don't score for them.
    await waitForState(page, 'play', 8000);
    await page.evaluate(() => {
      const b = window.__bystander();
      window.__game.g.level.items = [{ x0: b.hands[0].x, x: b.hands[0].x, y: b.hands[0].y, r: 80, vy: 0, amp: 0, f: 1, ph: 0, gold: false }];
      window.__game.g.level.spawn = 999;
    });
    await wait(500);
    assert.equal(await page.evaluate(() => window.__bystander().score), 0, 'bystander cannot score');
    assert.equal(await page.evaluate(() => window.__game.g.level.items.length), 1, 'their hands do not pop bubbles');

    // Going back to the menu (Esc twice: level -> picker -> menu) gives everybody a fresh chance to join.
    await page.keyboard.press('Escape');
    await waitForState(page, 'pick', 3000);
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu', 3000);
    assert.equal(await page.evaluate(() => window.__bystander().excluded), false);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('FALLBACK: with no camera available the game still starts, in mouse mode, with a notice', { skip }, async () => {
  // Deny camera access by not passing the fake-device flags.
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--deny-permission-prompts', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])], defaultViewport: { width: 1280, height: 720 } });
  try {
    const { page } = await openGame(browser, url);
    await waitForState(page, 'menu', 60000);
    const notice = await page.evaluate(() => window.__game.g.notice);
    assert.match(notice, /No camera/);
    assert.equal(await page.evaluate(() => window.__game.tracker.delegate), 'mouse');
  } finally {
    await browser.close();
  }
});

test('SMOOTH DRAWING: the pose model runs in a worker, so the game keeps drawing while a frame is tracked', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    const info = await page.evaluate(async () => {
      const t = window.__game.tracker;
      // count drawn frames and tracked frames over 3 s
      const f0 = t.frameSeq;
      let drawn = 0;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => (++drawn, performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      });
      return { worker: t.useWorker, tracked: t.frameSeq - f0, drawn, airplane: t.players[0]?.pose.airplane };
    });
    assert.equal(info.worker, true, 'tracking runs in a Web Worker');
    assert.ok(info.tracked >= 1, `frames are being tracked (${info.tracked})`);
    assert.ok(info.drawn > info.tracked * 3, `the game draws more often than it tracks (${info.drawn} drawn, ${info.tracked} tracked)`);
    assert.equal(info.airplane, true, 'and the pose is still recognised');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('SETUP CHECK: a first launch checks camera, light, distance, speed and graphics acceleration in plain words; SPACE skips it; it is not remembered until it passes', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full', { setup: true });
    await waitForState(page, 'setup', 60000);
    // wait for every check to have an answer (speed needs a few tracked frames)
    await page.waitForFunction(() => window.__game.setup.items.length === 5 && window.__game.setup.items.every((c) => c.ok !== null), { timeout: 300000, polling: 200 });
    const items = await page.evaluate(() => Object.fromEntries(window.__game.setup.items.map((c) => [c.name, c])));
    assert.deepEqual(Object.keys(items), ['camera', 'light', 'distance', 'speed', 'graphics']);
    // headless test browsers usually draw in software (SwiftShader): the graphics row must agree with the renderer
    const soft = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const r = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)) || 'no WebGL';
      return /swiftshader|llvmpipe|softpipe|software|basic render|no webgl/i.test(r) || window.__game.tracker.delegate === 'CPU';
    });
    assert.equal(items.graphics.ok, !soft, items.graphics.text);
    assert.equal(items.camera.ok, true, items.camera.text);
    assert.equal(items.light.ok, true, `the photo is evenly lit: ${items.light.text}`);
    for (const c of Object.values(items)) assert.ok(c.text.length > 5, `each check says something: ${c.name}`);
    await page.keyboard.press('Space');
    await waitForState(page, 'menu', 5000);
    const passed = await page.evaluate(() => window.__game.setup.passed);
    assert.equal(await page.evaluate(() => localStorage.getItem('kcg.setupDone')), passed ? '1' : null, 'only a pass is remembered');
    if (!passed) {
      await page.reload({ waitUntil: 'load' });
      await waitForState(page, 'setup', 60000);
    }
    // once remembered it is skipped
    await page.evaluate(() => localStorage.setItem('kcg.setupDone', '1'));
    await page.reload({ waitUntil: 'load' });
    await waitForState(page, 'menu', 60000);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('SELF-HEALING: an unplugged camera shows a reconnecting screen, the game waits, and the camera comes back by itself', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    await playLevel(page, 'bubbles');
    // "unplug" it: the track ends, exactly as when a USB camera is pulled out
    await page.evaluate(() => window.__game.tracker.video.srcObject.getVideoTracks()[0].stop());
    await page.waitForFunction(() => window.__game.tracker.reconnecting === 'camera', { timeout: 10000 });
    const paused = await page.evaluate(async () => {
      const s0 = window.__game.state;
      await new Promise((r) => setTimeout(r, 300));
      return { s0, s1: window.__game.state };
    });
    assert.equal(paused.s1, paused.s0, 'the game waits while reconnecting');
    // back: a live camera again, and tracking answering on it (counted in tracked frames, not seconds)
    await page.waitForFunction(() => window.__game.tracker.reconnecting === null, { timeout: 120000, polling: 100 });
    const seq = await page.evaluate(() => window.__game.tracker.frameSeq);
    await page.waitForFunction((s) => window.__game.tracker.frameSeq > s + 2, { timeout: 120000 }, seq);
    assert.equal(await page.evaluate(() => window.__game.tracker.video.srcObject.getVideoTracks()[0].readyState), 'live');
    assert.equal(await page.evaluate(() => window.__game.g.level?.id), 'bubbles', 'and carries on with the same level');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('SELF-HEALING: a pose worker that dies silently is restarted, and tracking carries on', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?model=full');
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    // kill the worker without telling anyone: the frame it was given is never answered
    await page.evaluate(() => window.__game.tracker.engine.worker.terminate());
    await page.waitForFunction(() => window.__game.tracker.reconnecting === 'tracker', { timeout: 300000, polling: 200 });
    await page.waitForFunction(() => window.__game.tracker.reconnecting === null, { timeout: 300000, polling: 200 });
    await waitForPerson(page, { frames: (await page.evaluate(() => window.__game.tracker.frameSeq)) + 20 });
    assert.equal(await page.evaluate(() => window.__game.tracker.useWorker), true, 'a first hang gets a fresh worker');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

// The on-screen debug panel was hidden behind the game's own text, so ?debug also prints a line a grown-up can
// copy from the console (F12 > Console) when reporting lag.
test('DEBUG: ?debug prints a copyable summary of tracking to the console', { skip }, async () => {
  const browser = await launch(exe, camArgs());
  try {
    const { page, problems } = await openGame(browser, url + '?debug&model=full');
    const logs = [];
    page.on('console', (m) => m.text().startsWith('[kids-camera-games debug]') && logs.push(m.text()));
    await waitForState(page, 'menu', 60000);
    await page.waitForFunction(() => window.__game.tracker.frameSeq > 0, { timeout: 60000 });
    const t0 = Date.now();
    while (logs.length < 2 && Date.now() - t0 < 30000) await wait(500);
    const line = logs.at(-1) ?? '';
    for (const part of [/fps \d+/, /tracked [\d.]+\/s/, /round trip \d+ ms/, /tracking (GPU|CPU), worker, high \(full\)/, /camera .*\d+x\d+/, /gpu /])
      assert.match(line, part);
    assert.doesNotMatch(line, /tracked 0\/s/, 'tracking is counted');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

// Debug recordings: R saves the last minute (tracking, timings, events) as a file, G adds a video of the screen,
// and ?replay plays a recording back through the real game, so the person comes back without a camera.
test('RECORDING: in debug mode R saves the last minute, G adds screen video, and ?replay plays it back', { skip }, async () => {
  // catch downloads instead of saving them: [name, size, type] per file
  const spyDownloads = () => {
    window.__downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return click.call(this);
      window.__downloads.push(fetch(this.href).then((r) => r.blob()).then(async (b) => [this.download, b.size, b.type, b.type.includes('json') ? await b.text() : null]));
    };
  };
  const browser = await launch(exe, camArgs());
  try {
    const { page, problems } = await openGame(browser, url + '?debug&model=full', { init: spyDownloads });
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page, { airplane: true });
    await page.waitForFunction(() => window.__game.recorder?.data.frames.length >= 5, { timeout: 120000, polling: 200 });
    await page.keyboard.press('g'); // screen video on
    await wait(2500);
    assert.equal(await page.evaluate(() => window.__game.recorder.videoOn), true);
    await page.keyboard.press('r');
    await page.waitForFunction(() => window.__downloads.length >= 2, { timeout: 30000 });
    const files = await page.evaluate(() => Promise.all(window.__downloads));
    const [json, video] = files;
    assert.match(json[0], /^kcg-\d{4}-\d\d-\d\d-\d{6}\.json$/);
    assert.match(video[0], /^kcg-.*-video\.webm$/);
    assert.ok(video[1] > 1000, `video is ${video[1]} bytes`);
    const rec = JSON.parse(json[3]);
    assert.equal(rec.kind, 'kids-camera-games-recording');
    assert.ok(rec.frames.length >= 5);
    assert.equal(rec.frames[0].lm[0].length, 99, '33 landmarks x [x, y, visibility]');
    assert.ok(rec.samples.some((s) => s.state === 'menu' && s.players.length === 1 && typeof s.detectMs === 'number' && s.quality === 'high'));
    assert.ok(rec.events.some((e) => e.type === 'toast' && /Recording the screen/.test(e.text)));
    assert.match(rec.meta.debug.join(' '), /round trip/);
    assert.deepEqual(problems, []);

    // play it back: no camera, the same person appears, in the same pose
    const replayed = await openGame(browser, url + '?replay');
    await waitForState(replayed.page, 'menu', 30000);
    assert.equal(await replayed.page.evaluate(() => window.__game.tracker.delegate), 'replay');
    await replayed.page.evaluate((text) => window.__game.loadRecording(JSON.parse(text)), json[3]);
    await replayed.page.waitForFunction(() => window.__game.g.players.some((p) => p.present && p.pose.airplane), { timeout: 30000, polling: 100 });
    assert.deepEqual(replayed.problems, []);
  } finally {
    await browser.close();
  }
});

test('MAIN-THREAD FALLBACK: with ?worker=off the pose model runs on the main thread and still finds the person', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, url + '?worker=off&model=full');
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page, { airplane: true });
    assert.equal(await page.evaluate(() => window.__game.tracker.useWorker), false);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('GITHUB PAGES: the game works from a sub-folder (every file is asked for relative to the page)', { skip }, async () => {
  const sub = createGameServer({ base: '/kids-camera-games/' });
  await new Promise((r) => sub.listen(0, '127.0.0.1', r));
  const subUrl = `http://localhost:${sub.address().port}/kids-camera-games/`;
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    const { page, problems } = await openGame(browser, subUrl + '?model=full');
    const outside = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && !u.pathname.startsWith('/kids-camera-games/')) outside.push(u.pathname);
    });
    await waitForState(page, 'menu', 60000);
    await waitForPerson(page);
    assert.equal(await page.evaluate(() => window.__game.g.notice), '', 'the camera path was used, not the mouse fallback');
    assert.deepEqual(outside, [], 'nothing was requested from outside the game folder');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    sub.close();
  }
});

test('TOUCH: tapping the screen shows the grown-up buttons; Start starts the game; they hide again', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    const shown = () => page.evaluate(() => document.getElementById('controls').classList.contains('shown'));
    assert.equal(await shown(), false, 'hidden while nobody touches the screen');
    await page.touchscreen.tap(640, 300);
    await wait(100);
    assert.equal(await shown(), true, 'a tap shows them');
    const visible = await page.evaluate(() => [...document.querySelectorAll('#controls button')].filter((b) => !b.hidden).map((b) => b.dataset.action));
    assert.ok(visible.includes('start') && visible.includes('fullscreen'), `menu buttons: ${visible}`);
    await page.tap('#controls button[data-action="start"]');
    await waitForState(page, 'pick', 3000);
    const picking = await page.evaluate(() => [...document.querySelectorAll('#controls button')].filter((b) => !b.hidden).map((b) => b.dataset.action));
    assert.ok(picking.includes('menu') && !picking.includes('next'), `picker buttons: ${picking}`);
    // tap the middle card (the first game, bubbles)
    const card = await page.evaluate(() => {
      const c = document.getElementById('c');
      const r = window.__game.pickCards().find((card) => card.off === 0).rect;
      const k = c.getBoundingClientRect().width / c.width;
      return { x: (r.x + r.w / 2) * k, y: (r.y + r.h / 2) * k };
    });
    await page.touchscreen.tap(card.x, card.y);
    await waitForState(page, 'intro', 3000);
    const during = await page.evaluate(() => [...document.querySelectorAll('#controls button')].filter((b) => !b.hidden).map((b) => b.dataset.action));
    assert.ok(during.includes('next') && during.includes('menu') && !during.includes('start'), `in-game buttons: ${during}`);
    await page.tap('#controls button[data-action="next"]');
    await page.waitForFunction(() => window.__game.g.level.id === 'dodge', { timeout: 3000 });
    await page.waitForFunction(() => !document.getElementById('controls').classList.contains('shown'), { timeout: 8000 });
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('WALKING PAST: someone who appears mid-game only watches, until they hold their arms out to join', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    await page.mouse.move(300, 300);
    await page.keyboard.press('Space');
    await waitForState(page, 'pick', 3000);
    await page.keyboard.press('1');
    await waitForState(page, 'intro', 3000);

    // a grown-up walks into view: the tracker reports a brand-new person (isNew, as people.js does)
    await page.evaluate(async () => {
      const { computeFeatures } = await import('./src/tracker.js');
      const t = window.__game.tracker;
      const orig = t.update.bind(t);
      const cx = 1000;
      const px = Array.from({ length: 33 }, () => ({ x: cx, y: 360 }));
      const set = (i, x, y) => (px[i] = { x, y });
      set(0, cx, 130); set(11, cx - 40, 200); set(12, cx + 40, 200);
      set(23, cx - 30, 335); set(24, cx + 30, 335); set(25, cx - 30, 470); set(26, cx + 30, 470);
      set(15, cx - 50, 300); set(16, cx + 50, 300); set(19, cx - 50, 310); set(20, cx + 50, 310);
      const walker = { id: 77, color: '#ffffff', score: 0, jumps: 0, lastJump: -99, hitUntil: 0, pose: {}, px, isNew: true };
      window.__armsOut = false;
      t.update = (now) => {
        const ps = orig(now);
        walker.seen = now;
        walker.present = true;
        computeFeatures(walker, now, { skipJump: true });
        walker.pose = { armsUp: false, airplane: window.__armsOut, handsHead: false };
        return [...ps, walker];
      };
      window.__walker = walker;
    });
    await wait(500);
    assert.equal(await page.evaluate(() => window.__walker.excluded), true, 'the walker only watches');
    assert.deepEqual(await page.evaluate(() => window.__game.g.activePlayers().map((p) => p.id)), [1]);

    await page.evaluate(() => (window.__armsOut = true));
    await page.waitForFunction(() => window.__walker.excluded === false, { timeout: 6000 });
    assert.match(await page.evaluate(() => window.__game.g.toast?.text ?? ''), /joined/);
    assert.equal(await page.evaluate(() => window.__game.g.activePlayers().length), 2, 'they joined by holding their arms out');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test('FULL SCREEN NOTE: when the game is not full screen the menu suggests it, with a button that does it', { skip }, async () => {
  const browser = await launch(exe);
  try {
    const { page, problems } = await openGame(browser, url + '?mouse');
    await waitForState(page, 'menu', 20000);
    const nudge = () => page.evaluate(() => {
      const el = document.getElementById('fullscreen-nudge');
      return { shown: !el.hidden, text: el.textContent, full: !!document.fullscreenElement };
    });
    await page.waitForFunction(() => !document.getElementById('fullscreen-nudge').hidden, { timeout: 3000 });
    assert.match((await nudge()).text, /Full screen works best/);
    await page.click('#fullscreen-nudge button[data-action="fullscreen"]');
    await page.waitForFunction(() => !!document.fullscreenElement, { timeout: 3000 });
    await page.waitForFunction(() => document.getElementById('fullscreen-nudge').hidden, { timeout: 3000 });

    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.getElementById('fullscreen-nudge').hidden, { timeout: 3000 });
    await page.keyboard.press('Space');
    await waitForState(page, 'pick', 3000);
    await page.keyboard.press('1'); // not shown during play: it would only distract
    await waitForState(page, 'intro', 3000);
    await page.waitForFunction(() => document.getElementById('fullscreen-nudge').hidden, { timeout: 3000 });
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});
