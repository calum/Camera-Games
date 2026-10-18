// Guards against a real mishap: editing files with a tool that re-saves UTF-8 as Windows-1252
// turns symbols like the tick and the star into several junk characters and adds a byte-order
// mark. The game still runs, so nothing else would notice until it showed up on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirs = ['src', 'test', 'docs', 'assets'];
const top = ['server.mjs', 'README.md', 'package.json', 'index.html', 'start.bat'];

function files() {
  const out = top.map((f) => path.join(root, f));
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs|md|json|html|bat)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return out.filter((f) => fs.existsSync(f));
}

// Mangled UTF-8 starts with a lead byte (0xE2, 0xC3 or 0xF0) shown as a Latin letter, followed by a
// character from the Windows-1252 "high" range. Everything is written as numbers so that this file
// never contains the junk it is looking for.
const LEAD = new Set([0xe2, 0xc3, 0xf0]);
const CP1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
function looksMangled(text) {
  for (let i = 0; i < text.length - 1; i++) {
    if (!LEAD.has(text.charCodeAt(i))) continue;
    const next = text.charCodeAt(i + 1);
    if ((next >= 0x80 && next <= 0xbf) || CP1252_EXTRA.has(next)) return true;
  }
  return false;
}

test('the mangled-text detector works', () => {
  const good = '✓ ★ café'; // tick, star, e-acute: fine
  assert.equal(looksMangled(good), false);
  const bad = Buffer.from(good, 'utf8').toString('latin1'); // what a bad re-save does to it
  assert.equal(looksMangled(bad), true);
});

test('no source file has a byte-order mark', () => {
  const bad = files().filter((f) => {
    const b = fs.readFileSync(f);
    return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  });
  assert.deepEqual(bad.map((f) => path.relative(root, f)), []);
});

test('no source file contains mangled UTF-8 (mojibake)', () => {
  const bad = files().filter((f) => looksMangled(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => path.relative(root, f)), []);
});

test('the on-screen symbols are intact', () => {
  const levels = fs.readFileSync(path.join(root, 'src/levels.js'), 'utf8');
  assert.ok(levels.includes('✓ NICE JUMP!') && levels.includes('✗ SPLASH!') && levels.includes('→'));
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.ok(main.includes('✓ IN') && main.includes('★') && main.includes('\u{1F451}'));
});
