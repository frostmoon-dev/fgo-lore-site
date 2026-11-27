// Ambient atmosphere (subtle canvas particles) and procedural Web Audio
// soundscapes for chats. Zero external files, works offline, respects
// prefers-reduced-motion, and audio only starts on an explicit user action.

export const VISUALS = [
  { key: "off", label: "Off", hint: "No visual atmosphere" },
  { key: "auto", label: "Auto (follow scene)", hint: "Reads the scene tracker for rain, snow, fire, petals or dusk" },
  { key: "rain", label: "Rain", hint: "Soft drifting rainfall" },
  { key: "snow", label: "Snow & frost", hint: "Slow winter snowfall" },
  { key: "embers", label: "Embers", hint: "Rising hearth or fallout embers" },
  { key: "petals", label: "Petals", hint: "Drifting rose and blossom petals" },
  { key: "motes", label: "Moonlit motes", hint: "Quiet floating dust and starlight" },
];

export const SOUNDS = [
  { key: "off", label: "Quiet" },
  { key: "rain", label: "Soft rain" },
  { key: "fire", label: "Fireplace" },
  { key: "wind", label: "Night wind" },
  { key: "hum", label: "Moon hum" },
];

// Matches keywords in the scene tracker text to a visual atmosphere.
const SCENE_CUES = [
  ["rain", /\b(rain|raining|storm|thunder|drizzle|downpour|wet street|monsoon|pouring)\b/i],
  ["snow", /\b(snow|snowing|blizzard|frost|winter|ice|icy|glacier|frozen|antarctica|cold wind)\b/i],
  ["embers", /\b(fire|fireplace|hearth|campfire|ember|ash|burning|blaze|inferno|apocalypse|fallout|ruins|candlelit|torch)\b/i],
  ["petals", /\b(petal|petals|sakura|cherry blossom|rose garden|roses|blossom|spring garden|orchard|flowers)\b/i],
  ["motes", /\b(library|cathedral|moonlight|moon cell|throne room|forest|shrine|night|midnight|attic|cellar|study|ballroom|crypt|dusk)\b/i],
];

export function detectVisualFromScene(sceneText) {
  const src = String(sceneText ?? "");
  if (!src.trim()) return "off";
  for (const [key, re] of SCENE_CUES) {
    if (re.test(src)) return key;
  }
  return "off";
}

export function readAmbienceVolume() {
  try {
    const v = Number(localStorage.getItem("chatAmbienceVol"));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.35;
  } catch {
    return 0.35;
  }
}

export function saveAmbienceVolume(v) {
  const clamped = Math.max(0, Math.min(1, Number(v) || 0));
  try { localStorage.setItem("chatAmbienceVol", String(clamped)); } catch { /* private mode */ }
  return clamped;
}

