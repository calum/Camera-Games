import { drawArt } from './art.js';
import { BONES } from './tracker.js';

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
