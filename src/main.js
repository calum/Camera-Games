import { PoseTracker, MouseTracker } from './tracker.js';
import { LEVELS } from './levels.js';
import { sfx, unlock } from './audio.js';
import { loadArt, drawArt } from './art.js';
import { text, drawSkeleton, drawHeart } from './draw.js';
import { Lobby } from './lobby.js';
import { Cutout } from './cutout.js';
import { Backdrops } from './backdrops.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ shared game object
const g = {
  W: 1280,
  H: 720,
  u: 1,
  now: 0,
  players: [],
  team: { score: 0, hearts: 5, maxHearts: 5 },
  particles: [],
  round: 0,
  diff: 1,
  debug: params.has('debug'),
  fx: !params.has('lite'), // ?lite turns off glow effects for slow machines
  // What the kids are shown against: 'cutout' = just the kids, cut out and placed in a cartoon world;
  // 'camera' = the whole camera picture. Key B switches (handy if the cut-out ever misbehaves).
  view: params.get('view') === 'camera' ? 'camera' : 'cutout',
  skeleton: 'thin', // how the tracked skeleton is drawn over the kids: 'thin' | 'bold' | 'off' (key K)
  level: null,
  levelEnd: null,
  notice: '',

  // Everyone who is visible AND playing (kids who sat out the lobby are excluded).
  activePlayers() {
    return this.players.filter((p) => p.present && !p.excluded);
  },
  score(p, pts, x, y) {
    if (p) p.score += pts;
    this.team.score += pts;
    this.particles.push({ x, y, vx: 0, vy: -90 * this.u, life: 1, max: 1, txt: `+${pts}`, color: p ? p.color : '#fff', size: 56 * this.u });
  },
  burst(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (120 + Math.random() * 380) * this.u;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7, color, size: (6 + Math.random() * 8) * this.u });
    }
  },
  endLevel(msg) {
    if (!this.levelEnd) this.levelEnd = msg;
  },
};

let pose = null;
let mouse = null;
let tracker = null;
const cutout = new Cutout();
const backdrops = new Backdrops();
let cutoutReady = false;

// ------------------------------------------------------------------ state machine
// loading -> menu -> intro -> play -> outro -> (next level ...) -> finale -> intro ...
let state = 'loading';
let stateT = 0;
let levelIdx = 0;
let levelT = 0;
const lobby = new Lobby({ hold: 3 });
let outroMsg = '';
let status = 'Loading...';

function setState(s) {
  state = s;
  stateT = 0;
}

function toMenu() {
  for (const p of g.players) p.excluded = false;
  lobby.reset();
  setState('menu');
}

function startLevel(i) {
  levelIdx = i % LEVELS.length;
  g.level = LEVELS[levelIdx];
  g.levelEnd = null;
  g.team.hearts = g.team.maxHearts;
  g.level.start(g);
  levelT = 0;
  setState('intro');
}

// joinedIds: the kids who joined with arms out (everyone else sits out); null = include everyone.
function startGame(joinedIds = null) {
  g.team.score = 0;
  g.round = 0;
  g.diff = 1;
  for (const p of g.players) {
    p.score = 0;
    p.excluded = joinedIds ? !joinedIds.includes(p.id) : false;
  }
  startLevel(0);
}

function nextLevel() {
  if (levelIdx + 1 >= LEVELS.length) {
    sfx.fanfare();
    setState('finale');
  } else {
    startLevel(levelIdx + 1);
  }
}

// ------------------------------------------------------------------ setup
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  g.W = canvas.width;
  g.H = canvas.height;
  g.u = g.H / 1080;
  tracker?.setView(g.W, g.H);
  pose?.setView(g.W, g.H);
  mouse?.setView(g.W, g.H);
}

function useMouse() {
  mouse ??= new MouseTracker(canvas);
  tracker = mouse;
  g.players = [];
  resize();
}

async function boot() {
  loadArt();
  resize();
  if (params.has('mouse')) {
    useMouse();
    setState('menu');
    return;
  }
  try {
    pose = new PoseTracker({ model: params.get('model') }); // ?model=lite|full to force a model
    status = 'Waking up the pose detector...';
    await pose.init();
    status = 'Starting the camera... (click Allow)';
    await pose.startCamera();
    tracker = pose;
    resize();
    setState('menu');
  } catch (e) {
    console.error(e);
    g.notice = `No camera (${e.message || e}). Using the mouse instead.`;
    useMouse();
    setState('menu');
  }
}

window.addEventListener('resize', resize);

window.addEventListener('keydown', (e) => {
  unlock();
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') {
    if (state === 'menu') startGame();
    else if (state === 'finale') {
      g.round++;
      g.diff = 1 + 0.25 * g.round;
      startLevel(0);
    }
    e.preventDefault();
  } else if (k === 'n' && g.level && state !== 'menu') nextLevel();
  else if (k >= '1' && k <= '4' && state !== 'loading') {
    if (state === 'menu') g.team.score = 0;
    startLevel(Number(k) - 1);
  } else if (k === 'escape') toMenu();
  else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  else if (k === 'd') g.debug = !g.debug;
  else if (k === 'b') g.view = g.view === 'cutout' ? 'camera' : 'cutout';
  else if (k === 'k') g.skeleton = { thin: 'bold', bold: 'off', off: 'thin' }[g.skeleton];
  else if (k === 'm' && state !== 'loading') {
    if (tracker === mouse) {
      if (pose) {
        tracker = pose;
        g.players = [];
        lobby.reset();
        resize();
      }
    } else {
      useMouse();
      lobby.reset();
    }
  }
});
window.addEventListener('pointerdown', unlock);

