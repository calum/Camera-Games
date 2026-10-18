// A person's "look": the average colour of their top and of their legs, from a tiny copy of the camera
// picture. Six numbers in 0..1, enough to tell a red T-shirt from a blue one so a kid who steps out of
// view and comes back is recognised (people.js). Pure maths so it can be unit tested.

/**
 * @param {Uint8ClampedArray | Uint8Array} rgba  pixels of a small copy of the camera frame (w x h)
 * @param {number} w
 * @param {number} h
 * @param {{ x: number, y: number }[]} lm  the 33 pose landmarks in NORMALISED camera coordinates (0..1)
 * @returns {number[] | null}  [topR, topG, topB, legR, legG, legB] in 0..1, or null if the body is off-picture
 */
export function lookOf(rgba, w, h, lm) {
  const top = meanColour(rgba, w, h, [lm[11], lm[12], lm[24], lm[23]]);
  const legs = meanColour(rgba, w, h, [lm[23], lm[24], lm[26], lm[25]]);
  if (!top || !legs) return null;
  return [...top, ...legs];
}

// Mean colour inside the quad's bounding box, shrunk a little so the background round the edges is left out.
function meanColour(rgba, w, h, quad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of quad) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const mx = (x1 - x0) * 0.2;
  const my = (y1 - y0) * 0.2;
  const ax = Math.max(0, Math.round((x0 + mx) * w));
  const bx = Math.min(w - 1, Math.round((x1 - mx) * w));
  const ay = Math.max(0, Math.round((y0 + my) * h));
  const by = Math.min(h - 1, Math.round((y1 - my) * h));
  if (bx < ax || by < ay) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++, n++) {
      const i = (y * w + x) * 4;
      r += rgba[i];
      g += rgba[i + 1];
      b += rgba[i + 2];
    }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
}
