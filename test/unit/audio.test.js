import { test } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for WebAudio that records what each sound builds. Enough to catch a typo or a bad ramp
// (exponential ramps to 0 throw in real browsers).
const made = [];
const param = () => ({
  value: 0,
  setValueAtTime(v) {
    assert.ok(Number.isFinite(v));
  },
  exponentialRampToValueAtTime(v, t) {
    assert.ok(v > 0 && Number.isFinite(t), `exponential ramp to ${v}`);
  },
});
const node = (kind) => {
  made.push(kind);
  const n = { frequency: param(), gain: param(), Q: param(), connect: (x) => x, start() {}, stop() {} };
  return n;
};
class FakeContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume = async () => {};
  createOscillator = () => node('osc');
  createGain = () => node('gain');
  createBiquadFilter = () => node('filter');
  createBufferSource = () => node('noise');
  createBuffer = (ch, len) => ({ getChannelData: () => new Float32Array(len) });
}
globalThis.window = /** @type {any} */ ({ AudioContext: FakeContext });

const { sfx } = await import('../../src/audio.js');

test('every sound effect plays without errors and makes some sound', () => {
  for (const [name, play] of Object.entries(sfx)) {
    made.length = 0;
    play();
    assert.ok(made.includes('osc') || made.includes('noise'), `${name} makes no sound`);
  }
});

test('every sound a level plays exists', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../src/levels/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const [, name] of src.matchAll(/sfx\.(\w+)/g)) assert.ok(name in sfx, `${f} uses sfx.${name}, which does not exist`);
  }
});
