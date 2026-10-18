// Art loader. Drop your own PNGs into /assets with the file names below and they
// replace the built-in graphics automatically (see assets/README.md).
// Anything missing falls back to an emoji or a procedural drawing.
const DEFS = {
  bubble: { file: 'bubble.png' },
  goldbubble: { file: 'goldbubble.png' },
  rock: { file: 'rock.png', emoji: '🪨' },
  star: { file: 'star.png', emoji: '⭐' },
  heart: { file: 'heart.png' },
  hand: { file: 'hand.png' },
  // full-screen backgrounds (any missing one uses the built-in cartoon scene)
  bg_menu: { file: 'bg_menu.png' },
  bg_bubbles: { file: 'bg_bubbles.png' },
  bg_dodge: { file: 'bg_dodge.png' },
  bg_jump: { file: 'bg_jump.png' },
  bg_dance: { file: 'bg_dance.png' },
  bg_finale: { file: 'bg_finale.png' },
};

const imgs = {};

// A level can bring its own art slots (level.art = { name: { file, emoji } }); main.js registers them
// before loadArt(). Existing names are left alone, so a level can't break another level's art.
export function registerArt(defs) {
  for (const [name, def] of Object.entries(defs)) DEFS[name] ??= { ...def };
}

export function loadArt() {
  for (const [name, def] of Object.entries(DEFS)) {
    const img = new Image();
    img.onload = () => (def.ok = true);
    img.onerror = () => (def.ok = false);
    img.src = new URL(`../assets/${def.file}`, import.meta.url).href; // relative: works under any site path (GitHub Pages)
    imgs[name] = img;
  }
}

// Fill the whole canvas with a custom background image (cropped to fit, never stretched).
// Returns false if there is no such image, so the caller draws its built-in scene.
export function drawCover(ctx, name, W, H) {
  const def = DEFS[name];
  if (!def?.ok) return false;
  const img = imgs[name];
  const s = Math.max(W / img.width, H / img.height);
  ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  return true;
}

// Returns true if something was drawn, false if the caller should draw its own fallback.
export function drawArt(ctx, name, x, y, size, rot = 0) {
  const def = DEFS[name];
  if (!def) return false;
  if (def.ok) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(imgs[name], -size / 2, -size / 2, size, size);
    ctx.restore();
    return true;
  }
  if (def.emoji) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${size * 0.85}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(def.emoji, 0, 0);
    ctx.restore();
    return true;
  }
  return false;
}
