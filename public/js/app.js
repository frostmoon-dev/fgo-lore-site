import { seed, onChange, getActiveConnection } from "./store.js";
import { $, $$, esc, confirmDialog, toast } from "./ui.js";
import { registerServiceWorker } from "./install.js";
import { openPalette, goToSettings } from "./palette.js";
import { maybeShowTour } from "./help.js";

// ---------- Routes ----------
// Each view module exports render(main, params) and may return
// { cleanup(), isDirty() } so the router can warn about unsaved changes.
const routes = [
  [/^\/?$/, "home", () => import("./views/home.js")],
  [/^\/bot\/new$/, "home", () => import("./views/bot-edit.js")],
  [/^\/bot\/([^/]+)$/, "home", () => import("./views/bot-edit.js")],
  [/^\/chat\/([^/?]+)(?:\/([^/?]+))?(?:\?m=([^/?]+))?$/, "home", () => import("./views/chat.js")],
  [/^\/search(?:\?q=(.*))?$/, "search", () => import("./views/search.js")],
  [/^\/personas$/, "personas", () => import("./views/personas.js")],
  [/^\/prompt$/, "prompt", () => import("./views/prompt.js")],
  [/^\/lore(?:\/([^/]+))?$/, "lore", () => import("./views/lore.js")],
  [/^\/connection$/, "connection", () => import("./views/connection.js")],
  [/^\/settings$/, "settings", () => import("./views/settings.js")],
];

// Where the Back button goes when there is no earlier page in this visit.
const parents = [
  [/^\/lore\/.+/, "#/lore"],
  [/./, "#/"],
];
const parentOf = (path) => parents.find(([re]) => re.test(path))[1];

// Every history entry made in this visit gets a depth, so Back knows
// whether stepping back stays inside the site or would leave it.
let depth = -1;
function trackDepth() {
  if (Number.isInteger(history.state?.depth)) depth = history.state.depth;
  else { depth += 1; history.replaceState({ ...history.state, depth }, ""); }
}

const main = $("#main");
let current = null;
let currentHash = location.hash;
let skipNext = false;

async function route() {
  if (skipNext) { skipNext = false; return; }
  if (current?.isDirty?.() && location.hash !== currentHash) {
    const leave = await confirmDialog({
      title: "Leave without saving?",
      body: "You have changes that are not saved yet.",
      confirm: "Discard changes", danger: true,
    });
    if (!leave) { skipNext = true; location.hash = currentHash; return; }
  }
  currentHash = location.hash;
  trackDepth();
  document.title = "Shiru’s Garden";
  current?.cleanup?.();
  current = null;

  const path = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  const match = routes.map(([re, nav, load]) => ({ m: path.match(re), nav, load })).find((r) => r.m);
  paintNavPair(path);
  $$("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", false));
  document.body.classList.remove("in-chat");

  if (!match) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Page not found</h2>
      <p>There is nothing at this address.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  $(`[data-nav="${match.nav}"]`)?.setAttribute("aria-current", "page");
  main.innerHTML = "";
  // Only show a placeholder when loading is slow enough to notice.
  const slow = setTimeout(() => { main.innerHTML = skeletonHTML(match.nav); }, 120);
  try {
    const view = await match.load();
    current = (await view.render(main, match.m.slice(1))) ?? null;
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="wrap page"><div class="note bad">${esc(err.message)}</div></div>`;
  }
  clearTimeout(slow);
  main.firstElementChild?.classList.add("route-in");
  if (!path.startsWith("/chat")) window.scrollTo({ top: 0 });
  if (document.activeElement === document.body) main.focus({ preventScroll: true });
}

function skeletonHTML(nav) {
  const cards = nav === "home"
    ? `<div class="bot-grid" style="margin-top:var(--s6)">${'<span class="skeleton skeleton-card"></span>'.repeat(4)}</div>` : "";
  return `<div class="wrap page" aria-busy="true" aria-label="Loading">
    <span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line"></span>${cards}</div>`;
}

// ---------- Back and Home ----------
// Always in the same place so the header never shifts. Back is only
// disabled on the home page when there is nowhere earlier to go.
function paintNavPair(path) {
  $("#nav-back").disabled = path === "/" && depth <= 0;
  $("#nav-home").toggleAttribute("aria-current", path === "/");
  if (path === "/") $("#nav-home").setAttribute("aria-current", "page");
}
$("#nav-back").addEventListener("click", () => {
  if (depth > 0) history.back();
  else location.hash = parentOf(decodeURIComponent(location.hash.replace(/^#/, "")) || "/");
});

window.addEventListener("beforeunload", (e) => { if (current?.isDirty?.()) e.preventDefault(); });

// ---------- Theme ----------
const themeBtn = $("#theme-toggle");
function paintThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#161412" : "#f3efe8"));
}
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  paintThemeButton();
});
paintThemeButton();

// ---------- Connection status in the header ----------
// Views fire "api-status" after each request: true = worked, false = failed.
let lastResult = null;
window.addEventListener("api-status", (e) => { lastResult = e.detail; paintStatus(); });

async function paintStatus() {
  const el = $("#status");
  const conn = await getActiveConnection();
  const dot = $(".status-dot", el);
  const label = $(".label", el);
  dot.className = "status-dot";
  if (!conn) {
    dot.classList.add("off");
    label.textContent = "Set up a connection";
    return;
  }
  if (lastResult === true) dot.classList.add("on");
  if (lastResult === false) dot.classList.add("off");
  const model = conn.mode === "server" ? (conn.model || "server default") : (conn.model || "no model chosen");
  label.textContent = model;
  el.setAttribute("aria-label", `Connection ${conn.name}, model ${model}${lastResult === false ? ", last request failed" : ""}. Open connection settings.`);
}


// ---------- Boot ----------
onChange((what) => {
  if (what === "connections") lastResult = null;
  if (["connections", "settings", "all"].includes(what)) paintStatus();
});
window.addEventListener("hashchange", route);

try {
  await seed();
} catch (err) {
  toast(`Browser storage is unavailable, so nothing will be saved. (${err.message})`, "error", { timeout: 0 });
}
paintStatus();
await route();
registerServiceWorker();
maybeShowTour();

// ---------- Command palette ----------
const isMac = /mac|iphone|ipad/i.test(navigator.platform);
const kbd = document.querySelector(".palette-hint kbd");
if (kbd) kbd.textContent = isMac ? "⌘K" : "Ctrl K";
$("#palette-btn").addEventListener("click", openPalette);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!document.querySelector("dialog[open]")) openPalette();
  }
});
$("#footer-backup")?.addEventListener("click", (e) => { e.preventDefault(); goToSettings("data"); });
