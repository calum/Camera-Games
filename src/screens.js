// The screens drawn over the game: the join screen, the setup check, the play-space walk, the picker, a level's
// intro, HUD and outro, the reconnecting screen, toasts and the debug panel. Drawing only: main.js decides which
// screen shows and passes in what each one needs. All the words stay in the top band, so the kids can watch themselves.
/** @import { Game } from './types.js' */
/** @typedef {Game & Record<string, any>} G  the game object, with main.js's extras (particles, toast, notice) */
/** @import { Lobby } from './lobby.js' */
/** @import { Carousel } from './picker.js' */
/** @import { SetupCheck } from './setup-check.js' */
/** @import { Calibration } from './calibrate.js' */
import { drawArt } from './art.js';
import { text, drawHeart, popScale, roundRectPath } from './draw.js';
import { drawPicker } from './picker.js';
import { accelerationHelp } from './setup-check.js';

// Score pop-ups, sparks, rings and confetti (the particles in g.particles).
/** @param {CanvasRenderingContext2D} ctx  @param {G} g */
export function drawParticles(ctx, g) {
  for (const q of g.particles) {
    const a = Math.max(0, q.life / q.max);
    ctx.globalAlpha = a;
    if (q.txt) {
      // pops in with a bounce, stays solid, then fades over its last 40%
      ctx.globalAlpha = Math.min(1, a / 0.4);
      text(ctx, q.txt, q.x, q.y, q.size * popScale(q.max - q.life), { color: q.color });
    } else if (q.ring) {
      ctx.lineWidth = 10 * g.u * a;
      ctx.strokeStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (1.15 - a * 0.85), 0, Math.PI * 2);
      ctx.stroke();
    } else if (q.paper !== undefined) {
      ctx.globalAlpha = Math.min(1, a * 3);
      ctx.fillStyle = q.color;
      ctx.save();
      ctx.translate(q.x + Math.sin(q.paper) * 20 * g.u, q.y);
      ctx.rotate(q.paper * 0.7);
      ctx.fillRect(-q.size / 2, -q.size * 0.3 * Math.abs(Math.cos(q.paper)) - 1, q.size, q.size * 0.6 * Math.abs(Math.cos(q.paper)) + 2);
      ctx.restore();
    } else {
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * a + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// The bar along the top during a level: its name, the time left, the team's stars and hearts.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {number} levelT  @param {boolean} playing */
export function drawHud(ctx, g, levelT, playing) {
  const u = g.u;
  const L = g.level;
  text(ctx, L.title, 40 * u, 55 * u, 48 * u, { align: 'left' });
  // timer bar
  const bw = g.W * 0.3;
  const bx = (g.W - bw) / 2;
  const left = Math.max(0, L.duration - levelT);
  const ending = left < 5 && playing; // the last 5 s: the bar goes orange and throbs
  const bh = 22 * u * (ending ? 1 + 0.15 * Math.max(0, Math.sin(g.now * 10)) : 1);
  fillRoundRect(ctx, bx - 4 * u, 39 * u - bh / 2 - 4 * u, bw + 8 * u, bh + 8 * u, 'rgba(0,0,0,0.45)');
  if (left > 0) fillRoundRect(ctx, bx, 39 * u - bh / 2, Math.max(bh, bw * (left / L.duration)), bh, ending ? '#ffa23d' : '#fff');
  // team score
  drawArt(ctx, 'star', g.W - 220 * u, 55 * u, 64 * u);
  text(ctx, String(g.team.score), g.W - 40 * u, 55 * u, 64 * u, { align: 'right', color: '#ffe14d' });
  if (L.hearts) {
    for (let i = 0; i < g.team.maxHearts; i++) drawHeart(ctx, g.W - (60 + i * 62) * u, 130 * u, 28 * u, i < g.team.hearts);
  }
}

/** @param {CanvasRenderingContext2D} ctx */
function fillRoundRect(ctx, x, y, w, h, color, r = h / 2) {
  ctx.fillStyle = color;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {string} word  'spotted' or 'playing' */
function drawPlayerCount(ctx, g, word) {
  const n = g.activePlayers().length;
  text(ctx, n ? `${n} player${n > 1 ? 's' : ''} ${word}!` : 'Step into view...', g.W / 2, g.H - 60 * g.u, 54 * g.u);
}

// A row per check: a tick, a cross or dots, and what to do about it. Kept to the top half so the kids stay visible.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {SetupCheck} setup  @param {boolean} mobile */
export function drawSetup(ctx, g, setup, mobile) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.35)';
  ctx.fillRect(0, 0, g.W, g.H);
  text(ctx, setup.passed ? 'All set! Let\'s play!' : 'Quick setup check', g.W / 2, g.H * 0.08, 80 * u, { color: setup.passed ? '#7dff6b' : '#ffe14d' });
  const names = { camera: 'Camera', light: 'Light', distance: 'Distance', speed: 'Speed', graphics: 'Graphics' };
  const w = Math.min(g.W - 80 * u, 1300 * u);
  const x0 = (g.W - w) / 2;
  setup.items.forEach((c, i) => {
    const y = g.H * 0.17 + i * 74 * u;
    ctx.fillStyle = 'rgba(8,12,30,0.65)';
    ctx.fillRect(x0, y - 32 * u, w, 64 * u);
    const mark = c.ok === true ? '✓' : c.ok === false ? '✗' : '…';
    const color = c.ok === true ? '#7dff6b' : c.ok === false ? '#ff8a80' : '#cfd6e6';
    text(ctx, mark, x0 + 40 * u, y, 44 * u, { color });
    text(ctx, names[c.name] ?? c.name, x0 + 80 * u, y, 36 * u, { align: 'left', color });
    text(ctx, c.text, x0 + 300 * u, y, 32 * u, { align: 'left' });
  });
  if (setup.items.some((c) => c.name === 'graphics' && c.ok === false)) {
    text(ctx, accelerationHelp(navigator.userAgent), g.W / 2, g.H * 0.17 + setup.items.length * 74 * u, 30 * u, { color: '#ffe14d' });
  }
  const how = mobile ? 'tap the screen' : 'press SPACE or tap';
  const foot = setup.overdue ? `Fix what is marked ✗ and it will carry on by itself, or ${how} to play anyway` : `Grown-ups: ${how} to skip`;
  text(ctx, foot, g.W / 2, g.H - 50 * u, 32 * u, { color: setup.overdue ? '#ffe14d' : '#cfd6e6' });
}

// The play-space check: a big arrow says which way to walk, and each kid's ground is coloured in, in their own
// colour, as they explore it. Overlapping grounds add up, so two kids' colours mix where they both went.
// The words stay in the top band, like every screen, so the kids can watch themselves.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {Calibration} c  @param {boolean} mobile */
export function drawCalibration(ctx, g, c, mobile) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.25)';
  ctx.fillRect(0, 0, g.W, g.H);
  const pad = 40 * u; // a body is wider than the middle of its shoulders
  const floor = g.H - 90 * u;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // red over blue makes purple, not just the colour on top
  for (const r of c.ranges.values()) {
    const x0 = r.lo * g.W - pad;
    const w = (r.hi - r.lo) * g.W + 2 * pad;
    // a light wash over the whole height of the ground, and a stronger floor strip under it
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = r.color;
    ctx.fillRect(x0, 0, w, floor);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x0, floor, w, 70 * u);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x0, floor, w, 8 * u);
  }
  ctx.restore();
  // stars at the ends of the whole space found so far (once it is done: the play space the games will use)
  if (c.lo <= c.hi) {
    const a = c.phase === 'done' ? c.area : null;
    const x0 = (a ? a.x0 : c.lo) * g.W;
    const x1 = (a ? a.x1 : c.hi) * g.W;
    for (const x of [x0 - pad, x1 + pad]) text(ctx, '⭐', x, floor + 30 * u, 60 * u);
  }
  if (c.phase === 'done') {
    text(ctx, 'This is your play space!', g.W / 2, g.H * 0.08, 84 * u, { color: '#7dff6b' });
    text(ctx, 'The games will stay inside it.', g.W / 2, g.H * 0.16, 44 * u);
    return;
  }
  const left = c.phase === 'left';
  text(ctx, 'Show me your play space!', g.W / 2, g.H * 0.07, 72 * u, { color: '#ffe14d' });
  text(ctx, left ? 'Walk this way as far as you can go!' : 'Now walk the other way, as far as you can!', g.W / 2, g.H * 0.15, 48 * u);
  // a big bouncing arrow on that side, and a ring that fills once they have stopped at the furthest spot
  const dir = left ? -1 : 1;
  const x = g.W / 2 + dir * (g.W * 0.36 + Math.sin(g.now * 6) * 25 * u);
  const y = g.H * 0.3;
  text(ctx, left ? '⬅' : '➡', x, y, 150 * u, { color: '#ffe14d' });
  if (c.progress > 0) {
    ctx.lineWidth = 14 * u;
    ctx.strokeStyle = '#7dff6b';
    ctx.beginPath();
    ctx.arc(x, y, 100 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
    ctx.stroke();
  }
  const how = mobile ? 'tap the screen' : 'press SPACE or tap';
  text(ctx, `Stop where a wall or the sofa is in the way.   Grown-ups: ${how} to skip`, g.W / 2, g.H * 0.21, 28 * u, { color: '#cfd6e6' });
}

