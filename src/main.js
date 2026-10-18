/** @import { Game, Player } from './types.js' */
import { PoseTracker, MouseTracker } from './tracker.js';
import { LEVELS } from './levels/index.js';
import { sfx, unlock } from './audio.js';
import { Ease } from './ease.js';
import { loadArt, drawArt, registerArt } from './art.js';
import { text, drawSkeleton, drawHeart } from './draw.js';
import { Lobby, lateJoin } from './lobby.js';
import { Picker, pickerChoices, pickerLayout, pickingHands, cardAt, surprisePick, drawPicker } from './picker.js';
import { Cutout } from './cutout.js';
import { Backdrops } from './backdrops.js';
import { loadSavedCamera } from './camera.js';
import { defaultSettings } from './device.js';
import { createControls } from './controls.js';
import { Family } from './family.js';
import { SIGNAL_URL } from './online-config.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const settings = defaultSettings(params, navigator);
// The canvas is drawn at most at 1080p and scaled up by the browser: a 4K TV would otherwise mean four
// times the pixels to fill every frame for no visible gain from the sofa.
const MAX_W = 1920;
const MAX_H = 1080;

// ------------------------------------------------------------------ shared game object
const ease = new Ease(); // slows the game down when the kids keep failing
/** @type {Game & Record<string, any>} */
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
  ease: 1,
  debug: params.has('debug'),
  fx: settings.fx, // glow effects: off with ?lite, on phones, or when drawing gets slow (see watchFrameRate)
  // What the kids are shown against: 'cutout' = just the kids, cut out and placed in a cartoon world;
  // 'camera' = the whole camera picture. Key B switches (handy if the cut-out ever misbehaves).
  view: params.get('view') === 'camera' ? 'camera' : 'cutout',
  skeleton: 'thin', // how the tracked skeleton is drawn over the kids: 'thin' | 'bold' | 'off' (key K)
  level: null,
  levelEnd: null,
  notice: '',
  toast: null, // a short message in the middle of the screen: { text, until }

  // Everyone who is visible AND playing (kids who sat out the lobby are excluded).
  activePlayers() {
    return this.players.filter((p) => p.present && !p.excluded);
  },
  score(p, pts, x, y) {
    if (p) {
      p.score += pts;
      ease.hit(this.now);
    } else ease.point(this.now);
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
  miss() {
    ease.miss(this.now);
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
// loading -> menu (arms out to join) -> pick (choose a level) -> intro -> play -> outro -> pick ...
let state = 'loading';
let stateT = 0;
let levelIdx = 0;
let lastPlayed = -1; // so "Surprise!" never picks the level just played
let levelT = 0;
const lobby = new Lobby({ hold: 3 });
const picker = new Picker();
const choices = pickerChoices(LEVELS);
let pickRects = pickerLayout(choices.length, g.W, g.H, g.u);
let pickHands = [];
/** @type {Record<number, number>} */
const wiggle = {}; // card -> when a hand last moved onto it
// Playing with family in another home (docs/ONLINE.md). Idle unless the grown-up opens a room (key O) or the page
// was opened with ?room=CODE.
const family = new Family({ canvas, search: location.search, origin: location.origin + location.pathname, signal: params.get('signal') || SIGNAL_URL });
let outroMsg = '';
let status = 'Loading...';

function setState(s) {
  state = s;
  stateT = 0;
}

// Everyone the tracker knows, including kids who are briefly out of view (so they keep their place),
// and the family guests.
const localPeople = () => /** @type {Player[]} */ (tracker?.people?.players ?? g.players.filter((p) => !p.remote));
const everyone = () => [...localPeople(), ...family.crowd.players];

function toMenu() {
  for (const p of everyone()) p.excluded = false;
  g.level = null;
  lobby.reset();
  setState('menu');
}

// The level picker: the kids who joined choose what to play, and come back here after every level.
function toPick() {
  g.level = null;
  picker.reset();
  setState('pick');
}

/** @param {number} i  a card in `choices` */
function choose(i) {
  const c = choices[i];
  if (!c) return;
  sfx.chime();
  startLevel(c.kind === 'level' ? c.index : surprisePick(LEVELS.length, lastPlayed));
}

// Difficulty = the round's step up, times the auto-ease.
function setDiff() {
  g.ease = ease.factor;
  g.diff = (1 + 0.25 * g.round) * ease.factor;
}

function startLevel(i) {
  levelIdx = i % LEVELS.length;
  lastPlayed = levelIdx;
  g.level = LEVELS[levelIdx];
  g.levelEnd = null;
  g.team.hearts = g.team.maxHearts;
  ease.newLevel();
  setDiff();
  g.level.start(g);
  levelT = 0;
  setState('intro');
}

// joinedIds: the kids who joined with arms out (everyone else sits out); null = include everyone.
function startGame(joinedIds = null) {
  g.team.score = 0;
  g.round = 0;
  ease.reset();
  for (const p of everyone()) {
    p.score = 0;
    p.excluded = joinedIds ? !joinedIds.includes(p.id) : false;
  }
  toPick();
}

// The grown-up's "skip": the next level in the list (wrapping round).
function nextLevel() {
  startLevel(levelIdx + 1);
}

const inLevel = () => state === 'intro' || state === 'play' || state === 'outro';

// ------------------------------------------------------------------ setup
function resize() {
  const s = Math.min(1, MAX_W / window.innerWidth, MAX_H / window.innerHeight);
  canvas.width = Math.round(window.innerWidth * s);
  canvas.height = Math.round(window.innerHeight * s);
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
  for (const level of LEVELS) if (level.art) registerArt(level.art);
  loadArt();
  resize();
  if (params.has('mouse')) {
    useMouse();
    setState('menu');
    jumpToLevelFromUrl();
    return;
  }
  try {
    // ?model=lite|full forces a pose model, ?quality=high|medium|low|lowest pins the whole tracking ladder,
    // ?cam=wide|standard forces the picture size, ?worker=off tracks on the main thread
    pose = new PoseTracker({
      model: params.get('model'),
      quality: params.get('quality'),
      startQuality: settings.startQuality,
      cameraMode: params.get('cam'),
      worker: settings.worker,
    });
    status = 'Waking up the pose detector...';
    await pose.init();
    status = 'Starting the camera... (click Allow)';
    await pose.startCamera({ deviceId: loadSavedCamera(globalThis.localStorage) }); // remembers the camera picked with C
    tracker = pose;
    if (pose.cameraCount > 1) toast(`Camera: ${pose.cameraLabel}  (${pose.cameraCount} found, press C to switch)`, 5);
    resize();
    setState('menu');
  } catch (e) {
    console.error(e);
    g.notice = `No camera (${e.message || e}). Using the mouse instead.`;
    useMouse();
    setState('menu');
  }
  jumpToLevelFromUrl();
}

// ?level=<id> starts straight in that level: handy while making or tuning a level (see docs/ADDING-GAMES.md).
function jumpToLevelFromUrl() {
  const id = params.get('level');
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i >= 0) startLevel(i);
  else if (id) g.notice = `No level called "${id}". Levels: ${LEVELS.map((l) => l.id).join(', ')}`;
}

function toast(text, secs = 3.5) {
  g.toast = { text, until: g.now + secs };
}

let switchingCamera = false;
async function switchCamera() {
  if (switchingCamera) return; // a switch is already under way: pressing C again must not start a second one
  switchingCamera = true;
  try {
    const cam = await pose.nextCamera();
    toast(cam ? `Camera ${cam.index} of ${cam.count}: ${cam.label}` : 'Only one camera found (a phone webcam app has to be running first)', 4);
  } catch (e) {
    console.error(e);
    toast(`Could not switch camera: ${e.message || e}`, 5);
  } finally {
    switchingCamera = false;
  }
}

window.addEventListener('resize', resize);

// What the grown-up can do. Keys and the on-screen buttons (controls.js) both call these.
const actions = {
  start() {
    if (state === 'menu') startGame();
    else if (state === 'pick') choose(choices.length - 1); // Surprise!
  },
  next() {
    if (g.level && inLevel()) nextLevel();
  },
  // Back one step: from a level to the picker, from the picker to the join screen.
  menu() {
    if (inLevel()) toPick();
    else if (state === 'pick') toMenu();
  },
  fullscreen() {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  },
  camera() {
    if (pose && tracker === pose) switchCamera();
  },
  family() {
    family.toggle();
    toast(family.active ? `Family room ${family.code}: ${family.role === 'host' ? 'ask them to open ' + family.link : 'looking for the host'}` : 'Family room closed', 6);
  },
};

window.addEventListener('keydown', (e) => {
  unlock();
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') {
    actions.start();
    e.preventDefault();
  } else if (k === 'n') actions.next();
  else if (k >= '1' && k <= '9' && Number(k) <= LEVELS.length && state !== 'loading') {
    if (state === 'menu') g.team.score = 0;
    startLevel(Number(k) - 1);
  } else if (k === 'escape') actions.menu();
  else if (k === 'f') actions.fullscreen();
  else if (k === 'd') g.debug = !g.debug;
  else if (k === 'c') actions.camera();
  else if (k === 'o' && state !== 'loading') actions.family();
  else if (k === 'v') family.toggleMute();
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
// A grown-up can tap (or click) a card in the picker instead of waiting for a kid's hand.
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'pick') return;
  const r = canvas.getBoundingClientRect();
  const i = cardAt(pickRects, { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height }, 0);
  if (i >= 0) choose(i);
});

