# CLAUDE.md

Guidance for AI coding assistants working in this repo. For what the game is and how to play it, read
[README.md](README.md); for design decisions and the roadmap, [docs/PLAN.md](docs/PLAN.md).

## What this is

A webcam-controlled movement game for kids. A webcam on the TV tracks up to 4 kids with MediaPipe's pose model,
cuts them out of the picture, and puts them in a cartoon world while they play short levels (11 so far: bubbles,
rocks, waves, digging, ducking, balloons, freeze, poses and more), chosen in a carousel picker that opens on game
sets (a few levels in a row) and ends with a card for picking one level. Plain JavaScript ES modules and a canvas. **No build step and no runtime dependencies.**
The only npm dependency is `puppeteer-core`, for the browser tests.

## Commands

```
node server.mjs          # serve the game at http://localhost:8137 (PORT env var overrides); start.bat on Windows
npm run typecheck        # JSDoc types checked by tsc (no build, nothing emitted), a few seconds
npm test                 # unit tests (node:test), ~2 s
npm run test:e2e         # browser tests with real Edge/Chrome + the real pose model, ~10 min
npm run test:perf        # just the performance test (every level must stay smooth on a no-GPU laptop), ~2 min
npm run test:all         # all three; run this before saying something works
```

Run the type check and unit tests after every change. Run the e2e tests for anything that touches tracking, rendering, the lobby
or screens. No camera is needed for either: the e2e tests feed a photo through a fake webcam
(`test/fixtures/pose.jpg`), and `?mouse` mode (or key M) lets a mouse stand in for a kid.

## Architecture

```
src/main.js        game loop, state machine (loading > (setup) > menu > calibrate > pick > intro > play > outro > pick ...), keys + actions
src/screens.js     drawing only: join screen, setup check, play-space walk, picker, intro, HUD, outro, toasts, debug panel
src/types.js       JSDoc typedefs: Player, Game, Level, Scene. Import with /** @import { Player } from './types.js' */
src/tracker.js     PoseTracker (camera + engine) and MouseTracker; computeFeatures() -> a "player"
src/quality.js     pure: the tracking quality ladder (QUALITY rungs, when to step down or up); PoseTracker follows it
src/pose-worker.js CLASSIC Web Worker running MediaPipe (it needs importScripts); returns landmarks, mask, looks
src/pose-shared.js what the worker and MainThreadEngine share (options, mask downsampling), so tuning can't drift
src/people.js      pure: who is who. Probation for new bodies, matching, recall of kids who come back (by look)
src/look.js        pure: a person's clothing colours from a tiny frame copy
src/camera.js      pure camera logic: constraints (16:9 720p wish), next-camera choice, saved camera, FpsGuard, withRetry
src/filter.js      One Euro filter for skeleton smoothing
src/lobby.js       join-by-arms-out: arms out for 3 s starts the game with exactly those kids; lateJoin() mid-game
src/picker.js      picker carousel: wave a hand out to the side to scroll, both arms up to play; taps and arrows too.
                   Opens on the game sets (src/levels/sets.js, a few levels in a row); "Pick your game" shows every level
src/controls.js    on-screen buttons (touch), full-screen note, screen wake lock
src/device.js      pure: phone/tablet detection and starting settings
src/levels/        one file per level, index.js = the list (play order), kit.js = helpers + checkLevel, _template.js
src/online.js      pure maths for family play: room codes, guest skeletons -> remote players, cut-out video frame
src/family.js      family play glue: WebRTC pairing, sending/receiving cut-out video (see docs/ONLINE.md)
src/room-code.js   room code format, shared with the Cloudflare Worker (no imports)
src/online-config.js SIGNAL_URL, the pairing service address (the Pages publish writes PAIRING_URL into it)
cloudflare/        the pairing function for family play (Worker + Durable Object); deployed separately, not part of the game
src/person-mask.js pure maths: pose silhouette + motion + fading -> per-pixel "is a person" (no DOM)
src/cutout.js      browser glue that cuts the kids out of the camera frame
src/backdrops.js   animated cartoon scene per level (static layer cached, dynamic layer per frame)
src/backdrops-extra.js scenes for the newer levels (EXTRA_SCENES); scene-kit.js = shared scene drawing helpers
src/art.js         loads optional PNG overrides from assets/ (falls back to emoji / procedural drawing)
src/draw.js        text, skeleton, hearts, pose icon helpers
src/audio.js       synthesized sound effects (tones + filtered noise, no files), a few per level, and the music player
src/music.js       pure: the background music (a generated song per level), when it plays, ducking under family voices
src/ease.js        pure: auto-ease. Misses (g.miss()) and dry spells lower g.diff; a good spell restores it
src/setup-check.js pure: first-launch setup check (camera, light, distance, speed) with plain-word fixes
src/calibrate.js   pure: the play space. Kids walk left then right as far as they can before the first pick; g.area
src/health.js      pure: self-healing watchdog. Spots a lost camera or a hung tracker; tab sleep is not a fault
src/recording.js   pure: debug recordings. Rolling last minute of tracking answers, samples and events; file format
src/replay.js      ReplayTracker: plays a recording through ingestLandmarks (the live path); playRecording for tests
src/debug-record.js DebugSession (keeps the last minute, R saves it, L/drop loads one) + screen video (opt-in, G) in 30 s WebM pieces
```

