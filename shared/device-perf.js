// Shared resolution/DPR cap for anything doing GPU rendering (the Pixi
// stage, any self-contained effect's own resize()). Two independent risks,
// one function: mobile/tablet screens are small enough that rendering at
// the full device pixel ratio (often 2-3) costs real fill-rate for no
// visible gain, so touch/narrow-viewport devices get capped lower than
// desktop; separately, very large and/or high-DPI desktop monitors (4K/5K+)
// can drive the backing store's *absolute* pixel count far higher than the
// viewport-width check alone would ever catch, so the result is also capped
// so the longest side of the rendered canvas never exceeds maxLongestSide
// regardless of how big or dense the display is (this used to be a
// one-off hardcoded clamp inside UI/holographic/script.js's own resize();
// moved here so every consumer gets it for free instead of each effect
// needing to remember to add its own copy).
(function () {
  function getPerfResolutionCap(maxDesktop, maxLongestSide) {
    maxDesktop = maxDesktop || 2;
    maxLongestSide = maxLongestSide || 2600;
    // `navigator.maxTouchPoints` is unreliable here — plenty of ordinary
    // touchscreen laptops report it even when used as a full desktop, so it
    // can't tell "phone/tablet" apart from "desktop with a touchscreen".
    // Viewport width is a more honest proxy for how much benefit extra
    // resolution actually buys (phones/tablets rarely exceed ~1024 CSS px
    // even in landscape).
    const viewportCap = window.innerWidth <= 1024 ? Math.min(maxDesktop, 1.5) : maxDesktop;
    let scale = Math.min(window.devicePixelRatio || 1, viewportCap);
    const longest = Math.max(window.innerWidth, window.innerHeight) * scale;
    if (longest > maxLongestSide) scale *= maxLongestSide / longest;
    return scale;
  }
  window.getPerfResolutionCap = getPerfResolutionCap;
})();
