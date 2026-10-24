# Camera Games: project handover

Everything a new coding agent (or person) needs to pick this project up where it was left on 2026-10-24.
Read this first, then [CLAUDE.md](CLAUDE.md) (working rules and architecture detail), then the docs it links.
Where this file and the code disagree, the code wins; please fix this file when you notice.

## 1. What it is, and who it's for

A webcam-controlled movement game for young kids, in the spirit of Nex Playground. A webcam (or a phone used as a
webcam) sits on the TV, MediaPipe's pose model tracks up to 4 kids in the browser, the kids are cut out of the
camera picture and dropped into a cartoon world, and they play short levels by jumping, ducking, reaching and
waving. It is made by Calum for his own children (his daughter is about 4 and is the main play-tester), and is
meant to grow into something any non-technical family can set up on their own TV.

- Live: https://calum.github.io/camera-games/ (GitHub Pages, published from `main`).
- Repo: `calum/camera-games`. It was renamed from `kids-camera-games` on 2026-10-19 because Calum's partner found
  the old name creepy-sounding. Don't reintroduce the old name in text. (Old clones' remotes still point at the old
  URL; GitHub redirects git, but the old Pages URL 404s.) `kcg.*` localStorage keys and the pairing Worker's
  `kids-camera-game-pairing` address keep the old name on purpose.
- Plain JavaScript ES modules on a canvas, JSDoc types checked by `tsc`. No build step, no runtime dependencies,
  no backend. Runs offline after the first visit (service worker `sw.js`).

## 2. Where things are

| Read this | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Commands, full module list, key ideas to preserve, pitfalls that have bitten the project, conventions |
| [README.md](README.md) | What the game is and how to play it (keys, URL options) |
| [docs/PLAN.md](docs/PLAN.md) | Technical plan, design decisions, roadmap (M1 to M9), known limits |
| [docs/ADDING-GAMES.md](docs/ADDING-GAMES.md) | How to add or change a level (one file per level) |
| [docs/FORT-GAMES.md](docs/FORT-GAMES.md) | Fort games: each player in their own screen column; Calum's rules for them |
| [docs/ONLINE.md](docs/ONLINE.md), [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md) | Family play across homes (WebRTC) and its Cloudflare pairing Worker |
| [docs/FAMILY_SETUP.md](docs/FAMILY_SETUP.md) | Setup guide for families (TV, webcam or phone camera) |
| [docs/PLAYGROUND-PLAN.md](docs/PLAYGROUND-PLAN.md), [docs/PUBLIC-PLAN.md](docs/PUBLIC-PLAN.md) | Play-area calibration plan; public release plan |
| `test/fixtures/recordings/` | Real tracking clips (skeletons only) replayed by `test/unit/recording.test.js` |

Outside the repo, in the Claude project's shared files (not available to agents outside that project):
`design/` (level-ideas.md, online-multiplayer.md, split-world-games.md, concept images) and `reviews/`
(codebase-review-2026-10-18.md, code-health-2026-10-18.md, code-review-2026-10-19.md,
play-test-recognition-2026-10-18.md). Their conclusions are summarised below.

### Architecture in one breath

`src/main.js` runs the loop and state machine (loading > setup > menu > calibrate > pick > intro > play > outro >
pick). `src/tracker.js` (PoseTracker, MouseTracker) runs MediaPipe in `src/pose-worker.js` (main-thread fallback),
follows the quality ladder in `quality.js`, heals itself (`health.js`), and turns skeletons into **player** objects.
`people.js` decides who is who. `person-mask.js` + `cutout.js` cut the kids out; `backdrops*.js` draw the worlds.
Levels live in `src/levels/` (one file each, list in `index.js`, game sets in `sets.js`) and **only read the player
object**. Fort games use `forts.js`. Family play is `family.js` + `online.js`, paired by the Worker in
`cloudflare/`. Sound is synthesized (`audio.js`, `music.js`); there are no sound files. The full table is in
CLAUDE.md.

