import { seed, onChange, getActiveConnection } from "./store.js";
import { $, $$, esc, confirmDialog, toast } from "./ui.js";

// ---------- Routes ----------
// Each view module exports render(main, params) and may return
// { cleanup(), isDirty() } so the router can warn about unsaved changes.
const routes = [
  [/^\/?$/, "home", () => import("./views/home.js")],
  [/^\/bot\/new$/, "home", () => import("./views/bot-edit.js")],
  [/^\/bot\/([^/]+)$/, "home", () => import("./views/bot-edit.js")],
  [/^\/chat\/([^/]+)(?:\/([^/]+))?$/, "home", () => import("./views/chat.js")],
  [/^\/personas$/, "personas", () => import("./views/personas.js")],
  [/^\/prompt$/, "prompt", () => import("./views/prompt.js")],
  [/^\/lore(?:\/([^/]+))?$/, "lore", () => import("./views/lore.js")],
  [/^\/connection$/, "connection", () => import("./views/connection.js")],
  [/^\/settings$/, "settings", () => import("./views/settings.js")],
];

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
  document.title = "Shiru’s Garden";
  current?.cleanup?.();
  current = null;

  const path = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  const match = routes.map(([re, nav, load]) => ({ m: path.match(re), nav, load })).find((r) => r.m);
  $$("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", false));
  document.body.classList.remove("in-chat");

  if (!match) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Page not found</h2>
      <p>There is nothing at this address.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  $(`[data-nav="${match.nav}"]`)?.setAttribute("aria-current", "page");
  try {
    const view = await match.load();
    main.innerHTML = "";
    current = (await view.render(main, match.m.slice(1))) ?? null;
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="wrap page"><div class="note bad">${esc(err.message)}</div></div>`;
  }
  if (!path.startsWith("/chat")) window.scrollTo({ top: 0 });
  if (document.activeElement === document.body) main.focus({ preventScroll: true });
}

window.addEventListener("beforeunload", (e) => { if (current?.isDirty?.()) e.preventDefault(); });

// ---------- Theme ----------
const themeBtn = $("#theme-toggle");
function paintThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#151413" : "#f4f1ec"));
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
route();
