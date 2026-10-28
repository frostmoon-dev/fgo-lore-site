// Colours, fonts, accent and corners (Settings → Appearance, and Chat look).
// Each choice lives in localStorage like the rest of the look. Fonts that
// index.html does not load come from Google Fonts only once chosen, and the
// result is cached under "looks" so theme-init.js can apply it before paint.

const gf = (spec) => `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// Nunito, Atkinson Hyperlegible Next and Fraunces are already in index.html.
export const CHAT_FONTS = [
  { key: "rounded", label: "Rounded (Nunito)", group: "Sans serif", stack: `"Nunito", ${SANS}` },
  { key: "inter", label: "Modern (Inter)", group: "Sans serif", stack: `"Inter", ${SANS}`, href: gf("Inter:ital,wght@0,400;0,500;0,600;0,700;1,400") },
  { key: "quicksand", label: "Soft (Quicksand)", group: "Sans serif", stack: `"Quicksand", ${SANS}`, href: gf("Quicksand:wght@400;500;600;700") },
  { key: "clear", label: "Clear (Atkinson Hyperlegible)", group: "Sans serif", stack: `"Atkinson Hyperlegible Next", ${SANS}` },
  { key: "plain", label: "Plain (your system's)", group: "Sans serif", stack: `${SANS}, Roboto` },
  { key: "serif", label: "Book (your system's)", group: "Serif", stack: `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", ${SERIF}` },
  { key: "literata", label: "Literata", group: "Serif", stack: `"Literata", ${SERIF}`, href: gf("Literata:ital,wght@0,400;0,600;1,400") },
  { key: "lora", label: "Lora", group: "Serif", stack: `"Lora", ${SERIF}`, href: gf("Lora:ital,wght@0,400;0,600;1,400") },
  { key: "garamond", label: "Garamond", group: "Serif", stack: `"EB Garamond", Garamond, ${SERIF}`, href: gf("EB+Garamond:ital,wght@0,400;0,600;1,400") },
  { key: "crimson", label: "Crimson", group: "Serif", stack: `"Crimson Pro", ${SERIF}`, href: gf("Crimson+Pro:ital,wght@0,400;0,600;1,400") },
  { key: "spectral", label: "Spectral", group: "Serif", stack: `"Spectral", ${SERIF}`, href: gf("Spectral:ital,wght@0,400;0,600;1,400") },
  { key: "merriweather", label: "Merriweather", group: "Serif", stack: `"Merriweather", ${SERIF}`, href: gf("Merriweather:ital,wght@0,400;0,700;1,400") },
  { key: "typewriter", label: "Typewriter (Courier Prime)", group: "Other", stack: '"Courier Prime", "Courier New", monospace', href: gf("Courier+Prime:ital,wght@0,400;0,700;1,400") },
  { key: "hand", label: "Handwritten (Patrick Hand)", group: "Other", stack: `"Patrick Hand", ${SANS}`, href: gf("Patrick+Hand") },
];

export const SITE_FONTS = CHAT_FONTS.filter((f) => ["rounded", "inter", "quicksand", "clear", "plain"].includes(f.key));

export const HEAD_FONTS = [
  { key: "fraunces", label: "Fraunces (soft serif)", stack: `"Fraunces", ${SERIF}` },
  { key: "cinzel", label: "Cinzel (carved capitals)", stack: `"Cinzel", ${SERIF}`, href: gf("Cinzel:wght@500;600") },
  { key: "playfair", label: "Playfair (high contrast)", stack: `"Playfair Display", ${SERIF}`, href: gf("Playfair+Display:wght@500;600") },
  { key: "cormorant", label: "Cormorant (elegant)", stack: `"Cormorant Garamond", ${SERIF}`, href: gf("Cormorant+Garamond:wght@500;600") },
  { key: "lora", label: "Lora (bookish)", stack: `"Lora", ${SERIF}`, href: gf("Lora:wght@500;600") },
  { key: "site", label: "Same as the site font", stack: "" },
];

