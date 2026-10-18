// What kind of device the game is running on, to pick sensible defaults. Pure: pass in `navigator`.

/**
 * True for phones and tablets (including iPads, which say they are Macs but have a touch screen).
 * @param {{ userAgent?: string, maxTouchPoints?: number, userAgentData?: { mobile?: boolean } }} nav
 */
export function isMobile(nav) {
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1; // iPadOS desktop-mode Safari
}

/**
 * Starting settings. Phones and tablets start one rung down the tracking quality ladder (the lite model)
 * and without glow effects; laptops start at the top and step down by themselves if they are slow.
 * Explicit URL options always win.
 * @param {URLSearchParams} params
 * @param {Parameters<typeof isMobile>[0]} nav
 */
export function defaultSettings(params, nav) {
  const mobile = isMobile(nav);
  return {
    mobile,
    startQuality: mobile ? 'medium' : 'high',
    fx: params.has('lite') ? false : params.has('fx') ? true : !mobile,
    fxPinned: params.has('lite') || params.has('fx'),
    worker: params.get('worker') !== 'off',
  };
}
