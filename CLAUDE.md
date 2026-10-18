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
npm test                 # unit tests (node:test), ~2 s
npm run test:e2e         # browser tests with real Edge/Chrome + the real pose model, ~5 min
npm run test:all         # both; run this before saying something works
```

Run the unit tests after every change. Run the e2e tests for anything that touches tracking, rendering, the lobby
or screens. No camera is needed for either: the e2e tests feed a photo through a fake webcam
(`test/fixtures/pose.jpg`), and `?mouse` mode (or key M) lets a mouse stand in for a kid.

## Architecture

```
src/main.js        game loop, state machine (loading > menu > intro > play > outro > ... > finale), HUD, keys
src/tracker.js     PoseTracker (camera + MediaPipe) and MouseTracker; computeFeatures() turns a skeleton into a "player"
src/filter.js      One Euro filter for skeleton smoothing
src/lobby.js       join-by-arms-out: arms out for 3 s starts the game with exactly those kids
src/levels.js      the four levels; each is { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
src/person-mask.js pure maths: pose silhouette + motion + fading -> per-pixel "is a person" (no DOM)
src/cutout.js      browser glue that cuts the kids out of the camera frame
src/backdrops.js   animated cartoon scene per level (static layer cached, dynamic layer per frame)
src/art.js         loads optional PNG overrides from assets/ (falls back to emoji / procedural drawing)
src/draw.js        text, skeleton, hearts, pose icon helpers
src/audio.js       synthesized sound effects
```

Key ideas to preserve:

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
- The model starts as `full` and auto-drops to `lite` on slow machines (`SLOW_MS` in `tracker.js`); `?model=` pins it.
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
6. A sloppy hit-test is a feature: kids are small, tracking is noisy, so windows and hit boxes are deliberately
   forgiving (jump window 0.5 s early to 0.3 s late; rocks use `c.r * 0.8`).

## Conventions

- Match the surrounding style: small modules, short comments that explain *why*, no frameworks, no build tooling.
- Tests: `node:test` + `node:assert/strict`. Unit tests are DOM-free (stub `document` as `tracker.test.js` does);
  put new logic in pure functions where possible. A test should fail when the behaviour breaks: check by
  temporarily breaking the code (several tests were hardened this way).
- Don't commit photos of children. The toddler regression test uses measurements from a real photo, not the photo.
- Third-party files in `vendor/` and `models/` are MediaPipe's (Apache-2.0). Don't edit them.
- When adding art slots, add one line to `DEFS` in `src/art.js` and document the file name in `assets/README.md`.

## Ideas and status

See the roadmap in [docs/PLAN.md](docs/PLAN.md). Next up: playtest with the kids and tune, then own art and sound,
more levels, silhouette-only gameplay for big groups, a Raspberry Pi kiosk build, and phone/iPad cameras over HTTPS.
