// Shared JSDoc types. Nothing here runs: the file only describes the shapes the modules pass around, so an
// editor can autocomplete them and `npm run typecheck` can catch a typo like `p.hand` or `g.Width`.
// Use them from any module with:   /** @import { Player, Game, Level } from './types.js' */

/** @typedef {{ x: number, y: number }} Point  A position in screen pixels (canvas space, already mirrored). */

/** @typedef {{ x: number, y: number, r: number }} Circle  A body part as a circle, in screen pixels. */

/**
 * Rule-based poses, each with hysteresis so one glitchy frame can't switch it.
 * @typedef {object} Poses
 * @property {boolean} [armsUp]     both wrists clearly above the head
 * @property {boolean} [airplane]   arms straight out to the sides (also how kids join)
 * @property {boolean} [handsHead]  both hands next to the head
 * @property {boolean} [duck]       head well below the kid's standing height (ducking or crouching)
 */

/**
 * One tracked person, as the tracker hands it to the game. Levels READ these fields; the only things a level
 * may write are its own scratch fields (e.g. `hold`, `got` in the dance level) and the effect fields
 * `hitUntil` / `flashUntil` / `flashColor`.
 * @typedef {object} Player
 * @property {number} id          stable while the person stays in view (and when they come back, see people.js)
 * @property {number} slot        colour slot
 * @property {string} color       this player's colour, e.g. '#ff4d6d'
 * @property {boolean} present    false during a short tracking dropout (the record is kept for a moment)
 * @property {boolean} [remote]   a family guest in another home (family.js): placed by the host from the guest's skeleton
 * @property {boolean} [excluded] watching, not playing: did not join, or walked in mid-game. No score, no hits.
 * @property {Point[]} px         the 33 MediaPipe pose landmarks in screen space (0 nose, 11/12 shoulders,
 *                                15/16 wrists, 19/20 index fingers, 23/24 hips, 25/26 knees, 27/28 ankles)
 * @property {Point[]} hands      wrists and index fingertips: what pops and touches things
 * @property {Circle[]} circles   head, chest, belly, hips, knees: what gets hit
 * @property {Point} sh           midpoint of the shoulders
 * @property {Point} hip          midpoint of the hips
 * @property {number} cx          horizontal centre of the body (= sh.x)
 * @property {number} shoulderW   shoulder width in px: THE unit for body-relative measures
 * @property {number} torso       shoulders-to-hips length in px (unreliable on small kids: prefer shoulderW)
 * @property {number} lastJump    game time (s) of the most recent jump
 * @property {number} jumps       number of jumps so far
 * @property {number} [lastDuck]  game time (s) the kid was last ducking (pose.duck)
 * @property {number} [motion]    how fast the body is moving, in shoulder widths per second (smoothed ~0.3 s)
 * @property {Poses} pose
 * @property {number} score
 * @property {number} seen        game time (s) the tracker last saw them
 * @property {number} [hitUntil]  draw the skeleton red until this time
 * @property {number} [flashUntil] draw the skeleton in flashColor until this time
 * @property {string} [flashColor]
 * @property {number[] | null} [look]  appearance signature (clothing colours), used to recognise them again
 * @property {any[]} [filters]    the tracker's smoothing filters, one pair per landmark
 * @property {boolean} [isNew]    set by the tracker for a person it has not seen before (cleared by main.js)
 * @property {{ cx: number, cy: number, sw: number }} [seenAt]  raw shoulders at the last sighting (people.js matching)
 * @property {boolean} [partial]  the last sighting was half out of the picture (people.js matches it sideways only)
 * @property {number} [joinHold]  seconds a watcher has held their arms out to join mid-game (lobby.js)
 * @property {any} [hold]         level scratch space
 * @property {any} [got]          level scratch space
 */

/**
 * The shared game object (`g`) every level receives.
 * @typedef {object} Game
 * @property {number} W           canvas width in px
 * @property {number} H           canvas height in px
 * @property {number} u           size unit: 1u = H / 1080 px. Write every size as `n * g.u`.
 * @property {number} now         game time in seconds
 * @property {number} diff        difficulty: 1 in the first round, +0.25 each round after, times `ease`
 * @property {number} ease        auto-ease (ease.js): 1 normally, down to 0.55 when the kids keep failing.
 *                                Already in `diff`; read it for difficulty that is not a speed (hold times)
 * @property {number} round
 * @property {boolean} fx         glow effects on (off with ?lite or on slow devices)
 * @property {Player[]} players   everyone the tracker sees, including kids who are only watching
 * @property {{ score: number, hearts: number, maxHearts: number }} team
 * @property {Level | null} level the level being played
 * @property {import('./calibrate.js').PlayArea | null} [area]  the play space the kids showed before the picker
 *                                (fractions of the width); read it through kit.js reachX / standX
 * @property {() => Player[]} activePlayers   visible AND playing: use this for gameplay
 * @property {(p: Player | null, pts: number, x: number, y: number) => void} score  add points (p = null: team only)
 * @property {(x: number, y: number, color: string, n?: number) => void} burst     a confetti burst
 * @property {() => void} miss    a kid failed something (hit, splash, bonk): feeds auto-ease
 * @property {(msg: string) => void} endLevel  end the level early with a message (e.g. out of hearts)
 */

/**
 * A full-screen animated backdrop. `static` is drawn once per screen size and cached; `dynamic` every frame.
 * @typedef {object} Scene
 * @property {(ctx: CanvasRenderingContext2D, W: number, H: number, u: number) => void} static
 * @property {(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, t: number) => void} dynamic
 */

/**
 * A level (mini-game). See docs/ADDING-GAMES.md. Besides these fields a level keeps its own state on itself
 * (`this.items`, `this.spawn`, ...), which is why `Level` allows extra properties.
 * @typedef {LevelBase & { [state: string]: any }} Level
 */

/**
 * @typedef {object} LevelBase
 * @property {string} id          short, unique, lowercase: also names the backdrop and `assets/bg_<id>.png`
 * @property {string} title       big title on the intro screen and the HUD
 * @property {string} [icon]      one emoji: the big picture on the level's card in the level picker
 * @property {string} hint        one short line telling kids what to do
 * @property {string} color       the level's colour (a light tint in camera view)
 * @property {number} duration    seconds
 * @property {boolean} [hearts]   show the team's hearts in the HUD
 * @property {string | Scene} [backdrop]  scene to use: an existing scene id or your own Scene (default: the id)
 * @property {Record<string, { file: string, emoji?: string }>} [art]  art slots this level adds (see art.js)
 * @property {(g: Game) => void} start                 reset all level state (called before every play)
 * @property {(g: Game, dt: number) => void} update    advance by dt seconds
 * @property {(g: Game, ctx: CanvasRenderingContext2D) => void} draw   paint (players are drawn on top)
 */

export {};
