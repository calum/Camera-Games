// Helpers for the browser end-to-end tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createGameServer } from '../../server.mjs';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Finds Edge/Chrome. Set BROWSER_PATH to override. Returns null if none installed.
export function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export async function startServer({ base = '/' } = {}) {
  const server = createGameServer({ base });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://localhost:${server.address().port}${base}` };
}

// Turn a still photo into a looping fake-webcam video (.y4m) so Chrome/Edge "see" a person.
export async function makeFakeWebcamFile(browser, jpgPath, W = 640, H = 480) {
  const page = await browser.newPage();
  const b64 = fs.readFileSync(jpgPath).toString('base64');
  const rgba = await page.evaluate(
    async (b64, W, H) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#808080';
      x.fillRect(0, 0, W, H);
      const s = Math.min(W / img.width, H / img.height);
      x.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      return Array.from(x.getImageData(0, 0, W, H).data);
    },
    b64,
    W,
    H,
  );
  await page.close();

  const clamp = (v) => Math.max(0, Math.min(255, v));
  const Y = Buffer.alloc(W * H);
  const U = Buffer.alloc((W / 2) * (H / 2));
  const V = Buffer.alloc((W / 2) * (H / 2));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      Y[j * W + i] = clamp(0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]);
    }
  for (let j = 0; j < H / 2; j++)
    for (let i = 0; i < W / 2; i++) {
      const k = (j * 2 * W + i * 2) * 4;
      const [r, g, b] = [rgba[k], rgba[k + 1], rgba[k + 2]];
      U[j * (W / 2) + i] = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      V[j * (W / 2) + i] = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < 30; f++) parts.push(Buffer.from('FRAME\n'), Y, U, V);
  const file = path.join(os.tmpdir(), `kcg-fake-webcam-${process.pid}.y4m`);
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

export function launch(executablePath, extraArgs = []) {
  return puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--use-fake-ui-for-media-stream',
      // containers and CI runners often run as root, where Chrome refuses to start with its sandbox on
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      // the plain flag, unless the test supplies its own form of it (e.g. =device-count=3)
      ...(extraArgs.some((a) => a.startsWith('--use-fake-device-for-media-stream')) ? [] : ['--use-fake-device-for-media-stream']),
      ...extraArgs,
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
}

// Opens the game and records anything that would be a bug (uncaught errors, console errors).
// 404s are ignored: the optional custom-art PNGs are expected to be missing.
// `init` (optional) is a function, or a list of functions, that run inside the page before any game code,
// e.g. to spy on the camera. Each must be self-contained: only its own source is sent to the page.
export async function openGame(browser, url, { init, window = false } = {}) {
  // window: its own browser window, so it counts as visible while another page is open (tabs behind the front one stop drawing)
  const page = await browser.newPage(window ? { type: 'window' } : undefined);
  for (const fn of [init].flat().filter(Boolean)) await page.evaluateOnNewDocument(fn);
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  return { page, problems };
}

export const gameState = (page) => page.evaluate(() => window.__game.state);
export const waitForState = (page, state, timeout = 30000) =>
  page.waitForFunction((s) => window.__game?.state === s, { timeout }, state);

// Starts a test browser with `count` built-in fake cameras and opens the game on it. The test browser's fake
// camera list is occasionally empty at startup (it then reports no cameras at all, whatever the game does), so
// we start a fresh browser until it really lists them all, rather than weakening what the test checks.
export async function openWithCameras(exe, url, { count = 3, init, tries = 8 } = {}) {
  for (let i = 0; i < tries; i++) {
    const browser = await launch(exe, [`--use-fake-device-for-media-stream=device-count=${count}`]);
    const { page, problems } = await openGame(browser, url, { init });
    await waitForState(page, 'menu', 60000);
    const listed = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length);
    if (listed >= count) return { browser, page, problems };
    await browser.close();
  }
  throw new Error(`the test browser never listed ${count} fake cameras`);
}

// Waits until the tracker has found a person (with `airplane`, in the arms-out pose). Tracking speed varies a lot:
// a software renderer on a busy machine can take seconds per frame, so this counts tracked frames, not seconds.
// It fails once `frames` frames have been tracked without finding them (or after 5 minutes, as a backstop).
export async function waitForPerson(page, { airplane = false, frames = 20 } = {}) {
  await page.waitForFunction(
    (airplane, frames) => {
      const t = window.__game.tracker;
      return t.players.some((p) => p.present && (!airplane || p.pose.airplane)) || t.frameSeq >= frames;
    },
    { timeout: 300000, polling: 100 },
    airplane,
    frames,
  );
  const found = await page.evaluate(
    (airplane) => window.__game.tracker.players.some((p) => p.present && (!airplane || p.pose.airplane)),
    airplane,
  );
  if (!found) {
    const ms = await page.evaluate(() => window.__game.tracker.detectMs);
    throw new Error(`no person${airplane ? ' in the airplane pose' : ''} found in ${frames} tracked frames (${ms.toFixed(0)} ms each)`);
  }
}
