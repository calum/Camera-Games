// Works out which pixels are "a person" so the game can cut the kids out of the camera picture and
// put them in a cartoon world. Pure maths on small arrays (no DOM), so it is easy to test.
//
// Two sources are blended:
//   1. POSE MASK  - the pose model's own silhouette. Very good (even on toddlers' fingers) but it
//                   disappears whenever pose tracking glitches or loses the kid.
//   2. MOTION     - "what is different from the empty room?" (background subtraction). Rougher, but
//                   independent of pose tracking. It is only believed NEAR where a person was seen a
//                   moment ago, so lights, pets and passers-by don't spawn random cut-outs.
//
// The two feed a per-pixel confidence that fades out gradually instead of switching off, so a lost
// pose becomes a short fade (and no fade at all while the kid keeps moving) rather than a pop.

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Shrink a big mask (e.g. 640x480 floats) into `out` (w x h) by averaging, keeping the larger of old
// and new so several people's masks can be OR-ed together into one array.
export function downsampleMaxInto(src, sw, sh, out, w, h) {
  const bx = sw / w;
  const by = sh / h;
  for (let j = 0; j < h; j++) {
    const y0 = Math.floor(j * by);
    const y1 = Math.max(y0 + 1, Math.floor((j + 1) * by));
    for (let i = 0; i < w; i++) {
      const x0 = Math.floor(i * bx);
      const x1 = Math.max(x0 + 1, Math.floor((i + 1) * bx));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) sum += src[y * sw + x];
      const v = sum / n;
      if (v > out[j * w + i]) out[j * w + i] = v;
    }
  }
}

// Separable box blur (radius r) of a Float32Array, written into dst (tmp is scratch).
function boxBlur(src, dst, tmp, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let j = 0; j < h; j++) {
    const row = j * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let i = 0; i < w; i++) {
      tmp[row + i] = acc * k;
      acc += src[row + Math.min(w - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < w; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(h - 1, Math.max(0, j)) * w + i];
    for (let j = 0; j < h; j++) {
      dst[j * w + i] = acc * k;
      acc += tmp[Math.min(h - 1, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i];
    }
  }
}

export const DEFAULTS = {
  motionLo: 14, // gray-level difference where "motion" starts to count (webcam noise is ~2-4)
  motionHi: 34, // ...and where it counts fully
  motionWeight: 0.9, // evidence from motion alone (pose mask counts 1.0)
  nearRadius: 0.05, // motion is only believed within this fraction of the width of a known person
  tauActive: 0.25, // seconds for a region to fade when pose IS tracking but no longer covers it
  tauLost: 0.9, // seconds to fade when pose tracking is lost altogether
  motionOnlyMax: 5, // seconds motion alone may keep a region before it is absorbed into the background
  bgTau: 3, // seconds for the background model to adapt to slow changes
  bgValidAfter: 0.5, // seconds a pixel must be seen empty before motion is trusted there
};

export class PersonMask {
  constructor(w, h, opts = {}) {
    this.w = w;
    this.h = h;
    this.o = { ...DEFAULTS, ...opts };
    const n = w * h;
    this.conf = new Float32Array(n); // persistent person confidence 0..1
    this.bg = new Float32Array(n); // what the empty room looks like (gray)
    this.bgSeen = new Float32Array(n); // seconds each pixel has been seen empty
    this.motionOnly = new Float32Array(n); // seconds a pixel was kept only by motion
    this.near = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.motion = new Float32Array(n);
    this.alpha = new Uint8ClampedArray(n); // result: 0..255 opacity per pixel
    this.zeros = new Float32Array(n);
    this.stats = { coverage: 0, motionFrac: 0, poseActive: false, globalChange: false };
  }

  // gray: Uint8 brightness of the current camera frame (w*h)
  // pose: Float32Array (w*h, 0..1) from the pose model's silhouettes, or null if none this frame
  // dt:   seconds since the last call
  update(gray, pose, dt) {
    const { w, h, o, conf, bg, bgSeen, motionOnly, near, tmp, motion, alpha } = this;
    const n = w * h;
    dt = Math.min(0.25, Math.max(1e-3, dt));
    const s = pose || this.zeros;

    // is the pose model currently finding someone?
    let poseCount = 0;
    for (let i = 0; i < n; i++) if (s[i] > 0.5) poseCount++;
    const poseActive = poseCount > n * 0.002;

    // 1. where is motion allowed to count? near people we already know about
    boxBlur(conf, near, tmp, w, h, Math.max(2, Math.round(w * o.nearRadius)));

    // 2. exposure compensation: webcams auto-adjust brightness, which shifts every pixel at once
    let offSum = 0;
    let offN = 0;
    for (let i = 0; i < n; i++) {
      if (bgSeen[i] >= o.bgValidAfter && conf[i] < 0.05) {
        offSum += gray[i] - bg[i];
        offN++;
      }
    }
    const offset = offN > n * 0.05 ? Math.max(-40, Math.min(40, offSum / offN)) : 0;

    // 3. motion = difference from the background model (only where the background is known)
    let strong = 0;
    let valid = 0;
    for (let i = 0; i < n; i++) {
      if (bgSeen[i] < o.bgValidAfter) {
        motion[i] = 0;
        continue;
      }
      valid++;
      const d = Math.abs(gray[i] - bg[i] - offset);
      const m = smoothstep(o.motionLo, o.motionHi, d);
      motion[i] = m;
      if (m > 0.5) strong++;
    }
    // if most of the picture "moved", the camera was bumped or the lights changed: don't trust motion
    const globalChange = valid > 0 && strong > valid * 0.5;

    // 4. fuse: pose silhouette, or motion near a known person (union)
    const tau = poseActive ? o.tauActive : o.tauLost;
    const decay = Math.exp(-dt / tau);
    let cover = 0;
    for (let i = 0; i < n; i++) {
      const gate = smoothstep(0.1, 0.3, near[i]);
      const m = globalChange ? 0 : motion[i] * gate;
      const evidence = Math.max(s[i], m * o.motionWeight);
      conf[i] = Math.max(evidence, conf[i] * decay);

      // a region held up by motion alone for too long is probably furniture that got moved: absorb it
      if (conf[i] > 0.1 && s[i] < 0.2) {
        motionOnly[i] += dt;
        if (motionOnly[i] > o.motionOnlyMax) {
          bg[i] = gray[i];
          bgSeen[i] = o.bgValidAfter;
          conf[i] = 0;
          motionOnly[i] = 0;
        }
      } else motionOnly[i] = 0;

      // 5. learn the background wherever nobody is (slowly; fast right after a global change)
      if (conf[i] < 0.1) {
        if (bgSeen[i] === 0) bg[i] = gray[i];
        else bg[i] += (gray[i] - offset - bg[i]) * (1 - Math.exp(-dt / (globalChange ? 0.3 : o.bgTau)));
        bgSeen[i] += dt;
      }
      cover += conf[i] > 0.5 ? 1 : 0;
    }

    // 6. confidence -> opacity. The curve starts at 0.5 (where the pose model's soft edge sits) so
    // no halo of real background leaks round the kid; the upscale to screen size softens the edge.
    for (let i = 0; i < n; i++) alpha[i] = Math.round(smoothstep(0.5, 0.85, conf[i]) * 255);

    this.stats = { coverage: cover / n, motionFrac: valid ? strong / valid : 0, poseActive, globalChange };
    return alpha;
  }
}
