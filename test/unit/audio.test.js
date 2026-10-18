import { test } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for WebAudio that records what each sound builds. Enough to catch a typo or a bad ramp
// (exponential ramps to 0 throw in real browsers).
const made = [];
const param = () => ({
  value: 0,
  target: null,
  setValueAtTime(v) {
    assert.ok(Number.isFinite(v));
  },
  setTargetAtTime(v, t, tc) {
    assert.ok(Number.isFinite(v) && Number.isFinite(t) && tc > 0);
    this.target = v;
  },
  exponentialRampToValueAtTime(v, t) {
    assert.ok(v > 0 && Number.isFinite(t), `exponential ramp to ${v}`);
  },
});
const node = (kind) => {
  made.push(kind);
  const n = { kind, frequency: param(), gain: param(), Q: param(), to: [], connect(x) { n.to.push(x); return x; }, disconnect() {}, start() {}, stop() {} };
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
  createMediaStreamSource = (s) => ({ connect: (an) => (an.stream = s) });
  createAnalyser = () => ({ fftSize: 0, stream: null, getFloatTimeDomainData(buf) { buf.fill(this.stream?.loud ? 0.2 : 0.001); } });
}
globalThis.window = /** @type {any} */ ({ AudioContext: FakeContext });

const { sfx, unlock, music } = await import('../../src/audio.js');
const { LEVEL, FAMILY, DUCK } = await import('../../src/music.js');

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

test('music plays, changes song, goes quiet, and ducks under voices on a family call', () => {
  unlock();
  made.length = 0;
  music.update('menu');
  assert.equal(music.mood, 'menu');
  assert.ok(made.filter((k) => k === 'osc').length > 3, 'a bar of notes is scheduled');
  music.update('jump');
  assert.equal(music.mood, 'jump');
  music.update(null);
  assert.equal(music.mood, null);

  // find the music's gains: level -> local (speakers) and send (to the other home)
  music.update('menu', { family: true });
  const voice = { loud: false };
  const mic = { loud: false };
  const call = (inLoud, outLoud) => {
    voice.loud = inLoud;
    mic.loud = outLoud;
    music.update('menu', { family: true, incoming: [/** @type {any} */ (voice)], outgoing: /** @type {any} */ (mic) });
  };
  call(false, false);
  const g = music._gains();
  assert.ok(Math.abs(g.level.gain.target - LEVEL * FAMILY) < 1e-9, 'quieter on a family call');
  call(true, false);
  assert.equal(g.local.gain.target, DUCK, 'the other home talking ducks our speakers');
  assert.notEqual(g.send.gain.target, DUCK, 'but not what we send them');
  call(false, true);
  assert.equal(g.send.gain.target, DUCK, 'our kids talking ducks the music the other home hears');
});
