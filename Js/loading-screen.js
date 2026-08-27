/* =========================================================
   VORPEX NEXUS — BOOT / LOADING SCREEN CONTROLLER
   Runs first (loaded before main.js). Shows a game-style
   boot sequence, then fades out once the DOM + a minimum
   flourish time have both elapsed. Works the same on touch
   and pointer devices; respects prefers-reduced-motion.
   ========================================================= */
(function () {
    var screen = document.getElementById("bootScreen");
    if (!screen) return;

    var barFill = document.getElementById("bootBarFill");
    var statusEl = document.getElementById("bootStatus");
    var tipEl = document.getElementById("bootTip");
    var skipBtn = document.getElementById("bootSkip");

    var STEPS = [
        "Initializing system…",
        "Loading interface shell…",
        "Warming up the game library…",
        "Syncing local save data…",
        "Almost there…"
    ];

    var TIPS = [
        "Tip: Press Esc to exit a game at any time.",
        "Tip: Open Music Center from the top bar to play tab or file audio.",
        "Tip: Sign in to keep your profile handy across visits.",
        "Tip: You can customize your theme and accent color in Settings.",
        "Tip: Swipe or tap the menu icon to open navigation on mobile."
    ];

    document.body.classList.add("boot-active");

    var progress = 0;
    var domReady = document.readyState !== "loading";
    var minTimeElapsed = false;
    var stepIndex = 0;

    function setStatus() {
        if (statusEl) statusEl.textContent = STEPS[stepIndex % STEPS.length];
        if (tipEl) tipEl.textContent = TIPS[stepIndex % TIPS.length];
        stepIndex++;
    }
    setStatus();
    var statusTimer = setInterval(setStatus, 650);

    function setProgress(pct) {
        progress = Math.max(progress, Math.min(100, pct));
        if (barFill) barFill.style.width = progress + "%";
    }

    // Simulated progress so the bar always feels alive, capped at 90%
    // until we actually know the page is ready.
    var tick = setInterval(function () {
        var next = progress + (progress < 60 ? 6 : progress < 85 ? 2 : 0.5);
        setProgress(Math.min(90, next));
    }, 120);

    function tryHide() {
        if (!domReady || !minTimeElapsed) return;
        clearInterval(tick);
        clearInterval(statusTimer);
        setProgress(100);
        if (statusEl) statusEl.textContent = "Ready.";
        setTimeout(hideBootScreen, 260);
    }

    function hideBootScreen() {
        if (!screen || screen.dataset.hidden) return;
        screen.dataset.hidden = "1";
        screen.classList.add("boot-hidden");
        document.body.classList.remove("boot-active");
        screen.setAttribute("aria-hidden", "true");
        setTimeout(function () {
            if (screen && screen.parentNode) screen.parentNode.removeChild(screen);
        }, 550);
    }

    document.addEventListener("DOMContentLoaded", function () {
        domReady = true;
        tryHide();
    });
    if (document.readyState !== "loading") {
        domReady = true;
    }

    window.addEventListener("load", function () {
        domReady = true;
        tryHide();
    });

    // Minimum time the boot screen stays up so it reads as an
    // intentional boot sequence rather than a flicker — shorter
    // if the user has asked for reduced motion.
    var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(function () {
        minTimeElapsed = true;
        tryHide();
    }, prefersReduced ? 300 : 1600);

    if (skipBtn) {
        skipBtn.addEventListener("click", function () {
            minTimeElapsed = true;
            domReady = true;
            tryHide();
        });
    }

    // Safety net: never block the app for more than 6s no matter what.
    setTimeout(function () {
        domReady = true;
        minTimeElapsed = true;
        tryHide();
    }, 6000);
})();
