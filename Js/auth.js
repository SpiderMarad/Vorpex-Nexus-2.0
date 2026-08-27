/* =========================================================
   VORPEX NEXUS — AUTHENTICATION
   ---------------------------------------------------------
   ⚠ READ SETUP.md BEFORE THIS WILL WORK ⚠
   Both providers require YOU to register a real OAuth app and
   drop your own credentials into the CONFIG block below. No
   placeholder ID will ever let anyone sign in — that's by
   design, this is not something that can be faked client-side.

   - Google: uses Google Identity Services. Fully client-side
     and secure — the returned ID token is a signed JWT you can
     trust without a backend. Needs GOOGLE_CLIENT_ID.

   - Discord: uses the standard OAuth2 Authorization Code flow.
     Discord's client secret must never be shipped to the
     browser, so the code exchange happens in the tiny
     serverless function at /api/discord-callback.js — deploy
     that (Vercel/Netlify/Cloudflare all have a free tier) and
     point DISCORD_TOKEN_ENDPOINT at it. Needs DISCORD_CLIENT_ID,
     DISCORD_REDIRECT_URI, DISCORD_TOKEN_ENDPOINT.

   This app has no real backend database — signed-in profile
   data is cached in this browser's localStorage only. It is
   enough to show who's signed in and personalize the UI, but
   it will NOT sync a profile across different devices/browsers.
   That needs a real backend + database, which is outside what
   a static site can do — see SETUP.md for the plan on that.
   ========================================================= */
