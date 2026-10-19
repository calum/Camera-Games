# Camera Games

A movement game for kids, in the spirit of the Nex Playground: put a webcam on the TV and the kids
jump, dodge, wave and dance their way through short levels. Their bodies are tracked by the camera, lifted
out of the picture and dropped into a cartoon world that matches the level. It runs in a web browser,
works offline once downloaded, and the art is easy to swap for your own.

Built for a family living room: one laptop, one cheap webcam, two or three kids at once.

## The levels

Eleven short levels (30 to 60 seconds each), in the order they appear in the picker:

| Level | What you do |
|---|---|
| **Pop the bubbles** (under the sea) | Wave your hands to pop bubbles. Gold ones are worth 3. |
| **Dodge the rocks** (volcano) | Watch for the "!" then step out of the way. The team shares 5 hearts. |
| **Jump the waves** (beach) | Count down 3-2-1 and jump as the wave rolls past. A green glow and "NICE JUMP!" for a good one, a red "SPLASH!" if you miss. |
| **Dig down!** (mine) | Every jump stomps the brick under your feet; step sideways to tunnel into the next column. Break the gold row at the bottom: LEVEL COMPLETE, and you fall into a harder level. Metal won't break, TNT goes BANG, gems and dinosaur bones on the way down. The mine fits the play space (a narrow one is a single shaft). |
| **Duck and jump** (beach) | Jump over the rolling logs and duck under the birds, each with a 3-2-1 countdown. A miss is a silly BONK, never a lost heart. |
| **Catch the stars!** (starry night) | Touch the falling stars with your hands (gold ones are worth 3) and dodge the meteors when you see the "!". |
| **Avalanche!** (snowy mountains) | Dodge the rocks, jump the rolling boulders, and hide in the safe gap when the giant boulder comes. |
| **Keep it up!** (party in the park) | Tap the balloons back up with your hands or head and don't let them touch the floor. |
| **Freeze!** (disco) | Dance while the music plays; when it stops, FREEZE. Wobblers crack their ice cube. |
| **Hole in the wall!** (game show) | A wall rushes at you with a pose-shaped hole: strike the pose before it arrives. |
| **Dance party** (disco) | Copy the stick-figure pose on screen (arms up, airplane, hands on head) and hold it. |

Every level has its own synthesized sound effects, and the game quietly eases off when the kids keep missing
(and creeps back up after a good spell), so nobody gets stuck on a level that is too hard.

After joining, the kids **show the game their play space** (about 10 seconds, each time a group joins): a big arrow says
"walk this way as far as you can go", first to one side, then the other, and a green strip grows along the floor
as they go. A wall, a sofa or a table can be in the camera picture while nobody can stand there; the levels then
keep bubbles, stars, balloons, treasure and the safe gap inside the space the kids really reached. **Space**,
**Esc** or a tap skips it (the last play space is kept), and **P** in the picker measures it again (after a camera switch it is measured again
by itself).

Then the kids choose what to play on the **picker**, a carousel of big picture cards: the current card in the
middle, the previous and next ones either side. Waving a hand out to the right shows the next card, to the left
the previous one, and **both arms straight up** for about a second plays the card in the middle.

The picker opens on **game sets**, each playing a few levels in a row: **Party mix** (four random levels, new
ones every time), **Jump & dodge**, **Catch & pop** and **Dance & pose**. The last card, **Pick your game**,
swaps them for one card per level (plus **Surprise!** and **Back** to the sets). After a set the sets come back
with it in the middle; after a single level the level cards come back with that game in the middle, so "again!"
is just arms up. The sets are in `src/levels/sets.js`.

## Quick start