// ---------- Visual particle layer ----------
export function createVisualLayer(canvas) {
  let mode = "off";
  let raf = 0;
  let particles = [];
  let w = 0;
  let h = 0;
  let lastT = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const ctx = canvas.getContext("2d");

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function themeColours() {
    const cs = getComputedStyle(document.documentElement);
    const dark = document.documentElement.dataset.theme === "dark";
    const accent = cs.getPropertyValue("--accent").trim() || "#a8234b";
    const ink = cs.getPropertyValue("--ink").trim() || (dark ? "#eee" : "#222");
    return { dark, accent, ink };
  }

  function spawn(kind, randomY = false) {
    const y = randomY ? Math.random() * h : (kind === "embers" ? h + 10 : -12);
    if (kind === "rain") {
      return { x: Math.random() * (w + 120) - 60, y, vx: -1.4 - Math.random() * 0.8, vy: 11 + Math.random() * 7, len: 12 + Math.random() * 14, a: 0.14 + Math.random() * 0.16 };
    }
    if (kind === "snow") {
      return { x: Math.random() * w, y, r: 1.2 + Math.random() * 2.4, vy: 0.45 + Math.random() * 0.85, drift: Math.random() * Math.PI * 2, amp: 0.35 + Math.random() * 0.6, a: 0.22 + Math.random() * 0.35 };
    }
    if (kind === "embers") {
      return { x: Math.random() * w, y, r: 1 + Math.random() * 2.1, vy: -(0.55 + Math.random() * 1.15), drift: Math.random() * Math.PI * 2, a: 0.3 + Math.random() * 0.5, hue: 14 + Math.random() * 28 };
    }
    if (kind === "petals") {
      return { x: Math.random() * (w + 80) - 40, y, rx: 3.2 + Math.random() * 2.6, ry: 1.8 + Math.random() * 1.4, vx: 0.35 + Math.random() * 0.65, vy: 0.55 + Math.random() * 0.75, rot: Math.random() * Math.PI * 2, vrot: (Math.random() - 0.5) * 0.04, drift: Math.random() * Math.PI * 2, a: 0.22 + Math.random() * 0.25 };
    }
    // motes
    return { x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2, vx: (Math.random() - 0.5) * 0.22, vy: -(0.08 + Math.random() * 0.22), phase: Math.random() * Math.PI * 2, a: 0.15 + Math.random() * 0.28 };
  }

  function countFor(kind) {
    const area = Math.max(1, (w * h) / (1200 * 800));
    const base = { rain: 62, snow: 48, embers: 34, petals: 24, motes: 32 }[kind] ?? 0;
    return Math.max(10, Math.min(90, Math.round(base * Math.sqrt(area))));
  }

  function resetParticles() {
    if (mode === "off") { particles = []; return; }
    const n = countFor(mode);
    particles = Array.from({ length: n }, () => spawn(mode, true));
  }

  function step(t) {
    raf = 0;
    if (mode === "off" || reduced.matches || document.hidden || !canvas.isConnected) return;
    const dt = lastT ? Math.min(2.5, (t - lastT) / 16.67) : 1;
    lastT = t;
    ctx.clearRect(0, 0, w, h);
    const { dark, accent, ink } = themeColours();

    if (mode === "rain") {
      ctx.strokeStyle = dark ? "rgba(195, 215, 245, 0.36)" : "rgba(70, 90, 120, 0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of particles) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 1.4, p.y + p.len);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > h + 20 || p.x < -80) Object.assign(p, spawn("rain", false));
      }
      ctx.stroke();
    } else if (mode === "snow") {
      ctx.fillStyle = dark ? "#e6efff" : "#7c8ca8";
      for (const p of particles) {
        p.drift += 0.018 * dt;
        p.x += Math.sin(p.drift) * p.amp * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = dark ? p.a : p.a * 0.65;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (p.y > h + 10) Object.assign(p, spawn("snow", false));
      }
      ctx.globalAlpha = 1;
    } else if (mode === "embers") {
      for (const p of particles) {
        p.drift += 0.03 * dt;
        p.x += Math.sin(p.drift) * 0.6 * dt;
        p.y += p.vy * dt;
        const fade = Math.max(0, Math.min(1, p.y / (h * 0.85)));
        ctx.globalAlpha = p.a * fade * (dark ? 1 : 0.72);
        ctx.fillStyle = `hsl(${p.hue} 92% ${dark ? 62 : 44}%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (p.y < -10) Object.assign(p, spawn("embers", false));
      }
      ctx.globalAlpha = 1;
    } else if (mode === "petals") {
      ctx.fillStyle = accent;
      for (const p of particles) {
        p.drift += 0.02 * dt;
        p.rot += p.vrot * dt;
        p.x += (p.vx + Math.sin(p.drift) * 0.45) * dt;
        p.y += p.vy * dt;
        ctx.save();
        ctx.globalAlpha = p.a * (dark ? 0.9 : 0.65);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (p.y > h + 16 || p.x > w + 40) Object.assign(p, spawn("petals", false));
      }
      ctx.globalAlpha = 1;
    } else if (mode === "motes") {
      ctx.fillStyle = dark ? accent : ink;
      for (const p of particles) {
        p.phase += 0.02 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < -8) p.y = h + 8;
        if (p.x < -8) p.x = w + 8;
        if (p.x > w + 8) p.x = -8;
        ctx.globalAlpha = p.a * (0.45 + 0.55 * Math.sin(p.phase)) * (dark ? 0.9 : 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(step);
  }

  function start() {
    if (raf || mode === "off" || reduced.matches || document.hidden) return;
    lastT = 0;
    raf = requestAnimationFrame(step);
  }

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    ctx.clearRect(0, 0, w, h);
  }

  const ro = new ResizeObserver(() => {
    resize();
    if (mode !== "off") resetParticles();
  });
  ro.observe(canvas);
  const onVis = () => { if (document.hidden) stop(); else start(); };
  const onMotion = () => { if (reduced.matches) stop(); else if (mode !== "off") { resetParticles(); start(); } };
  document.addEventListener("visibilitychange", onVis);
  reduced.addEventListener("change", onMotion);

  return {
    set(next) {
      const clean = VISUALS.some((v) => v.key === next && v.key !== "auto") ? next : "off";
      if (clean === mode) return;
      mode = clean;
      canvas.hidden = mode === "off" || reduced.matches;
      stop();
      if (mode !== "off" && !reduced.matches) {
        resize();
        resetParticles();
        start();
      }
    },
    destroy() {
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduced.removeEventListener("change", onMotion);
    },
  };
}

// ---------- Procedural Web Audio soundscapes ----------
export function createSoundscape() {
  let ctx = null;
  let master = null;
  let stopNodes = () => {};
  let current = "off";
  let volume = readAmbienceVolume();

  function noiseBuffer(audioCtx, seconds = 3, colour = "pink") {
    const len = Math.floor(audioCtx.sampleRate * seconds);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (colour === "brown") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      } else {
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
      }
    }
    return buf;
  }

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function buildGraph(kind) {
    const ac = ensureContext();
    if (!ac) return () => {};
    const nodes = [];
    const timers = [];
    const bus = ac.createGain();
    bus.gain.value = 1;
    bus.connect(master);
    nodes.push(bus);

    if (kind === "rain") {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(ac, 4, "pink");
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 260;
      const g = ac.createGain();
      g.gain.value = 0.42;
      src.connect(hp).connect(lp).connect(g).connect(bus);
      src.start();
      nodes.push(src, hp, lp, g);
    } else if (kind === "fire") {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(ac, 4, "brown");
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const g = ac.createGain();
      g.gain.value = 0.55;
      src.connect(lp).connect(g).connect(bus);
      src.start();
      nodes.push(src, lp, g);
      // Soft occasional hearth crackles.
      const crackle = () => {
        if (!ctx || current !== "fire") return;
        const osc = ac.createOscillator();
        const cg = ac.createGain();
        const bp = ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1400 + Math.random() * 2400;
        osc.type = "triangle";
        osc.frequency.value = 90 + Math.random() * 220;
        const t = ac.currentTime;
        cg.gain.setValueAtTime(0.0001, t);
        cg.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.08, t + 0.006);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035 + Math.random() * 0.04);
        osc.connect(bp).connect(cg).connect(bus);
        osc.start(t);
        osc.stop(t + 0.09);
        timers.push(setTimeout(crackle, 240 + Math.random() * 1100));
      };
      timers.push(setTimeout(crackle, 350));
    } else if (kind === "wind") {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(ac, 5, "pink");
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 420;
      bp.Q.value = 2.4;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoGain = ac.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(bp.frequency);
      const g = ac.createGain();
      g.gain.value = 0.45;
      src.connect(bp).connect(g).connect(bus);
      src.start();
      lfo.start();
      nodes.push(src, bp, lfo, lfoGain, g);
    } else if (kind === "hum") {
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 260;
      const g = ac.createGain();
      g.gain.value = 0.18;
      lp.connect(g).connect(bus);
      nodes.push(lp, g);
      for (const [freq, type] of [[65.41, "sine"], [98.0, "sine"], [130.81, "triangle"]]) {
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        const og = ac.createGain();
        og.gain.value = type === "triangle" ? 0.18 : 0.4;
        osc.connect(og).connect(lp);
        osc.start();
        nodes.push(osc, og);
      }
    }

    return () => {
      timers.forEach(clearTimeout);
      for (const n of nodes) {
        try { n.stop?.(); } catch {}
        try { n.disconnect?.(); } catch {}
      }
    };
  }

  return {
    get mode() { return current; },
    get volume() { return volume; },
    set(kind) {
      const next = SOUNDS.some((s) => s.key === kind) ? kind : "off";
      if (next === current) return;
      stopNodes();
      stopNodes = () => {};
      current = next;
      if (next === "off") {
        if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
        return;
      }
      stopNodes = buildGraph(next);
      if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.35);
    },
    setVolume(v) {
      volume = saveAmbienceVolume(v);
      if (master && ctx && current !== "off") master.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
    },
    destroy() {
      stopNodes();
      stopNodes = () => {};
      current = "off";
      if (ctx) { ctx.close().catch(() => {}); ctx = null; master = null; }
    },
  };
}
