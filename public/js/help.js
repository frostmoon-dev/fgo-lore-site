// First-visit tour and "What's new". The tour shows once, and any time from
// the command palette or Settings. After an update, the home page shows a
// short card listing what changed and where to find it.
import { getMeta, setMeta } from "./store.js";
import { $, esc, icon, openDialog } from "./ui.js";

export const APP_VERSION = "2026.09.24.13";

// Newest first. Each item says what it is and where it lives.
export const NEWS = [
  {
    version: "2026.09.24.13",
    items: [
      ["Journals stay journals", "Some models used to continue the story instead of writing a diary entry. Entries are now checked: a story is asked for again as a first-person entry, and if the model still will not, nothing is saved. Entries are also easier to read, in your chat font instead of italics."],
    ],
  },
  {
    version: "2026.09.24.12",
    items: [
      ["Formatted previews", "Recent chats and Pinned moments show *actions* in italics and **bold** in bold, as in the chat, instead of showing the asterisks."],
    ],
  },
  {
    version: "2026.09.24.11",
    items: [
      ["No more half-finished recaps", "When a recap, journal entry, summary or other background task runs out of room mid-sentence, it is asked for again with more room. If it is still cut off, a recap or journal entry ends at its last whole sentence."],
    ],
  },
  {
    version: "2026.09.24.10",
    items: [
      ["Send button centred", "With one line typed, the send button now sits the same distance from the top, right and bottom of the message box."],
      ["Even gaps between sections", "Fold-out sections, like Start from an idea and Paste a definition, have the same space above and below the line between them."],
    ],
  },
  {
    version: "2026.09.24.9",
    items: [
      ["Tries again when the model is busy", "Free and shared models often answer \"overloaded\" or \"try again\". The reply is now asked for again up to 3 times, waiting a little longer each time, and the line under the message box says so. Stop cancels it. Turn it off in Settings, under Chat."],
      ["Delete chats from the list", "A bin button on each chat in the chat list, and on Recent chats on the home page. Undo brings it back."],
      ["Tidier layout", "Controls share one set of sizes, stacked cards sit the same distance apart, and text, icons and labels line up along the same edges. The persona picker is a lighter pill. On phones, buttons no longer stay grey after a tap."],
      ["Unfinished actions", "An action whose closing * never came, such as in a cut-off reply, now shows in italics instead of with a stray *."],
    ],
  },
  {
    version: "2026.09.24.8",
    items: [
      ["Series", "Give each bot a series, like Fate/Grand Order or Honkai: Star Rail, in its editor. The home page gets a Series filter and a heading over each series, with favourites in their own section first. Imported cards join a series you already use when one of their tags names it."],
      ["Group scenes by series", "When adding characters to a chat, bots from the same series come first."],
    ],
  },
  {
    version: "2026.09.24.7",
    items: [
      ["Import from Chub links", "Import on the home page now takes a Chub character link, as well as card files. Paste the page's address and the card comes in with its picture and lorebook."],
      ["Import several cards at once", "Pick several PNG or JSON cards together, or drop them anywhere on the home page. A file that is not a card now says what it is and what to download instead."],
      ["Paste a definition", "For sites with no card download: paste the character text you can see, and it is sorted into the right fields without being rewritten. Under Import, or on a new bot's page."],
      ["Easier reading", "A new Clear font, made for low vision and tired eyes, sits beside Rounded, Book and Plain. Actions can show upright instead of in italics (easier on long passages). Lines stop at about 70 characters, and text is a touch heavier in dark mode. In Chat look or Settings."],
      ["Tidier spacing", "The save status sits under Save bot, Delete bot stands a little apart, the send button sits evenly inside the message box, and renaming a chat no longer cuts off the name field. Selected text uses the theme colour."],
    ],
  },
  {
    version: "2026.09.24.6",
    items: [
      ["Easier to tap on a phone", "Every button is now at least 44 pixels to a finger, the size phones recommend. Buttons look the same; they are only easier to hit."],
      ["Quieter messages on a phone", "Message buttons show on the latest reply. Tap any other message to show its buttons."],
      ["Grouped chat menu", "The ⋯ menu is split into This chat, Story, Behind the scenes and Manage, so it is quicker to scan."],
    ],
  },
  {
    version: "2026.09.24.5",
    items: [
      ["Easier-to-read actions", "Roleplay actions in italics and your own messages use a slightly stronger colour, so long passages are easier to read, especially in dark mode."],
    ],
  },
  {
    version: "2026.09.24.4",
    items: [
      ["Long chats open fast", "A chat shows its latest 100 messages. Press Show earlier at the top for more. The bot still remembers everything."],
    ],
  },
  {
    version: "2026.09.24.3",
    items: [
      ["Stronger, cheaper memory", "Long chats are now remembered as chapters, a story so far and a list of key facts, and old moments come back when they are mentioned. Each reply sends far fewer tokens. See it all from the book button in a chat."],
      ["Cache savings", "When your provider reuses part of a request from its cache, the token count under a reply says how much, and Settings → Usage shows the total."],
    ],
  },
  {
    version: "2026.09.24.2",
    items: [
      ["Your own moods", "In the bot editor, add any mood you like, such as devious, plotting or mocking, and give it a picture. The bot picks from all of them."],
    ],
  },
  {
    version: "2026.09.24",
    items: [
      ["Chat look", "In a chat, ⋯ → Chat look changes the bot's background, how dim it is, the font, the message size and the picture size."],
      ["Bigger faces", "Every picture in a chat is the same large size, faces included. A bot with a Neutral expression shows it whenever a reply has no mood."],
      ["Straight crops", "Cropping no longer squeezes pictures on short screens. Re-crop any that came out stretched."],
      ["Moods from edits", "Editing a reply to end with <mood:happy> changes its expression picture."],
    ],
  },
  {
    version: "2026.09.23.3",
    items: [
      ["Moon Cell colours", "The site is now violet and rose, after BB. The old cream and clay look is still there: Settings → Appearance → Colours → Paper, or type \"paper\" in the search box."],
      ["Moon phases", "While something works in a chat, the line under the message box shows a small moon going through its phases."],
    ],
  },
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