// ------------------------------------------------------------------ update
function update(dt) {
  g.players = tracker ? tracker.update(g.now) : [];
  stateT += dt;
  // Cut the kids out of the camera picture (pose silhouettes + motion safety net).
  cutoutReady = g.view === 'cutout' && !!pose && tracker === pose && cutout.update(pose.video, pose.maskLow, pose.maskW, pose.maskH, dt);

  for (const q of g.particles) {
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (!q.txt) q.vy += 900 * g.u * dt;
  }
  g.particles = g.particles.filter((q) => q.life > 0);

  if (state === 'menu') {
    // Arms out for 3s starts the game with exactly the kids who have their arms out.
    const joinedIds = lobby.update(g.activePlayers(), g.now, dt);
    if (joinedIds) startGame(joinedIds);
  } else if (state === 'intro') {
    if (stateT > 3) {
      sfx.go();
      setState('play');
    }
  } else if (state === 'play') {
    levelT += dt;
    g.level.update(g, dt);
    if (g.levelEnd || levelT >= g.level.duration) {
      outroMsg = g.levelEnd || 'Level complete!';
      if (!g.levelEnd) sfx.fanfare();
      setState('outro');
    }
  } else if (state === 'outro') {
    if (stateT > 3) {
      // if the team ran out of hearts, replay the level instead of moving on
      if (g.levelEnd) startLevel(levelIdx);
      else nextLevel();
    }
  } else if (state === 'finale') {
    if (stateT > 12) {
      g.round++;
      g.diff = 1 + 0.25 * g.round;
      startLevel(0);
    }
  }
}

// ------------------------------------------------------------------ render
// Which cartoon world to show: one per level, a meadow in the menu, fireworks in the finale.
function backdropId() {
  if (state === 'finale') return 'finale';
  if (state === 'menu' || state === 'loading' || !g.level) return 'menu';
  return g.level.id;
}

function drawBackground() {
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, g.W, g.H);
  const r = pose && tracker === pose ? pose.videoRect() : null;
  const camera = r && pose.video.readyState >= 2;

  if (g.view === 'camera' && camera) {
    // the whole camera picture, at full brightness so the kids see themselves in full colour
    ctx.save();
    ctx.translate(r.x + r.w, r.y);
    ctx.scale(-1, 1);
    ctx.drawImage(pose.video, 0, 0, r.w, r.h);
    ctx.restore();
    if (g.level && state !== 'menu') {
      ctx.globalAlpha = 0.07; // just a hint of the level's colour, not a veil over the kids
      ctx.fillStyle = g.level.color;
      ctx.fillRect(0, 0, g.W, g.H);
      ctx.globalAlpha = 1;
    }
    return;
  }
  // cartoon world, with the kids cut out of the camera picture and placed in it
  backdrops.draw(ctx, backdropId(), g.W, g.H, g.now);
  if (camera && cutoutReady) cutout.draw(ctx, r);
}
function drawParticles() {
  for (const q of g.particles) {
    const a = Math.max(0, q.life / q.max);
    ctx.globalAlpha = a;
    if (q.txt) text(ctx, q.txt, q.x, q.y, q.size, { color: q.color });
    else {
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * a + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  const u = g.u;
  const L = g.level;
  text(ctx, L.title, 40 * u, 55 * u, 48 * u, { align: 'left' });
  // timer bar
  const bw = g.W * 0.3;
  const bx = (g.W - bw) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx, 28 * u, bw, 22 * u);
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx, 28 * u, bw * Math.max(0, 1 - levelT / L.duration), 22 * u);
  // team score
  drawArt(ctx, 'star', g.W - 220 * u, 55 * u, 64 * u);
  text(ctx, String(g.team.score), g.W - 40 * u, 55 * u, 64 * u, { align: 'right', color: '#ffe14d' });
  if (L.hearts) {
    for (let i = 0; i < g.team.maxHearts; i++) drawHeart(ctx, g.W - (60 + i * 62) * u, 130 * u, 28 * u, i < g.team.hearts);
  }
}

function drawPlayerCount() {
  const n = g.activePlayers().length;
  const word = state === 'menu' ? 'spotted' : 'playing';
  text(ctx, n ? `${n} player${n > 1 ? 's' : ''} ${word}!` : 'Step into view...', g.W / 2, g.H - 60 * g.u, 54 * g.u);
}

