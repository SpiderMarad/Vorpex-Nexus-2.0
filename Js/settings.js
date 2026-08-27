/* =========================================================
   VORPEX NEXUS — SETTINGS: THEME / ACCENT / GLASS QUALITY
   These controls existed in index.html but nothing in the
   original codebase listened for clicks on them, and no light
   theme existed to switch to. This file makes them real.
   Persists to the same localStorage the rest of the app uses.
   ========================================================= */
(function () {
    var KEY = "vorpex-nexus-appearance-v1";

    function loadAppearance() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return { theme: "dark", accent: "#00c8ff", glass: "medium" };
            var parsed = JSON.parse(raw);
            return {
                theme: parsed.theme || "dark",
                accent: parsed.accent || "#00c8ff",
                glass: parsed.glass || "medium",
            };
        } catch (e) {
            return { theme: "dark", accent: "#00c8ff", glass: "medium" };
        }
    }

    function saveAppearance(a) {
        try {
            localStorage.setItem(KEY, JSON.stringify(a));
        } catch (e) { /* storage unavailable — non-fatal */ }
    }

    var appearance = loadAppearance();
    var systemDarkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    function resolveTheme() {
        if (appearance.theme === "system") {
            return systemDarkQuery && !systemDarkQuery.matches ? "light" : "dark";
        }
        return appearance.theme;
    }

    function applyAppearance() {
        var resolved = resolveTheme();
        document.body.classList.toggle("theme-light", resolved === "light");

        document.body.classList.remove("glass-low", "glass-medium", "glass-high");
        document.body.classList.add("glass-" + appearance.glass);

        document.documentElement.style.setProperty("--vn-accent", appearance.accent);
        // Derive a soft/translucent version of the accent for backgrounds.
        var soft = hexToRgba(appearance.accent, 0.14);
        if (soft) {
            document.documentElement.style.setProperty("--vn-accent-shoft", soft);
            document.documentElement.style.setProperty("--vn-accent-soft", soft);
        }

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", resolved === "light" ? "#eef1f6" : "#07090f");
    }

    function hexToRgba(hex, alpha) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return null;
        var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
        return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    }

    function syncControls() {
        document.querySelectorAll("#themeControl [data-theme]").forEach(function (btn) {
            btn.classList.toggle("active", btn.dataset.theme === appearance.theme);
        });
        document.querySelectorAll(".accent-picker [data-accent]").forEach(function (btn) {
            btn.classList.toggle("active", btn.dataset.accent.toLowerCase() === appearance.accent.toLowerCase());
        });
        var customAccent = document.getElementById("customAccent");
        if (customAccent) customAccent.value = appearance.accent;
        document.querySelectorAll("[data-glass-quality]").forEach(function (btn) {
            btn.classList.toggle("active", btn.dataset.glassQuality === appearance.glass);
        });
    }

    function init() {
        applyAppearance();
        syncControls();

        document.querySelectorAll("#themeControl [data-theme]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                appearance.theme = btn.dataset.theme;
                saveAppearance(appearance);
                applyAppearance();
                syncControls();
            });
        });

        document.querySelectorAll(".accent-picker [data-accent]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                appearance.accent = btn.dataset.accent;
                saveAppearance(appearance);
                applyAppearance();
                syncControls();
            });
        });

        var customAccent = document.getElementById("customAccent");
        if (customAccent) {
            customAccent.addEventListener("input", function () {
                appearance.accent = customAccent.value;
                saveAppearance(appearance);
                applyAppearance();
                syncControls();
            });
        }

        document.querySelectorAll("[data-glass-quality]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                appearance.glass = btn.dataset.glassQuality;
                saveAppearance(appearance);
                applyAppearance();
                syncControls();
            });
        });

        if (systemDarkQuery) {
            var onSystemChange = function () {
                if (appearance.theme === "system") applyAppearance();
            };
            if (systemDarkQuery.addEventListener) systemDarkQuery.addEventListener("change", onSystemChange);
            else if (systemDarkQuery.addListener) systemDarkQuery.addListener(onSystemChange);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