### The levels (14)

Play order (`src/levels/index.js`): Pop the bubbles, Dodge the rocks, Jump the waves, Dig down!, Duck and jump,
Catch the stars!, Avalanche!, Keep it up!, Freeze!, Hole in the wall!, Snowball fight!, Fly high!, Pass the bomb!,
Dance party. The picker opens on game sets: Party mix (random 4), Jump & dodge, Catch & pop, Dance & pose, Fort
games; the last card, "Pick your game", shows every level.

What the kids like (play tests, October 2026): Dodge the rocks, then Jump the waves, then Pop the bubbles. Whole-body
dodging and jumping beats holding poses; Dance party is the least liked (rework it or drop it). Fly high! got lots
of laughs but its goal wasn't clear.

## 3. Running and testing

```
node server.mjs          # http://localhost:8137 (port 8000 is taken on Calum's machine)
npm run typecheck        # must stay clean
npm test                 # unit tests, ~2 s (420+ tests)
npm run test:e2e         # real browser + real pose model, ~10 min
npm run test:perf        # performance only
npm run test:all         # before saying something works
```

- `?mouse` (or key M) plays with the mouse; `?mouse&level=<id>` jumps straight into a level. `?debug` adds the debug
  panel, prints a copyable console line every 5 s, and enables recordings (R saves the last minute, `?replay` or
  drag-and-drop plays one back).
- **In a cloud container**, run the e2e tests with `BROWSER_PATH=/opt/pw-browsers/chromium npm run test:e2e`.
  Tracking there runs on a software renderer at ~1 frame a second, so tests wait on `tracker.frameSeq`.
- **Known environment-only e2e failures in a container** (they fail on unchanged `main` too, so they are not
  regressions): the performance test (frame rates too low for the budget, e.g. bubbles/freeze/dance) and the
  family real-camera test (times out). The Cloudflare test is skipped. Last full run: 38 of 41 passed, 1 skipped.
  Always confirm a failure against unchanged `main` before blaming your change.
- CI ("Check and publish", `.github/workflows/pages.yml`) runs only typecheck + unit tests. The e2e tests are
  local-only.
- Project preference: watch long test runs and report progress as a count and percentage ("14 of 33 (42%)").

## 4. Shipping: PRs, publishing and the Worker

- **Workflow:** one branch and one PR per piece of work. Calum lets agents merge their own PRs when CI is green,
  and go with their own recommendations, **except anything under `cloudflare/`** (see below).
