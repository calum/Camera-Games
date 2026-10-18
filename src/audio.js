// Tiny synthesized sound effects (no audio files needed).
let ctx = null;

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Every sound goes through one bus, so it can also be copied to family in another home (soundStream).
let bus = null;
let tap = null;
function out(/** @type {AudioContext} */ a) {
  if (!bus) {
    bus = a.createGain();
    bus.connect(a.destination);
  }
  return bus;
}

/** The game's sounds as a MediaStream (family play sends it to the guest). Null when there is no audio. */
export function soundStream() {
  const a = ac();
  if (!a) return null;
  if (!tap) {
    tap = a.createMediaStreamDestination();
    out(a).connect(tap);
  }
  return tap.stream;
}

// Call from a user gesture (key/click) so browsers allow sound.
export function unlock() {
  ac();
}

function tone(freq, dur, { type = 'sine', vol = 0.15, to = null, delay = 0 } = {}) {
  const a = ac();
  if (!a || a.state !== 'running') return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out(a));
  o.start(t);
  o.stop(t + dur + 0.02);
}

// One second of white noise, made once and reused: splashes, crunches and rumbles are filtered noise.
let noiseBuf = null;

// Filtered noise: `freq` is the filter's centre (or cut-off for 'lowpass'), `to` sweeps it.
function noise(dur, { freq = 1000, to = null, q = 1, filter = 'bandpass', vol = 0.2, delay = 0 } = {}) {
  const a = ac();
  if (!a || a.state !== 'running') return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = /** @type {BiquadFilterType} */ (filter);
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4)); // a tiny fade-in, so no click
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out(a));
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  pop: () => tone(500, 0.1, { to: 1200, vol: 0.18 }),
  gold: () => [660, 880, 1320].forEach((f, i) => tone(f, 0.12, { delay: i * 0.06, vol: 0.14 })),
  star: () => [660, 990].forEach((f, i) => tone(f, 0.14, { delay: i * 0.07, vol: 0.14 })),
  tick: () => tone(880, 0.06, { type: 'square', vol: 0.06 }),
  go: () => tone(660, 0.25, { type: 'triangle', to: 1320, vol: 0.18 }),
  boom: () => {
    tone(160, 0.35, { type: 'sawtooth', to: 40, vol: 0.25 });
    tone(90, 0.3, { type: 'square', to: 30, vol: 0.15 });
  },
  splash: () => tone(420, 0.25, { type: 'triangle', to: 120, vol: 0.14 }),
  whoosh: () => tone(200, 0.5, { type: 'triangle', to: 700, vol: 0.08 }),
  fanfare: () =>
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { delay: i * 0.12, type: 'triangle', vol: 0.18 })),

  // Level sounds. Each level has its own few, so it sounds like its own place. Failing sounds are silly,
  // never scary: a bonk or a "wah-wah", not an explosion.
  bubble: () => {
    tone(320, 0.08, { to: 900, vol: 0.16 });
    tone(700, 0.06, { to: 1500, vol: 0.08, delay: 0.05 });
  },
  whistle: () => tone(1500, 0.7, { to: 500, vol: 0.05 }), // something falling from the sky
  thud: () => {
    tone(120, 0.18, { to: 50, vol: 0.18 });
    noise(0.12, { freq: 300, filter: 'lowpass', vol: 0.12 });
  },
  bonk: () => {
    tone(420, 0.16, { type: 'square', to: 140, vol: 0.09 });
    tone(220, 0.22, { type: 'triangle', to: 90, vol: 0.14, delay: 0.03 });
  },
  aww: () => [392, 370, 349, 294].forEach((f, i) => tone(f, i === 3 ? 0.6 : 0.24, { delay: i * 0.26, type: 'triangle', vol: 0.14, to: i === 3 ? 262 : null })),
  boing: () => tone(160, 0.35, { type: 'triangle', to: 720, vol: 0.18 }),
  wave: () => noise(1.1, { freq: 300, to: 1400, filter: 'lowpass', vol: 0.12 }),
  splosh: () => {
    noise(0.45, { freq: 1800, to: 300, q: 0.7, vol: 0.22 });
    tone(300, 0.2, { to: 90, vol: 0.08 });
  },
  chime: () => [1047, 1319, 1568].forEach((f, i) => tone(f, 0.5, { delay: i * 0.08, vol: 0.08 })),
  sparkle: () => [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.18, { delay: i * 0.05, vol: 0.06 })),
  crunch: () => noise(0.12, { freq: 900, q: 0.8, vol: 0.2 }),
  crumble: () => {
    noise(0.35, { freq: 700, to: 150, q: 0.6, vol: 0.22 });
    tone(140, 0.25, { to: 60, vol: 0.1 });
  },
  clank: () => {
    tone(1250, 0.3, { type: 'square', vol: 0.04 });
    tone(1870, 0.25, { vol: 0.06 });
  },
  fizz: () => noise(0.6, { freq: 4000, to: 7000, filter: 'highpass', vol: 0.06 }), // a TNT fuse
  kaboom: () => {
    noise(0.7, { freq: 900, to: 80, filter: 'lowpass', vol: 0.3 });
    tone(110, 0.5, { to: 35, vol: 0.2 });
  },
  twinkle: () => [1319, 1760].forEach((f, i) => tone(f, 0.16, { delay: i * 0.06, type: 'triangle', vol: 0.1 })),
  rumble: () => noise(1.4, { freq: 160, to: 70, filter: 'lowpass', q: 2, vol: 0.3 }),
  roll: () => noise(0.6, { freq: 220, filter: 'lowpass', q: 3, vol: 0.18 }),
  boop: () => tone(240, 0.12, { type: 'triangle', to: 420, vol: 0.2 }),
  squeak: () => {
    tone(900, 0.12, { to: 1300, vol: 0.06 });
    noise(0.15, { freq: 2500, q: 2, vol: 0.12 });
  },
  rush: () => noise(0.9, { freq: 400, to: 2500, q: 0.8, vol: 0.12 }), // a wall coming at you
  swish: () => noise(0.3, { freq: 3000, to: 800, q: 1, vol: 0.12 }),
  tweet: () => [0, 0.12].forEach((d) => tone(2200, 0.08, { to: 3200, vol: 0.06, delay: d })), // a bird coming
  note: (step = 0) => tone(523 * 2 ** (step / 12), 0.18, { type: 'triangle', vol: 0.1 }), // step = semitones above C
  ice: () => {
    noise(0.5, { freq: 6000, filter: 'highpass', vol: 0.08 });
    [2637, 2093, 1568].forEach((f, i) => tone(f, 0.3, { delay: i * 0.06, vol: 0.06 }));
  },
  crack: () => noise(0.15, { freq: 2500, to: 600, q: 1.5, vol: 0.22 }),
};
