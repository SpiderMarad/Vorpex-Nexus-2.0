/* ==========================================================================
   VORPEX NEXUS — LAUNCHER AUDIO LINK (Module 2)
   Makes the rest of the launcher feel connected to the Music Center:
     bass   -> background glow brightness
     treble -> particle field scale/energy
     mid    -> hero liquid-glass glow
     volume -> glass blur intensity

   This module does NOT run its own render loop. It listens for the single
   "vorpex:audioframe" CustomEvent dispatched once per frame by visualizer.js
   (which only runs while the Music Center is open), and writes CSS custom
   properties onto <body>. All consuming CSS rules default the variables to
   0, so with the Music Center closed or no audio connected, the launcher's
   appearance is byte-for-byte identical to Module 1.

   Respects the existing "Animations" setting (body.no-animations): when
   animations are disabled, this module still listens but writes 0 so
   nothing moves, matching the rest of the launcher's reduced-motion story.
   ========================================================================== */

(function () {
    if (window.VorpexLauncherLink) return;

    const root = document.body;

    function reduceMotion() {
        return root.classList.contains("no-animations");
    }

    function applyBands(bands) {
        const b = reduceMotion() ? { bass: 0, mid: 0, treble: 0, vol: 0 } : bands;
        root.style.setProperty("--vorpex-bass", String(b.bass ?? 0));
        root.style.setProperty("--vorpex-mid", String(b.mid ?? 0));
        root.style.setProperty("--vorpex-treble", String(b.treble ?? 0));
        root.style.setProperty("--vorpex-vol", String(b.vol ?? 0));
    }

    function reset() {
        applyBands({ bass: 0, mid: 0, treble: 0, vol: 0 });
    }

    document.addEventListener("vorpex:audioframe", (e) => applyBands(e.detail || {}));

    // Start neutral so nothing shifts before the first frame arrives.
    reset();

    window.VorpexLauncherLink = { reset };
})();