Key ideas to preserve:

- **Adding or changing a level: follow [docs/ADDING-GAMES.md](docs/ADDING-GAMES.md).** One file per level,
  registered in `src/levels/index.js`; `test/unit/all-levels.test.js` plays every listed level automatically.
- **Levels only read the `player` object** (`px[33]` landmarks, `hands[]`, `circles[]`, `sh`, `hip`, `cx`, `lastJump`,
  `pose.{armsUp,airplane,handsHead}`, `score`, `excluded`). Keep tracking and game logic separate so the tracker can
  be swapped. Use `g.activePlayers()`, which filters out kids who sat out.
- **Sizes are in `u` units** (`1u = canvas height / 1080`) so everything scales with the screen.
- **Poses are measured in shoulder widths, never torso length.** Torso comes from the hips, which are unreliable on
  small kids; the old torso-based rules rejected a toddler with both arms up. Regression tests are in
  `test/unit/kids.test.js`.
- **Nothing pops.** Poses use hysteresis; a kid stays present through 0.6 s tracking dropouts; the cut-out fades
  over ~0.25-0.9 s and is kept alive by motion near where a kid was. Don't add instant on/off switches to tracking.
- **Everything in view appears in the cut-out**, including kids who sat out. `excluded` only means no scoring or hits.
- **Who is who lives in `people.js`, not in levels.** A new body is on probation (~0.45 s, 3 tracked frames,
  upright) before it becomes a player, so pets and ghosts never join. During a game a new player (`isNew`) is
  excluded until they hold airplane for 2 s (`lateJoin`). Bodies are matched to players by where their shoulders
  are, sideways AND up-and-down (in shoulder widths), best pairs first: matching sideways only swapped a kid with
  a grown-up lying on the sofa under them whenever the model found just one of the two. A body half out of the
  picture has no trustworthy height or size, so it is matched sideways only and never starts probation. Lost
  players are remembered for 20 s and recalled by position or by a distinctive look (two dark outfits in a dim
  room are not "the same look"). Probation and dropout windows stretch on slow tracking (`slowFrames`), so a
  slow device never makes kids flicker. `test/fixtures/recordings/` holds real clips that replay through this.
- **Tracking never blocks drawing.** The model runs in `pose-worker.js`; `PoseTracker.update` sends a frame when
  the last one is answered and applies whatever arrived. `?worker=off`, or a worker that fails to start, uses
  `MainThreadEngine` (same answer shape). The cut-out is redone per camera frame or tracked frame, not per
  screen refresh. `tracker.simulateLost` (tests) makes answers come back empty.