// swatch: background, primary and accent, light theme then dark.
export const PALETTES = [
  { key: "moon", label: "Moon Cell", about: "Violet and rose, after BB.", swatch: ["#f1edf5", "#2b1e3f", "#a8234b"], dark: ["#131019", "#efeaf6", "#f07ea2"] },
  { key: "paper", label: "Paper", about: "Warm cream and clay.", swatch: ["#f3efe8", "#1c1a17", "#ad4318"], dark: ["#161412", "#f2ede5", "#ef8a5a"] },
  { key: "avalon", label: "Avalon", about: "Moss green and old gold.", swatch: ["#eef1ea", "#1f3a2b", "#7a5000"], dark: ["#101511", "#e9efe6", "#e0b45a"] },
  { key: "chaldea", label: "Chaldea", about: "Slate and holographic blue.", swatch: ["#edf0f4", "#172a45", "#1d5fa8"], dark: ["#0f131a", "#e8edf4", "#6fb0f0"] },
  { key: "sakura", label: "Sakura", about: "Blush and plum.", swatch: ["#f7eff1", "#4a1f35", "#b0306a"], dark: ["#170f13", "#f6e9ee", "#f39abf"] },
  { key: "ember", label: "Ember", about: "Charcoal and crimson.", swatch: ["#f2efee", "#2a1d1b", "#b3261e"], dark: ["#141010", "#f3ecea", "#ff8a7a"] },
  { key: "mono", label: "Mono", about: "Black and white, nothing else.", swatch: ["#f4f4f4", "#111111", "#111111"], dark: ["#0d0d0d", "#f0f0f0", "#f0f0f0"] },
  // A whole look rather than colours alone: its fonts replace the defaults
  // (a font picked in Settings still wins), and style.css adds the borders,
  // square corners, grain and faded photographs.
  { key: "horror", label: "Horror Story", about: "After American Horror Story: tall Art Nouveau titles in blood red, like the show's Mackintosh-style logo; typewritten case-file labels; antique print for the story; hand-inked borders and moving film grain, after the Super 16mm opening titles. Pick a season below.",
    swatch: ["#e6dcc8", "#1b1311", "#8f1218"], dark: ["#0d0b0a", "#e9dfcc", "#e2463e"],
    fonts: {
      site: { stack: '"Special Elite", "Courier New", monospace', href: gf("Special+Elite") },
      chat: { stack: `"IM Fell English", ${SERIF}`, href: gf("IM+Fell+English:ital@0;1") },
      // The logo is ITC Willow, after Charles Rennie Mackintosh's lettering
      // (neither is free); Aubrey is the closest free condensed Art Nouveau face.
      head: { stack: `"Aubrey", "IM Fell English SC", ${SERIF}`, href: gf("Aubrey") },
    } },
];

// Horror Story's seasons, the looks fans know them by.
export const SEASONS = [
  { key: "murder", label: "Murder House", about: "Blood red on black, the house on Westmoreland Place." },
  { key: "asylum", label: "Asylum", about: "Briarcliff: institutional green, rust, and ruled case files." },
  { key: "coven", label: "Coven", about: "Black lace and white, with a witch's violet." },
  { key: "hotel", label: "Hotel", about: "The Cortez: art deco crimson and gold, with neon." },
];

// Short lines the fandom quotes most, shown under the home page title.
// A season shows its own line; the others take turns, one a day.
const EPIGRAPHS = [
  { season: "murder", text: "Normal people scare me.", who: "Tate Langdon, Murder House" },
  { season: "asylum", text: "All monsters are human.", who: "Sister Jude, Asylum" },
  { season: "coven", text: "Surprise, bitch.", who: "Madison Montgomery, Coven" },
];
export function epigraph() {
  if (getLook("palette") !== "horror") return null;
  return EPIGRAPHS.find((e) => e.season === getLook("horrorSeason"))
    ?? EPIGRAPHS[Math.floor(Date.now() / 86400000) % EPIGRAPHS.length];
}

