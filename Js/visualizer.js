/* ==========================================================================
   VORPEX NEXUS — VISUALIZER (Module 2)
   Canvas renderer for the Music Center. Ported and extended from the
   original signal.html prototype (ring + particle field + waveform ribbon),
   split into independently-selectable styles.

   This module owns the ONLY requestAnimationFrame loop for audio-reactive
   rendering in the whole app. Every frame it:
     1. reads bands/frequency/time data from VorpexAudioEngine (pull, cheap)
     2. draws the active style to its own canvas
     3. dispatches a single "vorpex:audioframe" CustomEvent on `document`
        carrying { bass, mid, treble, vol } so other modules (e.g. the
        launcher background/glow link) can react without running a second
        loop of their own.

   The loop only runs while start() has been called (i.e. the Music Center
   panel is open) — paused entirely otherwise, so a closed panel costs 0 CPU.

   Public API: window.VorpexVisualizer
   ========================================================================== */

(function () {
    if (window.VorpexVisualizer) return;

    const engine = () => window.VorpexAudioEngine;

    const PALETTES = [
        { a: "#5EEAD4", b: "#F72585", c: "#FFB627", bg1: "#101a30", bg2: "#060812" },
        { a: "#FFB627", b: "#5EEAD4", c: "#F72585", bg1: "#1a1408", bg2: "#0a0704" },
        { a: "#A78BFA", b: "#34D399", c: "#F472B6", bg1: "#140f24", bg2: "#08060f" },
        { a: "#00AAFF", b: "#8A2BE2", c: "#7DD3FC", bg1: "#0b1424", bg2: "#05070d" }, // Vorpex house palette
    ];

    let paletteIdx = 3; // default to the Vorpex house palette so it matches the launcher out of the box

    let canvas = null;
    let ctx = null;
    let wrapEl = null;
    let resizeObserver = null;
    let W = 0, H = 0, DPR = 1;

    let currentStyle = "ring";
    let raf = null;
    let running = false;
    let t = 0;
    let lastTime = performance.now();

    const smooth = {
        bass: 0,
        mid: 0,
        treble: 0,
        vol: 0
    }

    // ---------------- shared helpers ----------------

    function hexAlpha(hex, alpha) {
        const h = hex.replace("#", "");
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function glow(color, blur){
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
    }

    function noGlow(){
        ctx.shadowBlur = 0;
    }

    function pal() { return PALETTES[paletteIdx]; }

    function resize() {
        if (!canvas || !wrapEl) return;
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = wrapEl.clientWidth;
        H = wrapEl.clientHeight;
        if (W === 0 || H === 0) return;
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // ---------------- particle field (shared by particles / galaxy / spiral) ----------------

    const PARTICLE_COUNT = 120;
    let particles = [];
    function initParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 0.3 + Math.random() * 0.7;
            particles.push({
                angle, dist,
                speed: 0.0006 + Math.random() * 0.0012,
                size: 1 + Math.random() * 2.2,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }
    initParticles();

    const ORBITAL_COUNT = 7;
    let orbitBodies = [];
    function initOrbitBodies() {
        orbitBodies =  [];
        for (let i = 0; i < ORBITAL_COUNT; i++) {
            orbitBodies.push({
                r: 0.16 + (i / ORBITAL_COUNT) * 0.78,
                angle: Math.random() * Math.PI * 2,
                speed: (0.0007 + Math.random() * 0.0009) * (i % 2 ? -1 : 1),
                size: 2.5 + Math.random() * 3,
                trail: [],
            });
        }
    }
    initOrbitBodies();

    const HISTORY_LEN = 180;
    let volHistory = new Array(HISTORY_LEN).fill(0);

    // Matrix-style falling glyph columns
    let matrixCols = [];
    function initMatrix() {
        matrixCols = [];
        const cols = 28;
        for (let i = 0; i < cols; i++) {
            matrixCols.push({ x: i, y: Math.random() * 30, speed: 0.15 + Math.random() * 0.4 });
        }
    }
    initMatrix();

    // Lightning bolt segments, regenerated on treble transients
    let boltSeed = 0;

    function background(P, cx, cy) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
        grad.addColorStop(0, P.bg1);
        grad.addColorStop(1, P.bg2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // ---------------- style renderers ----------------
    // Each takes (bands, P, cx, cy) and draws into the shared ctx/W/H.

    const styles = {
        ring(bands, P, cx, cy) {
            const { bass, mid, treble, vol, freq } = bands;
            volHistory.push(vol); volHistory.shift();

            const baseR = Math.min(W, H) * 0.16;
            const ringR = baseR * (1 + bass * 0.55);

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const glow = ctx.createRadialGradient(cx, cy, ringR * 0.4, cx, cy, ringR * 2.6);
            glow.addColorStop(0, hexAlpha(P.a, 0.35 + bass * 0.35));
            glow.addColorStop(1, hexAlpha(P.a, 0));
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(cx, cy, ringR * 2.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            for (const p of particles) {
                p.angle += p.speed * (1 + treble * 3);
                const wob = Math.sin(t * 0.002 + p.phase) * 0.04;
                const r = baseR * 1.9 * (p.dist + wob) * (1 + mid * 0.5);
                const x = cx + Math.cos(p.angle) * r;
                const y = cy + Math.sin(p.angle) * r;
                const size = p.size * (1 + treble * 2.2);
                ctx.beginPath();
                ctx.fillStyle = hexAlpha(p.dist > 0.6 ? P.b : P.a, 0.55 + treble * 0.4);
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            const spikes = 64;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            for (let i = 0; i <= spikes; i++) {
                const a = (i / spikes) * Math.PI * 2;
                const idx = freq ? Math.floor((i / spikes) * freq.length * 0.5) : 0;
                const v = freq ? freq[idx] / 255 : 0;
                const r = ringR + v * baseR * 0.9 + Math.sin(a * 6 + t * 0.003) * 2;
                const x = cx + Math.cos(a) * r;
                const y = cy + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.lineWidth = 3 + mid * 4;
            ctx.strokeStyle = hexAlpha(P.a, 0.9);
            ctx.shadowColor = P.a;
            ctx.shadowBlur = 22 + bass * 30;
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.strokeStyle = hexAlpha(P.c, 0.5);
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, ringR * 0.55);
            coreGrad.addColorStop(0, hexAlpha("#ffffff", 0.9));
            coreGrad.addColorStop(0.4, hexAlpha(P.a, 0.35 + vol * 0.3));
            coreGrad.addColorStop(1, hexAlpha(P.a, 0));
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, ringR * 0.55 * (1 + vol * 0.3), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.beginPath();
            const ribbonH = 50;
            const baseY = H - 24;
            for (let i = 0; i < HISTORY_LEN; i++) {
                const x = (i / (HISTORY_LEN - 1)) * W;
                const y = baseY - volHistory[i] * ribbonH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = hexAlpha(P.b, 0.5);
            ctx.lineWidth = 2;
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            ctx.shadowColor = P.b;
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.restore();
        },

        bars(bands, P) {
            const freq = bands.freq;
            const barCount = 48;
            const gap = 3;
            const barW = (W - gap * (barCount - 1)) / barCount;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            for (let i = 0; i < barCount; i++) {
                const idx = freq ? Math.floor((i / barCount) * freq.length * 0.7) : 0;
                const v = freq ? freq[idx] / 255 : 0;
                const h = Math.max(3, v * H * 0.82);
                const x = i * (barW + gap);
                const y = H - h;
                const grad = ctx.createLinearGradient(0, y, 0, H);
                grad.addColorStop(0, hexAlpha(P.a, 0.95));
                grad.addColorStop(1, hexAlpha(P.b, 0.25));
                ctx.fillStyle = grad;
                ctx.shadowColor = P.a;
                ctx.shadowBlur = 10 + bands.bass * 20;
                ctx.fillRect(x, y, barW, h);
            }
            ctx.restore();
        },

        wave(bands, P, cx, cy) {
            const time = bands.time;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            const n = time ? time.length : 0;
            ctx.beginPath();
            ctx.lineJoin = "round";
            ctx.lineCap = "round"
            for (let i = 0; i < n; i++) {
                const x = (i / (n - 1)) * W;
                const v = (time[i] - 128) / 128; // -1..1
                const bassAmp = 1 + bands.bass * 1.8;
                const trebleRipple = Math.sin(i * 0.25 + performance.now() * 0.01) * bands.treble * 18;
                const y = cy + v * (H * 0.24) * bassAmp + trebleRipple;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            const grad = ctx.createLinearGradient(0, 0, W, 0);
            grad.addColorStop(0.0, P.a);
            grad.addColorStop(0.5, P.b);
            grad.addColorStop(1.0, P.c);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 5 + bands.bass * 10;
            ctx.shadowColor = P.a;
            ctx.shadowBlur = 35 + bands.treble * 30;
            ctx.stroke();
            // Second glow pass
            ctx.save();
            ctx.lineWidth *= 0.45;
            ctx.shadowBlur = 60;
            ctx.shadowColor = P.b;
            ctx.globalAlpha = 0.9;
            ctx.stroke();
            ctx.restore();
            ctx.restore();

            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = hexAlpha(P.c, 0.6);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(W, cy);
            ctx.stroke();
            ctx.restore();
        },

        particles(bands, P, cx, cy) {
            const { treble, mid, bass } = bands;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const baseR = Math.min(W, H) * 0.42;
            for (const p of particles) {
                p.angle += p.speed * (1 + treble * 4);
                const wob = Math.sin(t * 0.0018 + p.phase) * 0.05;
                const r = baseR * (p.dist + wob) * (1 + mid * 0.4);
                const x = cx + Math.cos(p.angle) * r;
                const y = cy + Math.sin(p.angle) * r;
                const size = p.size * (1.2 + bass * 2.4 + treble * 1.6);
                ctx.beginPath();
                ctx.fillStyle = hexAlpha(p.dist > 0.6 ? P.b : P.a, 0.5 + treble * 0.5);
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        },

        galaxy(bands, P, cx, cy) {
            const { bass, mid, treble } = bands;
            const arms = 3;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const baseR = Math.min(W, H) * 0.44;
            particles.forEach((p, i) => {
                const armOffset = (i % arms) * ((Math.PI * 2) / arms);
                const spin = t * 0.0006 * (1 + treble * 2);
                const r = baseR * p.dist * (0.5 + mid * 0.5);
                const a = p.angle * 2 + armOffset + spin + r * 0.01;
                const x = cx + Math.cos(a) * r;
                const y = cy + Math.sin(a) * r * 0.55; // flattened ellipse for a disc feel
                const size = p.size * (1 + bass * 2);
                ctx.beginPath();
                ctx.fillStyle = hexAlpha(i % 2 ? P.a : P.c, 0.5 + bass * 0.4);
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            });
            const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 0.2 * (1 + bass * 0.5));
            coreGrad.addColorStop(0, hexAlpha("#ffffff", 0.85));
            coreGrad.addColorStop(1, hexAlpha(P.a, 0));
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, baseR * 0.2 * (1 + bass * 0.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        orbitals(bands, P, cx, cy) {
            const { bass, mid, treble, vol } = bands;
            const baseR = Math.min(W, H) * 0.42;
            const squash = 0.42 + mid * 0.12; // vertical squash → tilted ring feel
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            // faint orbit paths
            orbitBodies.forEach((o) => {
                const r = baseR * o.r;
                ctx.beginPath();
                ctx.ellipse(cx, cy, r, r * squash, 0, 0, Math.PI * 2);
                ctx.strokeStyle = hexAlpha(P.a, 0.08);
                ctx.lineWidth = 1; ctx.stroke();
            });
            // bodies + comet trails
            orbitBodies.forEach((o, i) => {
                o.angle += o.speed * (1 + treble * 2.5);
                const r = baseR * o.r * (1 + bass * 0.08);
                const x = cx + Math.cos(o.angle) * r;
                const y = cy + Math.sin(o.angle) * r * squash;
                o.trail.push({ x, y });
                if (o.trail.length > 18) o.trail.shift();
                for (let k = 0; k < o.trail.length; k++) {
                    const pt = o.trail[k];
                    const alpha = (k / o.trail.length) * 0.5 * (0.5 + treble * 0.6);
                    ctx.beginPath();
                    ctx.fillStyle = hexAlpha(i % 2 ? P.b : P.c, alpha);
                    ctx.arc(pt.x, pt.y, o.size * (k / o.trail.length), 0, Math.PI * 2);
                    ctx.fill();
                }
                const size = o.size * (1 + bass * 1.4 + vol * 0.4);
                ctx.beginPath();
                ctx.fillStyle = hexAlpha("#ffffff", 0.9);
                ctx.shadowColor = i % 2 ? P.b : P.c;
                ctx.shadowBlur = 12 + treble * 20;
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
            // central star
            const starR = Math.min(W, H) * 0.07 * (1 + bass * 0.5);
            const starGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 2.5);
            starGrad.addColorStop(0, "#ffffff");
            starGrad.addColorStop(0.3, P.a);
            starGrad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = starGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, starR * 2.5, 0, Math.PI * 2);
            ctx.fill(); ctx.restore();
        },
        
        lightning(bands, P, cx, cy) {
            const { treble, bass } = bands;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const bolts = 5;
            for (let b = 0; b < bolts; b++) {
                const angle = (b / bolts) * Math.PI * 2 + t * 0.0003;
                const len = Math.min(W, H) * (0.32 + treble * 0.35);
                let x = cx, y = cy;
                ctx.beginPath();
                ctx.moveTo(x, y);
                const segments = 8;
                for (let s = 1; s <= segments; s++) {
                    const progress = s / segments;
                    const jitter = (Math.sin((boltSeed + s * 13 + b * 7) * 12.9898) * 0.5) * 14 * (0.4 + treble);
                    const segX = cx + Math.cos(angle) * len * progress + Math.cos(angle + Math.PI / 2) * jitter;
                    const segY = cy + Math.sin(angle) * len * progress + Math.sin(angle + Math.PI / 2) * jitter;
                    ctx.lineTo(segX, segY);
                }
                ctx.strokeStyle = hexAlpha(b % 2 ? P.c : P.a, 0.35 + treble * 0.6);
                ctx.lineWidth = 1.5 + bass * 3;
                ctx.shadowColor = P.a;
                ctx.shadowBlur = 12 + treble * 20;
                ctx.stroke();
            }
            boltSeed += 0.6 + treble * 2;
            ctx.restore();
        },

        matrix(bands, P) {
            const { mid, treble } = bands;
            const glyphSize = Math.max(12, Math.min(W, H) / 26);
            ctx.save();
            ctx.font = `${glyphSize}px 'JetBrains Mono', monospace`;
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const chars = "01アイウエオカキクケコ";
            matrixCols.forEach((col) => {
                col.y += col.speed * (1 + treble * 3);
                if (col.y * glyphSize > H + glyphSize) col.y = 0;
                const x = (col.x + 0.5) * (W / matrixCols.length);
                const y = col.y * glyphSize;
                const ch = chars[Math.floor(Math.random() * chars.length)];
                ctx.fillStyle = hexAlpha(P.a, 0.15 + mid * 0.6);
                ctx.fillText(ch, x, y);
            });
            ctx.restore();
        },

        spiral(bands, P, cx, cy) {
            const { treble, mid, bass } = bands;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;
            const baseR = Math.min(W, H) * 0.42;
            particles.forEach((p, i) => {
                const spin = t * 0.0009 * (1 + treble * 2.5);
                const growth = (p.dist + (i / particles.length) * 0.6) % 1;
                const r = baseR * growth * (0.6 + mid * 0.4);
                const a = p.angle * 3 + spin + growth * 8;
                const x = cx + Math.cos(a) * r;
                const y = cy + Math.sin(a) * r;
                const size = p.size * (1 + bass * 2);
                ctx.beginPath();
                ctx.fillStyle = hexAlpha(i % 3 === 0 ? P.c : P.a, 0.35 + treble * 0.5);
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        },

        reactor(bands, P, cx, cy) {
            const { bass, mid, treble, vol } = bands;
            const time = t * 0.001; // shared animation clock (module-level `t`, advances 16ms/frame)
            const core = Math.min(W, H) * 0.08 + bass * 25;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.95;

            // ---------- outer glow ----------
            const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, core * 3.2);
            outerGlow.addColorStop(0, "#ffffff");
            outerGlow.addColorStop(0.15, P.a);
            outerGlow.addColorStop(0.45, P.b);
            outerGlow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = outerGlow;
            ctx.beginPath();
            ctx.arc(cx, cy, core * 3.2, 0, Math.PI * 2);
            ctx.fill();

            // ---------- containment field (mid-driven hex lattice) ----------
            const hexR = core * 2.3 * (1 + mid * 0.25);
            ctx.beginPath();
            for (let i = 0; i <= 6; i++) {
                const a = (i / 6) * Math.PI * 2 + time * 0.15;
                const wob = Math.sin(a * 3 + time * 2) * mid * 6;
                const x = cx + Math.cos(a) * (hexR + wob);
                const y = cy + Math.sin(a) * (hexR + wob);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = hexAlpha(P.c, 0.25 + mid * 0.35);
            ctx.lineWidth = 1.5;
            ctx.shadowColor = P.c;
            ctx.shadowBlur = 10 + mid * 15;
            ctx.stroke();

            // ---------- energy rings ----------
            for (let r = 0; r < 3; r++) {
                const radius = core * (1.8 + r * 0.55) + bass * (6 + r * 3);
                ctx.beginPath();
                for (let i = 0; i <= 180; i++) {
                    const a = (i / 180) * Math.PI * 2 + time * (0.35 + r * 0.2) * (r % 2 ? -1 : 1);
                    const wobble = Math.sin(a * (5 + r) + time * 2) * (3 + treble * 8);
                    const x = cx + Math.cos(a) * (radius + wobble);
                    const y = cy + Math.sin(a) * (radius + wobble);
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.lineWidth = 2 + r;
                ctx.strokeStyle = r === 0 ? P.a : r === 1 ? P.b : P.c;
                ctx.shadowColor = ctx.strokeStyle;
                ctx.shadowBlur = 18 + vol * 25;
                ctx.stroke();
            }

            // ---------- treble sparks orbiting the containment field ----------
            particles.forEach((p, i) => {
                if (i % 3 !== 0) return; // thin the shared particle field down for the reactor
                p.angle += p.speed * (2 + treble * 6);
                const r = hexR * (0.85 + p.dist * 0.3);
                const x = cx + Math.cos(p.angle) * r;
                const y = cy + Math.sin(p.angle) * r;
                const size = p.size * (0.6 + treble * 2);
                ctx.beginPath();
                ctx.fillStyle = hexAlpha(i % 2 ? P.b : P.a, 0.4 + treble * 0.5);
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            });

            // ---------- core (with plasma flicker) ----------
            const flicker = 0.85 + Math.sin(time * 37) * 0.05 + Math.sin(time * 71 + 1.7) * 0.05;
            const coreR = core * flicker * (1 + vol * 0.15);
            ctx.beginPath();
            ctx.fillStyle = "#ffffff";
            ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
            ctx.fill();

            // filament arcs crack across the core on strong treble transients
            if (treble > 0.5) {
                ctx.save();
                ctx.globalAlpha = (treble - 0.5) * 1.6;
                for (let f = 0; f < 4; f++) {
                    const a1 = Math.random() * Math.PI * 2;
                    const a2 = a1 + (Math.random() - 0.5) * 2;
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(a1) * coreR * 0.3, cy + Math.sin(a1) * coreR * 0.3);
                    ctx.lineTo(cx + Math.cos(a2) * coreR * 0.9, cy + Math.sin(a2) * coreR * 0.9);
                    ctx.strokeStyle = P.a;
                    ctx.lineWidth = 1;
                    ctx.shadowColor = "#ffffff";
                    ctx.shadowBlur = 8;
                    ctx.stroke();
                }
                ctx.restore();
            }

            ctx.restore();
        },
    
    };

    // ---------------- render loop ----------------

    function draw() {
        const eng = engine();
        const frame = eng ? eng.getFrame() : { bass: 0, mid: 0, treble: 0, vol: 0, freq: null, time: null };
        const P = pal();
        const cx = W / 2, cy = H / 2;

        background(P, cx, cy);
        const renderer = styles[currentStyle] || styles.ring;

        // Smoth audio values
        smooth.bass += (frame.bass - smooth.bass) * 0.12;
        smooth.mid += (frame.mid - smooth.mid) * 0.12;
        smooth.treble += (frame.treble - smooth.treble) * 0.12;
        smooth.vol += (frame.vol - smooth.vol) * 0.12;

        renderer({
            ...frame,
            bass: smooth.bass,
            mid: smooth.mid,
            treble: smooth.treble,
            vol: smooth.vol
        }, P, cx, cy);

        t += 16;


        // Single shared broadcast for anything else that wants to react to audio
        // (e.g. launcherAudioLink.js) without spinning up its own rAF loop.
        document.dispatchEvent(new CustomEvent("vorpex:audioframe", {
            detail: { bass: frame.bass, mid: frame.mid, treble: frame.treble, vol: frame.vol },
        }));
    }

    function loop() {
        if (!running) return;
        draw();
        raf = requestAnimationFrame(loop);
    }

    // ---------------- public API ----------------

    function init(canvasEl) {
        canvas = canvasEl;
        if (!canvas) return;
        ctx = canvas.getContext("2d");
        wrapEl = canvas.parentElement;

        if (resizeObserver) resizeObserver.disconnect();
        if (window.ResizeObserver && wrapEl) {
            resizeObserver = new ResizeObserver(() => resize());
            resizeObserver.observe(wrapEl);
        }
        window.addEventListener("resize", resize);
        resize();
    }

    function setStyle(name) {
        if (styles[name]) currentStyle = name;
    }

    function getStyle() { return currentStyle; }

    function setPaletteIndex(i) {
        if (i >= 0 && i < PALETTES.length) paletteIdx = i;
    }

    function cyclePalette() {
        paletteIdx = (paletteIdx + 1) % PALETTES.length;
        return paletteIdx;
    }

    function start() {
        if (running) return;
        running = true;
        resize();
        if (!raf) loop();
    }

    function stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        // Reset the shared frame broadcast to neutral so dependent UI
        // (launcher glow) relaxes back to its default look when paused.
        document.dispatchEvent(new CustomEvent("vorpex:audioframe", { detail: { bass: 0, mid: 0, treble: 0, vol: 0 } }));
    }

    window.VorpexVisualizer = {
        init,
        setStyle,
        getStyle,
        setPaletteIndex,
        cyclePalette,
        start,
        stop,
        availableStyles: Object.keys(styles),
    };
})();
