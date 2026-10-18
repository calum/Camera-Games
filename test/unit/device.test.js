import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobile, defaultSettings } from '../../src/device.js';

const LAPTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', maxTouchPoints: 0 };
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', maxTouchPoints: 5 };
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 };
const MAC = { ...IPAD, maxTouchPoints: 0 };

test('phones and tablets (including iPads posing as Macs) are mobile; laptops are not', () => {
  assert.equal(isMobile(LAPTOP), false);
  assert.equal(isMobile(MAC), false);
  assert.equal(isMobile(ANDROID), true);
  assert.equal(isMobile(IPAD), true);
  assert.equal(isMobile({ userAgent: '', userAgentData: { mobile: true } }), true);
});

test('a laptop starts at the best quality with effects; a phone starts lighter', () => {
  const p = new URLSearchParams('');
  assert.deepEqual(defaultSettings(p, LAPTOP), { mobile: false, startQuality: 'high', fx: true, fxPinned: false, worker: true });
  assert.deepEqual(defaultSettings(p, ANDROID), { mobile: true, startQuality: 'medium', fx: false, fxPinned: false, worker: true });
});

test('URL options win over the device defaults', () => {
  assert.equal(defaultSettings(new URLSearchParams('lite'), LAPTOP).fx, false);
  assert.equal(defaultSettings(new URLSearchParams('fx'), ANDROID).fx, true);
  assert.equal(defaultSettings(new URLSearchParams('worker=off'), LAPTOP).worker, false);
});
