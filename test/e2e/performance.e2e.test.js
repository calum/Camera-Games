// Performance test: the game must stay smooth on an average laptop with no graphics card.
//
//   npm run test:perf       (part of npm run test:e2e too; about 2 minutes)
//
// Headless test browsers draw and run the pose model in software, so they already behave like a laptop
// without a GPU. To make the verdict not depend on how fast THIS machine is, the page first times a small
// CPU benchmark and, on a faster machine, slows the page's main thread down (Chrome's CPU throttling) to
// the reference speed. The reference is a 4-core cloud container, which is about as fast as a cheap laptop.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, startServer, makeFakeWebcamFile, launch, openGame, waitForState, waitForPerson, wait } from './helpers.js';

// How long the benchmark below takes on the reference machine. Re-measure it if you change the benchmark.
const REFERENCE_BENCH_MS = 44;
// Budgets, per level, with a person in view (pose model + cut-out + backdrop + level all running).
// On the reference machine the game measured 11-18 ms of main-thread work per frame and 27-45 frames a second.
const MAX_MEDIAN_FRAME_MS = 25; // the game's own work per frame (update + cut-out + draw), median
const MIN_FPS = 20; // frames actually shown per second
const SAMPLE_MS = 3000;

const here = path.dirname(fileURLToPath(import.meta.url));
const photo = path.join(here, '..', 'fixtures', 'pose.jpg');
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

// Runs in the page before any game code: times every requestAnimationFrame callback (the game loop).
const timeFrames = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frameMs = [];
  window.requestAnimationFrame = (cb) =>
    raf((ts) => {
      const t0 = performance.now();
      cb(ts);
      window.__frameMs.push(performance.now() - t0);
    });
};

// A fixed amount of plain JavaScript work; best of 5 runs, in ms.
const bench = () => {
  const runs = [];
  for (let j = 0; j < 5; j++) {
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 2e7; i++) s += Math.sqrt(i) * (i & 7);
    runs.push(performance.now() - t0 + (s < 0 ? 1 : 0));
  }
  return Math.min(...runs);
};

test('PERFORMANCE: every level stays smooth on an average laptop with no GPU (a person in view, full model)', { skip }, async () => {
  const browser = await launch(exe, [`--use-file-for-fake-video-capture=${webcamFile}`]);
  try {
    // ?model=full pins the heaviest model so the quality ladder can't make the numbers look better mid-test
    const { page, problems } = await openGame(browser, url + '?model=full', { init: timeFrames });
    await page.setViewport({ width: 1920, height: 1080 }); // a TV: the canvas's full size

    const benchMs = await page.evaluate(bench);
    const rate = Math.max(1, REFERENCE_BENCH_MS / benchMs);
    if (rate > 1) await (await page.createCDPSession()).send('Emulation.setCPUThrottlingRate', { rate });
    console.log(`benchmark ${benchMs.toFixed(0)} ms (reference ${REFERENCE_BENCH_MS} ms): CPU slowed down ${rate.toFixed(2)}x`);

    await waitForState(page, 'menu', 90000);
    await waitForPerson(page);

    const ids = await page.evaluate(() => window.__game.levels.map((l) => l.id));
    const slow = [];
    for (const [i, id] of ids.entries()) {
      await page.evaluate((i) => window.__game.startLevel(i), i);
      await waitForState(page, 'play', 15000);
      await wait(500); // let the level's first frames (caching the backdrop) pass
      await page.evaluate(() => (window.__frameMs = []));
      await wait(SAMPLE_MS);
      const r = await page.evaluate((sampleMs) => {
        const a = [...window.__frameMs].sort((x, y) => x - y);
        return { fps: (a.length * 1000) / sampleMs, median: a[Math.floor((a.length - 1) / 2)] ?? Infinity };
      }, SAMPLE_MS);
      console.log(`${id.padEnd(12)} ${r.fps.toFixed(0)} fps, ${r.median.toFixed(1)} ms per frame`);
      if (r.median > MAX_MEDIAN_FRAME_MS || r.fps < MIN_FPS) slow.push(`${id}: ${r.fps.toFixed(0)} fps, ${r.median.toFixed(1)} ms per frame`);
    }
    assert.deepEqual(slow, [], `too slow (budget: ${MIN_FPS}+ fps and ${MAX_MEDIAN_FRAME_MS} ms or less per frame)`);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});