function render() {
  const u = g.u;
  drawBackground();

  if (state === 'loading') {
    text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.4, 110 * u);
    text(ctx, status, g.W / 2, g.H * 0.55, 48 * u);
    return;
  }

  if (g.level && state !== 'menu' && state !== 'finale') g.level.draw(g, ctx);
  for (const p of g.players) drawSkeleton(ctx, p, g);
  drawParticles();

  if (state === 'menu') {
    ctx.fillStyle = 'rgba(8,12,30,0.3)';
    ctx.fillRect(0, 0, g.W, g.H);
    // All the words live in a band at the top so they never cover the kids.
    text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.07, 96 * u, { color: '#ffe14d' });
    text(ctx, 'Arms out like an airplane for 3 seconds to JOIN and START!', g.W / 2, g.H * 0.15, 44 * u);
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
    drawPlayerCount();
    text(ctx, 'grown-ups: SPACE starts with everyone', g.W - 30 * u, g.H - 30 * u, 24 * u, { align: 'right' });
    if (g.notice) text(ctx, g.notice, g.W / 2, g.H * 0.26, 28 * u, { color: '#ffb3b3' });
    if (tracker === mouse) text(ctx, 'Mouse mode: move = body & hands, click = jump, Q/W/E = poses', g.W / 2, g.H * 0.8, 28 * u);
  } else if (state === 'intro') {
    ctx.fillStyle = 'rgba(8,12,30,0.4)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, `Level ${levelIdx + 1}`, g.W / 2, g.H * 0.22, 70 * u, { color: '#ffe14d' });
    text(ctx, g.level.title, g.W / 2, g.H * 0.36, 130 * u);
    text(ctx, g.level.hint, g.W / 2, g.H * 0.5, 50 * u);
    text(ctx, String(Math.max(1, Math.ceil(3 - stateT))), g.W / 2, g.H * 0.7, 200 * u, { color: '#7dff6b' });
    drawPlayerCount();
  } else if (state === 'play') {
    drawHud();
  } else if (state === 'outro') {
    drawHud();
    ctx.fillStyle = 'rgba(8,12,30,0.4)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, outroMsg, g.W / 2, g.H * 0.4, 100 * u, { color: '#ffe14d' });
    text(ctx, `Team score: ${g.team.score}`, g.W / 2, g.H * 0.55, 70 * u);
  } else if (state === 'finale') {
    ctx.fillStyle = 'rgba(8,12,30,0.6)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, 'Amazing teamwork!', g.W / 2, g.H * 0.18, 130 * u, { color: '#ffe14d' });
    text(ctx, `Team score: ${g.team.score}`, g.W / 2, g.H * 0.32, 80 * u);
    const ranked = g.players.filter((p) => !p.excluded).sort((a, b) => b.score - a.score);
    ranked.forEach((p, i) => text(ctx, `${i === 0 ? '👑 ' : ''}★ ${p.score}`, g.W / 2, g.H * (0.46 + i * 0.1), 70 * u, { color: p.color }));
    text(ctx, 'Next round is a bit harder...', g.W / 2, g.H * 0.92, 44 * u);
  }

  if (g.debug) {
    const fps = dtSmooth > 0 ? Math.round(1 / dtSmooth) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, g.H - 110, 420, 100);
    const line = (s, y) => text(ctx, s, 20, y, 22, { align: 'left', stroke: 'transparent', weight: 600 });
    line(`fps ${fps}   detect ${tracker?.detectMs?.toFixed?.(1)} ms (${tracker?.delegate}, ${tracker?.modelName ?? '-'})`, g.H - 90);
    line(`players ${g.activePlayers().length}   state ${state}   diff ${g.diff.toFixed(2)}`, g.H - 62);
    line(`keys: D debug  B cut-out/camera  K skeleton  F fullscreen  M mouse  N next  1-4 level  Esc menu`, g.H - 34);
    if (g.view === 'cutout' && cutoutReady) {
      const s = cutout.stats;
      text(ctx, `cut-out ${(s.coverage * 100).toFixed(0)}% of screen   pose mask ${s.poseActive ? 'ON' : 'LOST (using motion)'}   motion ${(s.motionFrac * 100).toFixed(0)}%`, 440, g.H - 90, 22 * u, { align: 'left', stroke: 'rgba(0,0,0,0.8)', weight: 600 });
    }
    // what the game thinks each kid is doing (handy when a pose won't register)
    for (const p of g.activePlayers()) {
      const on = Object.entries(p.pose).filter(([, v]) => v).map(([k]) => k).join(' + ') || 'no pose';
      text(ctx, `on ${on}   (torso/shoulders ${(p.torso / p.shoulderW).toFixed(1)})`, p.px[0].x, p.px[0].y - 120 * u, 24 * u, { color: p.color });
    }
  }
}

// ------------------------------------------------------------------ main loop
let last = 0;
let dtSmooth = 0.016;
function frame(ts) {
  requestAnimationFrame(frame);
  const now = ts / 1000;
  const dt = Math.min(0.05, now - last || 0.016);
  last = now;
  dtSmooth = dtSmooth * 0.95 + dt * 0.05;
  g.now = now;
  update(dt);
  render();
}

requestAnimationFrame(frame);
boot();

// handy for debugging / automated tests
window.__game = { g, startLevel, cutout, backdrops, get state() { return state; }, get tracker() { return tracker; }, get cutoutReady() { return cutoutReady; } };
