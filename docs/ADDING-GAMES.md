# Adding and changing games

This guide is for anyone adding a level (a mini-game) or changing one, whether you are a person or an AI
coding assistant. It covers how a level works, what it can read, a step-by-step for a new level, how to test
it, and the design rules that came out of playtesting with real kids.

A level is **one file** in `src/levels/`. It reads a few tidy facts about each kid ("where are their hands?",
"did they just jump?") and draws on a canvas. It never touches the camera or the pose model, so you can build
and test a whole level with the mouse standing in for a kid.

## Contents

1. [How a level fits in](#how-a-level-fits-in)
2. [Make a new level in five steps](#make-a-new-level-in-five-steps)
3. [What a level can read: the player](#what-a-level-can-read-the-player)
4. [What a level can use: the game object `g`](#what-a-level-can-use-the-game-object-g)
5. [Helpers, art, sound and backdrops](#helpers-art-sound-and-backdrops)
6. [Testing a level](#testing-a-level)
7. [Design rules for small kids](#design-rules-for-small-kids)
8. [Changing an existing level](#changing-an-existing-level)
9. [Checklist](#checklist)

## How a level fits in

```
camera -> pose model (worker) -> people.js (who is who) -> tracker.js (players) -> main.js -> your level
                                                                                      |
                                                    draws backdrop, kids' cut-out, your level, skeletons, HUD
```

`main.js` runs the game: menu, a 3-second intro with your title and hint, your level for `duration` seconds,
an outro, then the next level. Each frame it calls your level's `update(g, dt)` then `draw(g, ctx)`. The
cartoon backdrop and the kids' cut-out are drawn **before** your level; the skeletons, scores and HUD
**after** it.

The order of play is the list in [`src/levels/index.js`](../src/levels/index.js). Keys `1` to `9` jump to a
level by its position in that list.

A level is a plain object (see the `Level` type in [`src/types.js`](../src/types.js)):

| Field | Meaning |
|---|---|
| `id` | Short, unique, lowercase (`'stars'`). Also names the backdrop and `assets/bg_<id>.png`. |
| `title` | The big title on the intro screen and in the HUD. |
| `hint` | One short line saying what to do. Most kids can't read it, so a grown-up says it out loud. |
| `color` | The level's colour, used as a light tint in camera view. |
| `duration` | Seconds. Levels are about 30 s. |
| `hearts` | Optional. `true` shows the team's shared hearts (see Dodge the rocks). |
| `backdrop` | Optional. A scene id (`'menu'`, `'bubbles'`, `'dodge'`, `'jump'`, `'dance'`, `'finale'`) or your own scene. |
| `art` | Optional. Art slots your level adds, e.g. `{ bigstar: { file: 'bigstar.png', emoji: '⭐' } }`. |
| `start(g)` | Reset **all** your state. Called before every play, including replays. |
| `update(g, dt)` | Move things on by `dt` seconds, check hits, score. |
| `draw(g, ctx)` | Paint your things. Don't draw the kids or the HUD: that is done for you. |

Your level keeps its own state on itself (`this.stars`, `this.spawn`). Set all of it in `start()`, because the
same object is reused every time the level is played.

## Make a new level in five steps

1. **Copy the template.** [`src/levels/_template.js`](../src/levels/_template.js) is a complete, working
   level ("Catch the stars"). Copy it:

   ```
   cp src/levels/_template.js src/levels/rockets.js
   ```

   Change `id`, `title`, `hint` and `color`, and rename the variable.

2. **Add it to the list** in `src/levels/index.js`:

   ```js
   import rockets from './rockets.js';
   export const LEVELS = [bubbles, dodge, jump, rockets, dance];
   ```

3. **Play it with the mouse.** Run `node server.mjs` and open
   `http://localhost:8137/?mouse&level=rockets`. The mouse is a pretend kid: moving it moves the body and
   hands, a click is a jump, and holding Q, W or E does arms up, airplane or hands on head, and S ducks. Press `D` for debug
   info. Edit, save, refresh.

4. **Run the checks.**

   ```
   npm run typecheck   # catches typos such as p.hand or g.Width, using the JSDoc types
   npm test            # includes a minute of pretend play of every level with 0-4 kids
   ```

5. **Try it with the camera**, then with the kids. Tune the constants at the top of your file. Tests can't
   tell you whether it's fun.

## What a level can read: the player

Get the kids who are playing with `g.activePlayers()`. It leaves out kids who are briefly lost by tracking,
kids who sat out the lobby, and people who walked in mid-game and are only watching. Use `g.players` only to
draw something for everyone in view.

Every player has these fields. Positions are screen pixels, already mirrored like a mirror.

| Field | What it is | Typical use |
|---|---|---|
| `hands` | Wrists and index fingertips (4 points) | Touching, popping, catching |
| `circles` | Head, chest, belly, hips, knees as `{ x, y, r }` | Getting hit, dodging |
| `px[33]` | All 33 pose landmarks (0 nose, 11/12 shoulders, 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles) | Anything else, e.g. feet for kicking |
| `sh`, `hip` | Midpoints of the shoulders and of the hips | Where the body is |
| `cx` | Horizontal centre of the body | Aiming things at a kid, lanes |
| `shoulderW` | Shoulder width in px | **The** unit for body-relative sizes |
| `lastJump`, `jumps` | Time of the last jump (s, compare with `g.now`) and a count | Jump games |
| `pose.armsUp`, `pose.airplane`, `pose.handsHead` | The three recognised poses, each steadied with hysteresis | Pose games |
| `pose.duck`, `lastDuck` | Head well below the kid's own standing height (with hysteresis), and the last time that was true | Duck games (see `duckjump.js`) |
| `motion` | How fast the body is moving, in shoulder widths per second, smoothed over ~0.3 s. About 0 standing still, 2+ dancing | Freeze games (see `freeze.js`) |
| `id`, `color` | Stable id and the kid's colour | Per-kid feedback, keyed state |
| `score` | This kid's stars | Read only; add points with `g.score` |

You may also write `p.hitUntil = g.now + 0.8` (red skeleton flash), and `p.flashUntil` with `p.flashColor`
(any colour flash), and your own scratch fields such as `p.hold`.

**Measure bodies in shoulder widths, never torso length.** Torso length comes from the hips, which are badly
tracked on small kids. The old torso-based pose rules rejected a toddler with both arms up.

## What a level can use: the game object `g`

| | |
|---|---|
| `g.W`, `g.H` | Canvas size in px. |
| `g.u` | The size unit: `1u = g.H / 1080`. Write every size and speed as `n * g.u` so the level looks the same on a laptop and a TV. |
| `g.now`, `dt` | Game time in seconds, and the time since the last frame (at most 0.05 s). |
| `g.diff` | Difficulty: 1 in the first round, then 1.25, 1.5 and so on, lowered by auto-ease when the kids keep failing. Multiply speeds and divide spawn gaps by it. |
| `g.miss()` | Call it when a kid fails something (hit by a rock, a splash, a dropped balloon). Three misses close together make the game ease off (`src/ease.js`). |
| `g.ease` | The auto-ease factor, 1 down to 0.55. It is already in `g.diff`; use it for difficulty that is not a speed, like a hold time (`HOLD * (g.ease ?? 1)`). |
| `g.activePlayers()` | The kids who are playing. |
| `g.score(p, pts, x, y)` | Add points to player `p` (or `null` for the team only) with a floating "+pts" at x, y. |
| `g.burst(x, y, color, n)` | A confetti burst. |
| `g.team.hearts` | The team's shared hearts, when `hearts: true`. |
| `g.endLevel(msg)` | End early with a message. The level is then replayed, so use it for "out of hearts". |
| `g.fx` | `false` on slow devices and phones: skip expensive extras such as `shadowBlur` when it is off. |

## Helpers, art, sound and backdrops

**Hit tests** ([`src/levels/kit.js`](../src/levels/kit.js)):

```js
import { rand, pick, clamp, handTouching, bodyHit } from './kit.js';

const p = handTouching(players, x, y, r, 30 * g.u); // a player whose hand is within r + 30u, or null
const q = bodyHit(players, x, y, r);                 // a player whose body overlaps the circle, or null
```

**Drawing text and shapes**: `text(ctx, str, x, y, size, { color })` from `../draw.js` draws outlined text
that is readable over any background. `drawPoseIcon(ctx, 'armsUp', x, y, size)` draws a stick figure.

**Art you can swap**: declare a slot in your level, `art: { rocket: { file: 'rocket.png', emoji: '🚀' } }`,
and draw it with `drawArt(ctx, 'rocket', x, y, size, rotation)`. It draws `assets/rocket.png` if someone
added one, otherwise the emoji. If it returns `false` (no image and no emoji), draw your own fallback. List
the new file name in [`assets/README.md`](../assets/README.md).

**Sound**: `sfx.<name>()` from `../audio.js`, for example `pop`, `gold`, `star`, `tick`, `go`, `bubble`,
`whistle` (something falling), `thud`, `bonk` (a friendly fail), `boing`, `splosh`, `chime`, `sparkle`,
`crunch`, `crumble`, `twinkle`, `rumble`, `swish`. See the full list in `sfx`. They are synthesized from tones
and filtered noise, so no files are needed. Give a new level a few sounds of its own (add a line to `sfx`), and
keep failing sounds silly rather than scary. A unit test checks that every `sfx.<name>` a level uses exists.

**Backdrop**: by default a level uses the scene with its own id, or the menu meadow if there is none. Set
`backdrop: 'jump'` to reuse a scene, or give a scene object:

```js
backdrop: {
  static(ctx, W, H, u) { /* sky, hills: drawn once per screen size and cached */ },
  dynamic(ctx, W, H, u, t) { /* clouds, fish: drawn every frame, keep it light */ },
},
```

A family can always replace it with `assets/bg_<id>.png`.

## Testing a level

- **Automatic**: [`test/unit/all-levels.test.js`](../test/unit/all-levels.test.js) checks every level in the
  list. It validates the definition, checks the id is unique, and plays a minute with 0, 1, 2 and 4 pretend
  kids who move, wave, jump, sit out and drop out. It fails on any error, a non-number score, or a level that
  draws nothing.
- **Your own rules**: add tests to [`test/unit/levels.test.js`](../test/unit/levels.test.js), which drives
  levels with a fake `g` and hand-placed players (for example "a hand on a bubble pops it", "standing still in
  the jump level does not score"). Check that a test fails when you break the rule on purpose.
- **Types**: `npm run typecheck`. Starting a level object with `/** @satisfies {Level} */` makes the editor
  autocomplete `g.` and `p.` and catch typos.
- **In the browser**: `?mouse&level=<id>` to play it, `?level=<id>` with the camera, `D` for debug info. Run
  `npm run test:e2e` before calling it done, since the browser tests play every level in mouse mode.

## Design rules for small kids

These come from playtesting with our own kids.

1. **Whole-body movement wins.** Favourites so far: *Dodge the rocks* (moving out of the way of something
   falling), then *Jump the waves* (jumping on cue), then *Pop the bubbles* (waving). *Dance party*
   (holding a still pose) was the least liked. Prefer running, ducking, jumping and reaching over standing still.
2. **Big, slow, forgiving.** Hit boxes are deliberately generous (hands get 30u of slack; bodies count at 80%
   when being hit, so near misses are misses). Timing windows are wide: a jump counts from 0.5 s early to
   0.3 s late.
3. **Warn before danger.** Rocks show a "!" before they fall and waves count down 3-2-1. Never hit a kid
   without a warning they could react to.
4. **No hard failure.** Running out of hearts replays the level. Nobody is knocked out. Team score first, a
   kid's own stars on top.
5. **Feedback for every kid, every time.** A good jump glows green with "NICE JUMP!"; a miss goes red with
   a short hint. Don't leave a kid wondering whether it counted.
6. **No reading needed.** Kids can't read the hint, so make the goal obvious from what moves on screen.
7. **Nothing pops.** Fade things in and out. Don't make anything depend on a single frame of tracking.
8. **Scale with the group.** More kids should mean more to do (spawn rate grows with the player count), not
   a fight over one target.
9. **Keep it cheap to draw.** Phones and tablets run this. Avoid hundreds of gradients or `shadowBlur` per
   frame, and skip extras when `g.fx` is false.

Ideas that fit these rules are listed under M4 in [PLAN.md](PLAN.md#roadmap).

## Changing an existing level

- Difficulty and timing constants sit at the **top of each level file**. Change those first.
- A level must keep working with 0 to 4 kids and with kids dropping in and out.
- Keep the playtest-driven choices unless a new playtest says otherwise: the rock speeds, the jump window,
  the 0.8 s pose hold.
- Run `npm test` and `npm run typecheck`, then `npm run test:e2e` if you changed drawing or anything
  outside `src/levels/`.

## Checklist

- [ ] A new file in `src/levels/`, starting `/** @satisfies {Level} */`, added to `src/levels/index.js`
- [ ] All sizes and speeds in `g.u`; body-relative measures in `shoulderW`
- [ ] Reads `g.activePlayers()`, and works with 0 kids
- [ ] Everything reset in `start()`
- [ ] Tuning constants at the top of the file, with a comment saying what each one means
- [ ] New art slots declared in `art` and listed in `assets/README.md`
- [ ] `npm run typecheck`, `npm test` (and `npm run test:e2e` for bigger changes) pass
- [ ] Played with the mouse, then with the camera, then with kids
