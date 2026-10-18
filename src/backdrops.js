// Cartoon backdrops, one per level, drawn with canvas shapes (no image files needed).
// Each scene has a `static` part (drawn once and cached, redrawn on resize) and a `dynamic`
// part (clouds, fish, spotlights... redrawn every frame from the clock `t`).
// Drop a PNG named assets/bg_<scene>.png to replace a scene with your own art.
import { drawCover } from './art.js';

// Tiny seeded random so every scene looks the same each time it's drawn.
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

function cloud(ctx, x, y, s, alpha = 0.95) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  for (const [dx, dy, r] of [[0, 0, 60], [60, -25, 75], [130, 0, 62], [70, 12, 70], [-45, 14, 42], [175, 14, 44]]) {
    ctx.moveTo(x + dx * s + r * s, y + dy * s);
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
  }
  ctx.fill();
}

// x position of something drifting right at `speed` px/s, wrapping around the screen
const drift = (t, base, speed, W, pad = 300) => ((base + t * speed) % (W + pad * 2)) - pad;

function hills(ctx, W, H, y, color, amp, seed) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.004 + ph[0]) * amp + Math.sin(x * 0.011 + ph[1]) * amp * 0.4);
  ctx.lineTo(W, H);
  ctx.fill();
}

// ------------------------------------------------------------------ menu: sunny meadow + rainbow
const menu = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#6fcdfb'], [1, '#d8f3ff']]);
    // rainbow
    const cx = W * 0.5;
    const cy = H * 0.78;
    ['#ff5a5a', '#ff9a3d', '#ffe14d', '#6fe06f', '#4db8ff', '#6b6bff', '#b36bff'].forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 34 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, (640 - i * 32) * u, Math.PI, 0);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    hills(ctx, W, H, H * 0.78, '#7fd65a', 30 * u, 1);
    hills(ctx, W, H, H * 0.86, '#5cc245', 24 * u, 2);
    hills(ctx, W, H, H * 0.93, '#43a838', 16 * u, 3);
    const r = rng(11);
    for (let i = 0; i < 70; i++) {
      const x = r() * W;
      const y = H * (0.82 + r() * 0.17);
      ctx.fillStyle = ['#ff6b8b', '#fff27a', '#ffffff', '#ffa94d'][i % 4];
      ctx.beginPath();
      ctx.arc(x, y, (5 + r() * 6) * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f8f2f';
      ctx.fillRect(x - 1.5 * u, y + 4 * u, 3 * u, 14 * u);
    }
  },
  dynamic(ctx, W, H, u, t) {
    // sun with slowly turning rays
    const sx = W * 0.86;
    const sy = H * 0.17;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t * 0.15);
    ctx.fillStyle = 'rgba(255,226,90,0.55)';
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, -95 * u);
      ctx.lineTo(-16 * u, -165 * u);
      ctx.lineTo(16 * u, -165 * u);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.arc(sx, sy, 80 * u, 0, Math.PI * 2);
    ctx.fill();
    for (const [b, y, sp, s] of [[0, 0.12, 14, 1], [700, 0.28, 9, 0.8], [1300, 0.08, 18, 1.2], [1900, 0.36, 7, 0.7]])
      cloud(ctx, drift(t, b, sp * u, W), H * y, s * u);
  },
};

