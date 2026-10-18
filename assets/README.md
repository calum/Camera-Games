# Your art goes here

Drop PNG files (transparent background works best, square is easiest) in this folder
with these exact names. Any that are missing use the built-in placeholder.

| File | Used for | Drawn size |
|---|---|---|
| `bubble.png` | normal bubble (Pop the bubbles) | about 110-180 px, scaled |
| `goldbubble.png` | gold bubble worth 3 | same |
| `rock.png` | falling rock (Dodge the rocks, Avalanche) | about 100-150 px |
| `star.png` | score star in the corner | about 64 px |
| `heart.png` | the team's hearts (Dodge, Avalanche, Catch the stars) | small |
| `hand.png` | replaces the white dot on each hand | about 70 px |
| `bg_menu.png` | whole-screen backdrop for the menu | any size, 16:9 is best (cropped to fit) |
| `bg_bubbles.png` `bg_dodge.png` `bg_jump.png` `bg_dance.png` | backdrop for those scenes (`bg_jump` also covers Duck and jump, `bg_dance` also Freeze!) | same |
| `bg_finale.png` | the fireworks scene (not used by any level at the moment) | same |

The newer levels (Dig down, Avalanche, Hole in the wall, Catch the stars, Keep it up) draw their own scenes, which
can't be replaced by a file yet: the level would first need a `bg_<id>` art slot (see below).

Refresh the page after adding files. To add a new art slot, declare it in the level
(`art: { name: { file: 'name.png', emoji: '...' } }`, see [docs/ADDING-GAMES.md](../docs/ADDING-GAMES.md)) or add
one line to `DEFS` in `src/art.js`, and call `drawArt(ctx, 'name', x, y, size)` from the level.
