function updateClock() {
    const clock = document.getElementById("clock");
    if (!clock) return;
    clock.textContent = new Date().toLocaleTimeString();
}

const VORPEX_STORAGE_KEY = "vorpex-nexus-state-v3";
const DEFAULT_STATE = {
    xp: 0,
    playTime: 0,
    gamesPlayed: 0,
    lastGame: "WEB RUNNER",
    achievements: [],
    settings: {
        particles: true,
        liquid: true,
        refraction: true,
        animations: true,
    },
};

function loadState() {
    try {
        const raw = localStorage.getItem(VORPEX_STORAGE_KEY);
        if (!raw) return structuredClone(DEFAULT_STATE);
        const parsed = JSON.parse(raw);
        return {
            ...structuredClone(DEFAULT_STATE),
            ...parsed,
            settings: { ...structuredClone(DEFAULT_STATE.settings), ...(parsed.settings || {}) },
            achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
        };
    } catch {
        return structuredClone(DEFAULT_STATE);
    }
}

function saveState() {
    localStorage.setItem(VORPEX_STORAGE_KEY, JSON.stringify(state));
}

function formatPlayTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function computeLevel(xp) {
    return Math.max(1, Math.floor(xp / 250) + 1);
}

function showToast(title, body = "") {
    let host = document.getElementById("toastHost");
    if (!host) {
        host = document.createElement("div");
        host.id = "toastHost";
        document.body.appendChild(host);
    }

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<strong>${title}</strong>${body ? `<span>${body}</span>` : ""}`;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 260);
    }, 2200);
}

let state = loadState();
let sessionStartedAt = 0;
let currentGameSrc = "";
let currentGameTitle = "WEB RUNNER";
let currentGameKey = "";
let gameLoadTimer = null;
let loaderShownAt = 0;

function updateDashboard() {
    const cards = document.querySelectorAll(".dashboard .card");
    if (!cards.length) return;
    const level = computeLevel(state.xp);
    const installedGames = new Set(Array.from(document.querySelectorAll("[data-game-src]"), (el) => el.dataset.gameSrc)).size;
    const values = [
        String(installedGames),
        String(level),
        String(state.xp),
        formatPlayTime(state.playTime),
    ];
    cards.forEach((card, i) => {
        const h1 = card.querySelector("h1");
        if (h1 && values[i] !== undefined) h1.textContent = values[i];
    });
}

function applySettings() {
    document.body.classList.toggle("no-particles", !state.settings.particles);
    document.body.classList.toggle("no-liquid", !state.settings.liquid);
    document.body.classList.toggle("no-refraction", !state.settings.refraction)
    document.body.classList.toggle("no-animations", !state.settings.animations);

    const particles = document.getElementById("particles");
    if (particles) particles.style.display = state.settings.particles ? "block" : "none";

    const liq = document.getElementById("hero");
    if (liq) liq.classList.toggle("liquid-off", !state.settings.liquid);

    const p = document.getElementById("toggleParticles");
    const l = document.getElementById("toggleLiquid");
    const r = document.getElementById("toggleRefraction");
    const a = document.getElementById("toggleAnimations");
    if (p) p.checked = !!state.settings.particles;
    if (l) l.checked = !!state.settings.liquid;
    if (r) r.checked = !!state.settings.refraction;
    if (a) a.checked = !!state.settings.animations;
}

function markAchievement(id, title, body) {
    if (state.achievements.includes(id)) return;
    state.achievements.push(id);
    saveState();
    showToast(`🏆 ${title}`, body);
}

function bumpProgressOnLaunch(title) {
    state.gamesPlayed += 1;
    state.lastGame = title || state.lastGame;
    state.xp += 10;
    sessionStartedAt = Date.now();
    if (title === "WEB RUNNER") markAchievement("first-run", "Achievement Unlocked", "First launch of Web Runner");
    if (state.gamesPlayed === 1) markAchievement("first-launch", "Achievement Unlocked", "Launched your first game");
    saveState();
    updateDashboard();
}

function finishGameSession() {
    if (!sessionStartedAt) return;
    const elapsed = Math.max(0, Math.round((Date.now() - sessionStartedAt) / 1000));
    state.playTime += elapsed;
    state.xp += Math.max(1, Math.min(25, Math.round(elapsed / 8)));
    sessionStartedAt = 0;
    if (state.playTime >= 600) markAchievement("ten-minutes", "Achievement Unlocked", "Played for 10 minutes");
    saveState();
    updateDashboard();
}

function initVorpex() {
    updateClock();
    if (!window.__vorpexClockStarted) {
        window.__vorpexClockStarted = true;
        setInterval(updateClock, 1000);
    }

    updateDashboard();
    applySettings();

    const hero = document.getElementById("hero");
    if (hero && !hero.dataset.boundMouse) {
        hero.dataset.boundMouse = "1";
        hero.addEventListener("mousemove", (e) => {
            const rect = hero.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            hero.style.setProperty("--x", x + "px");
            hero.style.setProperty("--y", y + "px");
        });
    }

    const particles = document.getElementById("particles");
    if (particles && !particles.dataset.built) {
        particles.dataset.built = "1";
        for (let i = 0; i < 30; i++) {
            const p = document.createElement("div");
            p.className = "particle";
            p.style.left = Math.random() * 100 + "%";
            p.style.animationDuration = (8 + Math.random() * 8) + "s";
            p.style.animationDelay = Math.random() * 8 + "s";
            p.style.opacity = String(0.25 + Math.random() * 0.55);
            particles.appendChild(p);
        }
    }

    const overlay = document.getElementById("gameOverlay");
    const frame = document.getElementById("gameFrame");
    const gameTitle = document.getElementById("gameTitle");
    const loader = document.getElementById("gameLoader");
    const loaderText = document.getElementById("loaderText");
    const libraryBtn = document.querySelector(".library-btn");
    const exitBtn = document.getElementById("exitGame");
    const restartBtn = document.getElementById("restartGame");
    const sidebarLinks = document.querySelectorAll(".sidebar a");
    const settings = {
        particles: document.getElementById("toggleParticles"),
        liquid: document.getElementById("toggleLiquid"),
        animations: document.getElementById("toggleAnimations"),
        reset: document.getElementById("resetProgress"),
    };

    const openGame = (src, title) => {
        if (!overlay || !frame) return;
        currentGameSrc = src;
        currentGameTitle = title || "GAME";
        currentGameKey = src;
        if (gameTitle) gameTitle.textContent = currentGameTitle;

        overlay.style.display = "flex";
        if (loader) loader.classList.remove("hidden");
        if (frame) frame.style.visibility = "hidden";
        if (loaderText) loaderText.textContent = `Launching ${currentGameTitle}…`;
        loaderShownAt = Date.now();
        bumpProgressOnLaunch(currentGameTitle);
        frame.src = `${currentGameSrc}?v=${Date.now()}`;
    };

    const closeGame = () => {
        if (!overlay || !frame) return;
        finishGameSession();
        overlay.style.display = "none";
        frame.src = "about:blank";
        window.clearTimeout(gameLoadTimer);
        currentGameSrc = "";
        currentGameTitle = "WEB RUNNER";
        currentGameKey = "";
        if (loader) loader.classList.remove("hidden");
        if (frame) frame.style.visibility = "hidden";
    };

    const restartGame = () => {
        if (!frame || !currentGameSrc) return;
        if (loader) loader.classList.remove("hidden");
        if (frame) frame.style.visibility = "hidden";
        frame.src = "about:blank";
        window.clearTimeout(gameLoadTimer);
        gameLoadTimer = window.setTimeout(() => {
            frame.src = `${currentGameSrc}?v=${Date.now()}`;
        }, 80);
    };

    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-game-src]");
        if (!btn) return;
        e.preventDefault();
        openGame(btn.dataset.gameSrc, btn.dataset.gameTitle);
    });

    if (libraryBtn) {
        libraryBtn.addEventListener("click", (e) => {
            e.preventDefault();
            document.querySelector(".featured-games")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    if (exitBtn) exitBtn.addEventListener("click", closeGame);
    if (restartBtn) restartBtn.addEventListener("click", restartGame);

    if (frame && !frame.dataset.boundLoad) {
        frame.dataset.boundLoad = "1";
        frame.addEventListener("load", () => {
            if (!overlay || overlay.style.display !== "flex") return;
            if (!currentGameSrc || frame.src === "about:blank") return;
            const minDelay = 120;
            const elapsed = Date.now() - loaderShownAt;
            const reveal = () => {
                if (loader) loader.classList.add("hidden");
                frame.style.visibility = "visible";
            };
            if (elapsed < minDelay) {
                window.setTimeout(reveal, minDelay - elapsed);
            } else {
                reveal();
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay && overlay.style.display === "flex") closeGame();
        if (e.key === "Enter" && document.activeElement && document.activeElement.classList.contains("play-btn")) {
            document.activeElement.click();
        }
    });

    const sectionTargets = [
        () => window.scrollTo({ top: 0, behavior: "smooth" }),
        () => document.querySelector(".featured-games")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        () => document.querySelector(".dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        () => document.getElementById("hero")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        () => document.getElementById("settings")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    ];

    sidebarLinks.forEach((link, index) => {
        if (link.dataset.boundNav) return;
        link.dataset.boundNav = "1";
        link.addEventListener("click", (e) => {
            e.preventDefault();
            sidebarLinks.forEach((a) => a.classList.remove("active"));
            link.classList.add("active");
            const action = sectionTargets[index];
            if (action) action();
        });
    });

    if (settings.particles) {
        settings.particles.addEventListener("change", () => {
            state.settings.particles = settings.particles.checked;
            applySettings();
            saveState();
        });
    }
    if (settings.liquid) {
        settings.liquid.addEventListener("change", () => {
            state.settings.liquid = settings.liquid.checked;
            applySettings();
            saveState();
        });
    }
    if (settings.refraction) {
        settings.refraction.addEventListener("change", () => {
            state.settings.refraction = settings.refraction.checked;
            applySettings();
            saveState();
        });
    }    
    if (settings.animations) {
        settings.animations.addEventListener("change", () => {
            state.settings.animations = settings.animations.checked;
            applySettings();
            saveState();
        });
    }
    if (settings.reset && !settings.reset.dataset.bound) {
        settings.reset.dataset.bound = "1";
        settings.reset.addEventListener("click", () => {
            if (!confirm("Reset Vorpex Nexus progress?")) return;
            state = structuredClone(DEFAULT_STATE);
            saveState();
            applySettings();
            updateDashboard();
            showToast("Progress reset", "All local launcher data has been cleared.");
        });
    }

    updateDashboard();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVorpex);
} else {
    initVorpex();
}

document.addEventListener("pointermove",
    e => {
        const x = e.clientX / window.innerWidth * 100;
        const y = e.clientY / window.innerHeight * 100;
        document.documentElement.style.setProperty("--gx", `${x}%`);
        document.documentElement.style.setProperty("--gy", `${y}%`);
    }
);

/* =========================================================
   VORPEX NEXUS — WALLPAPER ENGINE
   ========================================================= */

const WALLPAPER_KEY = "vorpex-nexus-wallpaper-v2";

const wallpaperState = {
    image: "",
    blur: 6,
    brightness: 100,
    overlay: 42
};


/* =========================================================
   LOAD / SAVE
   ========================================================= */

function loadWallpaperState() {
    try {
        const raw = localStorage.getItem(WALLPAPER_KEY);

        if (!raw) return;

        const saved = JSON.parse(raw);

        wallpaperState.image = saved.image || "";
        wallpaperState.blur =
            Number.isFinite(saved.blur) ? saved.blur : 6;

        wallpaperState.brightness =
            Number.isFinite(saved.brightness)
                ? saved.brightness
                : 100;

        wallpaperState.overlay =
            Number.isFinite(saved.overlay)
                ? saved.overlay
                : 42;

    } catch (error) {
        console.warn("Could not load wallpaper settings:", error);
    }
}


function saveWallpaperState() {
    try {
        localStorage.setItem(
            WALLPAPER_KEY,
            JSON.stringify(wallpaperState)
        );
    } catch (error) {
        console.warn("Could not save wallpaper settings:", error);
    }
}


/* =========================================================
   APPLY WALLPAPER
   ========================================================= */

function applyWallpaper() {

    const background =
        document.getElementById("backgroundLayer");

    const preview =
        document.getElementById("wallpaperPreview");

    if (!background) return;


    if (wallpaperState.image) {

        background.style.backgroundImage =
            `url("${wallpaperState.image}")`;

        document.body.classList.add("has-wallpaper");

        if (preview) {
            preview.style.backgroundImage =
                `url("${wallpaperState.image}")`;
        }

    } else {

        background.style.backgroundImage = "";

        document.body.classList.remove("has-wallpaper");

        if (preview) {
            preview.style.backgroundImage = "";
        }
    }


    /* Wallpaper effects */

    background.style.setProperty(
        "--wallpaper-blur",
        `${wallpaperState.blur}px`
    );

    background.style.setProperty(
        "--wallpaper-brightness",
        `${wallpaperState.brightness}%`
    );

    background.style.setProperty(
        "--wallpaper-overlay",
        `${wallpaperState.overlay / 100}`
    );
}


/* =========================================================
   CHOOSE IMAGE
   ========================================================= */

const wallpaperInput =
    document.getElementById("wallpaperInput");

if (wallpaperInput) {

    wallpaperInput.addEventListener("change", event => {

        const file = event.target.files?.[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            event.target.value = "";
            return;
        }


        const reader = new FileReader();

        reader.onload = () => {

            wallpaperState.image = reader.result;

            saveWallpaperState();
            applyWallpaper();

        };

        reader.readAsDataURL(file);
    });
}


/* =========================================================
   REMOVE WALLPAPER
   ========================================================= */

const removeWallpaperButton =
    document.getElementById("removeWallpaper");

if (removeWallpaperButton) {

    removeWallpaperButton.addEventListener("click", () => {

        wallpaperState.image = "";

        saveWallpaperState();
        applyWallpaper();

        if (wallpaperInput) {
            wallpaperInput.value = "";
        }

    });
}


/* =========================================================
   WALLPAPER EFFECTS
   ========================================================= */

const wallpaperBlur =
    document.getElementById("wallpaperBlur");

const wallpaperBrightness =
    document.getElementById("wallpaperBrightness");

const wallpaperOverlay =
    document.getElementById("wallpaperOverlay");


if (wallpaperBlur) {

    wallpaperBlur.value = wallpaperState.blur;

    wallpaperBlur.addEventListener("input", () => {

        wallpaperState.blur =
            Number(wallpaperBlur.value);

        saveWallpaperState();
        applyWallpaper();

    });
}


if (wallpaperBrightness) {

    wallpaperBrightness.value =
        wallpaperState.brightness;

    wallpaperBrightness.addEventListener("input", () => {

        wallpaperState.brightness =
            Number(wallpaperBrightness.value);

        saveWallpaperState();
        applyWallpaper();

    });
}


if (wallpaperOverlay) {

    wallpaperOverlay.value =
        wallpaperState.overlay;

    wallpaperOverlay.addEventListener("input", () => {

        wallpaperState.overlay =
            Number(wallpaperOverlay.value);

        saveWallpaperState();
        applyWallpaper();

    });
}


/* =========================================================
   INITIALIZE
   ========================================================= */

loadWallpaperState();
applyWallpaper();