// The friendly screen while the camera or the tracking is put right (see PoseTracker._heal). After a few seconds
// it suggests what a grown-up can check, in case it can't fix itself.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {string} what  'camera' or 'tracking'  @param {number} secs  how long so far */
export function drawReconnecting(ctx, g, what, secs) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.7)';
  ctx.fillRect(0, 0, g.W, g.H);
  ctx.lineWidth = 16 * u;
  ctx.strokeStyle = '#7dff6b';
  ctx.beginPath();
  const a = g.now * 5;
  ctx.arc(g.W / 2, g.H * 0.36, 60 * u, a, a + Math.PI * 1.3);
  ctx.stroke();
  text(ctx, what === 'camera' ? 'Reconnecting the camera...' : 'Waking up the pose detector...', g.W / 2, g.H * 0.56, 72 * u, { color: '#ffe14d' });
  text(ctx, 'Hold on, the game will carry on by itself.', g.W / 2, g.H * 0.66, 44 * u);
  if (secs > 6) {
    const hint = what === 'camera' ? 'Grown-ups: check the camera is plugged in and no other app is using it.' : 'Grown-ups: closing other tabs and apps can help.';
    text(ctx, hint, g.W / 2, g.H * 0.76, 32 * u, { color: '#cfd6e6' });
  }
}