- **Check the publish after every merge.** The "Check and publish" run on `main` re-runs the unit tests and
  silently skips publishing if they fail, leaving the live site old. This happened once: fort games (#35) and the
  slow-warning (#36) sat unpublished for two days because of a flaky mud test (fixed in #37). After merging, look
  at that run on `main` and make sure the deploy job succeeded.
- Agents in the cloud container can't fetch `calum.github.io` (the proxy returns 403), so Calum has to eyeball the
  live site.
- The Claude GitHub App was not installed under the renamed repo at one point, so PR event notifications may not
  arrive. Check CI status by hand rather than waiting for events.
- If you replace anything in `vendor/` or `models/` (MediaPipe's files, don't edit them), bump `VERSION` in `sw.js`
  so families' offline copies update.

### The Cloudflare pairing Worker (family play)

- Deployed at `https://kids-camera-game-pairing.calum-4ster.workers.dev`; the `PAIRING_URL` repository variable is
  set, and the publish step writes it into `src/online-config.js`.
- **Merging any change under `cloudflare/` (or to `src/room-code.js` or `.github/workflows/pairing.yml`)
  auto-deploys the production Worker.** Such a PR needs Calum's explicit yes before merging, every time.
- Pairing security (only the host's own key can replace the host; relay credentials only go to browsers in a
  room) was fixed in PR #16.
- Family play has **not yet been tested between two real homes**. If a family's network can't connect directly,
  add the TURN relay (DEPLOY-CLOUDFLARE.md, "Optional: the relay").

## 5. Calum's rules and preferences

### Design rules

- **The youngest player is 4.** No reading needed to play, no aiming, big slow things, generous hit boxes, loud
  funny feedback for everything. A sloppy hit test is a feature.
- **The goal must be obvious in seconds, without words.** Show it in the picture (the thing is on *your* head,
  it flashes and shakes, a big word bounces over whoever's turn it is).
- **Funny first.** A bit of glitchiness is fine if it's funny. Spend effort on silly reactions over precision.
- **Team-first, no hard failure.** Shared hearts and score, per-kid stars on top; running out of hearts only
  replays the level. Getting hit is a joke, never a loss (in fort games, never take points from the kid who was hit).
- **Fort games:** kids stand still an arm's reach apart and move only their arms (throws go up and over, never
  sideways, never swinging at each other); everyone gets the same fun; a kid alone plays the cartoon monkey
  (Calum asked for a monkey specifically). Full rules in FORT-GAMES.md.
- **Pace:** the Jump & dodge games were slowed to about half speed for his daughter (#38). Err slow.
- Whole-body action (dodging, jumping) is what the kids love; still poses are the least liked.
- Anything a kid must touch or stand in is placed with `reachX`/`standX` from `kit.js` so it respects the
  calibrated play space; the play-space walk reruns for every group joining from the menu (Calum chose this).

### Privacy

- **Never commit Calum's debug videos, photos, or anything showing him, his partner or the kids.** Skeleton-only
  JSON recordings or synthetic footage are fine. The toddler regression test uses measurements, not the photo.
- Screen video in debug recordings is opt-in (G) and nothing is ever uploaded. Keep it that way.
- No video leaves the house except on a family call, peer to peer.

### Working preferences

- Subagents: model `sonnet` for complex work, `haiku` for simple work. Thread default model is Opus; Fable was tried
  and dropped because it used usage too fast. Don't suggest it unless Calum asks.
- Calum watches his usage closely: don't start extra work or threads he didn't ask for.
- Plain, short replies; lead with the result.
- Calum is in the UK (assume UK time).

## 6. Calum's setup (the hardware the game must work on)

- Windows laptop with Intel Iris Xe graphics, Edge, HDMI to the living-room TV.
- Camera: a NexiGo N60 FHD webcam (1280x720, 30 fps) in recent sessions; earlier a Pixel 6a through Windows Virtual
  Camera (a phone as a webcam can add its own delay; check that before blaming tracking).
- The room is dim and people often wear dark clothes. His partner often lies on a sofa in view: that's why
  `people.js` matches by height as well as sideways position (#20), with a regression recording.
- Measured: the pose worker was too slow there, so tracking falls back to the main thread, ~13-24 fps on the
  lowest rung, round trip 30-60 ms. Each extra person in view costs ~40% more model time. The game says
  "Running slowly: <fix>" after 6 s of slow tracking (`src/speed.js`, #36).
- When diagnosing lag, ask Calum for the `?debug` console line from the slow session first.
- Hardware advice already given: Raspberry Pi 4 no, Pi 5 borderline; best upgrade is a used Ryzen mini PC
  (ThinkCentre M75q Gen 2 or EliteDesk 805 G6, 8 GB+ dual-channel RAM, about £250-350). A cloud GPU for tracking
  was costed (~£1-2 a session) and advised against: Wi-Fi stalls freeze everyone, it's a big rebuild, and kids'
  video would leave the house.

## 7. History (PRs, all merged)

| PRs | Date | What |
|---|---|---|
| #1-#5 | 2026-10-18 | Dig down, family setup guide, Pages hosting + worker tracking + no pets or passers-by + one file per level, Duck and jump, Freeze |
| #6 | 2026-10-18 | Family play online (WebRTC + Cloudflare pairing Worker) |
| #7-#18 | 2026-10-18 | Sounds and auto-ease, perf tests, lag fix (main-thread fallback), carousel picker, `?debug` line, self-healing + setup check, code-health fixes, pairing security (#16), docs refresh |
| #19 | 2026-10-18 | Debug recordings (R) and replay |
| #20 | 2026-10-18 | Player matching by height and size (sofa swaps) |
| #21 | 2026-10-18 | Play-space walk after joining; smaller, higher picker |
| #22 | 2026-10-18 | Polish: cartoon rocks, warning signs, bouncing points, 5 s warning, confetti |
| #23 | 2026-10-18 | Music: a generated song per level, U mutes, ducks under family voices |
| #24 | 2026-10-19 | Review fixes: jumps tracked on slow devices (match on raw shoulders, `riseRate` 4), roundRect fallback |
| #25-#28 | 2026-10-19 | Walk reruns per group, small leak fixes, main.js split (screens.js, debug-record.js), quality.js |
| #29 | 2026-10-19 | Coloured play spaces |
| #30 | 2026-10-19 | Game sets in the picker |
| #31, #33, #34 | 2026-10-19 | Duck scoring fix; keep a partial play-space walk; Dig down redesign (dig sideways, gold row "Level N complete!" between harder phases, columns fit the play space) |
| #32 | 2026-10-19 | Rename to Camera Games |
| #35 | 2026-10-19 | Fort games: Snowball fight!, Fly high!, the monkey |
| #36 | 2026-10-19 | "Running slowly" hint (`speed.js`) |
| #37 | 2026-10-21 | Flaky mud test fixed (it had blocked publishing) |
| #38 | 2026-10-21 | Jump & dodge slowed ~half for a 4-year-old |
| #39 | 2026-10-21 | Pass the bomb! (third fort game) |

## 8. Open questions for Calum

Ask these when the moment is right; don't block work on them.

- Do the kids get Pass the bomb! straight away? How do they find the fort games and the game sets in general?
- Is Jump & dodge slow enough now (#38)?
- Does the play-space walk feel quick enough for the kids?
- Music and voice volumes on the first real family call (the values in `music.js` are guesses).
- Has family play been tried between two homes yet? Did it connect, or is the TURN relay needed?
- A `?debug` line from the next laggy session (especially with two or more players).

## 9. Next steps (roadmap, roughly in priority order)

1. **Play-test findings first.** Tune whatever the questions above turn up; constants sit at the top of each level
   file and in `computeFeatures` in `tracker.js`.
2. **More whole-body levels.** Ideas: meteor shower with lanes (run left and right), catch falling stars in a basket
   (both hands), kick the ball, whack-a-mole with the feet, sleeping-dragon sneak, floor is lava, volcano. Fort game
   ideas: Volley (bop a beach ball), Pie in the face, team forts on a family call. Rework or drop Dance party.
3. **Make Fly high!'s goal obvious** (it's fun but confusing), per the "obvious without words" rule.
4. **Own art and sound** (M3): PNG overrides already work via `assets/`; voice cheers.
5. **Silhouette-only gameplay** (M5b) for big groups and kids too close or too small for skeletons.
6. **Raspberry Pi / mini-PC kiosk** (M6), and the public release plan (M9, PUBLIC-PLAN.md).
7. Code health, when quiet: `tracker.js` (~860 lines) and `main.js` (~945 lines, grown again since the split) are the biggest files. Harmless known nits are
   listed in the 2026-10-19 review (`motionPx`, `players.find`, `VideoClip.take` double stop, calibration "done"
   phase widening). Known limit: auto-ease only lowers difficulty; `g.round` never rises since the picker replaced
   playing straight through, so difficulty never goes above 1.

Keep this file current: when you merge something notable or learn a new rule from Calum, add a line here.
