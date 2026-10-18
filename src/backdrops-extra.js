// Cartoon backdrops for the newer levels (dig, avalanche, wall, meteor, balloons), in the same
// { static, dynamic } Scene format as src/backdrops.js: static is drawn once and cached, dynamic every
// frame from the clock `t`. Each level passes its scene as `backdrop: EXTRA_SCENES.<id>`.
// The small helpers below are copies of the ones in backdrops.js.

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vGradient(ctx, W, H, stops, y0 = 0, y1 = H) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
}

function cloud(ctx, x, y, s, color = 'rgba(255,255,255,0.95)') {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [dx, dy, r] of [[0, 0, 60], [60, -25, 75], [130, 0, 62], [70, 12, 70], [-45, 14, 42], [175, 14, 44]]) {
    ctx.moveTo(x + dx * s + r * s, y + dy * s);
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
  }
  ctx.fill();
}

const drift = (t, base, speed, W, pad = 300) => ((base + t * speed) % (W + pad * 2)) - pad;

function hills(ctx, W, H, y, color, amp, seed) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.004 + ph[0]) * amp + Math.sin(x * 0.011 + ph[1]) * amp * 0.4);
  ctx.lineTo(W, H);
  ctx.fill();
}

// Jagged mountain range along y, peaks up to `amp` tall, optional snow caps.
function mountains(ctx, W, H, y, amp, color, seed, snow = null) {
  const r = rng(seed);
  const peaks = [];
  for (let x = -100; x <= W + 200; x += (160 + r() * 160) * (H / 1080)) peaks.push([x, y - amp * (0.45 + r() * 0.55)]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-100, H);
  for (let i = 0; i < peaks.length; i++) {
    ctx.lineTo(peaks[i][0], peaks[i][1]);
    if (peaks[i + 1]) ctx.lineTo((peaks[i][0] + peaks[i + 1][0]) / 2, y - amp * 0.15 * r());
  }
  ctx.lineTo(W + 200, H);
  ctx.fill();
  if (!snow) return;
  ctx.fillStyle = snow;
  for (const [x, py] of peaks) {
    const d = (y - py) * 0.32;
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x - d * 0.75, py + d);
    ctx.lineTo(x - d * 0.25, py + d * 0.8);
    ctx.lineTo(x, py + d * 1.05);
    ctx.lineTo(x + d * 0.3, py + d * 0.8);
    ctx.lineTo(x + d * 0.75, py + d);
    ctx.fill();
  }
}

function pine(ctx, x, y, h, color) {
  ctx.fillStyle = '#5b3a22';
  ctx.fillRect(x - h * 0.05, y - h * 0.15, h * 0.1, h * 0.15);
  ctx.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const top = y - h * (0.45 + k * 0.25);
    const w = h * (0.42 - k * 0.1);
    ctx.beginPath();
    ctx.moveTo(x, top - h * 0.2);
    ctx.lineTo(x - w, y - h * (0.12 + k * 0.25));
    ctx.lineTo(x + w, y - h * (0.12 + k * 0.25));
    ctx.fill();
  }
}

