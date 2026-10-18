// The tiny static server must serve the game with correct MIME types (browsers refuse
// ES modules and WASM with the wrong type) and must not leak files outside the project.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGameServer } from '../../server.mjs';

let server;
let port;

before(async () => {
  server = createGameServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());

// raw request so the path is sent exactly as written (fetch/curl would normalise ../)
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('serves the game page at /', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body.toString(), /Kids Camera Game/);
});

test('serves ES modules as JavaScript', async () => {
  for (const f of ['/src/main.js', '/src/levels/jump.js', '/src/tracker.js', '/vendor/vision_bundle.mjs']) {
    const r = await get(f);
    assert.equal(r.status, 200, f);
    assert.match(r.type, /text\/javascript/, f);
  }
});

test('text files are served with an explicit UTF-8 charset (so symbols like the wave arrows never garble)', async () => {
  for (const f of ['/', '/src/main.js', '/src/levels/jump.js', '/src/draw.js', '/src/backdrops.js']) {
    const r = await get(f);
    assert.match(r.type, /charset=utf-8/i, f);
  }
  // and the bytes for the wave arrow are real UTF-8 (E2 86 92), not a re-encoded copy
  const levels = (await get('/src/levels/jump.js')).body;
  assert.ok(levels.includes(Buffer.from([0xe2, 0x86, 0x92])), 'the jump level contains the UTF-8 arrow');
});

test('serves the pose model files MediaPipe needs', async () => {
  const wasm = await get('/vendor/wasm/vision_wasm_internal.wasm');
  assert.equal(wasm.status, 200);
  assert.equal(wasm.type, 'application/wasm');
  assert.ok(wasm.body.length > 1_000_000);
  const js = await get('/vendor/wasm/vision_wasm_internal.js');
  assert.equal(js.status, 200);
  const model = await get('/models/pose_landmarker_lite.task');
  assert.equal(model.status, 200);
  assert.ok(model.body.length > 1_000_000, 'model file is not empty/truncated');
});

test('missing files (such as optional art) are a clean 404', async () => {
  const r = await get('/assets/bubble-that-does-not-exist.png');
  assert.equal(r.status, 404);
});

test('cannot read files outside the project (path traversal)', async () => {
  // (a plain /%2e%2e/x is normalised by the URL parser to /x, which is inside the project and fine;
  // the dangerous ones are encoded slashes, which only appear as ../ after decoding)
  for (const p of ['/..%2f..%2fWindows/win.ini', '/%2e%2e%2f%2e%2e%2f%2e%2e%2fWindows/win.ini', '/src/..%2f..%2f..%2fWindows/win.ini']) {
    const r = await get(p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.notEqual(r.status, 200, p);
  }
});

test('malformed URLs do not crash the server', async () => {
  const r = await get('/%E0%A4%A');
  assert.equal(r.status, 400);
  const ok = await get('/');
  assert.equal(ok.status, 200);
});

test('can serve the game from a sub-folder, like GitHub Pages does, and nothing outside it', async () => {
  const sub = createGameServer({ base: '/kids-camera-games/' });
  await new Promise((r) => sub.listen(0, '127.0.0.1', r));
  const port = sub.address().port;
  const fetchStatus = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: p }, (r) => (r.resume(), resolve(r.statusCode))));
  try {
    assert.equal(await fetchStatus('/kids-camera-games/'), 200);
    assert.equal(await fetchStatus('/kids-camera-games/src/main.js'), 200);
    assert.equal(await fetchStatus('/kids-camera-games/manifest.webmanifest'), 200);
    assert.equal(await fetchStatus('/src/main.js'), 404, 'root paths are not served: a /src/... request would be a bug');
  } finally {
    sub.close();
  }
});

test('no game code asks for files by absolute path (they would 404 on GitHub Pages)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../src/', import.meta.url);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(e.name + '/', d)) : [new URL(e.name, d)]));
  const bad = [];
  for (const f of walk(dir)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"`]\/(vendor|models|assets|src|icons)\//g)) bad.push(`${f.pathname.split('/src/')[1]}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});
