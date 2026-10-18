// Small drawing helpers shared by the cartoon scenes (backdrops.js and backdrops-extra.js).

// Tiny seeded random so every scene looks the same each time it's drawn.
export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function vGradient(ctx, W, H, stops, y0 = 0, y1 = H) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
}

export function cloud(ctx, x, y, s, alpha = 0.95) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  for (const [dx, dy, r] of [[0, 0, 60], [60, -25, 75], [130, 0, 62], [70, 12, 70], [-45, 14, 42], [175, 14, 44]]) {
    ctx.moveTo(x + dx * s + r * s, y + dy * s);
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
  }
  ctx.fill();
}

// x position of something drifting right at `speed` px/s, wrapping around the screen
export const drift = (t, base, speed, W, pad = 300) => ((base + t * speed) % (W + pad * 2)) - pad;

export function hills(ctx, W, H, y, color, amp, seed) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.004 + ph[0]) * amp + Math.sin(x * 0.011 + ph[1]) * amp * 0.4);
  ctx.lineTo(W, H);
  ctx.fill();
}