- **Every URL is relative to the module** (`new URL('../vendor/...', import.meta.url)`) so the game runs from a
  sub-folder on GitHub Pages. A unit test fails on absolute `'/src/'`-style paths in `src/`.
- **Camera operations are serialized.** `PoseTracker.startCamera`, `nextCamera` and the slow-camera fallback all go through `_queue`, so two can never fight over the camera. `switchCamera` in `main.js` also ignores key presses while a switch is under way. Switching never leaves the game without a picture: it retries transient errors (`withRetry`), falls back to the default camera, and restores the previous one if the switch fails.
- **The game heals itself.** `PoseTracker._heal` (verdicts from `health.js`) reconnects a camera whose track ended or
  whose picture froze for 3 s, and restarts a tracker that stopped answering (a second hang moves it to the main
  thread). It retries with backoff, `tracker.reconnecting` says what it is fixing, and `main.js` pauses the game
  under a "Reconnecting..." screen meanwhile. Checks are skipped while a camera operation is under way, and a gap
  between frames (a sleeping tab) restarts the clocks. Recovery logs use `console.warn`, never `console.error`.
- The frame-rate fallback measures the camera's real delivery rate from `requestVideoFrameCallback`'s `presentedFrames`, not callback counts, so a slow laptop is never mistaken for a slow camera. `?cam=` pins the picture size.
- Tracking quality is a ladder (`QUALITY` in `quality.js`: full model, lite, lite at half size, lite without
  masks). Laptops start at the top, phones one rung down (`device.js`); it steps down when tracking averages
  over `SLOW_MS` and back up after a long fast spell. It is timed in seconds and measures the whole round trip
  (frame sent to answer back), so a very slow device gets to a workable rung in seconds. Still slow at the bottom
  in the worker, or a worker without the GPU, means tracking moves to the main thread. Without model masks the
  cut-out is fed silhouettes drawn from the skeletons (`skeletonMaskInto`), or the kids would vanish from the
  picture. `?model=` pins the model, `?quality=` the whole ladder.
  The canvas is capped at 1920x1080 (scaled up by CSS) and glow effects turn off when drawing gets slow.
- The mask fusion in `person-mask.js` is tuned by `DEFAULTS` at the top of that file. Level difficulty constants
  (rock speed, wave timing, hold times) are at the top of each level's file in `src/levels/`.
- **The setup check** (state `setup`) runs on the first launch with a camera, until it has passed once
  (`kcg.setupDone` in localStorage). `?setup` shows it again, `?nosetup` or `?level=` skip it, SPACE/Esc/tap skip it.
  `openGame` in the e2e helpers marks it done unless called with `{ setup: true }`.
- **The play space** (state `calibrate`, `calibrate.js`) runs every time a group joins from the menu, between joining and the first pick,
  and again after a camera switch or P in the picker: the kids walk as far as they can each way, because a wall
  or sofa can be in the picture where nobody can stand. The result is `g.area` (fractions of the width: `x0..x1`
  where a body can be, `reach0..reach1` where hands can get to). **Levels place anything a kid must touch, catch
  or stand in with `reachX(g, f)` / `standX(g, f)` from `kit.js`, never `f * g.W`**; without a calibration they
  equal `f * g.W`. Things that sweep the whole screen (waves, logs, birds) don't need it. Mouse mode skips it;
  `?nocal` and `?level=` skip it, SPACE/Esc/tap skip the rest (keeping the sides the kids already walked; a side nobody walked stays the whole way). `openGame` adds `?nocal` unless `{ calibrate: true }`.
- **Debug recordings** (`?debug`: R saves, G adds screen video, `?replay` or a dropped file plays one back). Nothing
  is created until debug is on (`PoseTracker.onAnswer` stays null), video is never on by itself (it shows the
  kids), and nothing is uploaded. When Calum sends a recording, replay it, fix the bug, then add it to
  `test/fixtures/recordings/` with an `expect` so `test/unit/recording.test.js` keeps it fixed.
