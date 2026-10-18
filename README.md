# Kids Camera Games

A movement game for kids, in the spirit of the Nex Playground: put a webcam on the TV and the kids
jump, dodge, wave and dance their way through short levels. Their bodies are tracked by the camera, lifted
out of the picture and dropped into a cartoon world that matches the level. It runs in a web browser,
works offline once downloaded, and the art is easy to swap for your own.

Built for a family living room: one laptop, one cheap webcam, two or three kids at once.

## The levels

| Level | What you do |
|---|---|
| **Pop the bubbles** (under the sea) | Wave your hands to pop bubbles. Gold ones are worth 3. |
| **Dodge the rocks** (volcano) | Watch for the "!" then step out of the way. The team shares 5 hearts. |
| **Jump the waves** (beach) | Count down 3-2-1 and jump as the wave rolls past. A green glow and "NICE JUMP!" for a good one, a red "SPLASH!" if you miss. |
| **Dance party** (disco) | Copy the stick-figure pose on screen (arms up, airplane, hands on head) and hold it. |

After the fourth level there is a winners screen and the next round starts a little harder.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer and a webcam. There is nothing to install to play. (Running the tests needs Node 21 or newer; this was developed on Node 24.)

```
start.bat              # Windows: starts the server and opens the browser
# or, on any system:
node server.mjs        # then open http://localhost:8137
```

Click **Allow** when the browser asks for the camera, then press **F** for fullscreen on the TV.

**Setup that makes the biggest difference:** webcam on top of the TV, kids 2-3 metres back with their
whole body in view, room lit from the front (not backlit by a window).

### Joining the game

Every kid who wants to play holds their arms straight out like an airplane. When the group of airplane
kids has not changed for 3 seconds the game starts with exactly those kids. Anyone standing there without
their arms out sits that game out: they still appear on screen, but can't score or get hit. If someone joins
or drops out, the 3 seconds start again. A grown-up can press **Space** to start with everyone.

## Controls (for the grown-up)

| Key | Does |
|---|---|
| Space / Enter | Start the game with everyone (and skip the winners screen) |
| F | Fullscreen |
| 1 - 4 | Jump to a level |
| N | Next level |
| Esc | Back to the menu (everyone can join again) |
| B | Show just the kids in a cartoon world (default), or the whole camera picture |
| K | Skeleton overlay: thin line (default), bold, or off |
| D | Debug info: frame rate, tracking time, model, what pose each kid is doing |
| M | Switch between camera and mouse mode |

**Mouse mode** needs no camera (and is used automatically if the camera is blocked): move = body and hands,
click = jump, hold Q / W / E = arms up / airplane / hands on head.

URL options: `?mouse`, `?debug`, `?lite` (turn off glow effects on a slow machine), `?model=lite` or
`?model=full`, `?view=camera`.

## If something is off

- **A kid's pose won't register or tracking glitches:** press **D** to see what the game thinks each kid is
  doing. Make sure their whole body is in view and the room is well lit. Small children are harder for pose
  models; the game is tuned for them but it is not perfect.
- **It runs slowly:** press **D** for the frame rate. Try `?lite`, or `?model=lite`. The game already switches
  to the lighter pose model by itself if the laptop averages slower than 50 ms per frame.
- **The cut-out looks wrong:** press **B** for the plain camera picture.
- **Port already in use:** set another one, e.g. `PORT=9000 node server.mjs`.

## Your own art

Put PNG files in [`assets/`](assets/README.md) and they replace the built-in graphics: bubbles, rocks, stars,
hearts, hands, and a full-screen background for each level. Missing ones fall back to the built-in cartoon.

## How it works

1. The camera frame goes to MediaPipe's **pose landmarker** (running in the browser through WebAssembly /
   WebGL), which returns a skeleton and a body silhouette for up to 4 people.
2. [`src/tracker.js`](src/tracker.js) steadies the skeleton with a One Euro filter and turns it into simple
   signals the game uses: hands, body circles, jumping, and three poses. Poses are measured in shoulder
   widths so small and tall kids behave the same, and they use hysteresis so one glitchy frame can't flip them.
3. [`src/person-mask.js`](src/person-mask.js) decides which pixels are a person. It blends the pose silhouette
   with a motion check against the empty room (believed only near where a kid just was) and fades gently, so
   a kid doesn't pop out of existence when pose tracking glitches.
4. [`src/cutout.js`](src/cutout.js) cuts the kids out of the camera picture and
   [`src/backdrops.js`](src/backdrops.js) draws the cartoon world behind them. Levels draw on top.

Levels only ever read a small "player" object, so the tracking can be swapped (a different model, a Raspberry
Pi build) without touching the game. See [`docs/PLAN.md`](docs/PLAN.md) for the design, the decisions behind it
and the roadmap, and [`CLAUDE.md`](CLAUDE.md) for notes aimed at AI coding assistants.

```
index.html, server.mjs, start.bat       the page, a tiny dependency-free static server, a Windows launcher
src/main.js                             game loop, screens, HUD, keys
src/levels.js                           the four levels (start / update / draw each)
src/tracker.js  filter.js  lobby.js     camera + pose -> players, smoothing, the join-by-arms-out lobby
src/person-mask.js  cutout.js           which pixels are a kid, and cutting them out
src/backdrops.js  art.js  draw.js       cartoon worlds, art loading, drawing helpers
src/audio.js                            synthesized sound effects (no audio files)
vendor/  models/                        MediaPipe runtime and pose models, stored locally for offline use
test/unit  test/e2e  test/fixtures      tests
```

## Tests

```
npm install          # one time; only installs the test tool (puppeteer-core)
npm test             # 100 unit tests, a couple of seconds
npm run test:e2e     # 16 browser tests, about 5 minutes: real Edge/Chrome and the real pose model
npm run test:all
```

The browser tests use a fake webcam that plays a photo of a person, so they exercise the whole pipeline
(camera, pose model, cut-out, scoring, screens) with nobody in front of the camera. They need Edge or Chrome
(set `BROWSER_PATH` if it isn't found). Tests can't judge how the game *feels* for real kids; that needs a
playtest.

## Credits and licences

- Body tracking uses [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache License 2.0). The
  runtime in `vendor/` and the pose models in `models/` are Google's, downloaded from the public MediaPipe
  distribution and included so the game works offline.
- `test/fixtures/pose.jpg` is a stock photo from MediaPipe's public test assets, used only by the tests.
- No licence has been chosen for this project's own code yet.
