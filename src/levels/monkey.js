// The cheeky cartoon monkey: the computer player of the fort games (docs/FORT-GAMES.md). A kid playing alone gets
// the monkey in the spare fort, and anyone who joins takes its place. Drawn from shapes, so no art is needed.
/** @import { Fort } from '../forts.js' */

/**
 * @typedef {object} MonkeyLook
 * @property {number} t        game time, for the blinking, tail swish and wobble
 * @property {number} [arm]    0..1: the right arm goes up (winding up a throw, or flapping)
 * @property {number} [tilt]   radians, the whole monkey tilts (wobbles or spins) around its middle
 * @property {boolean} [mud]   covered in mud
 * @property {number} [splat]  0..1: a snowball splat on its face, fading
 * @property {boolean} [wings] flying: wings on its back that flap with `arm`
 * @property {boolean} [dizzy] dizzy stars and swirly eyes
 * @property {{ x: number, y: number } | null} [look]  where it looks (screen px)
 */

/**
 * The monkey with its middle (the belly) at x, y. `s` is its size: about half its height.
 * @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} s @param {MonkeyLook} o
 */
export function drawMonkey(ctx, x, y, s, o) {
  const fur = o.mud ? '#5e3a1c' : '#8a5a2b';
  const face = o.mud ? '#9a7450' : '#f2d2a2';
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.tilt ?? 0);
  ctx.lineCap = 'round';
  // tail, swishing
  ctx.strokeStyle = fur;
  ctx.lineWidth = s * 0.09;
  const sw = Math.sin(o.t * 3) * 0.3;
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, s * 0.35);
  ctx.bezierCurveTo(-s * 0.9, s * (0.5 + sw), -s * 1.0, -s * 0.2, -s * 0.7, -s * (0.3 + sw * 0.5));
  ctx.stroke();
  if (o.wings) {
    const flap = (o.arm ?? 0) * 0.8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * s * 0.2, -s * 0.25);
      ctx.rotate(side * (-0.5 - flap));
      ctx.beginPath();
      ctx.ellipse(side * s * 0.5, 0, s * 0.55, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // legs and feet
  ctx.strokeStyle = fur;
  ctx.lineWidth = s * 0.16;
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, s * 0.35);
  ctx.lineTo(-s * 0.3, s * 0.85);
  ctx.moveTo(s * 0.2, s * 0.35);
  ctx.lineTo(s * 0.3, s * 0.85);
  ctx.stroke();
  // arms: the left hangs down, the right goes up with `arm`
  const up = o.arm ?? 0;
  ctx.beginPath();
  ctx.moveTo(-s * 0.32, -s * 0.2);
  ctx.lineTo(-s * 0.6, s * 0.3);
  ctx.moveTo(s * 0.32, -s * 0.2);
  ctx.lineTo(s * (0.6 - up * 0.2), s * (0.3 - up * 1.1));
  ctx.stroke();
  // body and belly
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.42, s * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(0, s * 0.08, s * 0.27, s * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  // head, ears, face
  const hy = -s * 0.75;
  for (const ex of [-1, 1]) {
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(ex * s * 0.42, hy, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(ex * s * 0.42, hy, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(0, hy, s * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(-s * 0.12, hy - s * 0.04, s * 0.14, s * 0.16, 0, 0, Math.PI * 2);
  ctx.ellipse(s * 0.12, hy - s * 0.04, s * 0.14, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, hy + s * 0.14, s * 0.24, s * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes: googly, looking at something; swirly when dizzy; blinking now and then
  const blink = (o.t % 3.7) < 0.12;
  const look = o.look ? Math.atan2(o.look.y - (y + hy), o.look.x - x) - (o.tilt ?? 0) : 0;
  for (const ex of [-0.12, 0.12]) {
    const cx = ex * s;
    const cy = hy - s * 0.05;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.085, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    if (blink) ctx.fillRect(cx - s * 0.08, cy - s * 0.01, s * 0.16, s * 0.02);
    else if (o.dizzy) {
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      for (let a = 0; a < 9; a += 0.4) ctx.lineTo(cx + Math.cos(a + o.t * 8) * a * s * 0.008, cy + Math.sin(a + o.t * 8) * a * s * 0.008);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(look) * s * 0.035, cy + Math.sin(look) * s * 0.035, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // a big cheeky grin, and nostrils
  ctx.fillStyle = '#1b1b1b';
  for (const nx of [-0.04, 0.04]) {
    ctx.beginPath();
    ctx.arc(nx * s, hy + s * 0.08, s * 0.015, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#7a1f1f';
  ctx.beginPath();
  ctx.arc(0, hy + s * 0.15, s * 0.14, 0.15, Math.PI - 0.15);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-s * 0.1, hy + s * 0.16, s * 0.2, s * 0.03);
  if (o.splat) {
    ctx.globalAlpha = o.splat;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = s * 0.22 * (i % 2 ? 0.7 : 1);
      ctx.lineTo(s * 0.08 + Math.cos(a) * r, hy + Math.sin(a) * r);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** The middle of the monkey's head, for a monkey drawn at x, y with size s. */
export const monkeyHead = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) => ({ x, y: y - s * 0.75, r: s * 0.4 });