/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {string} status */
export function drawLoading(ctx, g, status) {
  const u = g.u;
  text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.4, 110 * u);
  text(ctx, status, g.W / 2, g.H * 0.55, 48 * u);
}

// The join screen: everything said in a band at the top, and a countdown ring over each kid with their arms out.
/**
 * @param {CanvasRenderingContext2D} ctx  @param {G} g
 * @param {{ lobby: Lobby, mobile: boolean, portrait: boolean, slowGraphics: boolean, mouseMode: boolean }} o
 */
export function drawMenu(ctx, g, { lobby, mobile, portrait, slowGraphics, mouseMode }) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.3)';
  ctx.fillRect(0, 0, g.W, g.H);
  // All the words live in a band at the top so they never cover the kids.
  text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.07, 96 * u, { color: '#ffe14d' });
  text(ctx, 'Arms out like an airplane for 3 seconds to JOIN!', g.W / 2, g.H * 0.15, 44 * u);
  text(ctx, "Stand back so the camera sees all of you. Anyone who doesn't join sits this one out.", g.W / 2, g.H * 0.2, 26 * u);
  // Who has joined: a green countdown ring over each airplane kid, a nudge over the others.
  for (const p of g.activePlayers()) {
    const x = p.px[0].x;
    const y = Math.max(g.H * 0.3, p.px[0].y - Math.max(120 * u, p.shoulderW * 1.0));
    if (lobby.isJoined(p.id)) {
      ctx.lineWidth = 14 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(x, y, 52 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#7dff6b';
      ctx.beginPath();
      ctx.arc(x, y, 52 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lobby.progress);
      ctx.stroke();
      text(ctx, String(lobby.secondsLeft), x, y, 60 * u, { color: '#7dff6b' });
      text(ctx, '✓ IN', x, y - 85 * u, 36 * u, { color: '#7dff6b' });
    } else {
      text(ctx, 'arms out to join', x, y, 28 * u, { color: '#cfd6e6' });
    }
  }
  if (lobby.joined.length) {
    const n = lobby.joined.length;
    text(ctx, `Starting with ${n} player${n > 1 ? 's' : ''}... keep your arms out!`, g.W / 2, g.H * 0.86, 46 * u, { color: '#7dff6b' });
  }
  drawPlayerCount(ctx, g, 'spotted');
  text(ctx, mobile ? 'grown-ups: tap the screen for the buttons (Start, Camera, Full screen)' : 'grown-ups: SPACE starts with everyone, or tap or move the mouse for buttons', g.W - 30 * u, g.H - 30 * u, 24 * u, { align: 'right' });
  if (portrait) text(ctx, 'The camera picture is upright (portrait). Turn the phone sideways for a much wider view.', g.W / 2, g.H * 0.26, 28 * u, { color: '#ffe14d' });
  if (g.notice) text(ctx, g.notice, g.W / 2, g.H * 0.26, 28 * u, { color: '#ffb3b3' });
  // the setup check only runs once, but acceleration can be switched off later: say so every time
  if (slowGraphics) {
    text(ctx, `The game may lag: graphics acceleration is off. ${accelerationHelp(navigator.userAgent)}`, g.W / 2, g.H * 0.3, 26 * u, { color: '#ffe14d' });
  }
  if (mouseMode) text(ctx, 'Mouse mode: move = body & hands, click = jump, Q/W/E = poses', g.W / 2, g.H * 0.8, 28 * u);
}