// ------------------------------------------------------------------ bubbles: under the sea
const bubbles = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#24c0f0'], [0.55, '#0a86cf'], [1, '#064785']]);
    // sandy seabed with coral and rocks
    ctx.fillStyle = '#f2d08a';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 30) ctx.lineTo(x, H * 0.9 + Math.sin(x * 0.006) * 14 * u);
    ctx.lineTo(W, H);
    ctx.fill();
    const r = rng(5);
    for (let i = 0; i < 16; i++) {
      const x = (i + 0.5) * (W / 16) + (r() - 0.5) * 60 * u;
      const y = H * 0.93 + r() * 14 * u;
      ctx.strokeStyle = ['#ff6b8b', '#ff9a3d', '#c77dff', '#ff5a7a'][i % 4];
      ctx.lineWidth = 10 * u;
      ctx.lineCap = 'round';
      const h = (50 + r() * 70) * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h);
      ctx.moveTo(x, y - h * 0.5);
      ctx.lineTo(x - 26 * u, y - h * 0.8);
      ctx.moveTo(x, y - h * 0.65);
      ctx.lineTo(x + 24 * u, y - h * 0.95);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = ['#7b8da6', '#6a7b94'][i % 2];
      ctx.beginPath();
      ctx.ellipse(r() * W, H * 0.97, (50 + r() * 60) * u, (28 + r() * 20) * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  dynamic(ctx, W, H, u, t) {
    // sunbeams from the surface
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let i = 0; i < 4; i++) {
      const x = W * (0.12 + i * 0.26) + Math.sin(t * 0.3 + i) * 50 * u;
      ctx.beginPath();
      ctx.moveTo(x - 40 * u, 0);
      ctx.lineTo(x + 40 * u, 0);
      ctx.lineTo(x + 190 * u + Math.sin(t * 0.4 + i) * 30 * u, H);
      ctx.lineTo(x - 120 * u, H);
      ctx.fill();
    }
    // swaying seaweed
    ctx.lineWidth = 14 * u;
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.4) * (W / 9);
      const base = H * 0.95;
      ctx.strokeStyle = i % 2 ? '#2fbf71' : '#1f9d5a';
      ctx.beginPath();
      ctx.moveTo(x, base);
      for (let k = 1; k <= 6; k++) ctx.lineTo(x + Math.sin(t * 1.4 + i + k * 0.7) * 16 * u * (k / 3), base - k * 34 * u);
      ctx.stroke();
    }
    // fish
    const fish = [[0.22, 120, 0.9, '#ffb347', 1], [0.4, 80, 1.2, '#ff6b8b', -1], [0.58, 140, 0.8, '#ffe14d', 1], [0.74, 100, 1.0, '#7ee8fa', -1], [0.32, 60, 1.4, '#c77dff', 1]];
    fish.forEach(([yy, sp, s, c, dir], i) => {
      const x = dir > 0 ? drift(t, i * 400, sp * u, W, 200) : W - drift(t, i * 400, sp * u, W, 200);
      const y = H * yy + Math.sin(t * 1.5 + i * 2) * 18 * u;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(dir * s * u, s * u);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, 0, 44, 24, 0, 0, Math.PI * 2);
      ctx.moveTo(-36, 0);
      ctx.lineTo(-72, -22 + Math.sin(t * 8 + i) * 6);
      ctx.lineTo(-72, 22 + Math.sin(t * 8 + i) * 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(22, -6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#123';
      ctx.beginPath();
      ctx.arc(24, -6, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    // little ambient bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3 * u;
    for (let i = 0; i < 22; i++) {
      const r = rng(i * 7 + 1);
      const x = r() * W + Math.sin(t + i) * 12 * u;
      const y = H - (((t * (40 + r() * 50) + r() * H) * u) % (H + 40)) ;
      ctx.beginPath();
      ctx.arc(x, y, (4 + r() * 9) * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};

// ------------------------------------------------------------------ dodge: volcano at dusk
const dodge = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#2b1055'], [0.45, '#8a2b6e'], [0.75, '#ff7a3d'], [1, '#ffd36b']]);
    const r = rng(9);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`;
      ctx.fillRect(r() * W, r() * H * 0.4, 3 * u, 3 * u);
    }
    hills(ctx, W, H, H * 0.62, '#4a1d5e', 70 * u, 21);
    hills(ctx, W, H, H * 0.7, '#341446', 50 * u, 22);
    // the volcano
    const vx = W * 0.72;
    const top = H * 0.36;
    const base = H * 0.86;
    ctx.fillStyle = '#2a0f38';
    ctx.beginPath();
    ctx.moveTo(vx - 520 * u, base);
    ctx.lineTo(vx - 70 * u, top);
    ctx.lineTo(vx + 70 * u, top);
    ctx.lineTo(vx + 520 * u, base);
    ctx.fill();
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineCap = 'round';
    ctx.lineWidth = 10 * u;
    for (const [dx0, dx1] of [[-30, -160], [10, 40], [45, 190]]) {
      ctx.beginPath();
      ctx.moveTo(vx + dx0 * u, top + 12 * u);
      ctx.quadraticCurveTo(vx + (dx0 + dx1) * 0.4 * u, top + (base - top) * 0.45, vx + dx1 * u, base - 30 * u);
      ctx.stroke();
    }
    // dark rocky ground with glowing cracks
    ctx.fillStyle = '#24102e';
    ctx.fillRect(0, H * 0.93, W, H * 0.07);
    ctx.strokeStyle = '#ff7a3d';
    ctx.lineWidth = 4 * u;
    for (let i = 0; i < 14; i++) {
      const x = r() * W;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.935);
      ctx.lineTo(x + (r() - 0.5) * 80 * u, H * 0.96);
      ctx.lineTo(x + (r() - 0.5) * 120 * u, H * 0.99);
      ctx.stroke();
    }
    this.vx = vx;
    this.top = top;
  },
  dynamic(ctx, W, H, u, t) {
    const vx = W * 0.72;
    const top = H * 0.36;
    const glow = 0.7 + 0.3 * Math.sin(t * 3);
    const g = ctx.createRadialGradient(vx, top, 5, vx, top, 260 * u);
    g.addColorStop(0, `rgba(255,220,120,${0.95 * glow})`);
    g.addColorStop(0.35, `rgba(255,120,40,${0.55 * glow})`);
    g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(vx - 300 * u, top - 300 * u, 600 * u, 600 * u);
    // smoke
    for (let i = 0; i < 9; i++) {
      const age = ((t * 0.18 + i / 9) % 1);
      const x = vx + Math.sin(age * 6 + i) * 40 * u + age * 80 * u;
      const y = top - age * 330 * u;
      ctx.fillStyle = `rgba(70,50,85,${0.55 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(x, y, (28 + age * 70) * u, 0, Math.PI * 2);
      ctx.fill();
    }
    // flying embers
    for (let i = 0; i < 24; i++) {
      const r = rng(i * 13 + 3);
      const age = ((t * (0.25 + r() * 0.3) + r()) % 1);
      const x = vx + (r() - 0.5) * 120 * u + (r() - 0.5) * age * 500 * u;
      const y = top - age * (260 + r() * 220) * u + age * age * 200 * u;
      ctx.fillStyle = `rgba(255,${150 + Math.floor(r() * 90)},60,${1 - age})`;
      ctx.beginPath();
      ctx.arc(x, y, (3 + r() * 4) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

// ------------------------------------------------------------------ jump: sunny beach
const jump = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#4fc3ff'], [1, '#c9efff']], 0, H * 0.55);
    vGradient(ctx, W, H, [[0, '#17b8c9'], [1, '#3fd4d4']], H * 0.54, H * 0.76);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, H * 0.54, W, 3 * u);
    vGradient(ctx, W, H, [[0, '#ffe7ae'], [1, '#f6cf84']], H * 0.76, H);
    // palm trees
    const palm = (x, y, lean, s) => {
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 26 * s * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.3 * s * u, y - 260 * s * u, x + lean * s * u, y - 460 * s * u);
      ctx.stroke();
      const tx = x + lean * s * u;
      const ty = y - 460 * s * u;
      ctx.fillStyle = '#2fa84f';
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.55;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -90 * s * u, 28 * s * u, 120 * s * u, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#7a4a22';
      ctx.beginPath();
      ctx.arc(tx - 12 * u, ty + 14 * u, 16 * s * u, 0, Math.PI * 2);
      ctx.arc(tx + 16 * u, ty + 18 * u, 16 * s * u, 0, Math.PI * 2);
      ctx.fill();
    };
    palm(W * 0.07, H * 0.86, 90, 1);
    palm(W * 0.14, H * 0.88, -40, 0.75);
    palm(W * 0.93, H * 0.87, -80, 1);
    // shells
    const r = rng(4);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = ['#ff9ec0', '#fff', '#ffc0a0'][i % 3];
      ctx.beginPath();
      ctx.arc(r() * W, H * (0.8 + r() * 0.12), (5 + r() * 5) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  dynamic(ctx, W, H, u, t) {
    // sun
    const g = ctx.createRadialGradient(W * 0.2, H * 0.14, 10, W * 0.2, H * 0.14, 190 * u);
    g.addColorStop(0, 'rgba(255,245,170,1)');
    g.addColorStop(0.3, 'rgba(255,225,90,0.9)');
    g.addColorStop(1, 'rgba(255,225,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W * 0.5, H * 0.45);
    for (const [b, y, sp, s] of [[200, 0.1, 12, 1], [900, 0.22, 8, 0.8], [1500, 0.06, 15, 1.1]]) cloud(ctx, drift(t, b, sp * u, W), H * y, s * u);
    // sparkles on the sea
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 26; i++) {
      const r = rng(i * 5 + 2);
      const tw = Math.sin(t * 3 + r() * 10);
      if (tw > 0.3) ctx.fillRect(r() * W, H * (0.56 + r() * 0.18), (18 + r() * 24) * u, 3 * u);
    }
    // gulls
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4 * u;
    for (let i = 0; i < 3; i++) {
      const x = drift(t, i * 600, (30 + i * 12) * u, W, 100);
      const y = H * (0.2 + i * 0.07) + Math.sin(t * 1.2 + i) * 14 * u;
      const f = Math.sin(t * 6 + i) * 8 * u;
      ctx.beginPath();
      ctx.moveTo(x - 24 * u, y + f);
      ctx.quadraticCurveTo(x - 10 * u, y - 14 * u, x, y);
      ctx.quadraticCurveTo(x + 10 * u, y - 14 * u, x + 24 * u, y + f);
      ctx.stroke();
    }
  },
};

// ------------------------------------------------------------------ dance: disco
const dance = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#14082e'], [1, '#4b1d8f']]);
    const r = rng(17);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.4})`;
      ctx.fillRect(r() * W, r() * H * 0.6, 3 * u, 3 * u);
    }
    // stage floor in perspective
    const fy = H * 0.72;
    ctx.fillStyle = '#1b0d3d';
    ctx.fillRect(0, fy, W, H - fy);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3 * u;
    for (let i = 0; i <= 14; i++) {
      const x = (i / 14) * W;
      ctx.beginPath();
      ctx.moveTo(W / 2 + (x - W / 2) * 0.25, fy);
      ctx.lineTo(W / 2 + (x - W / 2) * 1.8, H);
      ctx.stroke();
    }
    for (let k = 1; k <= 5; k++) {
      const y = fy + (H - fy) * (k / 5) ** 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  },
  dynamic(ctx, W, H, u, t) {
    // sweeping spotlights
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ['#ff3b8b', '#3be8ff', '#ffe14d', '#8b5bff'].forEach((c, i) => {
      const a = Math.sin(t * 0.9 + i * 1.7) * 0.5;
      const x0 = W * (0.15 + i * 0.23);
      ctx.save();
      ctx.translate(x0, 0);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, 0, H * 1.1);
      g.addColorStop(0, c + 'aa');
      g.addColorStop(1, c + '00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-14 * u, 0);
      ctx.lineTo(14 * u, 0);
      ctx.lineTo(150 * u, H * 1.1);
      ctx.lineTo(-150 * u, H * 1.1);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
    // glowing floor tiles
    const fy = H * 0.72;
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 3; j++) {
        const hue = (t * 60 + i * 36 + j * 50) % 360;
        const lit = 0.5 + 0.5 * Math.sin(t * 3 + i * 0.9 + j * 1.7);
        ctx.fillStyle = `hsla(${hue},90%,60%,${0.12 + 0.18 * lit})`;
        const y0 = fy + (H - fy) * (j / 3) ** 1.3;
        const y1 = fy + (H - fy) * ((j + 1) / 3) ** 1.3;
        const x0 = (i / 10) * W;
        const x1 = ((i + 1) / 10) * W;
        ctx.beginPath();
        ctx.moveTo(W / 2 + (x0 - W / 2) * (0.5 + 0.5 * j / 3), y0);
        ctx.lineTo(W / 2 + (x1 - W / 2) * (0.5 + 0.5 * j / 3), y0);
        ctx.lineTo(W / 2 + (x1 - W / 2) * (0.5 + 0.5 * (j + 1) / 3), y1);
        ctx.lineTo(W / 2 + (x0 - W / 2) * (0.5 + 0.5 * (j + 1) / 3), y1);
        ctx.fill();
      }
    }
    // disco ball
    const bx = W / 2;
    const by = H * 0.11;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, by - 70 * u);
    ctx.stroke();
    const bg = ctx.createRadialGradient(bx - 20 * u, by - 20 * u, 5, bx, by, 80 * u);
    bg.addColorStop(0, '#fff');
    bg.addColorStop(1, '#9aa7c8');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, 72 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, 72 * u, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 40; i++) {
      const r = rng(i + 90);
      const a = r() * 6.28 + t * 0.8;
      const rr = r() * 70 * u;
      if (Math.sin(t * 5 + i) > 0.2) {
        ctx.fillStyle = `hsl(${(i * 47 + t * 80) % 360},90%,70%)`;
        ctx.fillRect(bx + Math.cos(a) * rr - 5 * u, by + Math.sin(a) * rr * 0.8 - 5 * u, 10 * u, 10 * u);
      }
    }
    ctx.restore();
  },
};

// ------------------------------------------------------------------ finale: fireworks over the city
const finale = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#050a24'], [0.7, '#1b2a6b'], [1, '#3a2a7a']]);
    const r = rng(23);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`;
      ctx.fillRect(r() * W, r() * H * 0.7, (2 + r() * 2) * u, (2 + r() * 2) * u);
    }
    ctx.fillStyle = '#0a0a20';
    let x = 0;
    while (x < W) {
      const w = (50 + r() * 90) * u;
      const h = (90 + r() * 260) * u;
      ctx.fillRect(x, H - h, w, h);
      ctx.fillStyle = '#ffd96b';
      for (let wy = H - h + 16 * u; wy < H - 20 * u; wy += 34 * u)
        for (let wx = x + 10 * u; wx < x + w - 14 * u; wx += 26 * u) if (r() > 0.55) ctx.fillRect(wx, wy, 10 * u, 14 * u);
      ctx.fillStyle = '#0a0a20';
      x += w + 6 * u;
    }
  },
  dynamic(ctx, W, H, u, t) {
    const PERIOD = 0.8;
    const LIFE = 1.8;
    for (let k = Math.floor(t / PERIOD) - 2; k <= Math.floor(t / PERIOD); k++) {
      const age = t - k * PERIOD;
      if (age < 0 || age > LIFE) continue;
      const r = rng(k * 31 + 7);
      const cx = W * (0.12 + r() * 0.76);
      const cy = H * (0.12 + r() * 0.35);
      const hue = Math.floor(r() * 360);
      const a = 1 - age / LIFE;
      for (let i = 0; i < 28; i++) {
        const ang = (i / 28) * Math.PI * 2;
        const sp = (160 + r() * 90) * u;
        const x = cx + Math.cos(ang) * sp * age;
        const y = cy + Math.sin(ang) * sp * age + 60 * u * age * age;
        ctx.fillStyle = `hsla(${hue + i * 4},95%,65%,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, (5 * a + 2) * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};

export const SCENES = { menu, bubbles, dodge, jump, dance, finale };

export class Backdrops {
  constructor() {
    this.cache = document.createElement('canvas');
    this.cctx = this.cache.getContext('2d');
    this.key = '';
  }

  // Draws the scene `id` filling the whole canvas. `t` is the clock in seconds.
  draw(ctx, id, W, H, t) {
    if (drawCover(ctx, `bg_${id}`, W, H)) return; // your own art wins
    const scene = SCENES[id] ?? SCENES.menu;
    const key = `${id}:${W}x${H}`;
    if (key !== this.key) {
      this.cache.width = W;
      this.cache.height = H;
      this.cctx.clearRect(0, 0, W, H);
      scene.static(this.cctx, W, H, H / 1080);
      this.key = key;
    }
    ctx.drawImage(this.cache, 0, 0);
    scene.dynamic(ctx, W, H, H / 1080, t);
  }
}