- `window.__game` exposes internals (`g`, `tracker`, `cutout`, `backdrops`, `state`) for the tests. Keep it.

## Pitfalls (each one has bitten this project)

1. **Never edit source files with PowerShell `Get-Content` / `Set-Content` (or any tool that re-saves text in the
   system code page).** It silently turned every non-ASCII symbol (the arrows, the tick, the star) into garbled
   characters and added a byte-order mark, and a player saw the garbage on screen. Edit with your editor tools, or
   with Node using explicit `'utf8'`. `test/unit/source-files.test.js` fails on a BOM or mangled UTF-8, and the
   `ON-SCREEN TEXT` e2e test fails if any garbled string is painted.
2. **The edit tool may turn `\uXXXX` escapes in new text into literal characters.** Don't write a test that hunts for
   garbled text using literal garbled characters or `\u` escapes in the file you are editing (it then matches
   itself); build the pattern from numeric char codes as `source-files.test.js` does.
3. **Don't assert fixed pixel colours in animated scenes.** The disco spotlights and sea sparkles move. Compare with
   the backdrop drawn alone at the same instant (see `backgroundSource` in the e2e file).
4. **Headless test browsers use a software renderer**, so frame times there (30-70 ms) are not representative. Pin
   `?model=full` in e2e tests so the auto-downgrade can't swap the model mid-test.
5. **Port 8137, not 8000**: another program on the dev machine already used 8000. The server binds to localhost
   only; browsers allow the camera on `http://localhost` without HTTPS. Don't kill servers you didn't start.
6. **Running the e2e tests as root (containers, CI)** needs `--no-sandbox`; `launch()` adds it. Tracking in a
   container's software renderer can be ~1 frame a second, so e2e tests wait for tracked frames
   (`tracker.frameSeq`) rather than fixed times.
7. **The test browser's fake cameras are quirky.** With `--use-file-for-fake-video-capture` (the photo-as-webcam feed) the browser reports only ONE camera, and with `--use-fake-device-for-media-stream=device-count=3` it sometimes lists no cameras at startup. Camera-switching tests therefore use `openWithCameras` (restarts the browser until it lists all cameras) and the built-in test cameras; the photo feed is for tracking tests. Functions passed to `openGame({ init })` must be self-contained (only their own source reaches the page).
8. A sloppy hit-test is a feature: kids are small, tracking is noisy, so windows and hit boxes are deliberately
   forgiving (jump window 0.5 s early to 0.3 s late; rocks use `c.r * 0.8`).

## Conventions

- Match the surrounding style: small modules, short comments that explain *why*, no frameworks, no build tooling.
- Tests: `node:test` + `node:assert/strict`. Unit tests are DOM-free (stub `document` as `tracker.test.js` does);
  put new logic in pure functions where possible. A test should fail when the behaviour breaks: check by
  temporarily breaking the code (several tests were hardened this way).
- Don't commit photos of children. The toddler regression test uses measurements from a real photo, not the photo.
- Third-party files in `vendor/` and `models/` are MediaPipe's (Apache-2.0). Don't edit them. If you replace
  them, bump `VERSION` in `sw.js` so families' offline copies update.
- Type the code with JSDoc, not TypeScript files: there is no build step. Start level objects with
  `/** @satisfies {Level} */`. `npm run typecheck` must stay clean.
- When adding art slots, declare them in the level's `art` field (or one line in `DEFS` in `src/art.js` for shared art) and document the file name in `assets/README.md`.

## Ideas and status

See the roadmap in [docs/PLAN.md](docs/PLAN.md). The game is published at https://calum.github.io/camera-games/
(GitHub Pages, from `main`). Next up: more whole-body levels (the kids' favourites are dodging and jumping),
own art and sound, silhouette-only gameplay for big groups, and a Raspberry Pi kiosk build.
