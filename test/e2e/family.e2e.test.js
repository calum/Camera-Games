// Family play end to end: two pages in one browser pair up through a room code (BroadcastChannel signalling),
// then talk over a real WebRTC connection. One page is the host (the TV), the other the guest (the other home).
//
//   npm run test:e2e   (needs Edge or Chrome; set BROWSER_PATH if it isn't found)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findBrowser, startServer, makeFakeWebcamFile, launch, openGame, waitForState, wait } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const photo = path.join(here, '..', 'fixtures', 'pose.jpg');
const exe = findBrowser();
const skip = exe ? false : 'no Edge/Chrome found (set BROWSER_PATH)';
// The guest opens in a window of its own: a tab behind the front one is hidden, and a hidden page stops drawing.
const AWAKE = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];

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

const familyState = (page) => page.evaluate(() => window.__game.family.state);
const waitConnected = (...pages) => Promise.all(pages.map((p) => p.waitForFunction(() => window.__game.family.state === 'connected', { timeout: 30000 })));

async function pair(browser, hostQuery, guestQuery) {
  const host = await openGame(browser, url + hostQuery);
  await waitForState(host.page, 'menu', 60000);
  await host.page.keyboard.press('o');
  const code = await host.page.evaluate(() => window.__game.family.code);
  assert.match(code, /^[BCDFGHJKLMNPRSTVWXZ]{5}$/);
  const guest = await openGame(browser, `${url}${guestQuery}${guestQuery.includes('?') ? '&' : '?'}room=${code}`, { window: true });
  await waitConnected(host.page, guest.page);
  return { host, guest, code };
}

test('FAMILY (mouse mode): a guest\'s kid appears on the host\'s screen where they stand, sits out the lobby, and the guest sees the host\'s game', { skip }, async () => {
  const browser = await launch(exe, AWAKE);
  try {
    const { host, guest } = await pair(browser, '?mouse', '?mouse');
    await guest.page.mouse.move(960, 400);
    await host.page.waitForFunction(() => window.__game.g.players.some((p) => p.remote && Math.abs(p.cx - 960) < 5), { timeout: 15000 });
    // the host's own kid holds their arms out; the guest (mouse mode has no real arms) does not, so only the host plays
    await host.page.mouse.move(300, 400);
    await host.page.keyboard.down('w');
    await waitForState(host.page, 'pick', 15000);
    await host.page.keyboard.up('w');
    const who = await host.page.evaluate(() => window.__game.g.players.map((p) => ({ remote: !!p.remote, excluded: !!p.excluded })));
    assert.deepEqual(who.sort((a, b) => a.remote - b.remote), [{ remote: false, excluded: false }, { remote: true, excluded: true }]);
    // the guest is shown the host's picture and does not run a game of its own
    await guest.page.waitForFunction(() => window.__game.family.guestView && window.__game.family.video.videoWidth > 0, { timeout: 15000 });
    assert.equal(await guest.page.evaluate(() => window.__game.state), 'menu');
    await host.page.waitForFunction(() => window.__game.family.rtt > 0, { timeout: 10000 });
    // voices travel both ways (the test browser's fake microphone beeps)
    for (const { page } of [host, guest]) {
      await page.waitForFunction(async () => {
        const stats = await window.__game.family.pc.getStats();
        let n = 0;
        stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.packetsReceived; });
        return n > 20;
      }, { timeout: 15000 });
    }
    // the guest also gets the game's own sounds from the host: a second audio stream next to the voice
    await guest.page.waitForFunction(async () => {
      const stats = await window.__game.family.pc.getStats();
      let streams = 0;
      stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') streams++; });
      return streams >= 2;
    }, { timeout: 15000 });
    await host.page.keyboard.press('v');
    assert.equal(await host.page.evaluate(() => window.__game.family.mic.getAudioTracks()[0].enabled), false, 'V mutes the microphone');
    assert.deepEqual(host.problems, []);
    assert.deepEqual(guest.problems, []);
  } finally {
    await browser.close();
  }
});

test('FAMILY (real camera): the guest\'s cut-out arrives on the host\'s screen with see-through background', { skip }, async () => {
  const browser = await launch(exe, [...AWAKE, '--use-file-for-fake-video-capture=' + webcamFile]);
  try {
    // host in mouse mode (no camera needed), guest tracking the photo
    const host = await openGame(browser, url + '?mouse&view=cutout');
    await waitForState(host.page, 'menu', 60000);
    await host.page.keyboard.press('o');
    const code = await host.page.evaluate(() => window.__game.family.code);
    const guest = await openGame(browser, `${url}?model=full&room=${code}`, { window: true });
    await waitForState(guest.page, 'menu', 90000);
    await waitConnected(host.page, guest.page);
    await host.page.waitForFunction(() => window.__game.family.hasGuest && window.__game.g.players.some((p) => p.remote), { timeout: 120000 });
    // a person-shaped patch of the guest frame is opaque; most of it is see-through
    const share = await host.page.evaluate(() => {
      const f = window.__game.family;
      const d = f.guestCut.getContext('2d').getImageData(0, 0, f.guestCut.width, f.guestCut.height).data;
      let solid = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 128) solid++;
      return solid / (d.length / 4);
    });
    assert.ok(share > 0.02 && share < 0.6, `opaque share of the guest frame: ${share.toFixed(3)}`);
    // and the skeleton arrived: the photo shows a man with his arms out, so the host sees an airplane
    await host.page.waitForFunction(() => window.__game.g.players.some((p) => p.remote && p.pose.airplane), { timeout: 60000 });
    assert.deepEqual(host.problems, []);
  } finally {
    await browser.close();
  }
});