createControls(actions, {
  state: () => state,
  mouseIsPlaying: () => !!mouse && tracker === mouse,
  hasCamera: () => !!pose && tracker === pose,
  family: () => family.active,
});

// Offline play on the hosted site: a service worker keeps a copy of the game. Only over HTTPS (GitHub Pages),
// so the local server and the tests always run the files on disk.
if (location.protocol === 'https:' && 'serviceWorker' in navigator && !params.has('nosw')) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch((e) => console.warn('offline copy unavailable', e));
}

// ------------------------------------------------------------------ update
let cutoutKey = '';
let cutoutT = 0;
function update(dt) {
  const local = tracker ? tracker.update(g.now) : [];
  g.players = local;
  if (family.role === 'host') {
    family.readGuestFrame();
    g.players = [...local, ...family.remotePlayers(g.now, g.W, g.H, localPeople().map((p) => p.slot))];
  }
  stateT += dt;
  admitPlayers(dt);
  // Cut the kids out of the camera picture (pose silhouettes + motion safety net). Only worth redoing when
  // the camera has a new picture or tracking a new answer (about 30 times a second, not every screen refresh);
  // in between, the last cut-out is drawn again.
  cutoutT += dt;
  const key = pose ? `${pose.video.currentTime}:${pose.frameSeq}` : '';
  let cutoutFresh = false;
  if (g.view !== 'cutout' || !pose || tracker !== pose) cutoutReady = false;
  else if (key !== cutoutKey) {
    cutoutKey = key;
    cutoutFresh = cutout.update(pose.video, pose.maskLow, pose.maskW, pose.maskH, cutoutT);
    cutoutReady = cutoutFresh || cutoutReady;
    cutoutT = 0;
  }
  if (family.role === 'guest') {
    family.sendFrame(local, cutoutFresh ? cutout : null, cutoutFresh ? pose.videoRect() : null, g.W, g.H, g.now);
    if (family.guestView) return; // the host runs the game; we only send our kids and show its picture
  }

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
  } else if (state === 'pick') {
    pickRects = pickerLayout(choices.length, g.W, g.H, g.u);
    pickHands = pickingHands(g.activePlayers());
    const { chosen, entered } = picker.update(pickRects, pickHands, dt);
    for (const i of entered) {
      wiggle[i] = g.now;
      sfx.tick();
    }
    if (chosen >= 0) choose(chosen);
  } else if (state === 'intro') {
    if (stateT > 3) {
      sfx.go();
      setState('play');
    }
  } else if (state === 'play') {
    levelT += dt;
    ease.update(g.now, g.activePlayers().length > 0);
    setDiff();
    g.level.update(g, dt);
    if (g.levelEnd || levelT >= g.level.duration) {
      outroMsg = g.levelEnd || 'Level complete!';
      if (g.levelEnd) {
        sfx.aww();
        ease.failedLevel(g.now); // out of hearts: the replay is a bit easier
      } else sfx.fanfare();
      setState('outro');
    }
  } else if (state === 'outro') {
    if (stateT > 4) toPick(); // back to the picker, to choose again (the same level is one card away)
  }
}

