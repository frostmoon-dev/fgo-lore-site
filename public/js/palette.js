// The command palette: one box that finds any page, bot, setting or chat
// action. Ctrl+K (Cmd+K on a Mac) or the search button in the header opens
// it. Views add their own commands while they are on screen.
import { bots } from "./store.js";
import { $, $$, esc, openDialog } from "./ui.js";

const providers = new Set();
// fn() returns [{ title, hint, group, keywords, run }]; returns an unregister.
export function registerCommands(fn) { providers.add(fn); return () => providers.delete(fn); }

// Opens Settings at one card, even when Settings is already open.
export function goToSettings(section) {
  try { sessionStorage.setItem("settingsFocus", section); } catch { /* private mode */ }
  if (location.hash === "#/settings") {
    const el = document.getElementById(`set-${section}`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
    el?.classList.remove("flash-card"); void el?.offsetWidth; el?.classList.add("flash-card");
    try { sessionStorage.removeItem("settingsFocus"); } catch {}
  } else location.hash = "#/settings";
}

const go = (hash) => () => { location.hash = hash; };
const GROUP_ORDER = ["This chat", "Go to", "Bots", "Settings", "Help"];

async function baseCommands() {
  const allBots = await bots.all();
  const dark = document.documentElement.dataset.theme === "dark";
  const set = (title, section, keywords = "") => ({ group: "Settings", title, keywords, run: () => goToSettings(section) });
  return [
    { group: "Go to", title: "Bots", hint: "Home", keywords: "home library", run: go("#/") },
    { group: "Go to", title: "New bot", keywords: "create character make", run: go("#/bot/new") },
    { group: "Go to", title: "Search all chats", keywords: "find message", run: go("#/search") },
    { group: "Go to", title: "Personas", keywords: "who you are me", run: go("#/personas") },
    { group: "Go to", title: "Prompt", keywords: "main prompt preset generation temperature", run: go("#/prompt") },
    { group: "Go to", title: "Lore", keywords: "lorebook world", run: go("#/lore") },
    { group: "Go to", title: "Connection", keywords: "api key proxy model", run: go("#/connection") },
    { group: "Go to", title: "Settings", run: go("#/settings") },
    ...allBots.flatMap((b) => [
      { group: "Bots", title: `Chat with ${b.name || "Unnamed"}`, keywords: `${b.tags.join(" ")} talk open`, run: go(`#/chat/${b.id}`) },
      { group: "Bots", title: `Edit ${b.name || "Unnamed"}`, keywords: "bot editor definition expressions", run: go(`#/bot/${b.id}`) },
    ]),
    set("Appearance and text size", "appearance", "theme font size larger smaller"),
    { group: "Settings", title: dark ? "Switch to light theme" : "Switch to dark theme", keywords: "theme mode colours", run: () => document.getElementById("theme-toggle")?.click() },
    set("Install as an app", "install", "home screen pwa offline"),
    set("Mature content", "content", "nsfw explicit 18+ adult"),
    set("Chat background", "background", "picture image"),
    set("Bond settings", "bond", "relationship meter"),
    set("Languages and translation", "languages", "translate"),
    set("Memory settings", "memory", "summary"),
    set("Chat settings", "chat", "enter send journal recap confirm"),
    set("Usage and cost", "usage", "tokens price spend"),
    set("Back up or restore your data", "data", "backup export import restore download"),
    { group: "Help", title: "Welcome tour", keywords: "help guide start how", run: async () => (await import("./help.js")).showTour() },
    { group: "Help", title: "What's new", keywords: "changes update release", run: async () => (await import("./help.js")).showWhatsNew() },
  ];
}

function score(cmd, words) {
  const title = cmd.title.toLowerCase();
  const hay = `${title} ${(cmd.keywords ?? "").toLowerCase()} ${(cmd.hint ?? "").toLowerCase()} ${cmd.group.toLowerCase()}`;
  if (!words.every((w) => hay.includes(w))) return -1;
  let s = 0;
  for (const w of words) s += title.startsWith(w) ? 3 : title.includes(` ${w}`) ? 2 : title.includes(w) ? 1 : 0;
  return s;
}

let open = false;
export async function openPalette() {
  if (open) return;
  open = true;
  const commands = [...[...providers].flatMap((fn) => fn()), ...(await baseCommands())];
  const dlg = openDialog(`
    <div class="palette" role="presentation">
      <label class="sr-only" for="pal-input">Search pages, bots, settings and actions</label>
      <input type="text" id="pal-input" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list"
        placeholder="Search everything" autocomplete="off" spellcheck="false">
      <ul class="pal-list" id="pal-list" role="listbox" aria-label="Results"></ul>
      <p class="pal-foot hint" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></p>
    </div>`, { onClose: () => { open = false; } });
  dlg.classList.add("palette-dialog");
  const input = $("#pal-input", dlg);
  const list = $("#pal-list", dlg);
  let shown = [];
  let active = 0;

  function paint() {
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const found = commands
      .map((c) => ({ c, s: words.length ? score(c, words) : 0 }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group));
    shown = found.map((x) => x.c).slice(0, 40);
    // With a query, offer a full-text search of every chat as well.
    if (q) shown.push({ group: "Go to", title: `Search chats for “${input.value.trim()}”`, run: go(`#/search?q=${encodeURIComponent(input.value.trim())}`) });
    if (!words.length) shown.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    active = 0;
    let lastGroup = "";
    list.innerHTML = shown.map((c, i) => {
      const head = !words.length && c.group !== lastGroup ? `<li class="pal-group" role="presentation">${esc(c.group)}</li>` : "";
      lastGroup = c.group;
      return `${head}<li class="pal-item" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === 0}">
        <span class="t">${esc(c.title)}</span>${c.hint ? `<span class="h">${esc(c.hint)}</span>` : words.length ? `<span class="h">${esc(c.group)}</span>` : ""}</li>`;
    }).join("");
    select(0);
  }
  function select(i) {
    if (!shown.length) return;
    active = (i + shown.length) % shown.length;
    $$(".pal-item", list).forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.i) === active)));
    const el = $(`#pal-${active}`, list);
    input.setAttribute("aria-activedescendant", el?.id ?? "");
    el?.scrollIntoView({ block: "nearest" });
  }
  function run(i) {
    const cmd = shown[i];
    if (!cmd) return;
    dlg.close();
    cmd.run();
  }
  input.addEventListener("input", paint);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); select(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); select(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); run(active); }
  });
  list.addEventListener("click", (e) => { const li = e.target.closest(".pal-item"); if (li) run(Number(li.dataset.i)); });
  list.addEventListener("pointermove", (e) => { const li = e.target.closest(".pal-item"); if (li && Number(li.dataset.i) !== active) select(Number(li.dataset.i)); });
  paint();
  input.focus();
}