function star5(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

// ------------------------------------------------------------------ dig: mine in the hills
const dig = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#7fd3ff'], [0.7, '#cdefff'], [1, '#e9f7ff']]);
    mountains(ctx, W, H, H * 0.62, 260 * u, '#9b7b5c', 41);
    hills(ctx, W, H, H * 0.7, '#7a5a3c', 40 * u, 42);
    // rocky cliff walls framing the dig site, with wooden beams
    for (const side of [0, 1]) {
      const x0 = side ? W : 0;
      const dir = side ? -1 : 1;
      ctx.fillStyle = '#6b4a2e';
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + dir * 150 * u, 0);
      for (let k = 1; k <= 8; k++) ctx.lineTo(x0 + dir * (120 + (k % 2) * 50) * u, (H * k) / 8);
      ctx.lineTo(x0, H);
      ctx.fill();
      ctx.fillStyle = '#a0703f';
      ctx.fillRect(x0 + dir * 120 * u - (side ? 26 * u : 0), H * 0.25, 26 * u, H * 0.75);
    }
    ctx.fillStyle = '#a0703f';
    ctx.fillRect(W * 0.04, H * 0.25, W * 0.92, 26 * u);
    // a wooden "DIG HERE" sign on the right post (the depth meter is on the left)
    const sx = W - 400 * u;
    ctx.fillStyle = '#c98a4b';
    ctx.fillRect(sx, H * 0.32, 230 * u, 80 * u);
    ctx.strokeStyle = '#5b3a22';
    ctx.lineWidth = 6 * u;
    ctx.strokeRect(sx, H * 0.32, 230 * u, 80 * u);
    ctx.fillStyle = '#5b3a22';
    ctx.font = `800 ${46 * u}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DIG HERE', sx + 115 * u, H * 0.32 + 42 * u);
  },
  dynamic(ctx, W, H, u, t) {
    // two lanterns hanging from the beam, gently swinging and glowing
    for (const [fx, ph] of [[0.25, 0], [0.75, 1.7]]) {
      const ang = Math.sin(t * 1.6 + ph) * 0.12;
      const x = W * fx + Math.sin(ang) * 70 * u;
      const y = H * 0.25 + 26 * u + Math.cos(ang) * 70 * u;
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.moveTo(W * fx, H * 0.25 + 26 * u);
      ctx.lineTo(x, y);
      ctx.stroke();
      const glow = ctx.createRadialGradient(x, y + 20 * u, 4 * u, x, y + 20 * u, 120 * u);
      glow.addColorStop(0, `rgba(255,214,110,${0.55 + 0.1 * Math.sin(t * 9 + ph)})`);
      glow.addColorStop(1, 'rgba(255,214,110,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y + 20 * u, 120 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd66e';
      ctx.fillRect(x - 16 * u, y, 32 * u, 40 * u);
      ctx.strokeStyle = '#3a2a1a';
      ctx.strokeRect(x - 16 * u, y, 32 * u, 40 * u);
    }
    for (const [b, y, sp, s] of [[0, 0.1, 12, 0.9], [900, 0.18, 8, 0.7]]) cloud(ctx, drift(t, b, sp * u, W), H * y, s * u);
  },
};

// ------------------------------------------------------------------ avalanche: snowy mountains
const avalanche = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#5fa8e8'], [0.6, '#bfe3ff'], [1, '#eef8ff']]);
    mountains(ctx, W, H, H * 0.6, 380 * u, '#8fa3bf', 51, '#ffffff');
    mountains(ctx, W, H, H * 0.72, 240 * u, '#6f86a6', 52, '#f4f9ff');
    // snowy ground
    hills(ctx, W, H, H * 0.84, '#ffffff', 20 * u, 53);
    hills(ctx, W, H, H * 0.92, '#e6f2ff', 12 * u, 54);
    const r = rng(55);
    for (let i = 0; i < 14; i++) {
      const x = r() * W;
      pine(ctx, x, H * (0.86 + r() * 0.08), (90 + r() * 80) * u, i % 2 ? '#2f6f4f' : '#245c40');
    }
  },
  dynamic(ctx, W, H, u, t) {
    for (const [b, y, sp, s] of [[200, 0.12, 10, 0.9], [1100, 0.22, 6, 0.7]]) cloud(ctx, drift(t, b, sp * u, W), H * y, s * u);
    // gently falling snow
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 70; i++) {
      const r = rng(i * 13 + 5);
      const sp = 30 + r() * 50;
      const x = (r() * W + Math.sin(t * (0.6 + r()) + i) * 30 * u) % W;
      const y = ((r() * H + t * sp * u) % (H + 20)) - 10;
      ctx.beginPath();
      ctx.arc(x, y, (2 + r() * 4) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

// ------------------------------------------------------------------ wall: game-show studio
const wall = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#2a0f4a'], [0.6, '#5b1f7a'], [1, '#8a2b8f']]);
    // curtains on both sides
    for (const side of [0, 1]) {
      for (let k = 0; k < 6; k++) {
        const x = side ? W - (k + 1) * 34 * u : k * 34 * u;
        ctx.fillStyle = k % 2 ? '#b0174f' : '#d0265f';
        ctx.fillRect(x, 0, 34 * u, H);
      }
    }
    ctx.fillStyle = '#d0265f';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= W; x += 80 * u) ctx.quadraticCurveTo(x + 40 * u, 90 * u, x + 80 * u, 0);
    ctx.fill();
    // checkerboard stage floor in perspective
    const top = H * 0.78;
    const n = 12;
    for (let row = 0; row < 4; row++) {
      const y0 = top + ((H - top) * row) / 4;
      const y1 = top + ((H - top) * (row + 1)) / 4;
      for (let c = -n; c < 2 * n; c++) {
        const spread = (y) => 1 + ((y - top) / (H - top)) * 0.6;
        const xa = W / 2 + ((c / n - 0.5) * W) * spread(y0);
        const xb = W / 2 + (((c + 1) / n - 0.5) * W) * spread(y0);
        const xc = W / 2 + (((c + 1) / n - 0.5) * W) * spread(y1);
        const xd = W / 2 + ((c / n - 0.5) * W) * spread(y1);
        ctx.fillStyle = (c + row) % 2 ? '#ffd24d' : '#ff9ad5';
        ctx.beginPath();
        ctx.moveTo(xa, y0);
        ctx.lineTo(xb, y0);
        ctx.lineTo(xc, y1);
        ctx.lineTo(xd, y1);
        ctx.fill();
      }
    }
    // marquee bulbs along the top (lit in the dynamic layer)
  },
  dynamic(ctx, W, H, u, t) {
    // chasing marquee lights
    const n = Math.floor(W / (60 * u));
    for (let i = 0; i < n; i++) {
      const on = (i + Math.floor(t * 6)) % 3 === 0;
      ctx.fillStyle = on ? '#fff6a0' : 'rgba(255,246,160,0.25)';
      ctx.beginPath();
      ctx.arc((i + 0.5) * (W / n), 120 * u, 11 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    // two soft spotlights sweeping the stage
    for (const { fx, ph, col } of [{ fx: 0.25, ph: 0, col: 'rgba(255,240,180,0.13)' }, { fx: 0.75, ph: 2, col: 'rgba(180,220,255,0.13)' }]) {
      const x = W * fx;
      const aim = W / 2 + Math.sin(t * 0.7 + ph) * W * 0.3;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 20 * u, 0);
      ctx.lineTo(x + 20 * u, 0);
      ctx.lineTo(aim + 160 * u, H);
      ctx.lineTo(aim - 160 * u, H);
      ctx.fill();
    }
  },
};

// ------------------------------------------------------------------ meteor: starry night
const meteor = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#070a2a'], [0.6, '#1b2266'], [1, '#3a3f8f']]);
    // the moon, top left under the title (the score and hearts are top right)
    ctx.fillStyle = '#fff6d6';
    ctx.beginPath();
    ctx.arc(W * 0.12, H * 0.24, 80 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,190,160,0.5)';
    for (const [dx, dy, r] of [[-25, -15, 16], [20, 20, 12], [30, -30, 9]]) {
      ctx.beginPath();
      ctx.arc(W * 0.12 + dx * u, H * 0.24 + dy * u, r * u, 0, Math.PI * 2);
      ctx.fill();
    }
    hills(ctx, W, H, H * 0.8, '#151a4a', 40 * u, 61);
    hills(ctx, W, H, H * 0.9, '#0d1033', 24 * u, 62);
    // little houses with lit windows on the far hill
    const r = rng(63);
    for (let i = 0; i < 6; i++) {
      const x = W * (0.08 + i * 0.16 + r() * 0.04);
      const y = H * 0.8 + 6 * u;
      ctx.fillStyle = '#0d1033';
      ctx.fillRect(x, y - 50 * u, 60 * u, 50 * u);
      ctx.beginPath();
      ctx.moveTo(x - 8 * u, y - 50 * u);
      ctx.lineTo(x + 30 * u, y - 80 * u);
      ctx.lineTo(x + 68 * u, y - 50 * u);
      ctx.fill();
      ctx.fillStyle = '#ffd66e';
      ctx.fillRect(x + 12 * u, y - 36 * u, 14 * u, 14 * u);
      if (r() < 0.6) ctx.fillRect(x + 34 * u, y - 36 * u, 14 * u, 14 * u);
    }
  },
  dynamic(ctx, W, H, u, t) {
    // twinkling stars
    for (let i = 0; i < 90; i++) {
      const r = rng(i * 17 + 3);
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.8 + r() * 2) + i));
      ctx.fillStyle = `rgba(255,255,230,${a})`;
      const s = (1.5 + r() * 3) * u;
      if (i % 9 === 0) star5(ctx, r() * W, r() * H * 0.7, s * 2.4);
      else ctx.fillRect(r() * W, r() * H * 0.7, s, s);
    }
    // a little shooting star every few seconds
    const k = (t % 6) / 1.2;
    if (k < 1) {
      const r = rng(Math.floor(t / 6) + 99);
      const x0 = W * (0.1 + r() * 0.5);
      const y0 = H * (0.05 + r() * 0.2);
      const x = x0 + k * 400 * u;
      const y = y0 + k * 180 * u;
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 120 * u, y - 54 * u);
      ctx.stroke();
    }
  },
};

// ------------------------------------------------------------------ balloons: party in the park
const BUNTING = ['#ff5a7a', '#4db8ff', '#ffd24d', '#6fe06f', '#b36bff', '#ff9a3d'];
const balloons = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#8fd8ff'], [1, '#fff0f6']]);
    hills(ctx, W, H, H * 0.82, '#8fe07a', 26 * u, 71);
    hills(ctx, W, H, H * 0.9, '#6fcf5f', 16 * u, 72);
    // striped party tent on the right
    const tx = W * 0.8;
    const ty = H * 0.82;
    const tw = 300 * u;
    const th = 220 * u;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#ff5a7a';
      ctx.beginPath();
      ctx.moveTo(tx, ty - th);
      ctx.lineTo(tx - tw / 2 + (i * tw) / 6, ty);
      ctx.lineTo(tx - tw / 2 + ((i + 1) * tw) / 6, ty);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath();
    ctx.moveTo(tx, ty - th - 40 * u);
    ctx.lineTo(tx + 40 * u, ty - th - 26 * u);
    ctx.lineTo(tx, ty - th - 12 * u);
    ctx.fill();
  },
  dynamic(ctx, W, H, u, t) {
    for (const [b, y, sp, s] of [[0, 0.32, 12, 0.8], [1000, 0.4, 7, 0.6]]) cloud(ctx, drift(t, b, sp * u, W), H * y, s * u);
    // two strings of flags across the top, waving
    for (const [y0, sag, ph] of [[60, 70, 0], [150, 50, 1.3]]) {
      const n = 14;
      ctx.strokeStyle = 'rgba(80,60,60,0.6)';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * W;
        const y = (y0 + Math.sin((i / n) * Math.PI) * sag) * u;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * W;
        const y = (y0 + Math.sin(((i + 0.5) / n) * Math.PI) * sag) * u;
        const wave = Math.sin(t * 3 + i + ph) * 6 * u;
        ctx.fillStyle = BUNTING[i % BUNTING.length];
        ctx.beginPath();
        ctx.moveTo(x - 24 * u, y);
        ctx.lineTo(x + 24 * u, y);
        ctx.lineTo(x + wave, y + 50 * u);
        ctx.fill();
      }
    }
  },
};

export const EXTRA_SCENES = { dig, avalanche, wall, meteor, balloons };