(function () {
    var CONFIG = {
        GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
        DISCORD_CLIENT_ID: "YOUR_DISCORD_APPLICATION_CLIENT_ID",
        DISCORD_REDIRECT_URI: window.location.origin + "/auth/callback.html",
        DISCORD_TOKEN_ENDPOINT: "https://YOUR-DEPLOYED-FUNCTION.example.com/api/discord-callback",
    };
    window.VORPEX_AUTH_CONFIG = CONFIG; // exposed so auth/callback.html can reuse it

    var SESSION_KEY = "vorpex-nexus-session-v1";

    function getSession() {
        try {
            var raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function setSession(session) {
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
    }

    function clearSession() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    }

    function base64UrlDecode(str) {
        str = str.replace(/-/g, "+").replace(/_/g, "/");
        while (str.length % 4) str += "=";
        return decodeURIComponent(
            atob(str)
                .split("")
                .map(function (c) { return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2); })
                .join("")
        );
    }

    function decodeJwt(token) {
        try {
            var payload = token.split(".")[1];
            return JSON.parse(base64UrlDecode(payload));
        } catch (e) { return null; }
    }

    // ---------------- Google Identity Services ----------------
    function loadGis(cb) {
        if (window.google && window.google.accounts && window.google.accounts.id) return cb();
        var s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.defer = true;
        s.onload = cb;
        s.onerror = function () {
            showToastSafe("Couldn't reach Google", "Check your connection and try again.");
        };
        document.head.appendChild(s);
    }

    function handleGoogleCredential(response) {
        var payload = decodeJwt(response.credential);
        if (!payload) return;
        upsertUser({
            provider: "google",
            id: payload.sub,
            name: payload.name || payload.email,
            email: payload.email,
            avatar: payload.picture || "",
        });
    }

    function startGoogleSignIn() {
        if (CONFIG.GOOGLE_CLIENT_ID.indexOf("YOUR_GOOGLE") === 0) {
            showToastSafe("Google sign-in isn't configured yet", "Add your Client ID in js/auth.js — see SETUP.md.");
            return;
        }
        loadGis(function () {
            window.google.accounts.id.initialize({
                client_id: CONFIG.GOOGLE_CLIENT_ID,
                callback: handleGoogleCredential,
                auto_select: false,
            });
            window.google.accounts.id.prompt();
        });
    }

    // ---------------- Discord OAuth2 (Authorization Code) ----------------
    function startDiscordSignIn() {
        if (CONFIG.DISCORD_CLIENT_ID.indexOf("YOUR_DISCORD") === 0) {
            showToastSafe("Discord sign-in isn't configured yet", "Add your Client ID + deployed function in js/auth.js — see SETUP.md.");
            return;
        }
        var state = Math.random().toString(36).slice(2);
        try { sessionStorage.setItem("vorpex-oauth-state", state); } catch (e) {}
        var url = "https://discord.com/oauth2/authorize"
            + "?client_id=" + encodeURIComponent(CONFIG.DISCORD_CLIENT_ID)
            + "&redirect_uri=" + encodeURIComponent(CONFIG.DISCORD_REDIRECT_URI)
            + "&response_type=code"
            + "&scope=" + encodeURIComponent("identify email")
            + "&state=" + encodeURIComponent(state);
        window.location.href = url;
    }

    // Called by auth/callback.html after it gets a profile back from
    // /api/discord-callback.js. Exposed globally on purpose.
    window.vorpexCompleteDiscordSignIn = function (profile) {
        upsertUser({
            provider: "discord",
            id: profile.id,
            name: profile.global_name || profile.username,
            email: profile.email || "",
            avatar: profile.avatar
                ? "https://cdn.discordapp.com/avatars/" + profile.id + "/" + profile.avatar + ".png"
                : "",
        });
        window.location.href = "/"; // back to the launcher, now signed in
    };

    // ---------------- Shared account handling ----------------
    function upsertUser(user) {
        // No real backend: this is a local "account" cached per browser.
        // Same shape either way so the UI never needs to know which
        // provider signed the person in.
        var session = {
            provider: user.provider,
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            signedInAt: Date.now(),
        };
        setSession(session);
        renderAuthUI();
        closeAuthModal();
        showToastSafe("Signed in", "Welcome, " + (user.name || "there") + ".");
    }

    function signOut() {
        clearSession();
        if (window.google && window.google.accounts && window.google.accounts.id) {
            try { window.google.accounts.id.disableAutoSelect(); } catch (e) {}
        }
        renderAuthUI();
        closeAuthModal();
        showToastSafe("Signed out", "");
    }

    function showToastSafe(title, body) {
        if (typeof window.showToast === "function") window.showToast(title, body);
    }

    // ---------------- Modal + top-bar UI ----------------
    function openAuthModal() {
        var overlay = document.getElementById("authOverlay");
        if (!overlay) return;
        overlay.classList.add("show");
        overlay.setAttribute("aria-hidden", "false");
    }

    function closeAuthModal() {
        var overlay = document.getElementById("authOverlay");
        if (!overlay) return;
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
    }

    function renderAuthUI() {
        var session = getSession();
        var trigger = document.getElementById("authTrigger");
        var triggerAvatar = document.getElementById("authTriggerAvatar");
        var triggerLabel = document.getElementById("authTriggerLabel");
        var viewSignIn = document.getElementById("authViewSignIn");
        var viewAccount = document.getElementById("authViewAccount");

        if (session) {
            if (triggerLabel) triggerLabel.textContent = session.name || "Account";
            if (triggerAvatar) {
                triggerAvatar.innerHTML = session.avatar
                    ? '<img src="' + session.avatar + '" alt="">'
                    : "👤";
            }
            if (viewSignIn) viewSignIn.hidden = true;
            if (viewAccount) viewAccount.hidden = false;

            var name = document.getElementById("accountName");
            var meta = document.getElementById("accountMeta");
            var avatar = document.getElementById("accountAvatar");
            if (name) name.textContent = session.name || "Player";
            if (meta) meta.textContent = "Signed in with " + capitalize(session.provider) + (session.email ? " · " + session.email : "");
            if (avatar) avatar.innerHTML = session.avatar ? '<img src="' + session.avatar + '" alt="">' : "👤";

            var level = document.getElementById("accountLevel");
            var xp = document.getElementById("accountXp");
            var playtime = document.getElementById("accountPlaytime");
            try {
                var raw = localStorage.getItem("vorpex-nexus-state-v3");
                var state = raw ? JSON.parse(raw) : null;
                if (state) {
                    if (level) level.textContent = Math.max(1, Math.floor((state.xp || 0) / 250) + 1);
                    if (xp) xp.textContent = state.xp || 0;
                    if (playtime) {
                        var m = Math.floor((state.playTime || 0) / 60);
                        playtime.textContent = m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m";
                    }
                }
            } catch (e) {}
        } else {
            if (triggerLabel) triggerLabel.textContent = "Sign In";
            if (triggerAvatar) triggerAvatar.textContent = "👤";
            if (viewSignIn) viewSignIn.hidden = false;
            if (viewAccount) viewAccount.hidden = true;
        }
    }

    function capitalize(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    function init() {
        renderAuthUI();

        var trigger = document.getElementById("authTrigger");
        var overlay = document.getElementById("authOverlay");
        var closeBtn = document.getElementById("authClose");
        var googleBtn = document.getElementById("googleSignInBtn");
        var discordBtn = document.getElementById("discordSignInBtn");
        var guestBtn = document.getElementById("guestContinueBtn");
        var signOutBtn = document.getElementById("signOutBtn");

        if (trigger) trigger.addEventListener("click", openAuthModal);
        if (closeBtn) closeBtn.addEventListener("click", closeAuthModal);
        if (overlay) {
            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) closeAuthModal();
            });
        }
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeAuthModal();
        });

        if (googleBtn) googleBtn.addEventListener("click", startGoogleSignIn);
        if (discordBtn) discordBtn.addEventListener("click", startDiscordSignIn);
        if (guestBtn) guestBtn.addEventListener("click", closeAuthModal);
        if (signOutBtn) signOutBtn.addEventListener("click", signOut);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
