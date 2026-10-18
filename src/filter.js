// One Euro filter (Casiez et al. 2012): heavy smoothing when a joint is nearly still (kills the
// jitter that small or partly hidden kids get), light smoothing when it moves fast (so waving
// and jumping still feel instant). Units are pixels and seconds.
const smoothing = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.01, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff; // Hz: smoothing when still (lower = smoother)
    this.beta = beta; // how quickly smoothing relaxes as speed (px/s) goes up
    this.dCutoff = dCutoff;
    this.t = undefined;
    this.x = 0;
    this.dx = 0;
  }

  filter(x, t) {
    if (this.t === undefined) {
      this.t = t;
      this.x = x;
      return x;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dxRaw = (x - this.x) / dt;
    this.dx += smoothing(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += smoothing(cutoff, dt) * (x - this.x);
    return this.x;
  }
}