export const CORNERS = [["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]];

const DEFAULTS = { palette: "moon", chatFont: "rounded", siteFont: "rounded", headFont: "fraunces", corners: "soft", accent: "", horrorSeason: "murder" };
const VARS = ["--font", "--chat-font", "--font-display", "--accent", "--accent-hover", "--accent-soft", "--on-accent"];

export function getLook(key) {
  try { return localStorage.getItem(key) ?? DEFAULTS[key]; } catch { return DEFAULTS[key]; }
}

export function setLook(key, value) {
  try { !value || value === DEFAULTS[key] ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
  applyLooks();
}

// ---------- Accent ----------
const luminance = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v ?? ""));

// One colour for both themes: hover leans toward the ink, the soft tint
// toward the surface, so both follow light and dark on their own.
function accentVars(hex) {
  return {
    "--accent": hex,
    "--accent-hover": `color-mix(in srgb, ${hex} 78%, var(--ink))`,
    "--accent-soft": `color-mix(in srgb, ${hex} 20%, var(--surface))`,
    "--on-accent": contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111",
  };
}

// ---------- Apply ----------
export function applyLooks() {
  const root = document.documentElement;
  const pick = (list, key) => list.find((f) => f.key === getLook(key)) ?? list[0];
  // A palette with fonts of its own fills every font left at its default.
  const own = PALETTES.find((p) => p.key === getLook("palette"))?.fonts;
  const chat = own && getLook("chatFont") === DEFAULTS.chatFont ? { key: "theme", ...own.chat } : pick(CHAT_FONTS, "chatFont");
  const site = own && getLook("siteFont") === DEFAULTS.siteFont ? { key: "theme", ...own.site } : pick(SITE_FONTS, "siteFont");
  const head = own && getLook("headFont") === DEFAULTS.headFont ? { key: "theme", ...own.head } : pick(HEAD_FONTS, "headFont");

  const vars = {};
  if (site.key !== "rounded") vars["--font"] = site.stack;
  // The chat follows the site font unless told otherwise, so Rounded stays Nunito.
  if (chat.key !== "rounded" || site.key !== "rounded") vars["--chat-font"] = chat.stack;
  if (head.key !== "fraunces") vars["--font-display"] = head.key === "site" ? site.stack : head.stack;
  const accent = getLook("accent");
  if (isHex(accent)) Object.assign(vars, accentVars(accent));
  for (const k of VARS) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

  const palette = getLook("palette");
  if (palette === "paper") delete root.dataset.palette; else root.dataset.palette = palette;
  if (chat.key === "rounded" || chat.key === "theme") delete root.dataset.chatFont; else root.dataset.chatFont = chat.key;
  const corners = getLook("corners");
  if (corners === "soft") delete root.dataset.corners; else root.dataset.corners = corners;
  const season = palette === "horror" ? getLook("horrorSeason") : "murder";
  if (season === "murder") delete root.dataset.season; else root.dataset.season = season;
  if (palette === "horror") addScratchFilter();

  const links = [...new Set([chat, site, head].map((f) => f.href).filter(Boolean))];
  loadFonts(links);
  try { localStorage.setItem("looks", JSON.stringify({ vars, links })); } catch { /* private mode */ }
}

// Rough, scratched edges for big titles, like the show's logo. A CSS filter
// can only point at an SVG filter in the same page, so it is added here once.
function addScratchFilter() {
  if (document.getElementById("mp-scratch")) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  svg.innerHTML = '<filter id="mp-scratch" x="-2%" y="-10%" width="104%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="1" seed="7" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>';
  document.body.append(svg);
}

export function loadFonts(links) {
  for (const href of links) {
    if (document.querySelector(`link[data-font="${CSS.escape(href)}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.dataset.font = href;
    document.head.append(l);
  }
}

// ---------- Controls ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function fontSelectHTML(id, list, value) {
  const groups = [...new Set(list.map((f) => f.group ?? ""))];
  const opt = (f) => `<option value="${f.key}" ${f.key === value ? "selected" : ""}>${esc(f.label)}</option>`;
  return `<select id="${id}">${groups.map((g) => (g
    ? `<optgroup label="${esc(g)}">${list.filter((f) => f.group === g).map(opt).join("")}</optgroup>`
    : list.filter((f) => !f.group).map(opt).join(""))).join("")}</select>`;
}

export function paletteSwatchesHTML(name, value) {
  return `<div class="swatches">${PALETTES.map((p) => `
    <label class="swatch" title="${esc(p.about)}">
      <input type="radio" name="${name}" value="${p.key}" ${p.key === value ? "checked" : ""}>
      <span class="swatch-chip" aria-hidden="true" style="--sw-bg:${p.swatch[0]};--sw-ink:${p.swatch[1]};--sw-accent:${p.swatch[2]};--sw-bg-dark:${p.dark[0]};--sw-ink-dark:${p.dark[1]};--sw-accent-dark:${p.dark[2]}"><i></i><i></i></span>
      <span class="swatch-name">${esc(p.label)}</span>
    </label>`).join("")}</div>`;
}
