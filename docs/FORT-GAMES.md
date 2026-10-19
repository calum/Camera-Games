# Fort games

A fort game is a kind of level where **every player gets their own fort**: a column of the screen with their
cut-out moved into it. Kids standing an arm's reach apart in the room end up far apart in the game world, so they
can throw things at each other, splat each other with mud, or fly side by side. Family guests in another home get
forts too, the same way.

The two fort games so far are [`snowball.js`](../src/levels/snowball.js) (**Snowball fight!**) and
[`fly.js`](../src/levels/fly.js) (**Fly high!**). Read [ADDING-GAMES.md](ADDING-GAMES.md) first: a fort game is
an ordinary level with `forts: true`, and everything there still applies. This page covers what is different.

## Contents

1. [The rules for fort games](#the-rules-for-fort-games)
2. [Make a fort game](#make-a-fort-game)
3. [What the engine does for you](#what-the-engine-does-for-you)
4. [The fort object](#the-fort-object)
5. [The throw: arm pumps](#the-throw-arm-pumps)
6. [Things stuck on a kid](#things-stuck-on-a-kid)
7. [The monkey, and people joining](#the-monkey-and-people-joining)
8. [Family play](#family-play)
9. [Testing](#testing)
10. [Ideas](#ideas)

## The rules for fort games

These come from Calum (2026-10-19), and they are why fort games feel different from the other levels.

1. **Funny comes first.** The point is everyone laughing. A bit of glitchiness is fine if it's funny (a kid's
   arm cut off at the fort edge, a snowball that lands a bit off). Spend effort on silly reactions, not on
   precision.
2. **Stand still, move arms.** Kids stand an arm's reach apart, so a game must never ask them to run, step
   sideways or swing their arms at each other. Use arms up and down (the arm pump below), arms out (airplane),
   hands on head, reaching up, and the odd jump. Throws go **up and over**, never sideways.
3. **The youngest player is 4.** No aiming (the game picks the target), no reading, big slow things, generous
   hit boxes, and loud funny feedback for everything.
4. **Getting hit is a joke, never a loss.** Score for the thrower, the catcher, the wiper; never take points or
   hearts from the kid who was hit. Make the hit kid look silly (a carrot nose, a snow hat, a spin) instead.
5. **Everyone gets the same fun.** Share targets around (Snowball fight sends a throw to the next fort along).
   A kid alone plays against the monkey.

## Make a fort game

1. Copy a fort game, not `_template.js`: `snowball.js` shows throwing, catching and mud, `fly.js` shows lifting a
   kid's picture and things floating down each kid's own column.
2. Keep `forts: true` in the level object. That is all it takes for the engine to put everyone in forts.
3. Read the forts every frame with `forts(g)` from `kit.js`, in `update` and in `draw`. Use each fort's `hands`,
   `circles` and `head` for hit tests: they are already moved into the fort.
4. Register it like any level: `src/levels/index.js`, then add its id to the **Fort games** set in
   `src/levels/sets.js`, and a song in `SONGS` in `src/music.js`.
5. Play it with `?mouse&level=<id>`. Holding **Q** lifts the mouse kid's arms over their head, so tapping Q is an
   arm pump (a throw, a flap). Then try it with the camera: `?level=<id>`.

## What the engine does for you

`src/forts.js` lays the forts out and `main.js` draws through it:

- **Layout.** Forts are equal columns with a gap between them (`FORT.gap`, the no-man's-land snowballs fly over).
  At the start of a level, forts go left to right in the order the kids stand. Someone who joins later gets the
  next fort along, so nobody else's fort moves.
- **Never fewer than two forts** (`FORT.minForts`). A kid alone gets a spare fort for the level to fill: both
  games put [the monkey](#the-monkey-and-people-joining) there.
- **Each kid's slice.** The camera picture is cut halfway between neighbouring kids, and each slice is drawn in
  its kid's fort. Arms reaching into a neighbour's slice get clipped: that's fine.
- **Centring and scaling.** A fort follows its kid gently (`FORT.follow`, `FORT.sway`), and a kid who would not fit
  with arms out (`FORT.span` shoulder widths) is shrunk down to `FORT.minScale`. Kids are never made bigger.
- **Nothing pops.** A kid lost by tracking keeps an empty fort for `FORT.keep` seconds, and forts slide to a new
  layout (`FORT.slide`) rather than jumping.
- **Skeletons** are drawn in the forts too. Watchers (people who haven't joined) have no fort: they show faintly
  where they really stand with "Arms out to join!" over them.
- **Effects** a level can trigger on a kid's picture, from `kit.js`:

| Helper | What happens |
|---|---|
| `wobbleFort(g, p, amount?)` | The kid's picture wobbles like a jelly and settles (a hit). |
| `spinFort(g, p)` | The picture spins round once, fast then slowing (a big hit, a spin-out). |
| `liftFort(g, p, px)` | The picture is raised `px` above the floor (flying). 0 puts them back down. |

## The fort object

`forts(g)` returns this frame's forts, left to right (`Fort` in `src/forts.js`):

| Field | What it is |
|---|---|
| `p` | The player, or `null` for an empty fort |
| `id` | The player's id (also while their fort waits for them), or `-1` for a spare fort |
| `i` | Slot, 0 on the left |
| `x0`, `x1`, `cx` | The fort's edges and middle on screen |
| `hands`, `circles`, `head`, `sh` | The kid's hands, body circles, nose and shoulder middle, **in fort space** |
| `map(pt)` | Maps any landmark (`p.px[i]`) into fort space |
| `s` | The kid's scale in the fort (1 = as the camera sees them) |
| `lift`, `tilt` | How far the picture is raised, and how far it is tilted (wobble, spin) |

So a hit test looks like `f.hands.some((h) => Math.hypot(h.x - x, h.y - y) < r + 40 * g.u)`, and scoring uses the
player: `g.score(f.p, 1, x, y)`. Keep per-kid state keyed by `f.p.id`, and spare-fort state by `f.i`. Things that
fly between forts should remember their target by the fort's key (`f.id >= 0 ? 'p' + f.id : 's' + f.i`), not by
its position, because forts slide when someone joins.

## The throw: arm pumps

`ArmPumps` in `kit.js` is the fort games' throw (and flap): a hand that was **down by the side** (wrist below the
shoulders) goes **up over the head**. It only looks at where the wrist is, not how fast it moves, so it works at
10 tracked frames a second and on a 4-year-old. It is measured in shoulder widths with a gap between "down" and
"up", so a glitchy frame can't fire it.

```js
this.pumps = new ArmPumps(); // in start()
for (const { wrist, wound } of this.pumps.update(f.p, dt)) {
  // wrist: 15 (the kid's left hand) or 16 (right); wound: seconds the hand was down (a bigger snowball)
}
this.pumps.isDown(f.p, 15); // winding up: draw a snowball growing in that hand
```

Arms that are already up when the level starts don't fire: a kid has to lower an arm first.

## Things stuck on a kid

A splat, a hat or a carrot nose should wobble and spin with the kid. Draw them in the kid's own picture space:

```js
ctx.save();
applyFort(ctx, f, g.H, { slice: false }); // from ../forts.js: the picture's own transform
// now draw at the kid's own landmarks, sized in their shoulder widths:
carrot(ctx, f.p.px[0].x, f.p.px[0].y, f.p.shoulderW);
ctx.restore();
```

Everything else (snowballs in the air, walls, words) is drawn in plain screen space.

## The monkey, and people joining

`src/levels/monkey.js` draws a cheeky cartoon monkey (`drawMonkey(ctx, x, y, size, { t, arm, tilt, mud, splat,
wings, dizzy, look })`). It is the computer player: when a kid plays alone, the level puts it in the spare fort
(`f.id === -1`), and it plays along (throws snowballs back, flies after stars). It should be beatable and silly,
never better than the kid.

When someone joins, they take the spare fort and the monkey goes. Mid-game, a new person in view only watches
until they hold their arms out for 2 s (`lateJoin`, as in every level); then they are in `g.activePlayers()` and
the layout gives them a fort. More players, in the room or on a family call, add more forts.

## Family play

Guests' players have `remote: true` and come in with the guests' own cut-out picture, so the engine draws each
guest's slice from that picture into their fort. Their skeletons arrive 0.2 to 0.4 s late, which matters little
here: give remote players a bit more catching slack (Snowball fight adds 30u), and prefer things that take about a
second to arrive.

## Testing

- `test/unit/all-levels.test.js` plays every level, fort games included, with 0 to 4 pretend kids.
- `test/unit/forts.test.js` covers the layout (order, joining, dropouts, scaling), arm pumps, and the rules of both
  fort games. Add your game's rules there. A test player is built with `computeFeatures`, and hit tests go
  through the forts, so put hands in camera space and let the forts map them.
- `npm run test:e2e` plays every level in the browser and checks the performance on a slow laptop. Drawing a
  fort game costs one cut-out draw per fort.

## Ideas

- **Hot potato**: a fizzing bomb is passed fort to fort by arm pumps; whoever holds it at the bang gets soot.
- **Volley**: a beach ball floats between forts; reach up to bop it on.
- **Pie in the face**: reach up for a pie that floats over your fort and pump to throw it.
- **Team forts**: the home team against the grandparents' house on a family call.