// People who show up while a game is under way only watch (they are in the picture, but can't score or be hit),
// so a parent walking past or a visiting cousin never barges in. To play they hold their arms out for 2 s.
// A kid who was playing and steps out of view is recognised when they come back (people.js) and carries on.
function admitPlayers(dt) {
  const playing = state !== 'menu' && state !== 'loading';
  for (const p of g.players) {
    if (p.isNew) {
      p.isNew = false;
      if (playing) p.excluded = true;
    }
    if (playing && lateJoin(p, dt)) {
      toast('A new player joined!', 3);
      sfx.star();
    }
  }
}

// If the screen can't keep up (under ~40 frames a second for a few seconds), turn the glow effects off.
let slowFor = 0;
function watchFrameRate(dt) {
  if (!g.fx || settings.fxPinned || state === 'loading') return;
  slowFor = dtSmooth > 1 / 40 ? slowFor + dt : 0;
  if (slowFor > 4) {
    g.fx = false;
    console.warn('drawing is slow, glow effects off');
  }
}

// ------------------------------------------------------------------ render
// Which cartoon world to show: one per level, a meadow in the menu and the picker.
function backdropId() {
  if (state === 'menu' || state === 'pick' || state === 'loading' || !g.level) return 'menu';
  return typeof g.level.backdrop === 'string' ? g.level.backdrop : g.level.id;
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
  const custom = g.level && inLevel() && typeof g.level.backdrop === 'object' ? g.level.backdrop : undefined;
  backdrops.draw(ctx, backdropId(), g.W, g.H, g.now, custom);
  if (camera && cutoutReady) cutout.draw(ctx, r);
  family.drawGuest(ctx, g.W, g.H);
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
  if (family.guestView && family.drawHostPicture(ctx, g.W, g.H)) return; // the host's picture already carries the room label
  drawBackground();

  if (state === 'loading') {
    text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.4, 110 * u);
    text(ctx, status, g.W / 2, g.H * 0.55, 48 * u);
    return;
  }

  if (g.level && inLevel()) g.level.draw(g, ctx);
  for (const p of g.players) drawSkeleton(ctx, p, g);
  drawParticles();

  if (state === 'menu') {
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
    drawPlayerCount();
    text(ctx, settings.mobile ? 'grown-ups: tap the screen for the buttons (Start, Camera, Full screen)' : 'grown-ups: SPACE starts with everyone, or tap or move the mouse for buttons', g.W - 30 * u, g.H - 30 * u, 24 * u, { align: 'right' });
    if (pose && tracker === pose && pose.isPortrait) text(ctx, 'The camera picture is upright (portrait). Turn the phone sideways for a much wider view.', g.W / 2, g.H * 0.26, 28 * u, { color: '#ffe14d' });
    if (g.notice) text(ctx, g.notice, g.W / 2, g.H * 0.26, 28 * u, { color: '#ffb3b3' });
    if (tracker === mouse) text(ctx, 'Mouse mode: move = body & hands, click = jump, Q/W/E = poses', g.W / 2, g.H * 0.8, 28 * u);
  } else if (state === 'pick') {
    ctx.fillStyle = 'rgba(8,12,30,0.3)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, 'Pick a game!', g.W / 2, g.H * 0.07, 84 * u, { color: '#ffe14d' });
    drawPicker(ctx, g, choices, pickRects, picker, pickHands, wiggle);
    text(ctx, 'Hold a hand up over a picture', g.W / 2, g.H * 0.92, 44 * u);
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
    text(ctx, outroMsg, g.W / 2, g.H * 0.3, 100 * u, { color: '#ffe14d' });
    text(ctx, `Team score: ${g.team.score}`, g.W / 2, g.H * 0.45, 70 * u);
    // each kid's stars, best first, side by side
    const ranked = g.players.filter((p) => !p.excluded).sort((a, b) => b.score - a.score);
    ranked.forEach((p, i) => text(ctx, `${i === 0 ? '👑 ' : ''}★ ${p.score}`, g.W * ((i + 1) / (ranked.length + 1)), g.H * 0.62, 64 * u, { color: p.color }));
  }

  if (family.active) text(ctx, family.label, 30 * u, g.H - 30 * u, 26 * u, { align: 'left' });

  if (g.toast && g.now < g.toast.until) {
    ctx.font = `800 ${36 * u}px "Trebuchet MS", system-ui, sans-serif`;
    const w = ctx.measureText(g.toast.text).width + 60 * u;
    ctx.fillStyle = 'rgba(8,12,30,0.75)';
    ctx.fillRect((g.W - w) / 2, 80 * u, w, 64 * u);
    text(ctx, g.toast.text, g.W / 2, 112 * u, 36 * u);
  }

  if (g.debug) {
    const fps = dtSmooth > 0 ? Math.round(1 / dtSmooth) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, g.H - 110, 420, 100);
    const line = (s, y) => text(ctx, s, 20, y, 22, { align: 'left', stroke: 'transparent', weight: 600 });
    line(`fps ${fps}   detect ${tracker?.detectMs?.toFixed?.(1)} ms (${tracker?.delegate}, ${tracker?.modelName ?? '-'}${pose && tracker === pose ? `, ${pose.quality.name}, ${pose.useWorker ? 'worker' : 'main thread'}` : ''})`, g.H - 90);
    line(`players ${g.activePlayers().length}   state ${state}   diff ${g.diff.toFixed(2)} (ease ${g.ease.toFixed(2)})`, g.H - 62);
    if (pose && tracker === pose) text(ctx, `camera ${pose.cameraLabel} ${pose.video.videoWidth}x${pose.video.videoHeight} (${pose.mode}, ${pose.cameraFps ? pose.cameraFps.toFixed(0) + ' fps' : 'measuring'})`, 440, g.H - 62, 22 * u, { align: 'left', stroke: 'rgba(0,0,0,0.8)', weight: 600 });
    line(`keys: D debug  B cut-out/camera  K skeleton  C camera  F fullscreen  M mouse  N next  1-${LEVELS.length} level  Esc menu`, g.H - 34);
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
  watchFrameRate(dt);
  render();
}

requestAnimationFrame(frame);
boot();

// handy for debugging / automated tests
/** @type {any} */ (window).__game = { g, levels: LEVELS, startLevel, cutout, backdrops, get state() { return state; }, get tracker() { return tracker; }, get cutoutReady() { return cutoutReady; }, get pickRects() { return pickRects; }, family };
