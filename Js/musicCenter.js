/* ==========================================================================
   VORPEX NEXUS — MUSIC CENTER (Module 1: Shell)
   Owns: open/close, state switching (mini/normal/expanded/docked/fullscreen),
         drag, resize, position/size/state persistence, keyboard shortcuts.
   Does NOT own: audio graph or visualizer rendering (Module 2 & 3).
   Namespaced on window.VorpexMusicCenter so later modules can hook in
   without re-querying the DOM or re-binding listeners.
   ========================================================================== */

(function () {
    const STORAGE_KEY = "vorpex-music-center-v1";
    const STATES = ["mini", "normal", "expanded", "docked", "fullscreen"];

    const DEFAULT_MC_STATE = {
        open: false,
        state: "normal",
        theme: "default",
        visualizer: "ring",
        paletteIndex: 3,
        volume: 0.8,
        shuffle: false,
        repeatMode: "off",
        playlistOpen: false,
        // Actual audio bytes can't survive a reload (browser security), so we
        // only persist lightweight metadata — enough to show "recently played"
        // and the last-used queue names without pretending files come back.
        recentlyPlayed: [],
        pos: { top: 120, left: null }, // left:null == centered on first open
        size: { width: 380, height: 460 },
    };

    function loadMcState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return structuredClone(DEFAULT_MC_STATE);
            const parsed = JSON.parse(raw);
            return {
                ...structuredClone(DEFAULT_MC_STATE),
                ...parsed,
                pos: { ...DEFAULT_MC_STATE.pos, ...(parsed.pos || {}) },
                size: { ...DEFAULT_MC_STATE.size, ...(parsed.size || {}) },
            };
        } catch {
            return structuredClone(DEFAULT_MC_STATE);
        }
    }

    function saveMcState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(mcState));
        } catch {
            /* storage unavailable — degrade silently, shell still works this session */
        }
    }

    let mcState = loadMcState();

    function initMusicCenter() {
        const panel = document.getElementById("musicCenter");
        const toggleBtn = document.getElementById("musicToggleBtn");
        if (!panel || !toggleBtn) return; // markup not present — nothing to wire up
        if (panel.dataset.mcBound) return; // guard against double init
        panel.dataset.mcBound = "1";

        const header = document.getElementById("mcHeader");
        const closeBtn = document.getElementById("mcClose");
        const resizeHandle = document.getElementById("mcResizeHandle");
        const stateButtons = {
            mini: document.getElementById("mcStateMini"),
            normal: document.getElementById("mcStateNormal"),
            expanded: document.getElementById("mcStateExpanded"),
            docked: document.getElementById("mcStateDocked"),
            fullscreen: document.getElementById("mcStateFullscreen"),
        };
        const micBtn = document.getElementById("mcMicBtn");
        const fileBtn = document.getElementById("mcFileBtn");
        const fileInput = document.getElementById("mcFileInput");
        const nowPlaying = document.getElementById("mcNowPlaying");
        const artistEl = document.getElementById("mcArtist");
        const artEl = document.getElementById("mcArt");
        const placeholder = document.getElementById("mcPlaceholder");
        const canvas = document.getElementById("mcCanvas");
        const dropzone = document.getElementById("mcDropzone");

        const sourceChips = {
            mic: document.getElementById("mcSourceMic"),
            file: document.getElementById("mcSourceFile"),
            browser: document.getElementById("mcSourceBrowser"),
        };
        const vizChips = Array.from(document.querySelectorAll(".mc-viz-chip"));

        const seekBar = document.getElementById("mcSeekBar");
        const timeCurrentEl = document.getElementById("mcTimeCurrent");
        const timeDurationEl = document.getElementById("mcTimeDuration");
        const volumeSlider = document.getElementById("mcVolumeSlider");

        const playPauseBtn = document.getElementById("mcPlayPauseBtn");
        const prevBtn = document.getElementById("mcPrevBtn");
        const nextBtn = document.getElementById("mcNextBtn");
        const shuffleBtn = document.getElementById("mcShuffleBtn");
        const repeatBtn = document.getElementById("mcRepeatBtn");

        const playlistToggle = document.getElementById("mcPlaylistToggle");
        const playlistPanel = document.getElementById("mcPlaylistPanel");
        const queueListEl = document.getElementById("mcQueueList");
        const recentListEl = document.getElementById("mcRecentList");

        const miniBar = document.getElementById("mcMiniBar");
        const miniTitle = document.getElementById("mcMiniTitle");
        const miniPlayBtn = document.getElementById("mcMiniPlayBtn");

        const engine = window.VorpexAudioEngine;
        const viz = window.VorpexVisualizer;
        let seekDragging = false; // suppress timeUpdate fighting the user while they drag the seek handle

        let preFullscreenState = "normal";

        // ---------------- geometry helpers ----------------

        function clampToViewport() {
            if (mcState.state === "docked" || mcState.state === "fullscreen") return;
            const rect = panel.getBoundingClientRect();
            const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
            const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
            const left = Math.min(Math.max(8, rect.left), maxLeft);
            const top = Math.min(Math.max(8, rect.top), maxTop);
            panel.style.left = left + "px";
            panel.style.top = top + "px";
            mcState.pos.left = left;
            mcState.pos.top = top;
        }

        function applyPosition() {
            if (mcState.state === "docked" || mcState.state === "fullscreen") {
                panel.style.left = "";
                panel.style.top = "";
                return;
            }
            const left = mcState.pos.left == null
                ? Math.round(window.innerWidth / 2 - (mcState.size.width || 380) / 2)
                : mcState.pos.left;
            panel.style.left = left + "px";
            panel.style.top = mcState.pos.top + "px";
        }

        function applySize() {
            if (mcState.state === "mini" || mcState.state === "docked" || mcState.state === "fullscreen") {
                panel.style.width = "";
                panel.style.height = "";
                return;
            }
            panel.style.width = mcState.size.width + "px";
            panel.style.height = mcState.size.height + "px";
        }

        function applyState() {
            STATES.forEach((s) => panel.classList.remove("mc-state-" + s));
            panel.classList.add("mc-state-" + mcState.state);

            Object.entries(stateButtons).forEach(([key, btn]) => {
                if (btn) btn.classList.toggle("mc-active", key === mcState.state);
            });

            applySize();
            applyPosition();
        }

        function setState(next) {
            if (!STATES.includes(next)) return;
            if (mcState.state !== "fullscreen" && next === "fullscreen") {
                preFullscreenState = mcState.state;
            }
            mcState.state = next;
            applyState();
            saveMcState();
        }

        // ---------------- open / close ----------------

        function openPanel() {
            mcState.open = true;
            panel.classList.add("mc-open");
            panel.setAttribute("aria-hidden", "false");
            toggleBtn.setAttribute("aria-expanded", "true");
            applyState();
            saveMcState();
            if (viz) viz.start();
        }

        function closePanel() {
            mcState.open = false;
            panel.classList.remove("mc-open");
            panel.setAttribute("aria-hidden", "true");
            toggleBtn.setAttribute("aria-expanded", "false");
            saveMcState();
            // Music keeps playing in the background (like minimizing a player) —
            // only the visual render loop stops, since nothing is on screen to
            // show it. This is the CPU-saving tradeoff called out in visualizer.js.
            if (viz) viz.stop();
        }

        function togglePanel() {
            if (mcState.open) closePanel();
            else openPanel();
        }

        toggleBtn.addEventListener("click", (e) => {
            e.preventDefault();
            togglePanel();
        });

        if (closeBtn) closeBtn.addEventListener("click", closePanel);

        Object.entries(stateButtons).forEach(([key, btn]) => {
            if (!btn) return;
            btn.addEventListener("click", () => {
                if (key === "fullscreen" && mcState.state === "fullscreen") {
                    setState(preFullscreenState || "normal");
                } else {
                    setState(key);
                }
            });
        });

        // ---------------- keyboard shortcuts ----------------

        document.addEventListener("keydown", (e) => {
            const tag = (document.activeElement && document.activeElement.tagName) || "";
            const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

            if (!typing && (e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
                togglePanel();
                return;
            }
            if (e.key === "Escape" && mcState.open) {
                if (mcState.state === "fullscreen") {
                    setState(preFullscreenState || "normal");
                } else {
                    closePanel();
                }
            }
        });

        // ---------------- dragging ----------------

        let dragging = false;
        let dragStartX = 0, dragStartY = 0, dragOriginLeft = 0, dragOriginTop = 0;

        function onDragStart(e) {
            if (mcState.state === "fullscreen" || mcState.state === "docked") return;
            if (e.target.closest(".mc-btn")) return; // don't drag when clicking header buttons
            dragging = true;
            panel.classList.add("mc-dragging");
            const point = e.touches ? e.touches[0] : e;
            dragStartX = point.clientX;
            dragStartY = point.clientY;
            const rect = panel.getBoundingClientRect();
            dragOriginLeft = rect.left;
            dragOriginTop = rect.top;
            e.preventDefault();
        }

        function onDragMove(e) {
            if (!dragging) return;
            const point = e.touches ? e.touches[0] : e;
            const dx = point.clientX - dragStartX;
            const dy = point.clientY - dragStartY;
            const newLeft = dragOriginLeft + dx;
            const newTop = dragOriginTop + dy;
            panel.style.left = newLeft + "px";
            panel.style.top = newTop + "px";
        }

        function onDragEnd() {
            if (!dragging) return;
            dragging = false;
            panel.classList.remove("mc-dragging");
            clampToViewport();
            saveMcState();
        }

        if (header) {
            header.addEventListener("mousedown", onDragStart);
            header.addEventListener("touchstart", onDragStart, { passive: false });
        }
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("touchmove", onDragMove, { passive: false });
        window.addEventListener("mouseup", onDragEnd);
        window.addEventListener("touchend", onDragEnd);

        // ---------------- resizing ----------------

        let resizing = false;
        let resizeStartX = 0, resizeStartY = 0, resizeOriginW = 0, resizeOriginH = 0;
        const MIN_W = 300, MIN_H = 240;

        function onResizeStart(e) {
            if (mcState.state === "mini" || mcState.state === "docked" || mcState.state === "fullscreen") return;
            resizing = true;
            panel.classList.add("mc-resizing");
            const point = e.touches ? e.touches[0] : e;
            resizeStartX = point.clientX;
            resizeStartY = point.clientY;
            const rect = panel.getBoundingClientRect();
            resizeOriginW = rect.width;
            resizeOriginH = rect.height;
            e.preventDefault();
            e.stopPropagation();
        }

        function onResizeMove(e) {
            if (!resizing) return;
            const point = e.touches ? e.touches[0] : e;
            const dx = point.clientX - resizeStartX;
            const dy = point.clientY - resizeStartY;
            const maxW = window.innerWidth * 0.96;
            const maxH = window.innerHeight * 0.88;
            const w = Math.min(maxW, Math.max(MIN_W, resizeOriginW + dx));
            const h = Math.min(maxH, Math.max(MIN_H, resizeOriginH + dy));
            panel.style.width = w + "px";
            panel.style.height = h + "px";
        }

        function onResizeEnd() {
            if (!resizing) return;
            resizing = false;
            panel.classList.remove("mc-resizing");
            const rect = panel.getBoundingClientRect();
            mcState.size.width = Math.round(rect.width);
            mcState.size.height = Math.round(rect.height);
            saveMcState();
        }

        if (resizeHandle) {
            resizeHandle.addEventListener("mousedown", onResizeStart);
            resizeHandle.addEventListener("touchstart", onResizeStart, { passive: false });
        }
        window.addEventListener("mousemove", onResizeMove);
        window.addEventListener("touchmove", onResizeMove, { passive: false });
        window.addEventListener("mouseup", onResizeEnd);
        window.addEventListener("touchend", onResizeEnd);

        window.addEventListener("resize", () => {
            if (mcState.open) clampToViewport();
        });

        // Safety net: if the window loses focus mid-drag/resize (alt-tab, a
        // native file dialog opening, etc.), the corresponding mouseup/touchend
        // may never fire. Release the gesture so the panel doesn't get stuck
        // following the cursor.
        window.addEventListener("blur", () => {
            onDragEnd();
            onResizeEnd();
        });

        // ---------------- helpers ----------------

        function formatTime(sec) {
            if (!Number.isFinite(sec) || sec < 0) return "0:00";
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60).toString().padStart(2, "0");
            return `${m}:${s}`;
        }

        function notify(title, body) {
            if (typeof window.showToast === "function") window.showToast(title, body);
        }

        function setActiveSourceChip(type) {
            Object.entries(sourceChips).forEach(([key, chip]) => {
                if (!chip) return;
                chip.setAttribute("aria-pressed", key === type ? "true" : "false");
                chip.classList.toggle("mc-active", key === type);
            });
        }

        function setActiveVizChip(style) {
            vizChips.forEach((chip) => {
                const active = chip.dataset.style === style;
                chip.classList.toggle("mc-active", active);
                chip.setAttribute("aria-pressed", String(active));
            });
        }

        function updatePlaceholder(hasSourceOrQueue) {
            if (placeholder) placeholder.classList.toggle("mc-hidden", !!hasSourceOrQueue);
        }

        // ---------------- playlist rendering ----------------

        function renderQueue(state) {
            if (!queueListEl) return;
            queueListEl.innerHTML = "";
            if (!state.queue.length) {
                const li = document.createElement("li");
                li.className = "mc-playlist-empty";
                li.textContent = "Queue is empty — add local tracks with 📁";
                queueListEl.appendChild(li);
                return;
            }
            state.queue.forEach((track, i) => {
                const li = document.createElement("li");
                li.className = i === state.currentIndex ? "mc-playing" : "";
                li.setAttribute("role", "button");
                li.setAttribute("tabindex", "0");

                const name = document.createElement("span");
                name.className = "mc-track-name";
                name.textContent = `${i === state.currentIndex ? "▶ " : ""}${track.name} — ${track.artist}`;
                li.appendChild(name);

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "mc-track-remove";
                removeBtn.title = "Remove from queue";
                removeBtn.textContent = "✖";
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    engine.removeFromQueue(i);
                });
                li.appendChild(removeBtn);

                li.addEventListener("click", () => engine.playAtIndex(i));
                li.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); engine.playAtIndex(i); }
                });

                queueListEl.appendChild(li);
            });
        }

        function renderRecent(state) {
            if (!recentListEl) return;
            recentListEl.innerHTML = "";
            if (!state.recentlyPlayed.length) {
                const li = document.createElement("li");
                li.className = "mc-playlist-empty";
                li.textContent = "Nothing played yet this session";
                recentListEl.appendChild(li);
                return;
            }
            state.recentlyPlayed.forEach((t) => {
                const li = document.createElement("li");
                li.textContent = `${t.name} — ${t.artist}`;
                recentListEl.appendChild(li);
            });
            mcState.recentlyPlayed = state.recentlyPlayed;
            saveMcState();
        }

        // ---------------- transport UI sync ----------------

        function syncTransportUI(state) {
            const playing = !!state.playing;
            const isLive = state.sourceType === "mic" || state.sourceType === "browser";

            if (playPauseBtn) {
                if (isLive) {
                    playPauseBtn.textContent = "🔴";
                    playPauseBtn.title = "Live input — no playback controls";
                    playPauseBtn.disabled = true;
                } else {
                    playPauseBtn.disabled = false;
                    playPauseBtn.textContent = playing ? "⏸" : "▶";
                    playPauseBtn.title = playing ? "Pause" : "Play";
                    playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
                }
            }
            if (miniPlayBtn) {
                miniPlayBtn.disabled = isLive;
                miniPlayBtn.textContent = isLive ? "🔴" : (playing ? "⏸" : "▶");
                miniPlayBtn.title = isLive ? "Live input" : (playing ? "Pause" : "Play");
            }
            [prevBtn, nextBtn, shuffleBtn, repeatBtn].forEach((btn) => {
                if (btn) btn.disabled = isLive || (btn !== shuffleBtn && btn !== repeatBtn && state.queue.length === 0);
            });
            if (seekBar) seekBar.disabled = isLive || !state.duration;

            const track = state.currentTrack;
            const title = track ? track.name : (state.sourceType ? "Listening…" : "Nothing playing");
            const artist = track ? track.artist : (state.sourceType === "mic" ? "Microphone input" : state.sourceType === "browser" ? "Browser audio" : "—");
            if (nowPlaying) nowPlaying.textContent = title;
            if (artistEl) artistEl.textContent = artist;
            if (miniTitle) miniTitle.textContent = track ? `${title} — ${artist}` : title;
            if (artEl) artEl.textContent = state.sourceType === "mic" ? "🎤" : state.sourceType === "browser" ? "🌐" : "🎵";

            if (shuffleBtn) {
                shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
                shuffleBtn.classList.toggle("mc-active", state.shuffle);
            }
            if (repeatBtn) {
                const modeLabel = state.repeatMode === "one" ? "Repeat: one" : state.repeatMode === "all" ? "Repeat: all" : "Repeat: off";
                repeatBtn.title = modeLabel;
                repeatBtn.textContent = state.repeatMode === "one" ? "🔂" : "🔁";
                repeatBtn.setAttribute("aria-pressed", String(state.repeatMode !== "off"));
                repeatBtn.classList.toggle("mc-active", state.repeatMode !== "off");
            }

            if (!seekDragging && seekBar) {
                seekBar.max = state.duration || 0;
                seekBar.value = state.currentTime || 0;
            }
            if (timeCurrentEl) timeCurrentEl.textContent = formatTime(state.currentTime);
            if (timeDurationEl) timeDurationEl.textContent = formatTime(state.duration);

            setActiveSourceChip(state.sourceType);
            updatePlaceholder(state.sourceType || state.queue.length);
        }

        // ---------------- source controls ----------------

        async function activateSource(type) {
            if (!engine) return;
            let ok = false;
            if (type === "mic") ok = await engine.connectMic();
            else if (type === "browser") ok = await engine.connectBrowserAudio();
            else if (type === "file") {
                if (fileInput) fileInput.click();
                return; // playback begins via addFilesToQueue -> playAtIndex
            }
            if (ok) syncTransportUI(engine.getState());
        }

        Object.entries(sourceChips).forEach(([key, chip]) => {
            if (chip) chip.addEventListener("click", () => activateSource(key));
        });
        if (micBtn) micBtn.addEventListener("click", () => activateSource("mic"));
        if (fileBtn && fileInput) fileBtn.addEventListener("click", () => fileInput.click());

        if (fileInput && engine) {
            fileInput.addEventListener("change", (e) => {
                if (e.target.files && e.target.files.length) {
                    engine.addFilesToQueue(e.target.files);
                }
                fileInput.value = ""; // allow re-selecting the same file later
            });
        }

        // Drag & drop audio files directly onto the panel.
        let dragCounter = 0;
        panel.addEventListener("dragover", (e) => {
            if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
            e.preventDefault();
        });
        panel.addEventListener("dragenter", (e) => {
            if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
            e.preventDefault();
            dragCounter++;
            panel.classList.add("mc-drag-over");
        });
        panel.addEventListener("dragleave", () => {
            dragCounter = Math.max(0, dragCounter - 1);
            if (dragCounter === 0) panel.classList.remove("mc-drag-over");
        });
        panel.addEventListener("drop", (e) => {
            e.preventDefault();
            dragCounter = 0;
            panel.classList.remove("mc-drag-over");
            if (!dropzone) return;
            const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("audio/"));
            if (files.length && engine) engine.addFilesToQueue(files);
            else if (e.dataTransfer.files.length) notify("Unsupported files", "Only audio files can be added to the queue.");
        });

        // ---------------- transport controls ----------------

        if (playPauseBtn && engine) playPauseBtn.addEventListener("click", () => engine.togglePlayPause());
        if (miniPlayBtn && engine) miniPlayBtn.addEventListener("click", () => engine.togglePlayPause());
        if (prevBtn && engine) prevBtn.addEventListener("click", () => engine.prev());
        if (nextBtn && engine) nextBtn.addEventListener("click", () => engine.next());

        if (shuffleBtn && engine) {
            shuffleBtn.addEventListener("click", () => {
                const state = engine.getState();
                engine.setShuffle(!state.shuffle);
                mcState.shuffle = !state.shuffle;
                saveMcState();
                syncTransportUI(engine.getState());
            });
        }
        if (repeatBtn && engine) {
            repeatBtn.addEventListener("click", () => {
                const mode = engine.cycleRepeat();
                mcState.repeatMode = mode;
                saveMcState();
                syncTransportUI(engine.getState());
            });
        }

        if (seekBar && engine) {
            seekBar.addEventListener("input", () => { seekDragging = true; });
            seekBar.addEventListener("change", () => {
                engine.seek(parseFloat(seekBar.value));
                seekDragging = false;
            });
        }

        if (volumeSlider && engine) {
            volumeSlider.addEventListener("input", () => {
                const v = parseFloat(volumeSlider.value) / 100;
                engine.setVolume(v);
                mcState.volume = v;
            });
            volumeSlider.addEventListener("change", saveMcState);
        }

        // ---------------- playlist panel toggle ----------------

        if (playlistToggle && playlistPanel) {
            playlistToggle.addEventListener("click", () => {
                const nowOpen = playlistPanel.hasAttribute("hidden");
                if (nowOpen) playlistPanel.removeAttribute("hidden");
                else playlistPanel.setAttribute("hidden", "");
                playlistToggle.setAttribute("aria-expanded", String(nowOpen));
                playlistToggle.classList.toggle("mc-active", nowOpen);
                mcState.playlistOpen = nowOpen;
                saveMcState();
            });
        }

        // ---------------- visualizer style switcher ----------------

        vizChips.forEach((chip) => {
            chip.addEventListener("click", () => {
                const style = chip.dataset.style;
                if (viz) viz.setStyle(style);
                mcState.visualizer = style;
                setActiveVizChip(style);
                saveMcState();
            });
        });

        // ---------------- mini-bar: click title to expand back out ----------------

        if (miniBar) {
            miniBar.addEventListener("click", (e) => {
                if (e.target.closest(".mc-btn")) return; // let the play button behave independently
                setState("normal");
            });
        }

        // ---------------- wire up audioEngine events ----------------

        if (engine) {
            const refresh = () => syncTransportUI(engine.getState());
            engine.on("trackChange", refresh);
            engine.on("play", refresh);
            engine.on("pause", refresh);
            engine.on("timeUpdate", refresh);
            engine.on("sourceChange", refresh);
            engine.on("shuffleChange", refresh);
            engine.on("repeatChange", refresh);
            engine.on("queueChange", (state) => { renderQueue(state); refresh(); });
            engine.on("trackChange", (state) => renderRecent(state));
            engine.on("error", (err) => {
                notify("Music Center", err.message || "An audio error occurred.");
                console.warn("[VorpexMusicCenter] audio error:", err);
            });

            // Initial paint with whatever state the engine already has (in case
            // another part of the app interacted with it before this ran).
            renderQueue(engine.getState());
            // The engine's own recentlyPlayed list is always empty right after
            // a page load (audio data can't survive a reload) — seed the first
            // paint from persisted metadata so the list doesn't look reset.
            renderRecent(mcState.recentlyPlayed.length
                ? { recentlyPlayed: mcState.recentlyPlayed }
                : engine.getState());
            syncTransportUI(engine.getState());
            engine.setVolume(mcState.volume);
            engine.setShuffle(mcState.shuffle);
            engine.setRepeat(mcState.repeatMode);
            if (volumeSlider) volumeSlider.value = Math.round(mcState.volume * 100);
        }

        // ---------------- visualizer wiring ----------------

        if (viz && canvas) {
            viz.init(canvas);
            viz.setStyle(mcState.visualizer);
            viz.setPaletteIndex(mcState.paletteIndex);
            setActiveVizChip(mcState.visualizer);
        }

        if (playlistPanel && mcState.playlistOpen) {
            playlistPanel.removeAttribute("hidden");
            if (playlistToggle) {
                playlistToggle.setAttribute("aria-expanded", "true");
                playlistToggle.classList.add("mc-active");
            }
        }

        // ---------------- restore persisted state on load ----------------

        applyState();
        if (mcState.open) openPanel();

        // Expose a small API for Module 3+ to build on without re-binding anything.
        window.VorpexMusicCenter = {
            open: openPanel,
            close: closePanel,
            toggle: togglePanel,
            setState,
            getState: () => structuredClone(mcState),
            elements: { panel, header, canvas },
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initMusicCenter);
    } else {
        initMusicCenter();
    }
})();
