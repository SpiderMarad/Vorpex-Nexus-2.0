/* ==========================================================================
   VORPEX NEXUS — AUDIO ENGINE (Module 2)
   Single source of truth for everything audio: AudioContext, analyser,
   source switching (mic / local files / browser tab audio), playlist,
   and transport (play/pause/next/prev/seek/volume/shuffle/repeat).

   Design notes:
   - Exactly ONE AudioContext and ONE AnalyserNode for the app's lifetime.
   - Exactly ONE <audio> element for file playback; createMediaElementSource
     may only be called once per element ever, so that wrapping happens once
     and is cached.
   - Switching sources always tears down the previous source's tracks/nodes
     first (mic/tab streams call track.stop() so the browser's recording
     indicator turns off — this is the #1 real-world leak in apps like this).
   - No internal render loop. Visual consumers (visualizer.js) pull frames
     via getBands()/getFreqData()/getTimeData() on their own rAF tick, so
     there is exactly one rendering clock in the whole app, not one per
     module. This engine only emits *discrete* events (track change, play,
     pause, error, queue change, time update) — not per-frame data.

   Public API: window.VorpexAudioEngine
   ========================================================================== */

(function () {
    if (window.VorpexAudioEngine) return; // guard against double-inclusion

    // ---------------- tiny event emitter ----------------
    const listeners = Object.create(null);
    function on(event, cb) {
        (listeners[event] || (listeners[event] = [])).push(cb);
        return () => off(event, cb);
    }
    function off(event, cb) {
        const arr = listeners[event];
        if (!arr) return;
        const i = arr.indexOf(cb);
        if (i !== -1) arr.splice(i, 1);
    }
    function emit(event, payload) {
        const arr = listeners[event];
        if (!arr) return;
        // Copy before iterating: a listener may unsubscribe itself mid-emit.
        arr.slice().forEach((cb) => {
            try { cb(payload); } catch (err) { console.error(`[VorpexAudioEngine] listener error on "${event}"`, err); }
        });
    }

    // ---------------- state ----------------
    let audioCtx = null;
    let analyser = null;
    let freqData = null;      // Uint8Array, frequency domain
    let timeData = null;      // Uint8Array, time domain (for waveform styles)
    let bufferLength = 0;

    let currentSourceNode = null;  // whatever is currently feeding the analyser
    let currentSourceType = null;  // 'mic' | 'file' | 'browser' | null
    let activeMicStream = null;    // MediaStream, so we can stop tracks on teardown
    let activeDisplayStream = null;

    // Persistent <audio> element reused for the whole app lifetime.
    let audioEl = null;
    let mediaElementSource = null; // cached — can only be created once per element
    let currentVolume = 1;         // tracked independently so it survives lazy <audio> creation

    // Playlist / transport state
    const queue = [];          // { id, name, artist, url, duration, isObjectUrl }
    let currentIndex = -1;
    let shuffleOrder = [];     // permutation of queue indices used when shuffle is on
    let shuffle = false;
    let repeatMode = "off";    // 'off' | 'all' | 'one'
    let recentlyPlayed = [];   // [{ name, artist }] most-recent-first, capped
    const RECENT_LIMIT = 15;

    let idCounter = 0;
    function nextId() { return "trk_" + (++idCounter) + "_" + Date.now().toString(36); }

    // ---------------- context / analyser bootstrap ----------------

    function ensureContext() {
        if (audioCtx) return true;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
            emit("error", { code: "unsupported", message: "Web Audio API is not supported in this browser.", source: null });
            return false;
        }
        audioCtx = new Ctor();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.82;
        bufferLength = analyser.frequencyBinCount;
        freqData = new Uint8Array(bufferLength);
        timeData = new Uint8Array(bufferLength);
        return true;
    }

    function ensureAudioElement() {
        if (audioEl) return audioEl;
        audioEl = new Audio();
        audioEl.crossOrigin = "anonymous";
        audioEl.preload = "metadata";
        audioEl.volume = currentVolume;

        audioEl.addEventListener("timeupdate", () => {
            emit("timeUpdate", { currentTime: audioEl.currentTime, duration: audioEl.duration || 0 });
        });
        audioEl.addEventListener("loadedmetadata", () => {
            const track = queue[currentIndex];
            if (track) track.duration = audioEl.duration || 0;
            emit("trackChange", getState());
        });
        audioEl.addEventListener("play", () => emit("play", getState()));
        audioEl.addEventListener("pause", () => emit("pause", getState()));
        audioEl.addEventListener("ended", handleTrackEnded);
        audioEl.addEventListener("error", () => {
            emit("error", { code: "playback-failed", message: "This track could not be played.", source: "file" });
        });

        document.body.appendChild(audioEl);
        return audioEl;
    }

    // ---------------- teardown helpers (leak prevention) ----------------

    function stopStreamTracks(stream) {
        if (!stream) return;
        stream.getTracks().forEach((t) => {
            try { t.stop(); } catch { /* already stopped */ }
        });
    }

    function teardownCurrentSource() {
        if (currentSourceNode && currentSourceType !== "file") {
            try { currentSourceNode.disconnect(); } catch { /* already disconnected */ }
        }
        if (currentSourceType === "mic") {
            stopStreamTracks(activeMicStream);
            activeMicStream = null;
        }
        if (currentSourceType === "browser") {
            stopStreamTracks(activeDisplayStream);
            activeDisplayStream = null;
        }
        if (currentSourceType === "file") {
            try { audioEl && audioEl.pause(); } catch { /* noop */ }
        }
        currentSourceNode = null;
        currentSourceType = null;
    }

    function connectSourceNode(node, type) {
        teardownCurrentSource();
        currentSourceNode = node;
        currentSourceType = type;
        node.connect(analyser);
        if (type === "file") {
            node.connect(audioCtx.destination);
        }
        emit("sourceChange", { source: type });
    }

    // ---------------- sources ----------------

    async function connectMic() {
        if (!ensureContext()) return false;
        try {
            await audioCtx.resume();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            });
            activeMicStream = stream;
            const node = audioCtx.createMediaStreamSource(stream);
            connectSourceNode(node, "mic");
            return true;
        } catch (err) {
            emitMediaError(err, "mic");
            return false;
        }
    }

    async function connectBrowserAudio() {
        if (!ensureContext()) return false;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            emit("error", {
                code: "unsupported",
                message: "Browser/tab audio capture isn't supported in this browser.",
                source: "browser",
            });
            return false;
        }
        try {
            await audioCtx.resume();
            // Video track is required by most browsers to grant a tab audio
            // capture prompt; we stop it immediately since we only need audio.
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const audioTracks = stream.getAudioTracks();
            if (!audioTracks.length) {
                stopStreamTracks(stream);
                emit("error", {
                    code: "no-audio-track",
                    message: "That tab/window didn't share audio. Re-select it and check \"Share audio\".",
                    source: "browser",
                });
                return false;
            }
            stream.getVideoTracks().forEach((t) => t.stop());
            activeDisplayStream = stream;
            const node = audioCtx.createMediaStreamSource(stream);
            // If the shared stream ends (user stops sharing), clean up gracefully.
            audioTracks[0].addEventListener("ended", () => {
                if (currentSourceType === "browser") teardownCurrentSource();
                emit("sourceChange", { source: null });
            });
            connectSourceNode(node, "browser");
            return true;
        } catch (err) {
            emitMediaError(err, "browser");
            return false;
        }
    }

    function emitMediaError(err, source) {
        const name = err && err.name;
        let code = "unknown";
        let message = "Something went wrong accessing that audio source.";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            code = "permission-denied";
            message = source === "mic"
                ? "Microphone access was denied. Allow it in your browser's site settings to use this source."
                : "Permission was denied for browser audio capture.";
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
            code = "no-device";
            message = "No microphone was found on this device.";
        } else if (name === "NotSupportedError") {
            code = "unsupported";
            message = "That audio source isn't supported in this browser.";
        } else if (name === "AbortError") {
            code = "aborted";
            message = "The audio source request was cancelled.";
        }
        emit("error", { code, message, source, raw: err });
    }

    // ---------------- playlist / file source ----------------

    function addFilesToQueue(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const wasEmpty = queue.length === 0;
        files.forEach((file) => {
            const { title, artist } = parseTrackName(file.name);
            queue.push({
                id: nextId(),
                name: title,
                artist,
                url: URL.createObjectURL(file),
                duration: 0,
                isObjectUrl: true,
            });
        });
        rebuildShuffleOrder();
        emit("queueChange", getState());
        if (wasEmpty) {
            playAtIndex(0);
        }
    }

    function parseTrackName(filename) {
        const base = filename.replace(/\.[^/.]+$/, "");
        const parts = base.split(" - ");
        if (parts.length >= 2) {
            return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
        }
        return { artist: "Unknown Artist", title: base };
    }

    function removeFromQueue(index) {
        if (index < 0 || index >= queue.length) return;
        const track = queue[index];
        if (track.isObjectUrl) {
            try { URL.revokeObjectURL(track.url); } catch { /* noop */ }
        }
        queue.splice(index, 1);
        if (index === currentIndex) {
            teardownCurrentSource();
            currentIndex = -1;
        } else if (index < currentIndex) {
            currentIndex -= 1;
        }
        rebuildShuffleOrder();
        emit("queueChange", getState());
    }

    function clearQueue() {
        queue.slice().forEach((t) => {
            if (t.isObjectUrl) { try { URL.revokeObjectURL(t.url); } catch { /* noop */ } }
        });
        queue.length = 0;
        currentIndex = -1;
        shuffleOrder = [];
        teardownCurrentSource();
        emit("queueChange", getState());
    }

    function rebuildShuffleOrder() {
        shuffleOrder = queue.map((_, i) => i);
        for (let i = shuffleOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
        }
    }

    async function playAtIndex(index) {
        if (index < 0 || index >= queue.length) return;
        if (!ensureContext()) return;
        const track = queue[index];
        currentIndex = index;

        ensureAudioElement();
        // createMediaElementSource must be called exactly once per element.
        if (!mediaElementSource) {
            mediaElementSource = audioCtx.createMediaElementSource(audioEl);
            mediaElementSource.connect(audioCtx.destination);
        }
        connectSourceNode(mediaElementSource, "file");
        audioEl.pause();
        audioEl.currentTime = 0;
        audioEl.src = track.url;
        audioEl.load();
        try {
            await audioCtx.resume();
            await audioEl.play();
            pushRecentlyPlayed(track);
            emit("trackChange", getState());
        } catch (err) {
            emit("error", { code: "playback-failed", message: "Couldn't play \"" + track.name + "\".", source: "file", raw: err });
        }
    }

    function pushRecentlyPlayed(track) {
        recentlyPlayed = recentlyPlayed.filter((t) => t.name !== track.name || t.artist !== track.artist);
        recentlyPlayed.unshift({ name: track.name, artist: track.artist });
        if (recentlyPlayed.length > RECENT_LIMIT) recentlyPlayed.length = RECENT_LIMIT;
    }

    function handleTrackEnded() {
        if (repeatMode === "one") {
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {});
            return;
        }
        const hasNext = shuffle
            ? shuffleOrder.indexOf(currentIndex) < shuffleOrder.length - 1
            : currentIndex < queue.length - 1;
        if (hasNext) {
            next();
        } else if (repeatMode === "all" && queue.length) {
            playAtIndex(shuffle ? shuffleOrder[0] : 0);
        } else {
            emit("pause", getState());
        }
    }

    function play() {
        if (currentSourceType === "file" && audioEl) {
            audioCtx && audioCtx.resume();
            audioEl.play().catch(() => {});
        } else if (currentIndex === -1 && queue.length) {
            playAtIndex(0);
        }
    }

    function pause() {
        if (currentSourceType === "file" && audioEl) audioEl.pause();
    }

    function togglePlayPause() {
        if (currentSourceType === "file" && audioEl && !audioEl.paused) pause();
        else play();
    }

    function next() {
        if (!queue.length) return;
        if (shuffle) {
            const pos = shuffleOrder.indexOf(currentIndex);
            const nextPos = pos === -1 ? 0 : pos + 1;
            if (nextPos < shuffleOrder.length) playAtIndex(shuffleOrder[nextPos]);
            else if (repeatMode === "all") playAtIndex(shuffleOrder[0]);
        } else {
            if (currentIndex + 1 < queue.length) playAtIndex(currentIndex + 1);
            else if (repeatMode === "all") playAtIndex(0);
        }
    }

    function prev() {
        if (!queue.length) return;
        // Restart current track if we're more than 3s in (standard player UX).
        if (audioEl && audioEl.currentTime > 3) {
            audioEl.currentTime = 0;
            return;
        }
        if (shuffle) {
            const pos = shuffleOrder.indexOf(currentIndex);
            if (pos > 0) playAtIndex(shuffleOrder[pos - 1]);
        } else if (currentIndex > 0) {
            playAtIndex(currentIndex - 1);
        }
    }

    function seek(seconds) {
        if (audioEl && Number.isFinite(seconds)) audioEl.currentTime = seconds;
    }

    function setVolume(v) {
        const clamped = Math.min(1, Math.max(0, v));
        currentVolume = clamped;
        if (audioEl) audioEl.volume = clamped;
        emit("volumeChange", clamped);
    }

    function setShuffle(on) {
        shuffle = !!on;
        if (shuffle) rebuildShuffleOrder();
        emit("shuffleChange", shuffle);
    }

    function cycleRepeat() {
        repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
        emit("repeatChange", repeatMode);
        return repeatMode;
    }

    function setRepeat(mode) {
        if (["off", "all", "one"].includes(mode)) {
            repeatMode = mode;
            emit("repeatChange", repeatMode);
        }
    }

    // ---------------- analysis (pull-based, no internal loop) ----------------

    function getBands() {
        if (!analyser) return { bass: 0, mid: 0, treble: 0, vol: 0 };
        analyser.getByteFrequencyData(freqData);
        return computeBands(freqData);
    }

    function computeBands(freq) {
        const n = bufferLength;
        const bassEnd = Math.floor(n * 0.08);
        const midEnd = Math.floor(n * 0.35);
        let bass = 0, mid = 0, treble = 0;
        for (let i = 0; i < bassEnd; i++) bass += freq[i];
        for (let i = bassEnd; i < midEnd; i++) mid += freq[i];
        for (let i = midEnd; i < n; i++) treble += freq[i];
        bass = bass / (bassEnd || 1) / 255;
        mid = mid / ((midEnd - bassEnd) || 1) / 255;
        treble = treble / ((n - midEnd) || 1) / 255;
        const vol = bass * 0.5 + mid * 0.35 + treble * 0.15;
        return { bass, mid, treble, vol };
    }

    function getFreqData() {
        if (!analyser) return null;
        analyser.getByteFrequencyData(freqData);
        return freqData;
    }

    function getTimeData() {
        if (!analyser) return null;
        analyser.getByteTimeDomainData(timeData);
        return timeData;
    }

    // Single-sample-per-frame combo used by the visualizer's render loop, so
    // styles that need both bands AND raw frequency/time data (ring, bars,
    // wave) don't each trigger their own native getByteFrequencyData call —
    // that was happening twice per frame before this existed.
    function getFrame() {
        if (!analyser) return { bass: 0, mid: 0, treble: 0, vol: 0, freq: null, time: null };
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        const bands = computeBands(freqData);
        return { ...bands, freq: freqData, time: timeData };
    }

    function isActive() {
        return !!currentSourceType;
    }

    // ---------------- state snapshot ----------------

    function getState() {
        return {
            sourceType: currentSourceType,
            playing: currentSourceType === "file" && audioEl ? !audioEl.paused : currentSourceType !== null,
            queue: queue.map((t) => ({ id: t.id, name: t.name, artist: t.artist, duration: t.duration })),
            currentIndex,
            currentTrack: currentIndex >= 0 ? queue[currentIndex] : null,
            currentTime: audioEl ? audioEl.currentTime : 0,
            duration: audioEl ? audioEl.duration || 0 : 0,
            volume: audioEl ? audioEl.volume : currentVolume,
            shuffle,
            repeatMode,
            recentlyPlayed: recentlyPlayed.slice(),
        };
    }

    function destroy() {
        teardownCurrentSource();
        clearQueue();
        if (audioEl) {
            audioEl.pause();
            audioEl.src = "";
            audioEl.remove();
            audioEl = null;
        }
        mediaElementSource = null;
        if (audioCtx) {
            audioCtx.close().catch(() => {});
            audioCtx = null;
            analyser = null;
        }
    }

    // ---------------- public API ----------------

    window.VorpexAudioEngine = {
        // sources
        connectMic,
        connectBrowserAudio,
        disconnectSource: teardownCurrentSource,
        // playlist
        addFilesToQueue,
        removeFromQueue,
        clearQueue,
        playAtIndex,
        // transport
        play,
        pause,
        togglePlayPause,
        next,
        prev,
        seek,
        setVolume,
        setShuffle,
        cycleRepeat,
        setRepeat,
        // analysis (pull-based — call once per rAF frame from a single loop)
        getBands,
        getFreqData,
        getTimeData,
        getFrame,
        isActive,
        // state
        getState,
        // events
        on,
        off,
        // lifecycle
        destroy,
    };
})();