**Play online:** open **https://calum.github.io/camera-games/** in Chrome, Edge or Safari, tap **Allow**
for the camera, then press **F** or tap **⛶ Full screen**. Nothing is uploaded: the tracking runs on your
device, and after the first visit the game also works offline. (The one exception is
[family play](#playing-with-family-in-another-home), which you switch on yourself.)

**The first time** the game runs with a camera it does a short **setup check** (about 10 seconds): it looks at the
camera, the light, how far away the kids stand and how fast the device tracks, and says in plain words what to
fix, such as "Too dark: turn on a light" or, on a laptop with graphics acceleration turned off in the browser,
how to turn it on. Once everything passes it isn't shown again. **Space**, **Esc** or a tap skips it, and
`?setup` brings it back.

Two ways to set it up:

| | Simplest | Best experience |
|---|---|---|
| **What** | A tablet or phone runs the game | A laptop with a webcam runs the game |
| **TV** | USB-C to HDMI cable, or screen mirroring (AirPlay, Chromecast) | HDMI cable |
| **Camera** | The tablet's own front camera, propped under the TV facing the kids | A wide-angle USB webcam on top of the TV |
| **Controls** | Tap the screen for buttons | Keyboard (or tap / move the mouse for buttons) |

A wired connection to the TV has the least delay; mirroring adds a little. Phones and tablets start on a
lighter tracking setting; laptops start on the most accurate one and step down by themselves if they're slow.

**Run it yourself** (offline, or for development): you need [Node.js](https://nodejs.org) 18 or newer. (Running the tests needs Node 21 or newer; this was developed on Node 24.)

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
or drops out, the 3 seconds start again. A grown-up can press **Space** (or tap **▶ Start**) to start with everyone.

**People and pets walking past don't join in.** A new body has to be seen for about half a second, and look
like a standing person, before the game counts it, so the dog trotting past isn't picked up. Someone who walks
in while a game is running (a parent doing chores) only watches. To join mid-game, hold your arms out for 2
seconds. A kid who steps out of view and comes back is recognised by where they went and by the colours they
are wearing, and carries on with their own colour and score.

### Playing with family in another home

Grandparents (or cousins) in another house can join in over the internet. On the TV, press **O** in the menu (or
tap **👪 Family**): the screen shows a five-letter room code and a link. The other home opens that link on a
laptop with a webcam and allows the camera and microphone. They see the TV's game, they appear cut out in the
same cartoon world, and they join the lobby with arms out like everyone else. Voices and game sounds go both
ways (**V** mutes your microphone). **O** again closes the room.

Family play is off until someone opens a room, a note on screen shows while it is on, and the picture and voices go
straight between the two browsers, encrypted. A small pairing service on Cloudflare only introduces the two
browsers to each other. It hasn't been tried between two real homes yet; [docs/ONLINE.md](docs/ONLINE.md) has the
details and [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md) how the pairing service is set up.

## Controls (for the grown-up)

| Key | Does |
|---|---|
| Space / Enter | Start with everyone (on to the picker); in the picker, play the card in the middle |
| ← / → | In the picker, show the previous / next card |
| P | In the picker, show the game the play space again (walk left, then right) |
| F | Fullscreen |
| 1 - 9 | Play that level (by its place in the list) |
| N | Next level (in a game set, the set's next game) |
| Esc | Back one step: from a level to the picker, from the level cards to the sets, from the sets to the menu (everyone can join again) |
| C | Switch to the next camera (a phone webcam app shows up as an extra camera); the choice is remembered |
| B | Show just the kids in a cartoon world (default), or the whole camera picture |
| K | Skeleton overlay: thin line (default), bold, or off |
| D | Debug info: frame rate, tracking time, model, what pose each kid is doing |
| M | Switch between camera and mouse mode |
| O | Open or close a family room (play with another home) |
| V | Mute or unmute your microphone during family play |
| U | Music off or on (sound effects stay on); the choice is remembered |

**On a tablet or phone** (or any time), tap the screen: buttons for **▶ Start**, **⏭ Next level**,
**⏏ Menu**, **📷 Camera**, **👪 Family** (in the menu), **🎵 Music** and **⛶ Full screen** appear for a few seconds. In the level picker a grown-up can also tap a side card to scroll to it, and the middle card to play it. When the game isn't full screen, the
menu shows a small "Full screen works best" note with a button (on iPhone it suggests Add to Home Screen,
since web pages can't go full screen there). The screen is kept awake while the game is open.

**Mouse mode** needs no camera (and is used automatically if the camera is blocked): move = body and hands,
click = jump, hold Q / W / E = arms up / airplane / hands on head, hold S = duck.

URL options: `?mouse`, `?debug` (debug info on screen, a summary line in the browser console every 5
seconds, and recording the last minute, see below), `?replay` (play a debug recording back), `?lite` (turn off glow effects on a slow machine) or `?fx` (keep them on), `?model=lite` or
`?model=full`, `?quality=high|medium|low|lowest` (pin the tracking quality, see below), `?view=camera`,
`?cam=wide` or `?cam=standard` (picture size, see below), `?level=<id>` (start straight in one level),
`?worker=off` (track on the main thread), `?setup` / `?nosetup` (show or skip the setup check), `?nocal` (skip
the play-space check),
`?room=<code>` (join a family room; the host's link carries it), `?signal=<url>` (use another pairing service,
for testing), `?nosw` (don't install the offline copy).

### Camera and field of view

The game asks the camera for a 16:9 picture (1280x720). Many webcams crop the sides when asked for 640x480, so this gives a webcam its full field of view, and it barely costs anything (the pose model takes roughly 34 ms at 640x480 and 37 ms at 1280x720 in the test browser). If a cheap webcam cannot deliver at least ~15 frames a second at 720p, the game quietly drops to 640x480 by itself. `?cam=standard` or `?cam=wide` forces one.

**Using a phone as the camera:** run a phone-as-webcam app (Windows 11 can do this with an Android phone through Link to Windows; Camo, Iriun and DroidCam are other options). The phone then appears as an extra camera: press **C** to switch to it. The game remembers your choice. Phones have an ultra-wide lens, so pick that lens in the app for a much wider view, and keep the phone **landscape** (the menu warns you if the picture is upright). A USB connection adds less delay than Wi-Fi, and Game mode on the TV helps too.

## If something is off

- **A kid's pose won't register or tracking glitches:** press **D** to see what the game thinks each kid is
  doing. Make sure their whole body is in view and the room is well lit. Small children are harder for pose
  models; the game is tuned for them but it is not perfect.
- **It runs slowly:** press **D** for the frame rate and tracking quality. The game draws smoothly however long
  tracking takes (tracking runs in a background worker), and steps down by itself when tracking averages over
  50 ms a frame: first to the lighter model, then a smaller picture, then no silhouettes. Glow effects switch
  off if drawing drops under about 40 frames a second. Try `?lite` or `?quality=low` to force it.
- **"Reconnecting the camera..." or "Waking up the pose detector...":** the game lost its picture (camera
  unplugged, taken by another app, frozen) or tracking stopped answering, and is fixing it by itself. The level
  pauses meanwhile and carries on afterwards. If it keeps happening, check the cable and close other apps that
  use the camera.
- **Reporting a problem:** open the game with `?debug`, press **F12** and open the Console. Every 5 seconds the
  game writes one line starting with `[camera-games debug]` (frame rate, tracking, model, camera, graphics
  card); copy and paste that line.
- **Recording a bad moment:** in debug mode (`?debug` or **D**) the game keeps the last minute in memory. When
  something goes wrong, press **R** (or tap **💾 Save last minute**) straight away: a file like
  `camera-games-2026-10-18-181605.json` lands in Downloads with every skeleton the tracker saw, how fast everything ran
  (frame rate, tracking round trip, quality rung, camera rate) and what happened (screens, scores, misses,
  warnings). Send that file. It holds no pictures. **G** (or **🎥 Video**) also records the game screen, which
  does show the kids, so it is only ever on when a grown-up turns it on; **R** then saves the last 30-60 s as
  `.webm` too. Nothing is uploaded anywhere: saving is an ordinary download.
- **Replaying a recording:** open the game with `?replay` and drop the `.json` on the page (or press **L**). The
  game goes back to the level the clip started in and the recorded skeletons are played through the real tracking
  and game code, without a camera. Dropping a recording on the page also works in debug mode. A recording in
  `test/fixtures/recordings/` becomes a regression test (see the README there).
- **The cut-out looks wrong:** press **B** for the plain camera picture.
- **The wrong camera is used:** press **C** to cycle through the cameras. **D** shows which one is active, its size and its real frame rate.
- **Port already in use:** set another one, e.g. `PORT=9000 node server.mjs`.

## Making your own games

Each level is one file in [`src/levels/`](src/levels/). Copy [`_template.js`](src/levels/_template.js), add
it to the list in [`src/levels/index.js`](src/levels/index.js) and play it with `?mouse&level=<id>`.
[docs/ADDING-GAMES.md](docs/ADDING-GAMES.md) explains everything a level can use, how to test it, and the
design rules from playtesting.

## Your own art

Put PNG files in [`assets/`](assets/README.md) and they replace the built-in graphics: bubbles, rocks, stars,
hearts, hands, and full-screen backgrounds for the menu and the first levels' scenes. Missing ones fall back to
the built-in cartoon.

## How it works

1. The camera frame goes to MediaPipe's **pose landmarker** (running in the browser through WebAssembly /
   WebGL, in a background worker so drawing never waits for it), which returns a skeleton and a body
   silhouette for up to 4 people. If tracking is slow it steps down a quality ladder (lighter model, smaller
   picture, no silhouettes) and, if still slow, moves to the main thread. A watchdog
   ([`src/health.js`](src/health.js)) reconnects a lost camera and restarts a tracker that stopped answering.
2. [`src/people.js`](src/people.js) decides who is who: new bodies wait on probation, kids keep their colour,
   and a kid who comes back is recognised by position and clothing colours.
3. [`src/tracker.js`](src/tracker.js) steadies the skeleton with a One Euro filter and turns it into simple
   signals the game uses: hands, body circles, jumping, and three poses. Poses are measured in shoulder
   widths so small and tall kids behave the same, and they use hysteresis so one glitchy frame can't flip them.
4. [`src/person-mask.js`](src/person-mask.js) decides which pixels are a person. It blends the pose silhouette
   with a motion check against the empty room (believed only near where a kid just was) and fades gently, so
   a kid doesn't pop out of existence when pose tracking glitches.
5. [`src/cutout.js`](src/cutout.js) cuts the kids out of the camera picture and
   [`src/backdrops.js`](src/backdrops.js) draws the cartoon world behind them. Levels draw on top.

Levels only ever read a small "player" object, so the tracking can be swapped (a different model, a Raspberry
Pi build) without touching the game. See [`docs/PLAN.md`](docs/PLAN.md) for the design, the decisions behind it
and the roadmap, and [`CLAUDE.md`](CLAUDE.md) for notes aimed at AI coding assistants.

```
index.html, server.mjs, start.bat       the page, a tiny dependency-free static server, a Windows launcher
sw.js, manifest.webmanifest, icons/     offline copy and "install as an app" for the hosted site
src/main.js                             game loop, state machine, keys
src/screens.js                          the screens and the HUD drawn over the game
src/recording.js  replay.js             debug recordings (the last minute of play) and playing them back
src/debug-record.js                     debug recordings: keeping, saving and loading them, optional screen video
src/picker.js                           the level picker carousel
src/setup-check.js                      the first-launch setup check (camera, light, distance, speed, GPU)
src/calibrate.js                        the play space: where the kids can really go (walls, sofas), measured each time a group joins
src/controls.js  device.js              on-screen buttons, full-screen note, wake lock; phone/laptop defaults
src/levels/                             one file per level, index.js (the list), kit.js (helpers), _template.js
src/types.js                            JSDoc types: Player, Game, Level (checked by npm run typecheck)
src/tracker.js  pose-worker.js          camera + pose model (in a worker) -> players
src/quality.js                          the tracking quality ladder: step down when slow, back up when fast
src/pose-shared.js                      what the worker and the main-thread pose engine share
src/health.js                           self-healing watchdog: lost camera, hung tracker
src/people.js  look.js                  who is who: probation, matching, recognising kids who come back
src/filter.js  lobby.js                 smoothing, the join-by-arms-out lobby and joining mid-game
src/camera.js                           picture size, switching cameras, remembering the choice, frame-rate fallback
src/person-mask.js  cutout.js           which pixels are a kid, and cutting them out
src/backdrops.js  backdrops-extra.js    cartoon worlds (the first levels; the newer levels)
src/scene-kit.js  art.js  draw.js       scene drawing helpers, art loading, drawing helpers
src/audio.js  music.js  ease.js         synthesized sound effects and music (no audio files); auto-ease
src/family.js  online.js  room-code.js  family play: WebRTC glue, its pure maths, room codes
src/online-config.js                    the pairing service's address (filled in by the Pages publish)
cloudflare/                             the pairing service (Worker + Durable Object), deployed separately
vendor/  models/                        MediaPipe runtime and pose models, stored locally for offline use
test/unit  test/e2e  test/fixtures      tests
```

## Tests

```
npm install          # one time; only installs the test tools (puppeteer-core, typescript)
npm run typecheck    # checks the JSDoc types, a few seconds
npm test             # 340 unit tests, a couple of seconds
npm run test:e2e     # 38 browser tests, about 10 minutes: real Edge/Chrome and the real pose model
npm run test:perf    # just the performance test: every level must stay smooth on a laptop without a GPU
npm run test:all     # type check, unit tests and browser tests
```

Every push to `main` runs the type check and unit tests on GitHub and publishes the game to GitHub Pages
(`.github/workflows/pages.yml`). A change under `cloudflare/` also redeploys the family-play pairing service
(`.github/workflows/pairing.yml`).

The browser tests use a fake webcam that plays a photo of a person, so they exercise the whole pipeline
(camera, pose model, cut-out, scoring, screens, family play between two windows) with nobody in front of the
camera. They need Edge or Chrome
(set `BROWSER_PATH` if it isn't found). Tests can't judge how the game *feels* for real kids; that needs a
playtest.

## Credits and licences

- Body tracking uses [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache License 2.0). The
  runtime in `vendor/` and the pose models in `models/` are Google's, downloaded from the public MediaPipe
  distribution and included so the game works offline.
- `test/fixtures/pose.jpg` is a stock photo from MediaPipe's public test assets, used only by the tests.
- No licence has been chosen for this project's own code yet.
