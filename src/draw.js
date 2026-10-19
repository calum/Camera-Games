import { drawArt } from './art.js';
import { rng } from './scene-kit.js';
import { BONES } from './tracker.js';

// A rounded-rectangle path. ctx.roundRect is missing on older tablets (Safari before 16, Chrome before 99),
// where calling it threw on every frame: they get square corners instead.
export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function text(ctx, str, x, y, size, o = {}) {
  const { color = '#fff', stroke = 'rgba(0,0,0,0.75)', align = 'center', weight = 800 } = o;
  ctx.font = `${weight} ${size}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = stroke;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function drawHeart(ctx, x, y, s, full = true) {
  if (full && drawArt(ctx, 'heart', x, y, s * 1.8)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-30, -4, -14, -24, 0, -10);
  ctx.bezierCurveTo(14, -24, 30, -4, 0, 12);
  ctx.closePath();
  ctx.fillStyle = full ? '#ff3b5c' : 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

export function drawSkeleton(ctx, p, g) {
  if (!p.present) return;
  const u = g.u;
  const px = p.px;

  // Kids who didn't join are shown as a faint grey outline: visible, but not playing.
  if (p.excluded) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#cfd6e6';
    ctx.lineWidth = 10 * u;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(px[a].x, px[a].y);
      ctx.lineTo(px[b].x, px[b].y);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  const hit = p.hitUntil > g.now;
  const flash = p.flashUntil > g.now; // jump result: green = nailed it, red = missed
  const col = hit ? '#ff3b3b' : flash ? p.flashColor : p.color;
  // The kids are shown in full colour from the camera, so by default the skeleton is just a thin
  // line (g.skeleton = 'thin'). It goes bold for a moment on a hit / jump result so those stay
  // obvious. K cycles thin -> bold -> off for the grown-up.
  const bold = g.skeleton === 'bold' || hit || flash;
  const show = bold || g.skeleton !== 'off';

  if (show) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col;
    ctx.globalAlpha = bold ? 1 : 0.75;
    ctx.lineWidth = (flash ? 24 : bold ? 16 : 6) * u;
    if (g.fx && bold) {
      ctx.shadowColor = col;
      ctx.shadowBlur = (flash ? 40 : 18) * u;
    }
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(px[a].x, px[a].y);
      ctx.lineTo(px[b].x, px[b].y);
    }
    ctx.stroke();
    if (bold) {
      // head disc (only in bold mode: it covers the face)
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px[0].x, px[0].y, Math.max(22 * u, p.shoulderW * 0.38), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    ctx.restore();

    // hands: a ring marks exactly where things get popped; solid dot in bold mode
    for (const i of [15, 16]) {
      if (drawArt(ctx, 'hand', px[i].x, px[i].y, 70 * u)) continue;
      ctx.beginPath();
      ctx.arc(px[i].x, px[i].y, (bold ? 24 : 20) * u, 0, Math.PI * 2);
      if (bold) {
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      ctx.lineWidth = (bold ? 6 : 5) * u;
      ctx.strokeStyle = col;
      ctx.stroke();
    }
  }

  // score badge above the head
  text(ctx, `★ ${p.score}`, px[0].x, px[0].y - Math.max(70 * u, p.shoulderW * 0.7), 36 * u, { color: p.color });
}

// A little stick figure showing a target dance pose.
export function drawPoseIcon(ctx, key, x, y, s, color = '#fff') {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const arms = {
    armsUp: [[-0.28, -0.85], [0.28, -0.85]],
    airplane: [[-0.5, -0.38], [0.5, -0.38]],
    handsHead: [[-0.1, -0.64], [0.1, -0.64]],
  }[key];
  const draw = (w, c) => {
    ctx.lineWidth = w * s;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, -0.43 * s); // torso top
    ctx.lineTo(0, 0.1 * s);
    ctx.moveTo(0, 0.1 * s);
    ctx.lineTo(-0.15 * s, 0.5 * s);
    ctx.moveTo(0, 0.1 * s);
    ctx.lineTo(0.15 * s, 0.5 * s);
    for (const [ax, ay] of arms) {
      ctx.moveTo(0, -0.38 * s);
      if (key === 'handsHead') ctx.lineTo(ax * 3 * s, -0.52 * s); // elbow out, hand back to head
      ctx.lineTo(ax * s, ay * s);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -0.55 * s, 0.12 * s, 0, Math.PI * 2);
    ctx.stroke();
  };
  draw(0.1, 'rgba(0,0,0,0.6)');
  draw(0.055, color);
  ctx.restore();
}

// How big a pop-in thing is `age` seconds after it appeared: grows past full size, then settles (0.4 -> 1.25 -> 1).
// Score popups and countdown numbers use it, so they land with a little bounce instead of just appearing.
export function popScale(age) {
  if (age < 0) return 0.4;
  if (age < 0.12) return 0.4 + (age / 0.12) * 0.85;
  if (age < 0.3) return 1.25 - ((age - 0.12) / 0.18) * 0.25;
  return 1;
}

// "Something is about to fall here": a red column fading downwards and a yellow warning sign at the top.
// The sign bobs but never shrinks, so even a kid at the back of the room can see it (the old "!" pulsed down
// to a fifth of its size). Used by Dodge the rocks, Avalanche and Catch the stars.
export function drawWarning(ctx, g, x, r) {
  const u = g.u;
  const beat = Math.sin(g.now * 14);
  const col = ctx.createLinearGradient(0, 0, 0, g.H * 0.75);
  col.addColorStop(0, `rgba(255,70,50,${0.32 + 0.1 * beat})`);
  col.addColorStop(1, 'rgba(255,70,50,0)');
  ctx.fillStyle = col;
  ctx.fillRect(x - r, 0, r * 2, g.H * 0.75);
  const s = 62 * u * (1 + 0.08 * beat);
  const y = 215 * u; // below the HUD (title, timer, score and hearts)
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.62);
  ctx.lineTo(x + s * 0.68, y + s * 0.52);
  ctx.lineTo(x - s * 0.68, y + s * 0.52);
  ctx.closePath();
  ctx.lineWidth = s * 0.34;
  ctx.strokeStyle = '#3a1d0a';
  ctx.stroke();
  ctx.lineWidth = s * 0.2;
  ctx.strokeStyle = '#ffd21f';
  ctx.stroke();
  ctx.fillStyle = '#ffd21f';
  ctx.fill();
  ctx.restore();
  text(ctx, '!', x, y + s * 0.12, s * 0.8, { color: '#3a1d0a', stroke: 'transparent', weight: 900 });
}

// A cartoon rock: lumpy, outlined, lit from above, so it matches the flat cartoon scenes and is
// drawn exactly the size of its hit circle (the emoji it replaces only filled part of its box). The shape comes
// from `seed`, so each rock keeps its own lumps as it spins. A rock.png in assets/ still replaces it.
export function drawRock(ctx, x, y, r, rot, seed, u) {
  if (drawArt(ctx, 'rock', x, y, r * 2.2, rot)) return;
  const rnd = rng(seed);
  const n = 9;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.86 + rnd() * 0.18;
    pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const outline = () => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = '#8d8279';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // lighter top, kept upright so the light always comes from above while the rock spins
  ctx.rotate(-rot);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.22, -r * 0.3, r * 0.5, r * 0.32, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; // and a shaded underside
  ctx.beginPath();
  ctx.ellipse(r * 0.25, r * 0.45, r * 0.7, r * 0.4, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  outline(); // the path is not part of save/restore: draw the outline again
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3f3631';
  ctx.lineWidth = 5 * u;
  ctx.stroke();
  ctx.restore();
}
