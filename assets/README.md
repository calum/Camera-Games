# Your art goes here

Drop PNG files (transparent background works best, square is easiest) in this folder
with these exact names. Any that are missing use the built-in placeholder.

| File | Used for | Drawn size |
|---|---|---|
| `bubble.png` | normal bubble (level 1) | about 110-180 px, scaled |
| `goldbubble.png` | gold bubble worth 3 | same |
| `rock.png` | falling rock (level 2) | about 100-150 px |
| `star.png` | score star in the corner | about 64 px |
| `heart.png` | hearts (level 2) | small |
| `hand.png` | replaces the white dot on each hand | about 70 px |
| `bg_menu.png` | whole-screen backdrop for the menu | any size, 16:9 is best (cropped to fit) |
| `bg_bubbles.png` `bg_dodge.png` `bg_jump.png` `bg_dance.png` | backdrop for each level | same |
| `bg_finale.png` | backdrop for the finale | same |

Refresh the page after adding files. To add a new art slot, declare it in the level
(`art: { name: { file: 'name.png', emoji: '...' } }`, see [docs/ADDING-GAMES.md](../docs/ADDING-GAMES.md)) or add
one line to `DEFS` in `src/art.js`, and call `drawArt(ctx, 'name', x, y, size)` from the level.
