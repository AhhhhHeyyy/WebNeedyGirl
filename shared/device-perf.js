// Shared resolution/DPR cap for anything doing GPU rendering (the Pixi
// stage, any self-contained effect's own resize()). Mobile/tablet screens
// are small enough that rendering at the full device pixel ratio (often
// 2-3) costs real fill-rate for no visible gain, so touch/narrow-viewport
// devices get capped lower than desktop.
(function () {
  function getPerfResolutionCap(maxDesktop) {
    maxDesktop = maxDesktop || 2;
    // `navigator.maxTouchPoints` is unreliable here — plenty of ordinary
    // touchscreen laptops report it even when used as a full desktop, so it
    // can't tell "phone/tablet" apart from "desktop with a touchscreen".
    // Viewport width is a more honest proxy for how much benefit extra
    // resolution actually buys (phones/tablets rarely exceed ~1024 CSS px
    // even in landscape).
    const cap = window.innerWidth <= 1024 ? Math.min(maxDesktop, 1.5) : maxDesktop;
    return Math.min(window.devicePixelRatio || 1, cap);
  }
  window.getPerfResolutionCap = getPerfResolutionCap;
})();
