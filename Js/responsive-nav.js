/* =========================================================
   VORPEX NEXUS — RESPONSIVE NAVIGATION
   Wires the hamburger button added for mobile/tablet layouts.
   Works with touch, mouse, and keyboard.
   ========================================================= */
(function () {
    function init() {
        var toggle = document.getElementById("sidebarToggle");
        var sidebar = document.getElementById("mainSidebar");
        var scrim = document.getElementById("sidebarScrim");
        if (!toggle || !sidebar || !scrim) return;

        function open() {
            sidebar.classList.add("sidebar-open");
            scrim.classList.add("show");
            toggle.setAttribute("aria-expanded", "true");
            document.body.style.overflow = "hidden";
        }

        function close() {
            sidebar.classList.remove("sidebar-open");
            scrim.classList.remove("show");
            toggle.setAttribute("aria-expanded", "false");
            document.body.style.overflow = "";
        }

        function toggleNav() {
            if (sidebar.classList.contains("sidebar-open")) close();
            else open();
        }

        toggle.addEventListener("click", toggleNav);
        scrim.addEventListener("click", close);

        // Close automatically after choosing a nav item on small screens
        sidebar.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", function () {
                if (window.matchMedia("(max-width: 900px)").matches) close();
            });
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") close();
        });

        // Keep the sidebar state sane if the viewport crosses the
        // breakpoint (e.g. rotating a tablet, resizing a browser window).
        window.addEventListener("resize", function () {
            if (!window.matchMedia("(max-width: 900px)").matches) close();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
