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
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
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
};