test('FAMILY: a guest who leaves is gone from the host, the host keeps playing', { skip }, async () => {
  const browser = await launch(exe, AWAKE);
  try {
    const { host, guest } = await pair(browser, '?mouse', '?mouse');
    await host.page.waitForFunction(() => window.__game.g.players.some((p) => p.remote), { timeout: 15000 });
    await guest.page.keyboard.press('o'); // leave
    assert.equal(await familyState(guest.page), 'idle');
    await host.page.waitForFunction(() => !window.__game.g.players.some((p) => p.remote && p.present), { timeout: 15000 });
    assert.deepEqual(host.problems, []);
  } finally {
    await browser.close();
  }
});

// The real pairing function, run locally by wrangler (Cloudflare's own tool, which runs the Worker and its
// Durable Object exactly as Cloudflare does). Not a project dependency, so this test only runs when wrangler is
// there: set WRANGLER_BIN to it (e.g. after `npm i wrangler` somewhere), or install it in this folder.
const wranglerBin = process.env.WRANGLER_BIN || [path.join(here, '..', '..', 'node_modules', '.bin', 'wrangler')].find((f) => fs.existsSync(f));

test('FAMILY (Cloudflare pairing function): two windows pair through the real Worker, a stranger is kept out', { skip: skip || (wranglerBin ? false : 'wrangler not installed (set WRANGLER_BIN)') }, async () => {
  const port = 8788 + Math.floor(Math.random() * 100);
  const worker = spawn(wranglerBin, ['dev', '--port', String(port), '--ip', '127.0.0.1'], { cwd: path.join(here, '..', '..', 'cloudflare'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let log = '';
  worker.stdout.on('data', (d) => (log += d));
  worker.stderr.on('data', (d) => (log += d));
  const browser = await launch(exe, AWAKE);
  try {
    for (let i = 0; i < 120 && !/Ready on/.test(log); i++) await wait(500);
    assert.match(log, /Ready on/, 'the pairing function started');
    const signal = log.match(/Ready on (http:\/\/[^\s]+)/)[1]; // wrangler picks another port when ours is busy
    const ice = await (await fetch(`${signal}/ice`)).json();
    assert.ok(ice.iceServers.length >= 1 && ice.iceServers[0].urls[0].startsWith('stun:'), 'STUN servers are offered even without TURN secrets');

    const host = await openGame(browser, `${url}?mouse&signal=${encodeURIComponent(signal)}`, { window: true }); // every page in its own window, or the first tab is hidden once more windows open
    await waitForState(host.page, 'menu', 60000);
    await host.page.keyboard.press('o');
    const code = await host.page.evaluate(() => window.__game.family.code);
    const link = await host.page.evaluate(() => window.__game.family.link);
    assert.ok(link.includes('signal='), 'the guest\'s link carries the pairing address when it was set by hand');

    // a guest with the wrong code never gets in; the real guest does
    const lost = await openGame(browser, `${url}?mouse&room=BCDFG&signal=${encodeURIComponent(signal)}`, { window: true });
    const guest = await openGame(browser, link.replace(/^[^?]*/, url + '?mouse&').replace('?mouse&?', '?mouse&'), { window: true });
    await waitConnected(host.page, guest.page);
    await host.page.waitForFunction(() => window.__game.g.players.some((p) => p.remote), { timeout: 20000 });
    assert.equal(await lost.page.evaluate(() => window.__game.family.state), 'connecting', 'a wrong code finds nobody');

    // a second guest with the right code is turned away while the first is in
    const stranger = await openGame(browser, `${url}?mouse&room=${code}&signal=${encodeURIComponent(signal)}`, { window: true });
    await wait(5000);
    assert.equal(await stranger.page.evaluate(() => window.__game.family.state), 'connecting');
    assert.equal(await host.page.evaluate(() => window.__game.family.state), 'connected', 'the family is still connected');
    assert.equal(await guest.page.evaluate(() => window.__game.family.state), 'connected');
  } finally {
    await browser.close();
    worker.kill();
  }
});