/**
 * @param {CanvasRenderingContext2D} ctx  @param {G} g
 * @param {Parameters<typeof drawPicker>[2]} choices  @param {Carousel} carousel  @param {Parameters<typeof drawPicker>[4]} cards
 * @param {number} lastStep  when the carousel last scrolled
 */
export function drawPick(ctx, g, choices, carousel, cards, lastStep) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.3)';
  ctx.fillRect(0, 0, g.W, g.H);
  text(ctx, 'Pick a game!', g.W / 2, g.H * 0.045, 60 * u, { color: '#ffe14d' });
  drawPicker(ctx, g, choices, carousel, cards, lastStep);
}

// Before a level: its name, its hint and a bouncing 3, 2, 1.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {number} levelIdx  @param {number} stateT  seconds into the intro */
export function drawIntro(ctx, g, levelIdx, stateT) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.4)';
  ctx.fillRect(0, 0, g.W, g.H);
  // the level's colour as a soft band behind the words, its picture beside the level number
  ctx.globalAlpha = 0.35;
  fillRoundRect(ctx, g.W * 0.08, g.H * 0.15, g.W * 0.84, g.H * 0.42, g.level.color, 60 * u);
  ctx.globalAlpha = 1;
  text(ctx, `${g.level.icon ?? ''}  Level ${levelIdx + 1}`, g.W / 2, g.H * 0.22, 70 * u, { color: '#ffe14d' });
  text(ctx, g.level.title, g.W / 2, g.H * 0.36, 130 * u * popScale(stateT));
  text(ctx, g.level.hint, g.W / 2, g.H * 0.5, 50 * u);
  // 3, 2, 1: each number lands with a bounce on its own second
  const n = Math.max(1, Math.ceil(3 - stateT));
  text(ctx, String(n), g.W / 2, g.H * 0.7, 200 * u * popScale(stateT - (3 - n)), { color: '#7dff6b' });
  drawPlayerCount(ctx, g, 'playing');
}

// The end of a level: how it went, the team's score and each kid's stars.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {string} msg */
export function drawOutro(ctx, g, msg) {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.4)';
  ctx.fillRect(0, 0, g.W, g.H);
  text(ctx, msg, g.W / 2, g.H * 0.3, 100 * u, { color: '#ffe14d' });
  text(ctx, `Team score: ${g.team.score}`, g.W / 2, g.H * 0.45, 70 * u);
  // each kid's stars, best first, side by side
  const ranked = g.players.filter((p) => !p.excluded).sort((a, b) => b.score - a.score);
  ranked.forEach((p, i) => text(ctx, `${i === 0 ? '👑 ' : ''}★ ${p.score}`, g.W * ((i + 1) / (ranked.length + 1)), g.H * 0.62, 64 * u, { color: p.color }));
}

// A short message in the middle of the screen (g.toast), until it runs out.
/** @param {CanvasRenderingContext2D} ctx  @param {G} g */
export function drawToast(ctx, g) {
  if (!g.toast || g.now >= g.toast.until) return;
  const u = g.u;
  ctx.font = `800 ${36 * u}px "Trebuchet MS", system-ui, sans-serif`;
  const w = ctx.measureText(g.toast.text).width + 60 * u;
  ctx.fillStyle = 'rgba(8,12,30,0.75)';
  ctx.fillRect((g.W - w) / 2, 80 * u, w, 64 * u);
  text(ctx, g.toast.text, g.W / 2, 112 * u, 36 * u);
}

// The debug panel (?debug or D): top left, on a solid panel and drawn last, so the game's own text and the
// buttons can't cover it. Plus what the game thinks each kid is doing (handy when a pose won't register).
/** @param {CanvasRenderingContext2D} ctx  @param {G} g  @param {string[]} lines */
export function drawDebugPanel(ctx, g, lines) {
  const u = g.u;
  const size = 24 * u;
  ctx.font = `600 ${size}px "Trebuchet MS", system-ui, sans-serif`;
  const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 30 * u;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(10 * u, 10 * u, w, lines.length * size * 1.3 + 20 * u);
  lines.forEach((s, i) => text(ctx, s, 25 * u, 20 * u + (i + 0.5) * size * 1.3, size, { align: 'left', stroke: 'transparent', weight: 600 }));
  for (const p of g.activePlayers()) {
    const on = Object.entries(p.pose).filter(([, v]) => v).map(([k]) => k).join(' + ') || 'no pose';
    text(ctx, `on ${on}   (torso/shoulders ${(p.torso / p.shoulderW).toFixed(1)})`, p.px[0].x, p.px[0].y - 120 * u, 24 * u, { color: p.color });
  }
}
