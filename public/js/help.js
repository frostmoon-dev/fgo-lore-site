// First-visit tour and "What's new". The tour shows once, and any time from
// the command palette or Settings. After an update, the home page shows a
// short card listing what changed and where to find it.
import { getMeta, setMeta } from "./store.js";
import { $, esc, icon, openDialog } from "./ui.js";

export const APP_VERSION = "2026.09.23.2";

// Newest first. Each item says what it is and where it lives.
export const NEWS = [
  {
    version: "2026.09.23.2",
    items: [
      ["A new name: MoonPaper", "Same site, same data. Only the name and icon changed."],
      ["Rename in the header", "Click a chat's name at the top to rename it. Enter saves, Esc cancels."],
      ["Edit your persona in a chat", "The pencil beside \"Speaking as\" edits who you are without leaving the chat."],
    ],
  },
  {
    version: "2026.09.23",
    items: [
      ["Find anything", "Press Ctrl+K, or the search button at the top, and type what you want: a page, a bot, a setting or a chat action."],
      ["Welcome tour", "A short guide to the site. Open it again from the search box: type \"tour\"."],
      ["Backup reminders", "The home page reminds you to back up when your chats have not been saved for a week."],
      ["Dice", "Type /roll d20 in a chat, or use + → Roll dice. The bot has to respect the result."],
      ["Persona per bot", "Each bot remembers who you last were with it, and new chats start that way."],
      ["Favourite bots", "Star a bot on the home page to keep it at the front."],
    ],
  },
];

const STEPS = [
  { icon: "book", title: "Welcome to MoonPaper",
    body: "Write your own characters and talk to them through your own AI connection. Bots, chats and keys stay in this browser; nothing is uploaded." },
  { icon: "info", title: "1. Connect your AI",
    body: "Add your API key or proxy on the Connection page. The dot at the top turns green when replies are working.",
    action: ["Open Connection", "#/connection"] },
  { icon: "users", title: "2. Pick or make a bot",
    body: "Open a bot on the home page, make a new one, start from a one-line idea, or import a character card from another site." },
  { icon: "quill", title: "3. Chat",
    body: "Under the message box: the bulb suggests what to say, the pen writes your reply for you, and + holds directions, surprises, dice and translation. Each message's ⋯ menu has copy, branch, rewind and more." },
  { icon: "map", title: "4. Keep the story straight",
    body: "Memory, Scene and Characters sit at the top of a chat. The bond meter shows how the bot feels about you, and a line under the message box says what is happening." },
  { icon: "search", title: "5. Find anything",
    body: "Press Ctrl+K on a computer, or the search button at the top on a phone, and type what you want. Every page, bot, setting and chat action is there." },
];

export function showTour() {
  let i = 0;
  const dlg = openDialog(`<div class="dialog-body tour" aria-live="polite">
      <div class="tour-art" id="tour-art" aria-hidden="true"></div>
      <h2 id="tour-title"></h2>
      <p id="tour-body"></p>
      <div id="tour-action"></div>
      <div class="tour-dots" id="tour-dots" aria-hidden="true"></div>
      <p class="sr-only" id="tour-step"></p>
      <div class="dialog-actions">
        <button class="btn btn-quiet push" type="button" id="tour-skip">Skip</button>
        <button class="btn btn-ghost" type="button" id="tour-back">Back</button>
        <button class="btn btn-primary" type="button" id="tour-next">Next</button>
      </div>
    </div>`, { onClose: () => setMeta({ tourSeen: true, whatsNewSeen: APP_VERSION }) });
  const paint = () => {
    const s = STEPS[i];
    $("#tour-art", dlg).innerHTML = icon(s.icon);
    $("#tour-title", dlg).textContent = s.title;
    $("#tour-body", dlg).textContent = s.body;
    $("#tour-action", dlg).innerHTML = s.action ? `<a class="btn btn-sm" href="${s.action[1]}" id="tour-go">${esc(s.action[0])}</a>` : "";
    $("#tour-go", dlg)?.addEventListener("click", () => dlg.close());
    $("#tour-dots", dlg).innerHTML = STEPS.map((_, j) => `<span class="${j === i ? "on" : ""}"></span>`).join("");
    $("#tour-step", dlg).textContent = `Step ${i + 1} of ${STEPS.length}`;
    $("#tour-back", dlg).hidden = i === 0;
    $("#tour-skip", dlg).hidden = i === STEPS.length - 1;
    $("#tour-next", dlg).textContent = i === STEPS.length - 1 ? "Start" : "Next";
    $("#tour-next", dlg).focus();
  };
  $("#tour-next", dlg).addEventListener("click", () => { if (i === STEPS.length - 1) dlg.close(); else { i++; paint(); } });
  $("#tour-back", dlg).addEventListener("click", () => { i = Math.max(0, i - 1); paint(); });
  $("#tour-skip", dlg).addEventListener("click", () => dlg.close());
  paint();
}

export function showWhatsNew() {
  openDialog(`<div class="dialog-body">
    <h2>What's new</h2>
    ${NEWS.map((n, i) => `${i === 1 ? `<h3 class="news-earlier">Earlier</h3>` : ""}<ul class="news-list">${n.items.map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join("")}</ul>`).join("")}
    <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
  </div>`, { onClose: () => setMeta({ whatsNewSeen: APP_VERSION }) });
}

// Shows the tour to a first-time visitor. Returns true if it did.
export async function maybeShowTour() {
  const meta = await getMeta();
  if (meta.tourSeen || navigator.webdriver) return false;
  showTour();
  return true;
}

// For the home page: a small card while this version's news is unseen.
export async function whatsNewCardHTML() {
  const meta = await getMeta();
  if (!meta.tourSeen || meta.whatsNewSeen === APP_VERSION) return "";
  const latest = NEWS[0];
  return `<section class="notice-card" id="news-card" aria-labelledby="news-title">
    <span class="notice-icon" aria-hidden="true">${icon("megaphone")}</span>
    <div class="grow">
      <h2 class="card-title" id="news-title">What's new</h2>
      <p class="hint">${latest.items.map(([t]) => esc(t)).join(" · ")}</p>
    </div>
    <div class="actions">
      <button class="btn btn-sm" type="button" id="news-open">See what changed</button>
      <button class="icon-btn" type="button" id="news-close" aria-label="Dismiss what's new" title="Dismiss">${icon("x")}</button>
    </div>
  </section>`;
}
