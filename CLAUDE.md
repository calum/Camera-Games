# CLAUDE.md

Guidance for AI coding assistants working in this repo. For what the game is and how to play it, read
[README.md](README.md); for design decisions and the roadmap, [docs/PLAN.md](docs/PLAN.md).

## What this is

A webcam-controlled movement game for kids. A webcam on the TV tracks up to 4 kids with MediaPipe's pose model,
cuts them out of the picture, and puts them in a cartoon world while they play four short levels (bubbles, rocks,
waves, dance poses). Plain JavaScript ES modules and a canvas. **No build step and no runtime dependencies.**
The only npm dependency is `puppeteer-core`, for the browser tests.

## Commands

```
node server.mjs          # serve the game at http://localhost:8137 (PORT env var overrides); start.bat on Windows
npm run typecheck        # JSDoc types checked by tsc (no build, nothing emitted), a few seconds
npm test                 # unit tests (node:test), ~2 s
npm run test:e2e         # browser tests with real Edge/Chrome + the real pose model, ~10 min
npm run test:all         # all three; run this before saying something works
```

Run the type check and unit tests after every change. Run the e2e tests for anything that touches tracking, rendering, the lobby
or screens. No camera is needed for either: the e2e tests feed a photo through a fake webcam
(`test/fixtures/pose.jpg`), and `?mouse` mode (or key M) lets a mouse stand in for a kid.

## Architecture

```
src/main.js        game loop, state machine (loading > menu > intro > play > outro > ... > finale), HUD, keys + actions
src/types.js       JSDoc typedefs: Player, Game, Level, Scene. Import with /** @import { Player } from './types.js' */
src/tracker.js     PoseTracker (camera + engine + quality ladder) and MouseTracker; computeFeatures() -> a "player"
src/pose-worker.js CLASSIC Web Worker running MediaPipe (it needs importScripts); returns landmarks, mask, looks
src/people.js      pure: who is who. Probation for new bodies, matching, recall of kids who come back (by look)
src/look.js        pure: a person's clothing colours from a tiny frame copy
src/camera.js      pure camera logic: constraints (16:9 720p wish), next-camera choice, saved camera, FpsGuard, withRetry
src/filter.js      One Euro filter for skeleton smoothing
src/lobby.js       join-by-arms-out: arms out for 3 s starts the game with exactly those kids; lateJoin() mid-game
src/controls.js    on-screen buttons (touch), full-screen note, screen wake lock
src/device.js      pure: phone/tablet detection and starting settings
src/levels/        one file per level, index.js = the list (play order), kit.js = helpers + checkLevel, _template.js
src/online.js      pure maths for family play: room codes, guest skeletons -> remote players, cut-out video frame
src/family.js      family play glue: WebRTC pairing, sending/receiving cut-out video (see docs/ONLINE.md)
cloudflare/        the pairing function for family play (Worker + Durable Object); deployed separately, not part of the game
src/person-mask.js pure maths: pose silhouette + motion + fading -> per-pixel "is a person" (no DOM)
src/cutout.js      browser glue that cuts the kids out of the camera frame
src/backdrops.js   animated cartoon scene per level (static layer cached, dynamic layer per frame)
src/art.js         loads optional PNG overrides from assets/ (falls back to emoji / procedural drawing)
src/draw.js        text, skeleton, hearts, pose icon helpers
src/audio.js       synthesized sound effects (tones + filtered noise, no files), a few per level
src/ease.js        pure: auto-ease. Misses (g.miss()) and dry spells lower g.diff; a good spell restores it
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
  excluded until they hold airplane for 2 s (`lateJoin`). Lost players are remembered for 20 s and recalled by
  position or look. Probation and dropout windows stretch on slow tracking (`slowFrames`), so a slow device
  never makes kids flicker.
- **Tracking never blocks drawing.** The model runs in `pose-worker.js`; `PoseTracker.update` sends a frame when
  the last one is answered and applies whatever arrived. `?worker=off`, or a worker that fails to start, uses
  `MainThreadEngine` (same answer shape). The cut-out is redone per camera frame or tracked frame, not per
  screen refresh. `tracker.simulateLost` (tests) makes answers come back empty.
- **Every URL is relative to the module** (`new URL('../vendor/...', import.meta.url)`) so the game runs from a
  sub-folder on GitHub Pages. A unit test fails on absolute `'/src/'`-style paths in `src/`.
- **Camera operations are serialized.** `PoseTracker.startCamera`, `nextCamera` and the slow-camera fallback all go through `_queue`, so two can never fight over the camera. `switchCamera` in `main.js` also ignores key presses while a switch is under way. Switching never leaves the game without a picture: it retries transient errors (`withRetry`), falls back to the default camera, and restores the previous one if the switch fails.
- The frame-rate fallback measures the camera's real delivery rate from `requestVideoFrameCallback`'s `presentedFrames`, not callback counts, so a slow laptop is never mistaken for a slow camera. `?cam=` pins the picture size.
- Tracking quality is a ladder (`QUALITY` in `tracker.js`: full model, lite, lite at half size, lite without
  masks). Laptops start at the top, phones one rung down (`device.js`); it steps down when tracking averages
  over `SLOW_MS` and back up after a long fast spell. `?model=` pins the model, `?quality=` the whole ladder.
  The canvas is capped at 1920x1080 (scaled up by CSS) and glow effects turn off when drawing gets slow.
- The mask fusion in `person-mask.js` is tuned by `DEFAULTS` at the top of that file. Level difficulty constants
  (rock speed, wave timing, hold times) are at the top of `levels.js`.
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

See the roadmap in [docs/PLAN.md](docs/PLAN.md). The game is published at https://calum.github.io/kids-camera-games/
(GitHub Pages, from `main`). Next up: more whole-body levels (the kids' favourites are dodging and jumping),
own art and sound, silhouette-only gameplay for big groups, and a Raspberry Pi kiosk build.
