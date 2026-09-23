import {
  bots, chats, lore, personas, getSettings, getActiveConnection, getActivePreset,
  getLorebooks, saveLorebooks, newLorebook, newLore, loreForBot, bondTier, bondLevels, BOND_KINDS, moodsOf, uid, now,
  getBotPersonas, rememberBotPersona,
} from "../store.js";
import { registerCommands } from "../palette.js";
import { chatCompletion, listModels } from "../api.js";
import {
  buildPrompt, generationParams, currentText, applyMacros, readBond, readMood, stripBond, cleanImpersonation, contentLevel,
} from "../prompt.js";
import {
  summarize, suggestLore, checkCharacter, transcript, suggestReplies, translate, updateScene, recap, storyFrom, nameChat,
  journalEntry, surpriseEvent,
} from "../ai.js";
import { bondChartHTML, wireBondChart } from "../chart.js";
import { renderMarkdown } from "../markdown.js";
import {
  $, $$, esc, icon, avatarHTML, toast, confirmDialog, promptDialog, openDialog, openMenu,
  download, slug, timeAgo, clock, autosize, sliderHTML, wireSlider,
} from "../ui.js";

// New chats are numbered per bot: Chat 1, Chat 2, … Renamed chats keep
// their names and do not use up a number.
function nextChatTitle(existing) {
  const used = existing.map((c) => Number(/^Chat (\d+)$/.exec(c.title)?.[1])).filter(Number.isFinite);
  return `Chat ${Math.max(existing.length, ...used, 0) + 1}`;
}

// Dice: "/roll 2d6+1 to pick the lock" → { expr, rolls, mod, total, label }.
// Up to 20 dice of up to 1000 sides. Returns null when it is not a roll.
export function parseRoll(text) {
  const m = /^\/roll\s+(\d{0,2})d(\d{1,4})\s*([+-]\s*\d{1,4})?\s*(.*)$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1] || 1);
  const sides = Number(m[2]);
  if (n < 1 || n > 20 || sides < 2 || sides > 1000) return null;
  const mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
  const label = m[4].replace(/^(for|to)\s+/i, "").trim();
  return rollDice(n, sides, mod, label);
}
export function rollDice(n, sides, mod = 0, label = "") {
  const rolls = Array.from({ length: n }, () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return 1 + (buf[0] % sides);
  });
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const expr = `${n}d${sides}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ""}`;
  return { expr, rolls, mod, total, sides, n, label };
}
const rollText = (r) => {
  const parts = r.rolls.length > 1 || r.mod ? ` (${r.rolls.join(" + ")}${r.mod ? ` ${r.mod > 0 ? "+" : "−"} ${Math.abs(r.mod)}` : ""})` : "";
  return `*rolls ${r.expr}${r.label ? ` to ${r.label}` : ""}: **${r.total}**${parts}*`;
};

function newChat(bot, personaId, existing = []) {
  const openings = [bot.greeting, ...(bot.altGreetings ?? [])].filter((g) => g?.trim());
  return {
    id: uid(), botId: bot.id, personaId,
    title: nextChatTitle(existing),
    bondStart: null, // null follows the default in Settings
    castIds: [],     // other bots in a group scene
    memory: null,    // { text, upTo, updatedAt, auto }
    messages: openings.length
      ? [{ id: uid(), role: "assistant", botId: bot.id, swipes: openings, swipeIndex: 0, meta: openings.map(() => ({ greeting: true })), at: now() }]
      : [],
    createdAt: now(), updatedAt: now(),
  };
}

// One-reply nudges offered from the Regenerate menu.
const NUDGES = [
  { label: "Shorter", note: "Make this reply noticeably shorter than usual, about half the length." },
  { label: "Longer", note: "Make this reply longer and more detailed than usual." },
  { label: "More emotion", note: "Show more of {{char}}'s feelings and inner reactions, through actions and subtext rather than stating them." },
  { label: "More action", note: "Put more physical action and movement into this reply, and move the scene forward." },
  { label: "More dialogue", note: "Make this reply mostly spoken dialogue, with little narration." },
];

export async function render(main, [botId, chatId, jumpTo]) {
  const bot = await bots.get(botId);
  if (!bot) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Not found</h2>
      <p>That bot may have been deleted.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  document.body.classList.add("in-chat");

  const [settings, allPersonas, activePersona, allBots, botPersonas] = await Promise.all([getSettings(), personas.all(), personas.active(), bots.all(), getBotPersonas()]);
  // New chats start as whoever you last were with this bot.
  let startPersonaId = allPersonas.some((p) => p.id === botPersonas[bot.id]) ? botPersonas[bot.id] : activePersona?.id ?? null;
  let list = await chats.forBot(bot.id);
  let chat = (chatId && list.find((c) => c.id === chatId)) || (!chatId && list[0]) || null;
  if (!chat) {
    chat = newChat(bot, startPersonaId, list);
    await chats.save(chat);
    list = await chats.forBot(bot.id);
  }
  chat.castIds ??= [];
  chat.journal ??= [];
  let activeConn = await getActiveConnection();
  const lastVisit = chat.updatedAt ?? 0;
  history.replaceState(history.state, "", `#/chat/${bot.id}/${chat.id}`);

  let busy = false;
  let controller = null;
  let pendingError = null; // shown under the log, not saved
  let editingId = null;
  let memoryBusy = false;
  let sceneBusy = false;
  const checking = new Set();    // message ids being checked
  const translating = new Set(); // message ids being translated

  const persona = () => allPersonas.find((p) => p.id === chat.personaId) ?? activePersona;
  const background = bot.background ?? settings.chatBackground ?? null;
  if (background) main.style.setProperty("--bg-dim", String(settings.backgroundDim ?? 0.86));

  // ---------- Who is in the scene ----------
  const botById = new Map(allBots.map((b) => [b.id, b]));
  const cast = () => chat.castIds.map((id) => botById.get(id)).filter(Boolean);
  const group = () => cast().length > 0;
  const everyone = () => [bot, ...cast()];
  // Replies written before group scenes existed belong to the chat's own bot.
  const speakerOf = (m) => (m.role === "assistant" ? botById.get(m.botId ?? bot.id) ?? (m.botId === bot.id || !m.botId ? bot : { id: m.botId, name: "Someone", avatar: null }) : null);
  const withSpeakers = (msgs) => msgs.map((m) => (m.role === "assistant" && !m.botId ? { ...m, botId: bot.id } : m));
  const others = (speaker) => everyone().filter((b) => b.id !== speaker.id);
  const userName = () => persona()?.name || "You";
  const namesFor = (speaker = bot) => ({ char: speaker.name, user: userName() });
  const nameOf = (m) => (m.role === "user" ? userName() : speakerOf(m).name);

  // Auto: the character the message names, otherwise whoever has been
  // quiet the longest.
  function pickSpeaker(text = "") {
    const chosen = $("#speaker", main)?.value;
    if (chosen && chosen !== "auto") return botById.get(chosen) ?? bot;
    if (!group()) return bot;
    const lower = text.toLowerCase();
    const named = everyone()
      .map((b) => ({ b, at: lower.search(new RegExp(`\\b${b.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)) }))
      .filter((x) => x.at !== -1).sort((a, b) => a.at - b.at)[0];
    if (named) return named.b;
    const lastSpoke = (b) => chat.messages.findLastIndex((m) => m.role === "assistant" && (m.botId ?? bot.id) === b.id);
    return [...everyone()].sort((a, b) => lastSpoke(a) - lastSpoke(b))[0];
  }

  // ---------- Bonds ----------
  // The chat's own bot keeps chat.bondStart; in a group scene every other
  // character has a bond of its own, started from chat.bondStarts[id].
  // A bond is its start plus the changes in that character's replies now on
  // screen, so swiping, editing or deleting a reply keeps it honest.
  chat.bondStarts ??= {};
  chat.pendingMilestones ??= chat.pendingMilestone ? { [bot.id]: chat.pendingMilestone } : {};
  delete chat.pendingMilestone;
  const bondOnFor = (b) => settings.bond?.enabled !== false && b?.bondEnabled !== false && botById.has(b?.id);
  const milestonesFor = (b) => b.bondMilestones !== false;
  const bondDefault = () => Number(settings.bond?.start ?? 20);
  const bondStartFor = (b) => {
    const v = b.id === bot.id ? chat.bondStart : chat.bondStarts[b.id];
    return Number.isFinite(v) ? Number(v) : bondDefault();
  };
  const spokeBy = (m, b) => m.role === "assistant" && (m.botId ?? bot.id) === b.id;
  function bondEarnedFor(b, upTo = chat.messages.length) {
    return chat.messages.slice(0, upTo).reduce((total, m) => {
      const delta = spokeBy(m, b) ? m.meta?.[m.swipeIndex ?? 0]?.bond : 0;
      return total + (Number.isFinite(delta) ? delta : 0);
    }, 0);
  }
  const kindName = (b) => (b.bondKind === "custom" ? "" : (BOND_KINDS[b.bondKind] ?? BOND_KINDS.affection).name);
  const levelOf = (b, raw) => {
    const value = Math.max(0, Math.min(100, raw));
    const t = bondTier(value, b);
    return { value, label: t.label, behavior: t.behavior, index: t.index, kind: kindName(b) };
  };
  const bondFor = (b, start = bondStartFor(b)) => levelOf(b, start + bondEarnedFor(b));
  // Every point where this character's bond changed, for the chart.
  function bondHistory(b) {
    let running = bondStartFor(b);
    const points = [{ x: 0, ...levelOf(b, running) }];
    chat.messages.forEach((m, i) => {
      const delta = spokeBy(m, b) ? m.meta?.[m.swipeIndex ?? 0]?.bond : 0;
      if (Number.isFinite(delta) && delta !== 0) { running += delta; points.push({ x: i + 1, ...levelOf(b, running) }); }
    });
    // Carry the line to the latest message so the chart reads to "now".
    if (points.at(-1).x < chat.messages.length) points.push({ x: chat.messages.length, ...levelOf(b, running) });
    return points;
  }
  const bondOn = bondOnFor(bot); // the meter in the header follows the chat's own bot
  const bondNow = () => bondFor(bot);

  // A bot's picture always opens its editor.
  const botAvatar = (b, size, extra = "") =>
    `<a class="avatar-link${extra}" href="#/bot/${b.id}" aria-label="Edit ${esc(b.name)}" title="Edit ${esc(b.name)}">${avatarHTML(b.avatar, b.name, size)}</a>`;

  main.innerHTML = `
    <div class="chat-layout">
      <aside class="chat-sidebar" id="sidebar" aria-label="Chats with ${esc(bot.name)}">
        <div class="chat-sidebar-head">
          <div class="chat-sidebar-bot">
            ${botAvatar(bot, 48)}
            <div class="grow"><div class="name">${esc(bot.name)}</div>
              <a href="#/bot/${bot.id}" class="link-btn">Edit bot</a></div>
          </div>
          <button class="btn btn-primary" type="button" id="new-chat">New chat</button>
        </div>
        <h2 class="sr-only">Chat history</h2>
        <ul class="chat-list" id="chat-list"></ul>
      </aside>
      <div class="scrim" id="scrim" hidden></div>

      <section class="chat-main${background ? " has-bg" : ""}" aria-label="Conversation">
        ${background ? `<div class="chat-bg" style="background-image:url('${esc(background)}')" aria-hidden="true"></div>` : ""}
        <div class="chat-topbar">
          <button class="icon-btn only-mobile" type="button" id="open-sidebar" aria-label="Show chats" aria-controls="sidebar" aria-expanded="false">${icon("menu")}</button>
          ${botAvatar(bot, 36, " only-mobile")}
          <div class="title"><span class="title-line"><button class="title-edit" type="button" id="chat-title" title="Rename this chat"></button><input type="text" class="title-input" id="title-input" aria-label="Chat name" maxlength="80" autocomplete="off" hidden><span class="content-tag" id="content-tag" hidden></span></span><small id="chat-sub"></small></div>
          ${bondOn ? `<button class="bond" type="button" id="bond" title="Bond with ${esc(bot.name)} · set where it starts">
            <span class="bond-label" id="bond-label"></span>
            <span class="bond-bar"><span class="bond-fill" id="bond-fill"></span></span>
          </button>` : ""}
          <button class="model-chip hide-narrow" type="button" id="model-chip" aria-haspopup="menu" aria-expanded="false"></button>
          <button class="icon-btn tool-btn hide-narrow" type="button" id="memory" aria-label="Memory" title="Memory">${icon("book")}<span class="tool-label">Memory</span></button>
          <button class="icon-btn tool-btn hide-narrow" type="button" id="scene" aria-label="Scene tracker" title="Scene tracker">${icon("map")}<span class="tool-label">Scene</span></button>
          <button class="icon-btn tool-btn hide-narrow" type="button" id="cast" aria-label="Characters in this chat" title="Characters in this chat">${icon("users")}<span class="tool-label">Characters</span></button>
          <button class="icon-btn" type="button" id="more" aria-label="More chat actions" aria-haspopup="menu" aria-expanded="false" title="More">${icon("dots")}</button>
        </div>

        <div class="chat-log" id="log" tabindex="0" aria-label="Messages">
          <div class="chat-log-inner" id="log-inner"></div>
        </div>
        <p class="sr-only" id="announce" aria-live="polite"></p>

        <form class="composer" id="composer">
          <div class="composer-inner">
            <div class="note bad" id="no-conn" hidden>
              ${icon("info")}<span>No API connection yet. <a href="#/connection">Set one up</a> to start talking.</span>
            </div>
            <section class="recap-card" id="recap" hidden aria-labelledby="recap-title">
              <div class="recap-head"><h2 id="recap-title">Previously…</h2>
                <button class="icon-btn" type="button" id="recap-close" aria-label="Dismiss recap" title="Dismiss">${icon("x")}</button></div>
              <div class="recap-body" id="recap-body"></div>
            </section>
            <div class="draft-bar" id="draft-bar" hidden>
              <span class="grow" id="draft-status" aria-live="polite"></span>
              <button class="btn btn-quiet btn-sm" type="button" id="draft-retry">Try again</button>
              <button class="btn btn-quiet btn-sm" type="button" id="draft-undo">Undo</button>
            </div>
            <div class="direct-bar" id="direct-bar" hidden>
              <label for="direction" class="direct-label" id="direct-label">Direction</label>
              <input type="text" id="direction" autocomplete="off"
                placeholder="For the next reply only, e.g. time skip to nightfall" aria-describedby="direct-hint">
              <button class="icon-btn" type="button" id="direct-reroll" aria-label="Another surprise" title="Another surprise" hidden>${icon("refresh")}</button>
              <button class="icon-btn" type="button" id="direct-clear" aria-label="Remove direction" title="Remove">${icon("x")}</button>
              <span class="sr-only" id="direct-hint">Sent to the model with the next reply, then cleared. It does not appear in the chat.</span>
            </div>
            <div class="suggest-bar" id="suggest-bar" hidden>
              <span class="suggest-title" id="suggest-title">Ideas</span>
              <div class="suggest-list" id="suggest-list" aria-live="polite"></div>
              <button class="icon-btn" type="button" id="suggest-more" aria-label="Other ideas" title="Other ideas">${icon("refresh")}</button>
              <button class="icon-btn" type="button" id="suggest-close" aria-label="Close ideas" title="Close">${icon("x")}</button>
            </div>
            <div class="composer-box">
              <label for="input" class="sr-only">Message</label>
              <textarea id="input" rows="1" placeholder="Message ${esc(bot.name)}…" enterkeyhint="send"></textarea>
              <button class="icon-btn composer-tool" type="button" id="composer-more" aria-label="More tools: direct the next reply, translate your message" aria-haspopup="menu" aria-expanded="false" title="More tools">${icon("plus")}</button>
              <button class="icon-btn composer-tool hide-narrow" type="button" id="suggest" aria-label="Ideas for what to say next" title="Ideas for what to say (Alt+S)">${icon("bulb")}</button>
              <button class="icon-btn composer-tool" type="button" id="impersonate"
                aria-label="Write my reply. Uses what you typed as the idea." title="Write my reply (Alt+W)">${icon("quill")}</button>
              <button class="send-btn" type="submit" id="send" aria-label="Send message">${icon("send")}</button>
            </div>
            <div class="composer-foot">
              <span class="persona-group">
              <label class="persona-pick"><span>Speaking as</span>
                <select id="persona">${allPersonas.map((p) => `<option value="${p.id}">${esc(p.name || "Unnamed")}</option>`).join("")}</select>
              </label>
              <button class="icon-btn persona-edit" type="button" id="persona-edit" aria-label="Edit this persona" title="Edit this persona" ${allPersonas.length ? "" : "hidden"}>${icon("edit")}</button>
              </span>
              <label class="persona-pick" id="speaker-pick" hidden><span>Next to reply</span>
                <select id="speaker"></select>
              </label>
              <span class="activity" id="activity" role="status" hidden></span>
              <span id="composer-hint">${settings.enterToSend ? "Enter to send · Shift+Enter for a new line" : "Ctrl+Enter to send"}</span>
            </div>
          </div>
        </form>
      </section>
    </div>`;

  const log = $("#log", main);
  const logInner = $("#log-inner", main);
  const input = $("#input", main);
  const sendBtn = $("#send", main);
  const sidebar = $("#sidebar", main);
  const scrim = $("#scrim", main);
  const fitInput = autosize(input);
  const narrow = matchMedia("(max-width: 600px)"); // phones: rarer tools move into menus

  // ---------- Sidebar ----------
  function paintList() {
    if (!$("#chat-list", main)) return; // the chat was left while a task finished
    $("#chat-list", main).innerHTML = list.map((c) => {
      const extra = [c.castIds?.length ? `group of ${c.castIds.length + 1}` : "", c.branchOf ? "branch" : ""].filter(Boolean);
      return `<li class="${c.id === chat.id ? "is-active" : ""}">
        <a href="#/chat/${bot.id}/${c.id}" ${c.id === chat.id ? 'aria-current="page"' : ""}>
          <span class="t">${esc(c.title)}</span>
          <span class="d">${c.messages.length} message${c.messages.length === 1 ? "" : "s"} · ${timeAgo(c.updatedAt)}${extra.length ? ` · ${extra.join(" · ")}` : ""}</span>
        </a></li>`;
    }).join("");
  }
  const setSidebar = (open) => {
    sidebar.classList.toggle("is-open", open);
    scrim.hidden = !open;
    $("#open-sidebar", main).setAttribute("aria-expanded", String(open));
    if (open) $("#new-chat", main).focus();
  };
  $("#open-sidebar", main).addEventListener("click", () => setSidebar(true));
  scrim.addEventListener("click", () => setSidebar(false));
  sidebar.addEventListener("keydown", (e) => { if (e.key === "Escape") setSidebar(false); });

  $("#new-chat", main).addEventListener("click", async () => {
    if (busy) return;
    const c = newChat(bot, startPersonaId, list);
    await chats.save(c);
    location.hash = `#/chat/${bot.id}/${c.id}`;
  });

  function paintBond() {
    if (!bondOn) return;
    const { value, label, index } = bondNow();
    $("#bond-label", main).textContent = label;
    $("#bond-fill", main).style.width = `${value}%`;
    $("#bond", main).setAttribute("aria-label",
      `Bond with ${bot.name}: ${label}, ${value} of 100. Open bonds, history and starting points.`);
    $("#bond", main).dataset.level = String(index);
  }

  // The meter opens every bond in the chat: where it stands, how it moved,
  // and where it starts. Existing replies keep their changes on top.
  function openBonds() {
    const people = everyone().filter(bondOnFor);
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>${people.length > 1 ? "Bonds in this chat" : `Bond with ${esc(bot.name)}`}</h2>
        <p class="hint">Each reply can move a bond up or down. Set where a bond starts before the first line of this chat.</p>
        <div class="bond-rows">${people.map((b, i) => {
          const now = bondFor(b);
          return `<section class="bond-row" aria-labelledby="bh-${i}">
            <div class="bond-row-head">
              ${avatarHTML(b.avatar, b.name, 36)}
              <div class="grow"><h3 id="bh-${i}">${esc(b.name)}</h3>
                <small>${now.kind ? `${esc(now.kind)} · ` : ""}${esc(now.label)}, ${now.value} of 100</small></div>
            </div>
            ${bondChartHTML({ id: b.id, name: b.name, points: bondHistory(b), levels: bondLevels(b) })}
            ${sliderHTML({ id: `bs-${i}`, label: "Starts at", min: 0, max: 100, step: 1, value: bondStartFor(b) })}
            <p class="hint" id="bs-read-${i}"></p>
          </section>`;
        }).join("")}</div>
        <div class="dialog-actions">
          <button class="btn btn-quiet push" type="button" id="bs-default">Use the default start (${bondDefault()})</button>
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">Save</button>
        </div>
      </form>`, {
      wide: true,
      onClose: async (v) => {
        if (v !== "ok") return;
        people.forEach((b, i) => {
          const start = Number($(`#bs-${i}`, dlg).value);
          if (b.id === bot.id) chat.bondStart = start;
          else chat.bondStarts[b.id] = start;
        });
        await persist();
        paintBond();
        toast("Bond starting points saved.", "ok");
      },
    });
    people.forEach((b, i) => {
      wireBondChart($(`[data-chart="${CSS.escape(b.id)}"]`, dlg) ?? dlg, bondHistory(b));
      const read = () => {
        const next = bondFor(b, Number($(`#bs-${i}`, dlg).value || 0));
        $(`#bs-read-${i}`, dlg).textContent = `With this start the meter reads ${next.label}, ${next.value} of 100.`;
      };
      wireSlider(dlg, `bs-${i}`, read);
      read();
    });
    $("#bs-default", dlg).addEventListener("click", () => {
      people.forEach((_, i) => {
        $(`#bs-${i}`, dlg).value = String(bondDefault());
        $(`#bs-${i}-range`, dlg).value = String(bondDefault());
        $(`#bs-${i}`, dlg).dispatchEvent(new Event("input"));
      });
    });
  }

  function paintHeader() {
    $("#chat-title", main).innerHTML = `<span>${esc(chat.title)}</span>${icon("edit")}`;
    $("#chat-title", main).setAttribute("aria-label", `Chat name: ${chat.title}. Rename`);
    const p = persona();
    $("#chat-sub", main).textContent = `with ${everyone().map((b) => b.name).join(", ")}${p ? ` · as ${p.name}` : ""}`;
    paintModelChip();
    const level = contentLevel(settings, bot);
    const tag = $("#content-tag", main);
    tag.hidden = level === "off";
    tag.textContent = level === "explicit" ? "18+ explicit" : "18+";
    tag.title = level === "explicit" ? "Explicit content is on for this chat (Settings)" : "Mature content is on for this chat (Settings)";
    $("#persona", main).value = p?.id ?? "";
    document.title = `${bot.name} · MoonPaper`;
    // Speaker picker only matters when more than one bot can answer.
    const pick = $("#speaker-pick", main);
    const select = $("#speaker", main);
    const prev = select.value || "auto";
    pick.hidden = !group();
    select.innerHTML = `<option value="auto">Auto</option>` + everyone().map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
    select.value = [...select.options].some((o) => o.value === prev) ? prev : "auto";
    select.title = "Auto picks the character your message names, otherwise whoever has been quiet longest.";
    input.placeholder = placeholderText();
    const mem = $("#memory", main);
    mem.classList.toggle("has-dot", !!chat.memory?.text?.trim());
    mem.classList.toggle("is-loading", memoryBusy);
    mem.setAttribute("aria-label", memoryBusy ? "Memory, updating" : chat.memory?.text ? "Memory" : "Memory, empty");
    $("#cast", main).classList.toggle("has-dot", group());
    const sc = $("#scene", main);
    sc.classList.toggle("has-dot", !!chat.scene?.text?.trim());
    sc.classList.toggle("is-loading", sceneBusy);
  }

  // ---------- Messages ----------
  const lastAssistantIndex = () => chat.messages.findLastIndex((m) => m.role === "assistant");

  function bodyHTML(m, text, streaming = false) {
    const meta = m.meta?.[m.swipeIndex ?? 0] ?? {};
    const think = meta.reasoning
      ? `<details class="thinking"><summary>Model's reasoning</summary><div>${esc(meta.reasoning)}</div></details>` : "";
    const clean = stripBond(text);
    const content = clean.trim()
      ? renderMarkdown(applyMacros(clean, namesFor(speakerOf(m) ?? bot)))
      : (streaming ? "" : "<p><em>(empty)</em></p>");
    return think + content + (streaming ? '<span class="caret" aria-hidden="true"></span>' : "");
  }

  const meta0 = (m) => m.meta?.[m.swipeIndex ?? 0] ?? {};

  function messageHTML(m, i) {
    const isBot = m.role === "assistant";
    const p = persona();
    const speaker = speakerOf(m);
    const name = isBot ? speaker.name : userName();
    const face = isBot && meta0(m).mood && speaker.expressions?.[meta0(m).mood];
    const av = !isBot ? avatarHTML(p?.avatar, name, 40)
      : face ? `<a class="avatar-link" href="#/bot/${speaker.id}" aria-label="Edit ${esc(speaker.name)}" title="${esc(speaker.name)}, ${esc(meta0(m).mood)}"><span class="expr-face"><img src="${esc(face)}" alt=""></span></a>`
      : botById.has(speaker.id) ? botAvatar(speaker, 40) : avatarHTML(null, name, 40);
    const text = currentText(m);
    const isLastBot = isBot && i === lastAssistantIndex() && i === chat.messages.length - 1;
    const streaming = busy && isLastBot;
    const meta = isBot ? m.meta?.[m.swipeIndex ?? 0] ?? {} : {};
    const count = m.swipes?.length ?? 1;
    const idx = (m.swipeIndex ?? 0) + 1;

    if (editingId === m.id) {
      return `<article class="msg ${m.role}" data-id="${m.id}">${av}<div class="msg-edit">
        <div class="msg-head"><span class="msg-name">Editing ${esc(name)}'s message</span></div>
        <label class="sr-only" for="edit-box">Message text</label>
        <textarea id="edit-box">${esc(text)}</textarea>
        <div class="actions"><span class="hint">Ctrl+Enter to save · Esc to cancel</span>
          <button class="btn btn-ghost btn-sm" type="button" data-action="cancel-edit">Cancel</button>
          <button class="btn btn-primary btn-sm" type="button" data-action="save-edit">Save</button></div>
      </div></article>`;
    }

    const swipeNav = isBot && (isLastBot || count > 1) ? `<span class="swipes">
        <button class="icon-btn" type="button" data-action="swipe-prev" aria-label="Previous version" ${idx <= 1 || busy ? "disabled" : ""}>${icon("left")}</button>
        <span aria-label="Version ${idx} of ${count}">${idx}/${count}</span>
        <button class="icon-btn" type="button" data-action="swipe-next" aria-label="${idx >= count ? "Write another version" : "Next version"}" ${(!isLastBot && idx >= count) || busy ? "disabled" : ""}>${icon("right")}</button>
      </span>` : "";

    const info = [];
    if (meta.check) {
      info.push(meta.check.ok
        ? `<span class="check-chip ok" title="Checked against ${esc(name)}'s definition">In character</span>`
        : `<button type="button" class="check-chip bad" data-action="show-check">Out of character?</button>`);
    }
    if (meta.note) info.push(`<span class="chip" title="${esc(meta.note)}">directed</span>`);
    if (meta.lore?.length) info.push(meta.lore.map((t) => `<span class="chip" title="Lore used">${esc(t)}</span>`).join(""));
    if (meta.usage) info.push(`<span title="Tokens in / out">${meta.usage.prompt_tokens ?? "?"} → ${meta.usage.completion_tokens ?? "?"} tokens</span>`);
    if (meta.finish === "length" && !isLastBot) info.push(`<span title="The reply hit the max reply tokens limit">cut off</span>`);
    if (meta.mood) info.unshift(`<span class="chip mood-chip" title="${esc(name)}'s expression">${esc(meta.mood)}</span>`);
    const speakerBond = isBot && bondOnFor(speaker);
    if (speakerBond && Number.isFinite(meta.bond) && meta.bond !== 0) {
      info.push(`<span class="bond-chip ${meta.bond > 0 ? "up" : "down"}" title="Bond change">${meta.bond > 0 ? "+" : "−"}${Math.abs(meta.bond)} bond</span>`);
    }
    const isChecking = checking.has(m.id);
    if (isChecking) info.unshift(`<span class="chip">checking character…</span>`);
    if (m.pinned) info.unshift(`<span class="chip pinned-chip">pinned</span>`);
    if (m.roll) info.unshift(`<span class="chip dice-chip" title="${esc(`Rolled ${m.roll.rolls.join(", ")}${m.roll.mod ? `, ${m.roll.mod > 0 ? "+" : ""}${m.roll.mod}` : ""}`)}">${icon("dice")}${esc(m.roll.expr)} → ${m.roll.total}</span>`);
    const tr = isBot ? meta.translation : m.translation;
    const translation = translating.has(m.id)
      ? `<div class="translation" aria-busy="true"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>`
      : tr?.text ? `<div class="translation">
          <div class="translation-head"><span>${esc(tr.lang)}</span>
            <button type="button" class="link-btn" data-action="hide-translation">Hide</button></div>
          ${renderMarkdown(applyMacros(tr.text, namesFor(speaker ?? bot)))}</div>` : "";
    const milestone = speakerBond && milestonesFor(speaker) && meta.milestone
      ? `<div class="milestone ${meta.milestone.up ? "up" : "down"}" role="note">
          <span>Bond with ${esc(speaker.name)}: ${esc(meta.milestone.from)} → ${esc(meta.milestone.to)}</span></div>` : "";

    const cutOff = isLastBot && !busy && meta.finish === "length";
    return `<article class="msg ${m.role} ${isLastBot ? "is-last" : ""}${face ? " has-face" : ""}" data-id="${m.id}" aria-label="${esc(name)}">
      ${av}
      <div style="min-width:0">
        <div class="msg-head"><span class="msg-name">${esc(name)}</span><time class="msg-time" datetime="${new Date(m.at).toISOString()}">${clock(m.at)}</time></div>
        <div class="msg-body">${bodyHTML(m, text, streaming)}</div>
        ${translation}
        ${cutOff ? `<div class="cutoff-bar"><span>This reply was cut off by the length limit.</span>
          <button class="btn btn-sm btn-primary" type="button" data-action="continue">Continue writing</button></div>` : ""}
        <div class="msg-foot">
          ${swipeNav}
          <span class="msg-tools">
            <button class="icon-btn" type="button" data-action="edit" aria-label="Edit message" title="Edit" ${busy ? "disabled" : ""}>${icon("edit")}</button>
            ${isLastBot ? `<button class="icon-btn" type="button" data-action="regenerate" aria-label="Regenerate reply, with options" aria-haspopup="menu" aria-expanded="false" title="Regenerate" ${busy ? "disabled" : ""}>${icon("refresh")}</button>` : ""}
            <button class="icon-btn${m.pinned ? " is-on" : ""}" type="button" data-action="pin" aria-pressed="${m.pinned ? "true" : "false"}"
              aria-label="${m.pinned ? "Unpin" : "Pin this moment so it is always remembered"}" title="${m.pinned ? "Unpin" : "Pin"}">${icon("pin")}</button>
            <button class="icon-btn" type="button" data-action="msg-menu" aria-label="More message actions" aria-haspopup="menu" aria-expanded="false" title="More" ${streaming ? "disabled" : ""}>${icon("dots")}</button>
          </span>
          ${info.length ? `<span class="msg-meta">${info.join(" · ")}</span>` : ""}
        </div>
      </div>
    </article>${milestone}`;
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };

  function paintLog({ scroll = true } = {}) {
    if (!chat.messages.length && !pendingError) {
      logInner.innerHTML = `<div class="empty"><h2>A quiet room</h2>
        <p>${esc(bot.name)} has no opening line. Say something to begin.</p></div>`;
    } else {
      logInner.innerHTML = chat.messages.map(messageHTML).join("") + (pendingError ? `
        <div class="msg"><span></span><div>
          <div class="msg-body error" role="alert">${esc(pendingError)}</div>
          <div class="msg-foot"><button class="btn btn-sm" type="button" data-action="retry">Try again</button>
          <a class="btn btn-ghost btn-sm" href="#/connection">Connection settings</a></div>
        </div></div>` : "");
    }
    if (scroll) toBottom();
    paintBond();
    const box = $("#edit-box", logInner);
    if (box) { autosize(box); box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }

  async function persist() {
    await chats.save(chat);
    list = await chats.forBot(bot.id);
    paintList();
  }

  function setBusy(on) {
    busy = on;
    if (chat.messages.length) paintLog({ scroll: false });
    sendBtn.classList.toggle("stop", on);
    sendBtn.innerHTML = icon(on ? "stop" : "send");
    sendBtn.setAttribute("aria-label", on ? "Stop generating" : "Send message");
    logInner.setAttribute("aria-busy", String(on));
    $("#impersonate", main).disabled = on;
  }

  // ---------- Scene direction ----------
  // A hidden instruction for the next reply only. It is sent with that
  // reply and then cleared; it never appears in the chat.
  const directBar = $("#direct-bar", main);
  const directInput = $("#direction", main);
  const direction = () => (directBar.hidden ? "" : directInput.value.trim());
  // With a direction waiting, an empty send lets the bot go ahead with it.
  const placeholderText = () => (!directBar.hidden
    ? `Press send to let ${group() ? "the scene" : bot.name} react`
    : group() ? "Message the scene…" : `Message ${bot.name}…`);
  function setDirecting(open, { surprise = false } = {}) {
    directBar.hidden = !open;
    $("#composer-more", main).classList.toggle("has-dot", open);
    $("#direct-label", main).textContent = surprise ? "Surprise" : "Direction";
    $("#direct-reroll", main).hidden = !surprise;
    input.placeholder = placeholderText();
    if (open) directInput.focus();
    else { directInput.value = ""; }
  }

  // ---------- Surprise me ----------
  // A random event that fits the scene, placed in the direction bar so it
  // can be read, edited or re-rolled before it shapes the next reply.
  async function surprise() {
    if (busy) return;
    setDirecting(true, { surprise: true });
    directInput.value = "";
    directInput.placeholder = "Thinking of something…";
    setActivity("surprise", "Thinking of a surprise…");
    $("#direct-reroll", main).classList.add("is-loading");
    try {
      const text = await surpriseEvent({
        bot, names: namesFor(), scene: chat.scene?.text ?? "",
        lines: transcript(chat.messages.slice(-8), nameOf, namesFor()),
      });
      if (!text) throw new Error("No surprise came back. Try again.");
      directInput.value = text;
      input.focus();
    } catch (err) {
      toast(err.message, "error");
      setDirecting(false);
    } finally {
      directInput.placeholder = "For the next reply only, e.g. time skip to nightfall";
      setActivity("surprise", null);
      $("#direct-reroll", main).classList.remove("is-loading");
    }
  }
  $("#direct-reroll", main).addEventListener("click", surprise);
  $("#direct-clear", main).addEventListener("click", () => { setDirecting(false); input.focus(); });
  directInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); setDirecting(false); input.focus(); }
    if (e.key === "Enter") { e.preventDefault(); if (!input.value.trim() && direction()) send(); else input.focus(); }
  });

  // ---------- Generation ----------
  async function generate(kind = "new", { note = "", speaker: chosen = null } = {}) {
    if (busy) return;
    const conn = await getActiveConnection();
    if (!conn) {
      toast("Set up an API connection first.", "error", { action: "Open", onAction: () => { location.hash = "#/connection"; } });
      return;
    }
    pendingError = null;
    let target;
    let prevIndex = 0;
    let base = "";
    if (kind === "continue") {
      target = chat.messages.at(-1);
      if (target?.role !== "assistant") return;
      base = target.swipes[target.swipeIndex ?? 0] ?? "";
    } else if (kind === "swipe") {
      target = chat.messages.at(-1);
      prevIndex = target.swipeIndex ?? 0;
      target.swipes.push("");
      target.meta.push({});
      target.swipeIndex = target.swipes.length - 1;
    } else {
      const who = chosen ?? pickSpeaker(chat.messages.at(-1)?.role === "user" ? chat.messages.at(-1).content : "");
      target = { id: uid(), role: "assistant", botId: who.id, swipes: [""], swipeIndex: 0, meta: [{}], at: now() };
      chat.messages.push(target);
    }
    const si = target.swipeIndex;
    const speaker = speakerOf(target);
    const withBond = bondOnFor(speaker);
    const directed = direction();
    // After the bond changes level, the next reply is asked to show it.
    const shift = withBond && milestonesFor(speaker) && kind === "new" ? chat.pendingMilestones[speaker.id] ?? null : null;
    const shiftNote = shift
      ? `The bond has just moved ${shift.up ? "up" : "down"} from ${shift.from} to ${shift.to}. Let this change show clearly in this reply, in character, without naming it.`
      : "";
    const continueNote = kind === "continue"
      ? "Your last reply was cut off. Continue it exactly where it stopped, mid-sentence if needed. Do not repeat or summarize anything already written; write only the rest."
      : "";
    // A dice roll in the message being answered is binding.
    const before = chat.messages[chat.messages.indexOf(target) - 1];
    const r = before?.role === "user" ? before.roll : null;
    const rollNote = r
      ? `${userName()} rolled ${r.expr}${r.label ? ` to ${r.label}` : ""} and got ${r.total} (lowest possible ${r.n + r.mod}, highest ${r.n * r.sides + r.mod}). Respect this result: the outcome must match how good or bad the roll was. Do not reroll or ignore it.`
      : "";
    const fullNote = [directed, note, shiftNote, continueNote, rollNote].filter(Boolean).join(" ");

    const [freshSettings, preset, loreEntries] = await Promise.all([getSettings(), getActivePreset(), loreForBot(speaker)]);
    const beforeBond = bondFor(speaker);
    const prompt = buildPrompt({
      bot: speaker, persona: persona(), preset, settings: freshSettings, loreEntries,
      history: withSpeakers(chat.messages.slice(0, chat.messages.indexOf(target) + (kind === "continue" ? 1 : 0))),
      bond: withBond ? beforeBond : null,
      memory: chat.memory?.text ?? "", scene: chat.scene?.text ?? "", note: fullNote, cast: group() ? others(speaker) : [],
    });
    const body = {
      model: chat.model || speaker.model || conn.model || undefined,
      messages: prompt.messages,
      stream: freshSettings.gen.stream,
      ...generationParams(freshSettings, speaker),
    };
    // A continuation joins the cut-off text; add a space only where a new word starts.
    const join = (more) => base + (/\S$/.test(base) && /^[A-Z"“*]/.test(more) ? " " : "") + more;

    paintLog();
    setBusy(true);
    setActivity("reply", kind === "continue" ? `${speaker.name} is finishing the reply…` : `${speaker.name} is writing…`);
    controller = new AbortController();
    const node = () => $(`[data-id="${target.id}"] .msg-body`, logInner);
    let frame = 0;
    const paintStream = () => {
      frame = 0;
      const stick = nearBottom();
      const el = node();
      if (el) el.innerHTML = bodyHTML(target, target.swipes[si], true);
      if (stick) toBottom();
    };
    let ok = false;

    try {
      const res = await chatCompletion(conn, body, {
        signal: controller.signal,
        onDelta: (r) => {
          target.swipes[si] = kind === "continue" ? join(r.content) : r.content;
          if (kind !== "continue") target.meta[si].reasoning = r.reasoning;
          frame ||= requestAnimationFrame(paintStream);
        },
      });
      const mood = readMood(res.content, moodsOf(speaker));
      const parsed = withBond ? readBond(res.content) : { text: stripBond(res.content), delta: 0 };
      // In a group scene models sometimes label their own line.
      if (group()) parsed.text = cleanImpersonation(parsed.text, speaker.name);
      if (kind === "continue") {
        const before = target.meta[si] ?? {};
        target.swipes[si] = join(parsed.text);
        target.meta[si] = {
          ...before, finish: res.finishReason, model: body.model,
          usage: sumUsage(before.usage, res.usage),
          ...(withBond ? { bond: (Number(before.bond) || 0) + parsed.delta } : {}),
          ...(mood ? { mood } : {}),
        };
      } else {
        target.swipes[si] = parsed.text;
        target.meta[si] = {
          lore: prompt.loreUsed, usage: res.usage, model: body.model,
          reasoning: res.reasoning, finish: res.finishReason,
          ...(withBond ? { bond: parsed.delta } : {}),
          ...(mood ? { mood } : {}),
          // Only the person's own direction or nudge earns the "directed" label.
          ...(directed || note ? { note: [directed, note].filter(Boolean).join(" ") } : {}),
        };
      }
      if (!parsed.text.trim()) throw new Error("The model sent back an empty reply. Try again, or check the model name on the Connection page.");
      if (shift) delete chat.pendingMilestones[speaker.id];
      const afterBond = bondFor(speaker);
      if (withBond && afterBond.index !== beforeBond.index) {
        const change = { from: beforeBond.label, to: afterBond.label, up: afterBond.index > beforeBond.index };
        target.meta[si].milestone = change;
        chat.pendingMilestones[speaker.id] = change;
        toast(`${speaker.name}: ${change.from} \u2192 ${change.to}`);
      } else if (withBond && kind === "swipe") {
        // A new version that no longer crosses a level takes the milestone back.
        delete chat.pendingMilestones[speaker.id];
      }
      window.dispatchEvent(new CustomEvent("api-status", { detail: true }));
      if (prompt.dropped > 0 && !chat.warnedTrim && !chat.memory?.text) {
        chat.warnedTrim = true;
        toast(`The chat is longer than the context size, so the oldest ${prompt.dropped} messages were left out. Memory keeps a summary of them.`);
      }
      if (directed) setDirecting(false);
      ok = true;
    } catch (err) {
      const aborted = err.name === "AbortError";
      const partial = target.swipes[si]?.trim();
      if (kind === "continue") {
        // Keep whatever was added before the stop; the reply was never empty.
      } else if (!partial) {
        if (kind === "swipe") { target.swipes.pop(); target.meta.pop(); target.swipeIndex = prevIndex; }
        else chat.messages.pop();
      } else {
        target.meta[si] = { ...target.meta[si], lore: prompt.loreUsed, model: body.model };
      }
      if (!aborted) {
        pendingError = err.message;
        window.dispatchEvent(new CustomEvent("api-status", { detail: false }));
      }
    } finally {
      cancelAnimationFrame(frame);
      controller = null;
      setActivity("reply", null);
      setBusy(false);
      await bots.touch(bot);
      if (!pendingError && target.swipes[si]) $("#announce", main).textContent = `${speaker.name}: ${target.swipes[si]}`;
      await persist();
      paintLog({ scroll: nearBottom() || !!pendingError });
      toBottom();
    }
    if (ok) {
      if (freshSettings.check?.auto) runCheck(target, { quiet: true });
      if (chat.scene?.auto) refreshScene({ quiet: true });
      maybeRemember(freshSettings);
    }
  }

  // ---------- Memory ----------
  function memoryLines(from, to = chat.messages.length) {
    return transcript(chat.messages.slice(from, to), nameOf, namesFor());
  }

  async function updateMemory({ quiet = false } = {}) {
    if (memoryBusy) return false;
    const upTo = chat.messages.length;
    const from = Math.min(chat.memory?.upTo ?? 0, upTo);
    if (from >= upTo && chat.memory?.text) { if (!quiet) toast("Memory already covers every message."); return false; }
    memoryBusy = true;
    setActivity("memory", "Updating memory…");
    paintHeader();
    try {
      const text = await summarize({ bot, names: namesFor(), previous: chat.memory?.text ?? "", lines: memoryLines(from, upTo) });
      if (!text) throw new Error("The model sent back an empty summary.");
      chat.memory = { auto: chat.memory?.auto ?? true, text, upTo, updatedAt: now() };
      await persist();
      if (!quiet) toast("Memory updated.", "ok");
      return true;
    } catch (err) {
      toast(`Memory was not updated. ${err.message}`, "error");
      return false;
    } finally {
      memoryBusy = false;
      setActivity("memory", null);
      paintHeader();
    }
  }

  function maybeRemember(s) {
    if (s.memory?.enabled === false || chat.memory?.auto === false) return;
    const every = Math.max(4, Number(s.memory?.every) || 20);
    if (chat.messages.length - (chat.memory?.upTo ?? 0) >= every) updateMemory({ quiet: true });
  }

  function openMemory() {
    const mem = chat.memory ?? { text: "", upTo: 0, auto: true };
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Memory</h2>
        <p class="hint">A running summary of this chat, sent with every reply so ${esc(bot.name)} remembers what happened
          even after old messages fall out of the context. Edit it freely.</p>
        <div class="field">
          <label for="mem-text">Story so far <span class="count" id="mem-status"></span></label>
          <textarea id="mem-text" class="tall" placeholder="Nothing yet. Press Update now, or keep chatting and it fills in on its own.">${esc(mem.text ?? "")}</textarea>
        </div>
        <label class="check"><input type="checkbox" id="mem-auto" ${mem.auto !== false ? "checked" : ""}>
          <span>Update automatically<small>After every ${settings.memory?.every ?? 20} new messages. Change the number in Settings.</small></span></label>
        <div class="dialog-actions">
          <button class="btn btn-quiet push" type="button" id="mem-now">Update now</button>
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">Save</button>
        </div>
      </form>`, {
      wide: true,
      onClose: async (v) => {
        if (v !== "ok") return;
        const text = $("#mem-text", dlg).value.trim();
        chat.memory = { ...(chat.memory ?? { upTo: 0 }), text, auto: $("#mem-auto", dlg).checked, updatedAt: now() };
        await persist(); paintHeader();
        toast("Memory saved.", "ok");
      },
    });
    const ta = $("#mem-text", dlg);
    autosize(ta);
    const status = () => {
      const m = chat.memory;
      $("#mem-status", dlg).textContent = m?.text
        ? `covers ${Math.min(m.upTo ?? 0, chat.messages.length)} of ${chat.messages.length} messages · ${timeAgo(m.updatedAt)}`
        : "empty";
    };
    status();
    $("#mem-now", dlg).addEventListener("click", async (e) => {
      const b = e.currentTarget;
      // Keep any edits made in the box as the starting point.
      chat.memory = { ...(chat.memory ?? { upTo: 0, auto: true }), text: ta.value.trim() };
      b.classList.add("is-loading");
      b.setAttribute("aria-busy", "true");
      ta.readOnly = true;
      if (await updateMemory({ quiet: true })) ta.value = chat.memory.text;
      b.classList.remove("is-loading");
      b.removeAttribute("aria-busy");
      ta.readOnly = false;
      ta.dispatchEvent(new Event("input"));
      status();
    });
  }

  // ---------- Character check ----------
  async function runCheck(m, { quiet = false } = {}) {
    if (checking.has(m.id)) return;
    const speaker = speakerOf(m);
    const i = chat.messages.indexOf(m);
    const si = m.swipeIndex ?? 0;
    checking.add(m.id);
    setActivity(`check-${m.id}`, "Checking character…");
    paintLog({ scroll: false });
    try {
      const result = await checkCharacter({
        bot: speaker, names: namesFor(speaker),
        reply: applyMacros(stripBond(currentText(m)), namesFor(speaker)),
        context: transcript(chat.messages.slice(Math.max(0, i - 4), i), nameOf, namesFor(speaker)),
      });
      m.meta[si] = { ...m.meta[si], check: { ...result, at: now() } };
      await persist();
      if (!quiet) {
        if (result.ok) toast(`${speaker.name} stays in character here.`, "ok");
        else showCheck(m);
      }
    } catch (err) {
      if (!quiet) toast(`Could not check. ${err.message}`, "error");
    } finally {
      checking.delete(m.id);
      setActivity(`check-${m.id}`, null);
      paintLog({ scroll: false });
    }
  }

  function showCheck(m) {
    const c = m.meta?.[m.swipeIndex ?? 0]?.check;
    if (!c) return;
    const speaker = speakerOf(m);
    const isLast = chat.messages.at(-1) === m;
    const dlg = openDialog(`<div class="dialog-body">
      <h2>Out of character?</h2>
      <p class="hint">What the check found in this reply from ${esc(speaker.name)}. It can be wrong; you decide.</p>
      <ul class="issue-list">${c.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${c.fix ? `<p><strong>Suggested fix:</strong> ${esc(c.fix)}</p>` : ""}
      <div class="dialog-actions">
        <button class="btn btn-ghost" type="button" data-close>Keep it</button>
        ${isLast ? `<button class="btn btn-primary" type="button" id="redo">Write a new version with the fix</button>` : ""}
      </div></div>`);
    $("[data-close]", dlg).addEventListener("click", () => dlg.close());
    $("#redo", dlg)?.addEventListener("click", () => {
      dlg.close();
      generate("swipe", { note: `Stay true to ${speaker.name}'s character. Avoid these problems from the last attempt: ${c.issues.join("; ")}. ${c.fix}` });
    });
  }

  // ---------- Rewind ----------
  // Deletes everything after message i. Memory and the scene would still
  // describe what was removed, so the dialog offers to rebuild them.
  function askRewind(later) {
    const stale = !!(chat.memory?.text || chat.scene?.text);
    if (settings.confirm?.enabled === false) return Promise.resolve({ ok: true, refresh: stale });
    return new Promise((resolve) => {
      const dlg = openDialog(`
        <form method="dialog" class="dialog-body">
          <h2>Rewind to this message?</h2>
          <p>The ${later} message${later === 1 ? "" : "s"} after it will be deleted, and the chat continues from here. You can undo right after.</p>
          ${stale ? `<label class="check"><input type="checkbox" id="rw-refresh" checked>
            <span>Update memory and the scene to match<small>They may describe events that are being removed. Uses one or two requests.</small></span></label>` : ""}
          <div class="dialog-actions">
            <button class="btn btn-ghost" value="cancel">Cancel</button>
            <button class="btn btn-danger" value="ok" autofocus>Rewind</button>
          </div>
        </form>`, { onClose: (v) => resolve({ ok: v === "ok", refresh: !!$("#rw-refresh", dlg)?.checked }) });
    });
  }

  async function rewindTo(i) {
    if (busy) return;
    const upTo = i + 1;
    const later = chat.messages.length - upTo;
    if (later < 1) return;
    const { ok, refresh } = await askRewind(later);
    if (!ok || busy) return;
    const saved = {
      removed: chat.messages.slice(upTo),
      memory: structuredClone(chat.memory ?? null),
      scene: structuredClone(chat.scene ?? null),
      pending: structuredClone(chat.pendingMilestones ?? {}),
    };
    chat.messages = chat.messages.slice(0, upTo);
    chat.pendingMilestones = {};
    pendingError = null;
    const memoryStale = (chat.memory?.upTo ?? 0) > upTo;
    if (memoryStale) chat.memory = { ...chat.memory, upTo: Math.min(chat.memory.upTo, upTo) };
    await persist();
    paintLog();
    toast(`Rewound. ${later} message${later === 1 ? "" : "s"} removed.`, "info", {
      action: "Undo",
      onAction: async () => {
        chat.messages = [...chat.messages, ...saved.removed];
        chat.memory = saved.memory;
        chat.scene = saved.scene;
        chat.pendingMilestones = saved.pending;
        await persist(); paintLog(); paintHeader();
      },
    });
    if (refresh) {
      if (memoryStale && chat.memory?.text) { chat.memory = { ...chat.memory, text: "", upTo: 0 }; updateMemory({ quiet: true }); }
      if (chat.scene?.text) { chat.scene = { ...chat.scene, text: "" }; refreshScene({ quiet: true }); }
    }
  }

  // ---------- Activity ----------
  // One line under the message box says what is happening in the
  // background, so nothing works silently.
  const activity = new Map();
  function setActivity(key, label) {
    if (label) activity.set(key, label); else activity.delete(key);
    const el = $("#activity", main);
    if (!el) return;
    const items = [...new Set(activity.values())];
    el.hidden = !items.length;
    el.innerHTML = items.length ? `<span class="moon-phase" aria-hidden="true"></span>${esc(items.join(" · "))}` : "";
    $("#composer-hint", main).hidden = items.length > 0;
  }

  const sumUsage = (a, b) => (a || b ? {
    prompt_tokens: (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0),
    completion_tokens: (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0),
  } : undefined);

  // ---------- Model ----------
  // The model for this chat: its own override, else the bot's, else the connection's.
  const currentModel = () => chat.model || bot.model || activeConn?.model || "no model set";
  let modelList = null;
  function recentModels() { try { return JSON.parse(localStorage.getItem("recentModels") || "[]"); } catch { return []; } }
  function rememberModel(name) {
    try { localStorage.setItem("recentModels", JSON.stringify([name, ...recentModels().filter((m) => m !== name)].slice(0, 5))); } catch {}
  }
  async function setChatModel(name) {
    chat.model = name || null;
    if (name) rememberModel(name);
    await persist(); paintHeader();
    toast(name ? `This chat now uses ${name}.` : `Back to the default model (${currentModel()}).`, "ok");
  }
  async function openModelMenu(anchor) {
    if (!activeConn) { toast("Set up a connection first.", "error", { action: "Open", onAction: () => { location.hash = "#/connection"; } }); return; }
    if (!modelList) {
      anchor.classList.add("is-loading");
      try { modelList = await listModels(activeConn); } catch { modelList = []; }
      anchor.classList.remove("is-loading");
    }
    const def = bot.model || activeConn.model || "";
    const inUse = currentModel();
    const pick = (name) => ({ label: name, hint: name === inUse ? "In use" : "", onSelect: () => setChatModel(name === def ? null : name) });
    const recent = recentModels().filter((m) => m !== def);
    openMenu(anchor, [
      { label: `Default: ${def || "none set"}`, hint: chat.model ? "From the bot or the connection" : "In use", onSelect: () => setChatModel(null) },
      ...(recent.length ? ["-", ...recent.map(pick)] : []),
      ...(modelList.length ? ["-", ...modelList.filter((m) => m !== def && !recent.includes(m)).slice(0, 40).map(pick)] : []),
      "-",
      { label: "Type a model name…", hint: modelList.length ? "" : "The model list could not be loaded", onSelect: async () => {
        const name = await promptDialog({ title: "Model for this chat", label: "Model name", value: chat.model ?? "", confirm: "Use" });
        if (name) setChatModel(name);
      } },
    ]);
  }

  function paintModelChip() {
    const chip = $("#model-chip", main);
    chip.innerHTML = `<span class="model-name">${esc(currentModel())}</span>${icon("left", "chev")}`;
    chip.classList.toggle("is-custom", !!chat.model);
    chip.setAttribute("aria-label", `Model: ${currentModel()}${chat.model ? ", chosen for this chat" : ""}. Change it.`);
    chip.title = chat.model ? "Model chosen for this chat. Click to change." : "Model for this chat. Click to change.";
  }

  // ---------- Usage in this chat ----------
  function openChatUsage() {
    let prompt = 0; let completion = 0; let counted = 0; let missing = 0;
    for (const m of chat.messages) {
      if (m.role !== "assistant") continue;
      for (const meta of m.meta ?? []) {
        if (meta?.greeting) continue;
        if (meta?.usage) { prompt += meta.usage.prompt_tokens ?? 0; completion += meta.usage.completion_tokens ?? 0; counted++; }
        else missing++;
      }
    }
    openDialog(`<div class="dialog-body">
      <h2>Usage in this chat</h2>
      <div class="usage-tiles">
        <div class="usage-tile"><span class="k">Sent to the model</span><span class="v">${prompt.toLocaleString()}</span><span class="s">input tokens</span></div>
        <div class="usage-tile"><span class="k">Written by the model</span><span class="v">${completion.toLocaleString()}</span><span class="s">output tokens</span></div>
      </div>
      <p class="hint">Counted from ${counted} repl${counted === 1 ? "y" : "ies"}, every version included.${missing ? ` ${missing} had no count from your provider and are left out.` : ""}
        Extra tasks like memory and ideas are not included here. See all usage in <a href="#/settings">Settings</a>.</p>
      <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
    </div>`);
  }

  // ---------- Journal ----------
  // The bot's private diary about you, one entry per stretch of chat.
  const journalFrom = () => chat.journal.at(-1)?.upTo ?? 0;
  async function writeJournal({ quiet = false } = {}) {
    const from = Math.min(journalFrom(), chat.messages.length);
    if (chat.messages.length - from < 2) { if (!quiet) toast("Not much has happened since the last entry."); return false; }
    setActivity("journal", `${bot.name} is writing in their journal…`);
    try {
      const text = await journalEntry({
        bot, names: namesFor(), previous: chat.journal.at(-1)?.text ?? "",
        lines: transcript(chat.messages.slice(Math.max(from, chat.messages.length - 40)), nameOf, namesFor()),
      });
      if (!text) throw new Error("The model sent back an empty entry.");
      chat.journal.push({ id: uid(), at: now(), text, upTo: chat.messages.length });
      await persist();
      return true;
    } catch (err) {
      if (!quiet) toast(`No journal entry. ${err.message}`, "error");
      return false;
    } finally {
      setActivity("journal", null);
    }
  }

  // After leaving the chat the page is gone, so this saves straight to the
  // stored chat (read fresh, in case it changed or was deleted meanwhile).
  async function journalInBackground() {
    try {
      const upTo = chat.messages.length;
      const text = await journalEntry({
        bot, names: namesFor(), previous: chat.journal.at(-1)?.text ?? "",
        lines: transcript(chat.messages.slice(Math.max(journalFrom(), upTo - 40)), nameOf, namesFor()),
      });
      const fresh = text && await chats.get(chat.id);
      if (!fresh) return;
      fresh.journal = [...(fresh.journal ?? []), { id: uid(), at: now(), text, upTo }];
      await chats.save(fresh);
      toast(`${bot.name} wrote in their journal. Read it from the chat's ⋯ menu.`);
    } catch { /* a missed entry is not worth an error message */ }
  }

  function openJournal() {
    const paint = (dlg) => {
      $("#jr-list", dlg).innerHTML = chat.journal.length
        ? [...chat.journal].reverse().map((e) => `<article class="journal-entry">
            <header><time datetime="${new Date(e.at).toISOString()}">${new Date(e.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>
              <button class="link-btn" type="button" data-del="${e.id}">Delete</button></header>
            <div class="prose">${renderMarkdown(e.text)}</div></article>`).join("")
        : `<p class="note">${icon("info")}<span>No entries yet. ${esc(bot.name)} writes one when you leave after ${settings.journal?.every ?? 12} or more new messages, or press Write an entry now.</span></p>`;
    };
    const dlg = openDialog(`<div class="dialog-body">
      <h2>${esc(bot.name)}'s journal</h2>
      <p class="hint">What ${esc(bot.name)} writes privately about this chat, in their own voice. The model does not see these entries in the chat.</p>
      <div id="jr-list" class="journal-list"></div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" type="button" data-close>Close</button>
        <button class="btn btn-primary" type="button" id="jr-write">Write an entry now</button>
      </div></div>`, { wide: true });
    paint(dlg);
    $("[data-close]", dlg).addEventListener("click", () => dlg.close());
    $("#jr-write", dlg).addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.classList.add("is-loading"); b.setAttribute("aria-busy", "true");
      if (await writeJournal()) paint(dlg);
      b.classList.remove("is-loading"); b.removeAttribute("aria-busy");
    });
    dlg.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (!del) return;
      if (!(await askFirst({ title: "Delete this journal entry?", confirm: "Delete", danger: true }))) return;
      chat.journal = chat.journal.filter((x) => x.id !== del.dataset.del);
      await persist(); paint(dlg);
    });
  }

  // ---------- Swipe between versions (touch) ----------
  let swipe = null;
  logInner.addEventListener("touchstart", (e) => {
    const art = e.target.closest(".msg.assistant");
    if (!art || busy || e.touches.length > 1 || e.target.closest("button, a, textarea, details")) return;
    const m = chat.messages.find((x) => x.id === art.dataset.id);
    if (!m?.swipes) return;
    swipe = { art, m, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, axis: null };
  }, { passive: true });
  logInner.addEventListener("touchmove", (e) => {
    if (!swipe) return;
    const dx = e.touches[0].clientX - swipe.x;
    const dy = e.touches[0].clientY - swipe.y;
    if (!swipe.axis && Math.hypot(dx, dy) > 10) swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
    if (swipe.axis !== "x") return;
    swipe.dx = dx;
    swipe.art.style.transform = `translateX(${Math.max(-64, Math.min(64, dx / 2))}px)`;
  }, { passive: true });
  logInner.addEventListener("touchend", async () => {
    if (!swipe) return;
    const { art, m, dx, axis } = swipe;
    swipe = null;
    art.style.transform = "";
    if (axis !== "x" || Math.abs(dx) < 72 || busy) return;
    const idx = m.swipeIndex ?? 0;
    const isLast = chat.messages.at(-1) === m;
    if (dx > 0 && idx > 0) m.swipeIndex = idx - 1;
    else if (dx < 0 && idx < m.swipes.length - 1) m.swipeIndex = idx + 1;
    else if (dx < 0 && isLast) { generate("swipe"); return; }
    else return;
    await persist(); paintLog({ scroll: false });
  });

  // ---------- Branches ----------
  async function branchFrom(i) {
    const ok = await askFirst({
      title: "Branch from this message?",
      body: `A new chat starts with the first ${i + 1} message${i ? "s" : ""} of this one, and you move to it. This chat stays exactly as it is.`,
      confirm: "Branch",
    });
    if (!ok || busy) return;
    const upTo = i + 1;
    const copy = {
      ...structuredClone(chat),
      id: uid(),
      title: `${chat.title.replace(/ \(branch\)$/, "")} (branch)`,
      messages: structuredClone(chat.messages.slice(0, upTo)),
      // A summary of later messages would leak events that have not happened here.
      memory: chat.memory && (chat.memory.upTo ?? 0) <= upTo ? structuredClone(chat.memory) : null,
      branchOf: { chatId: chat.id, messageId: chat.messages[i].id },
      warnedTrim: false,
      createdAt: now(),
    };
    await chats.save(copy);
    toast(`Branched at message ${upTo}. The original chat is unchanged.`, "ok");
    location.hash = `#/chat/${bot.id}/${copy.id}`;
  }

  // ---------- Scene tracker ----------
  // Where everyone is and what they have on them, right now. Updated after
  // each reply when switched on, and sent with every reply.
  async function refreshScene({ quiet = false } = {}) {
    if (sceneBusy || !chat.messages.length) return false;
    sceneBusy = true;
    setActivity("scene", "Updating the scene…");
    paintHeader();
    try {
      const text = await updateScene({
        bot, names: namesFor(), previous: chat.scene?.text ?? "",
        lines: transcript(chat.messages.slice(chat.scene?.text ? -2 : -12), nameOf, namesFor()),
      });
      if (!text) throw new Error("The model sent back an empty scene.");
      chat.scene = { auto: chat.scene?.auto ?? false, text, updatedAt: now() };
      await persist();
      if (!quiet) toast("Scene updated.", "ok");
      return true;
    } catch (err) {
      toast(`The scene was not updated. ${err.message}`, "error");
      return false;
    } finally {
      sceneBusy = false;
      setActivity("scene", null);
      paintHeader();
    }
  }

  function openScene() {
    const sc = chat.scene ?? { text: "", auto: false };
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Scene tracker</h2>
        <p class="hint">The state of the scene right now, sent with every reply so small details stay consistent:
          where everyone is, the time, the mood, what they wear and hold. Edit it freely.</p>
        <div class="field">
          <label for="sc-text">Right now <span class="count" id="sc-status"></span></label>
          <textarea id="sc-text" class="tall" placeholder="Location: …&#10;Time: …&#10;Present: …&#10;Mood: …&#10;Appearance: …&#10;Holding: …">${esc(sc.text ?? "")}</textarea>
        </div>
        <label class="check"><input type="checkbox" id="sc-auto" ${sc.auto ? "checked" : ""}>
          <span>Update after every reply<small>One extra request per reply.</small></span></label>
        <div class="dialog-actions">
          <button class="btn btn-quiet push" type="button" id="sc-now">Update now</button>
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">Save</button>
        </div>
      </form>`, {
      wide: true,
      onClose: async (v) => {
        if (v !== "ok") return;
        chat.scene = { ...(chat.scene ?? {}), text: $("#sc-text", dlg).value.trim(), auto: $("#sc-auto", dlg).checked, updatedAt: now() };
        await persist(); paintHeader();
        toast("Scene saved.", "ok");
      },
    });
    const ta = $("#sc-text", dlg);
    autosize(ta);
    const status = () => { $("#sc-status", dlg).textContent = chat.scene?.text ? `updated ${timeAgo(chat.scene.updatedAt)}` : "empty"; };
    status();
    $("#sc-now", dlg).addEventListener("click", async (e) => {
      const b = e.currentTarget;
      chat.scene = { ...(chat.scene ?? { auto: false }), text: ta.value.trim() };
      b.classList.add("is-loading"); b.setAttribute("aria-busy", "true"); ta.readOnly = true;
      if (await refreshScene({ quiet: true })) ta.value = chat.scene.text;
      b.classList.remove("is-loading"); b.removeAttribute("aria-busy"); ta.readOnly = false;
      ta.dispatchEvent(new Event("input"));
      status();
    });
  }

  // ---------- Pinned moments ----------
  function scrollToMessage(id) {
    const el = $(`[data-id="${CSS.escape(id)}"]`, logInner);
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth; // restart the highlight
    el.classList.add("flash");
    return true;
  }

  function openPinned() {
    const pins = chat.messages.filter((m) => m.pinned);
    const dlg = openDialog(`<div class="dialog-body">
      <h2>Pinned moments</h2>
      <p class="hint">Pinned messages are always sent to the model, even after they fall out of the context. Pin or unpin from any message.</p>
      ${pins.length ? `<ul class="pin-list">${pins.map((m) => `
        <li class="pin-row">
          <div class="grow"><strong>${esc(nameOf(m))}</strong>
            <p>${esc(stripBond(currentText(m)).replace(/\s+/g, " ").slice(0, 180))}${currentText(m).length > 180 ? "…" : ""}</p></div>
          <button class="btn btn-sm" type="button" data-go="${m.id}">Go to</button>
          <button class="btn btn-sm btn-quiet" type="button" data-unpin="${m.id}">Unpin</button>
        </li>`).join("")}</ul>`
      : `<p class="note">${icon("info")}<span>Nothing pinned yet. Use the pin button on a message that matters, like a promise or a confession.</span></p>`}
      <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
    </div>`);
    dlg.addEventListener("click", async (e) => {
      const go = e.target.closest("[data-go]");
      const un = e.target.closest("[data-unpin]");
      if (go) { dlg.close(); scrollToMessage(go.dataset.go); }
      if (un) {
        const m = chat.messages.find((x) => x.id === un.dataset.unpin);
        if (m) { m.pinned = false; await persist(); paintLog({ scroll: false }); }
        un.closest("li").remove();
      }
    });
  }

  // ---------- Recap ----------
  const recapCard = $("#recap", main);
  async function showRecap() {
    if (chat.messages.length < 2) { toast("There is not much to recap yet."); return; }
    recapCard.hidden = false;
    const body = $("#recap-body", main);
    body.setAttribute("aria-busy", "true");
    body.innerHTML = '<span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span>';
    try {
      const text = await recap({
        bot, names: namesFor(), memory: chat.memory?.text ?? "",
        lines: transcript(chat.messages.slice(-16), nameOf, namesFor()),
      });
      if (!text) throw new Error("The model sent back an empty recap.");
      body.innerHTML = renderMarkdown(text);
    } catch (err) {
      recapCard.hidden = true;
      toast(`No recap. ${err.message}`, "error");
    } finally {
      body.removeAttribute("aria-busy");
    }
  }
  $("#recap-close", main).addEventListener("click", () => { recapCard.hidden = true; input.focus(); });

  // ---------- Story ----------
  function openStory() {
    const dlg = openDialog(`<div class="dialog-body">
      <h2>Turn this chat into a story</h2>
      <p class="hint">Rewrites the chat as prose, keeping every event and choice. Nothing in the chat changes.</p>
      <div class="form-row">
        <div class="field"><label for="st-range">Which part</label>
          <select id="st-range">
            <option value="20">The last 20 messages</option>
            <option value="50" selected>The last 50 messages</option>
            <option value="all">The whole chat (${chat.messages.length} messages)</option>
          </select></div>
        <div class="field"><label for="st-pov">Told as</label>
          <select id="st-pov">
            <option value="third">Third person</option>
            <option value="char">First person, by ${esc(bot.name)}</option>
          </select></div>
      </div>
      <div id="st-out" class="story-out" hidden></div>
      <div class="dialog-actions">
        <button class="btn btn-quiet push" type="button" id="st-copy" hidden>Copy</button>
        <button class="btn" type="button" id="st-download" hidden>Download</button>
        <button class="btn btn-ghost" type="button" data-close>Close</button>
        <button class="btn btn-primary" type="button" id="st-write">Write the story</button>
      </div>
    </div>`, { wide: true });
    $("[data-close]", dlg).addEventListener("click", () => dlg.close());
    const out = $("#st-out", dlg);
    let story = "";
    const aborter = new AbortController();
    dlg.addEventListener("close", () => aborter.abort());
    $("#st-write", dlg).addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const range = $("#st-range", dlg).value;
      const msgs = range === "all" ? chat.messages : chat.messages.slice(-Number(range));
      b.classList.add("is-loading"); b.setAttribute("aria-busy", "true");
      out.hidden = false;
      out.innerHTML = '<span class="skeleton skeleton-title"></span>' + '<span class="skeleton skeleton-line"></span>'.repeat(5);
      try {
        story = await storyFrom({
          bot, names: namesFor(), pov: $("#st-pov", dlg).value,
          lines: transcript(msgs, nameOf, namesFor()), signal: aborter.signal,
        });
        if (!story) throw new Error("The model sent back an empty story.");
        out.innerHTML = `<div class="prose">${renderMarkdown(story)}</div>`;
        $("#st-copy", dlg).hidden = false;
        $("#st-download", dlg).hidden = false;
        b.textContent = "Write it again";
      } catch (err) {
        if (err.name === "AbortError") return;
        out.innerHTML = `<p class="note bad">${icon("info")}<span>${esc(err.message)}</span></p>`;
      } finally {
        b.classList.remove("is-loading"); b.removeAttribute("aria-busy");
      }
    });
    $("#st-copy", dlg).addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(story); toast("Story copied."); }
      catch { toast("Could not copy. Your browser blocked clipboard access.", "error"); }
    });
    $("#st-download", dlg).addEventListener("click", () => download(`${slug(bot.name)}-${slug(chat.title)}-story.md`, story, "text/markdown"));
  }

  // ---------- Cast (group scenes) ----------
  function openCast() {
    const candidates = allBots.filter((b) => b.id !== bot.id);
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Characters in this chat</h2>
        <p class="hint">Add other bots to make this a group scene. Each character keeps a bond of their own; the meter in the header
          shows ${esc(bot.name)}'s and opens all of them. The chat stays in ${esc(bot.name)}'s list. Pick who replies next under the message box, or leave it on Auto.</p>
        ${candidates.length ? `<div class="cast-list">${candidates.map((b) => `
          <label class="cast-row">
            <input type="checkbox" value="${b.id}" ${chat.castIds.includes(b.id) ? "checked" : ""}>
            ${avatarHTML(b.avatar, b.name, 36)}
            <span class="grow"><span class="t">${esc(b.name)}</span><small>${esc(b.tagline || "")}</small></span>
          </label>`).join("")}</div>` : `<p class="note">${icon("info")}<span>There are no other bots yet. <a href="#/bot/new">Make one</a> first.</span></p>`}
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok" ${candidates.length ? "" : "disabled"}>Save</button>
        </div>
      </form>`, {
      onClose: async (v) => {
        if (v !== "ok") return;
        const before = chat.castIds.length;
        const next = $$('input[type="checkbox"]', dlg).filter((c) => c.checked).map((c) => c.value);
        const leaving = chat.castIds.filter((id) => !next.includes(id)).map((id) => botById.get(id)?.name).filter(Boolean);
        if (leaving.length && !(await askFirst({
          title: `Remove ${leaving.join(" and ")} from this scene?`,
          body: `${leaving.length > 1 ? "They" : leaving[0]} will stop replying here. Messages already written stay in the chat.`,
          confirm: "Remove", danger: true,
        }))) return;
        chat.castIds = next;
        await persist(); paintHeader(); paintLog({ scroll: false });
        if (chat.castIds.length !== before) {
          toast(chat.castIds.length ? `Now a group scene with ${everyone().map((b) => b.name).join(", ")}.` : `Back to just ${bot.name}.`, "ok");
        }
      },
    });
  }

  // ---------- Lore suggestions ----------
  async function openLoreSuggestions() {
    const dlg = openDialog(`<div class="dialog-body">
      <h2>Suggest lore from this chat</h2>
      <p class="hint">The model reads the last 30 messages and proposes entries for lasting facts. Edit or untick any before saving.</p>
      <div id="sugg" aria-busy="true">
        <span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span>
      </div>
      <div class="dialog-actions" id="sugg-actions" hidden>
        <label class="persona-pick push"><span>Save to</span><select id="sugg-book"></select></label>
        <button class="btn btn-ghost" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="button" id="sugg-save">Save selected</button>
      </div>
    </div>`, { wide: true });
    $("[data-close]", dlg).addEventListener("click", () => dlg.close());
    const box = $("#sugg", dlg);
    const aborter = new AbortController();
    dlg.addEventListener("close", () => aborter.abort());

    let found;
    let books;
    try {
      const [entries, allBooks] = await Promise.all([loreForBot(bot), getLorebooks()]);
      books = allBooks;
      found = await suggestLore({
        bot, names: namesFor(), existing: entries.map((e) => e.title),
        lines: transcript(chat.messages.slice(-30), nameOf, namesFor()), signal: aborter.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      box.removeAttribute("aria-busy");
      box.innerHTML = `<p class="note bad">${icon("info")}<span>${esc(err.message)}</span></p>`;
      return;
    }
    box.removeAttribute("aria-busy");
    if (!found.length) {
      box.innerHTML = `<p class="note">${icon("info")}<span>Nothing new worth saving yet. Try again after more of the story has happened.</span></p>`;
      return;
    }
    box.innerHTML = `<div class="sugg-list">${found.map((e, i) => `
      <fieldset class="sugg-item">
        <legend class="sr-only">Suggestion ${i + 1}</legend>
        <label class="check"><input type="checkbox" data-pick="${i}" checked><span>Save this entry</span></label>
        <div class="form-row">
          <div class="field"><label for="s-title-${i}">Title</label><input type="text" id="s-title-${i}" value="${esc(e.title)}"></div>
          <div class="field"><label for="s-keys-${i}">Keywords</label><input type="text" id="s-keys-${i}" value="${esc(e.keywords.join(", "))}"></div>
        </div>
        <div class="field"><label for="s-body-${i}">${esc(e.category)}</label><textarea id="s-body-${i}">${esc(e.content)}</textarea></div>
      </fieldset>`).join("")}</div>`;
    $$("textarea", box).forEach(autosize);

    const linked = books.filter((b) => !b.global && bot.lorebookIds?.includes(b.id));
    const rest = books.filter((b) => !linked.includes(b));
    $("#sugg-book", dlg).innerHTML = [
      ...linked.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`),
      `<option value="new">New book: ${esc(bot.name)} lore</option>`,
      ...rest.map((b) => `<option value="${b.id}">${esc(b.name)}${b.global ? " (every bot)" : ""}</option>`),
    ].join("");
    $("#sugg-actions", dlg).hidden = false;

    $("#sugg-save", dlg).addEventListener("click", async (ev) => {
      const picked = $$("[data-pick]", box).filter((c) => c.checked).map((c) => Number(c.dataset.pick));
      if (!picked.length) { toast("Tick at least one entry, or cancel.", "error"); return; }
      ev.currentTarget.classList.add("is-loading");
      let bookId = $("#sugg-book", dlg).value;
      if (bookId === "new") {
        const book = newLorebook({ name: `${bot.name} lore`, description: "Suggested from chats." });
        await saveLorebooks([...(await getLorebooks()), book]);
        bot.lorebookIds = [...(bot.lorebookIds ?? []), book.id];
        await bots.save(bot);
        bookId = book.id;
      }
      for (const i of picked) {
        await lore.save(newLore({
          title: $(`#s-title-${i}`, box).value.trim() || found[i].title,
          category: found[i].category,
          keywords: $(`#s-keys-${i}`, box).value.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
          content: $(`#s-body-${i}`, box).value.trim(),
          bookId,
        }));
      }
      dlg.close();
      toast(`Saved ${picked.length} lore ${picked.length === 1 ? "entry" : "entries"}.`, "ok", {
        action: "Open lore", onAction: () => { location.hash = "#/lore"; },
      });
    });
  }

  // ---------- Write my reply (impersonation) ----------
  // The model writes {{user}}'s next message into the box. Nothing is sent
  // until the person reviews it and presses Send.
  let drafting = null;    // AbortController while a draft is being written
  let draftSource = null; // what was in the box before, for Undo and Try again
  const draftBar = $("#draft-bar", main);
  const draftBtn = $("#impersonate", main);

  // The bar above the box after something was written into it for you:
  // a draft, an idea, or a translation. Undo puts back what was there.
  function showDraftBar(text, { tools = true, retry = true } = {}) {
    draftBar.hidden = false;
    $("#draft-status", main).textContent = text;
    $("#draft-retry", main).hidden = !tools || !retry;
    $("#draft-undo", main).hidden = !tools;
  }
  function hideDraftBar() { draftBar.hidden = true; draftSource = null; }

  function setDrafting(on) {
    draftBtn.innerHTML = icon(on ? "stop" : "quill");
    draftBtn.setAttribute("aria-label", on ? "Stop writing" : "Write my reply. Uses what you typed as the idea.");
    draftBtn.classList.toggle("is-active", on);
    input.readOnly = on;
    sendBtn.disabled = on;
  }

  async function impersonate({ retry = false } = {}) {
    if (drafting) { drafting.abort(); return; }
    if (busy) return;
    const conn = await getActiveConnection();
    if (!conn) {
      toast("Set up an API connection first.", "error", { action: "Open", onAction: () => { location.hash = "#/connection"; } });
      return;
    }
    const hint = retry ? draftSource ?? "" : input.value.trim();
    draftSource = hint;
    const who = userName();
    // Reply to whoever spoke last.
    const last = chat.messages.findLast((m) => m.role === "assistant");
    const partner = last ? speakerOf(last) : bot;

    const [freshSettings, preset, loreEntries] = await Promise.all([getSettings(), getActivePreset(), loreForBot(partner)]);
    const prompt = buildPrompt({
      bot: partner, persona: persona(), preset, settings: freshSettings, loreEntries,
      history: withSpeakers(chat.messages), mode: "impersonate", hint,
      memory: chat.memory?.text ?? "", scene: chat.scene?.text ?? "", cast: group() ? others(partner) : [],
    });
    const body = {
      model: chat.model || partner.model || conn.model || undefined,
      messages: prompt.messages,
      stream: freshSettings.gen.stream,
      ...generationParams(freshSettings, partner),
    };

    drafting = new AbortController();
    setDrafting(true);
    showDraftBar(hint ? `Writing “${hint.length > 40 ? hint.slice(0, 40) + "…" : hint}” as ${who}…` : `Writing ${who}'s reply…`, { tools: false });
    input.value = "";
    fitInput();

    let text = "";
    try {
      const res = await chatCompletion(conn, body, {
        signal: drafting.signal,
        onDelta: (r) => { input.value = cleanImpersonation(r.content, who); fitInput(); },
      });
      text = cleanImpersonation(res.content, who);
      if (!text) throw new Error("The model sent back an empty draft. Try again, or check the model on the Connection page.");
      window.dispatchEvent(new CustomEvent("api-status", { detail: true }));
    } catch (err) {
      text = input.value.trim();
      if (err.name !== "AbortError") {
        toast(err.message, "error");
        window.dispatchEvent(new CustomEvent("api-status", { detail: false }));
      }
    } finally {
      drafting = null;
      setDrafting(false);
    }

    if (text) {
      input.value = text;
      showDraftBar(`Written as ${who}. Edit it if you like, then send.`);
    } else {
      input.value = hint;
      hideDraftBar();
    }
    fitInput();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  draftBtn.addEventListener("click", () => impersonate());

  // ---------- Reply ideas ----------
  const suggestBar = $("#suggest-bar", main);
  const suggestList = $("#suggest-list", main);
  let ideas = [];
  let ideasBusy = null;
  async function showIdeas() {
    if (ideasBusy) return;
    if (busy || drafting) return;
    suggestBar.hidden = false;
    suggestList.setAttribute("aria-busy", "true");
    suggestList.innerHTML = '<span class="skeleton skeleton-chip"></span>'.repeat(3);
    $("#suggest-title", main).textContent = "Thinking of ideas…";
    ideasBusy = new AbortController();
    const last = chat.messages.findLast((m) => m.role === "assistant");
    const partner = last ? speakerOf(last) : bot;
    try {
      ideas = await suggestReplies({
        bot: partner, names: namesFor(partner), persona: persona()?.description ?? "",
        lines: transcript(chat.messages.slice(-8), nameOf, namesFor(partner)), signal: ideasBusy.signal,
      });
      if (!ideas.length) throw new Error("No ideas came back. Try again.");
      $("#suggest-title", main).textContent = "Ideas";
      suggestList.innerHTML = ideas.map((o, i) => `<button type="button" class="suggest-chip" data-idea="${i}" title="${esc(o.text)}">${esc(o.label)}</button>`).join("");
    } catch (err) {
      if (err.name !== "AbortError") toast(err.message, "error");
      suggestBar.hidden = true;
    } finally {
      suggestList.removeAttribute("aria-busy");
      ideasBusy = null;
    }
  }
  function closeIdeas() { ideasBusy?.abort(); suggestBar.hidden = true; }
  $("#suggest", main).addEventListener("click", () => (suggestBar.hidden ? showIdeas() : closeIdeas()));
  $("#suggest-more", main).addEventListener("click", showIdeas);
  $("#suggest-close", main).addEventListener("click", () => { closeIdeas(); input.focus(); });
  suggestList.addEventListener("click", (e) => {
    const b = e.target.closest("[data-idea]");
    if (!b) return;
    draftSource = input.value;
    input.value = ideas[Number(b.dataset.idea)].text;
    fitInput();
    closeIdeas();
    showDraftBar("Idea added. Edit it if you like, then send.", { retry: false });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  // ---------- Translate my message ----------
  async function translateOutgoing() {
    const text = input.value.trim();
    if (!text) { toast(`Write your message first, in any language. It will be translated into ${chatLanguage()}.`); input.focus(); return; }
    if (busy || drafting) return;
    const btn = $("#composer-more", main);
    btn.classList.add("is-loading");
    input.readOnly = true;
    try {
      const out = await translate({ text, to: chatLanguage(), bot });
      if (!out) throw new Error("The model sent back an empty translation.");
      draftSource = text;
      input.value = out;
      fitInput();
      showDraftBar(`Translated into ${chatLanguage()}. Check it, then send.`, { retry: false });
    } catch (err) {
      toast(`Could not translate. ${err.message}`, "error");
    } finally {
      btn.classList.remove("is-loading");
      input.readOnly = false;
      input.focus();
    }
  }
  $("#composer-more", main).addEventListener("click", (e) => openMenu(e.currentTarget, [
    // On a phone the Ideas button lives here, to leave room for typing.
    ...(narrow.matches ? [{ label: "Ideas for what to say", hint: "Three options for your next move · Alt+S", onSelect: showIdeas }] : []),
    { label: directBar.hidden ? "Direct the next reply" : "Remove the direction", hint: "A hidden note for the next reply only · Alt+D", onSelect: () => setDirecting(directBar.hidden) },
    { label: "Surprise me", hint: "A random twist; check it, then send to see the bot react", onSelect: surprise },
    { label: "Roll dice", hint: "A fair roll the reply has to respect · /roll d20", onSelect: openDice },
    { label: `Translate my message into ${chatLanguage()}`, hint: "Write in any language, check, then send · Alt+T", onSelect: translateOutgoing },
  ], { align: "end" }));
  $("#draft-retry", main).addEventListener("click", () => impersonate({ retry: true }));
  $("#draft-undo", main).addEventListener("click", () => {
    input.value = draftSource ?? "";
    hideDraftBar();
    fitInput();
    input.focus();
  });

  async function send() {
    if (drafting) return;
    if (busy) { controller?.abort(); return; }
    const text = input.value.trim();
    if (!text) {
      // Empty send: answer your last message, or in a group, let the next
      // character carry the scene on.
      if (chat.messages.at(-1)?.role === "user" || group() || direction()) generate("new");
      else input.focus();
      return;
    }
    hideDraftBar();
    closeIdeas();
    const roll = text.startsWith("/roll") ? parseRoll(text) : null;
    if (text.startsWith("/roll") && !roll) { toast("Write a roll like /roll d20, /roll 2d6+1 or /roll d100 to open the door.", "error"); return; }
    if (roll) await addRoll(roll);
    else chat.messages.push({ id: uid(), role: "user", content: text, at: now() });
    input.value = "";
    fitInput();
    await persist();
    generate("new");
  }

  // A roll is its own message; the reply that answers it must honour it.
  async function addRoll(roll) {
    chat.messages.push({ id: uid(), role: "user", content: rollText(roll), roll, at: now() });
    await persist();
    paintLog();
  }
  function openDice() {
    if (busy) return;
    const dlg = openDialog(`<form method="dialog" class="dialog-body" id="dice-form">
      <h2>Roll dice</h2>
      <p class="hint">The roll goes into the chat, and ${esc(group() ? "the next character" : bot.name)} has to go along with the result. You can also type <code>/roll 2d6+1</code> in the message box.</p>
      <fieldset class="field dice-pick"><legend class="field-label">Dice</legend>
        <div class="segmented">
          ${["d20", "d6", "2d6", "d100"].map((d, i) => `<label><input type="radio" name="dice" value="${d}" ${i === 0 ? "checked" : ""}><span>${d}</span></label>`).join("")}
          <label><input type="radio" name="dice" value="custom"><span>Other</span></label>
        </div>
      </fieldset>
      <div class="field" id="dice-custom-field" hidden><label for="dice-custom">Other dice</label>
        <input type="text" id="dice-custom" placeholder="3d8+2" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label for="dice-label">What is it for? <span class="count">Optional</span></label>
        <input type="text" id="dice-label" placeholder="pick the lock" autocomplete="off" maxlength="80"></div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
        <button class="btn btn-primary" value="roll" id="dice-roll">${icon("dice")}Roll and send</button>
      </div>
    </form>`);
    const customField = $("#dice-custom-field", dlg);
    $$("input[name=dice]", dlg).forEach((r) => r.addEventListener("change", () => {
      customField.hidden = $("input[name=dice]:checked", dlg).value !== "custom";
      if (!customField.hidden) $("#dice-custom", dlg).focus();
    }));
    $("#dice-form", dlg).addEventListener("submit", async (e) => {
      if (e.submitter?.value !== "roll") return;
      const pick = $("input[name=dice]:checked", dlg).value;
      const expr = pick === "custom" ? $("#dice-custom", dlg).value.trim() : pick;
      const roll = parseRoll(`/roll ${expr} ${$("#dice-label", dlg).value.trim()}`);
      if (!roll) {
        e.preventDefault();
        toast("Write dice like d20, 2d6 or 3d8+2 (up to 20 dice, up to 1000 sides).", "error");
        $("#dice-custom", dlg).focus();
        return;
      }
      await addRoll(roll);
      generate("new");
    });
  }

  $("#composer", main).addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyW") { e.preventDefault(); impersonate(); return; }
    if (e.altKey && e.code === "KeyD") { e.preventDefault(); setDirecting(directBar.hidden); return; }
    if (e.altKey && e.code === "KeyS") { e.preventDefault(); suggestBar.hidden ? showIdeas() : closeIdeas(); return; }
    if (e.altKey && e.code === "KeyT") { e.preventDefault(); translateOutgoing(); return; }
    const submit = settings.enterToSend ? e.key === "Enter" && !e.shiftKey && !e.isComposing : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (submit) { e.preventDefault(); send(); }
  });
  // iPhones scroll the whole page up to make room for the keyboard and can
  // leave it there. The chat page never scrolls, so put it back.
  const settlePage = () => setTimeout(() => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); }, 50);
  main.addEventListener("focusout", settlePage);
  const onGlobalKey = (e) => {
    if (e.key === "Escape" && busy) controller?.abort();
    if (e.key === "Escape" && drafting) drafting.abort();
  };
  document.addEventListener("keydown", onGlobalKey);

  // ---------- Message actions ----------
  logInner.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "retry") { pendingError = null; generate("new"); return; }
    const el = btn.closest("[data-id]");
    const i = chat.messages.findIndex((m) => m.id === el?.dataset.id);
    const m = chat.messages[i];
    if (!m) return;

    if (action === "edit") {
      if (busy) return;
      editingId = m.id; paintLog({ scroll: false });
    } else if (action === "cancel-edit") {
      editingId = null; paintLog({ scroll: false });
    } else if (action === "save-edit") {
      saveEdit(m);
    } else if (action === "swipe-prev") {
      m.swipeIndex = Math.max(0, (m.swipeIndex ?? 0) - 1);
      await persist(); paintLog({ scroll: false });
    } else if (action === "swipe-next") {
      if ((m.swipeIndex ?? 0) < m.swipes.length - 1) {
        m.swipeIndex += 1;
        await persist(); paintLog({ scroll: false });
      } else generate("swipe");
    } else if (action === "regenerate") {
      if (busy) return;
      openMenu(btn, [
        { label: "Regenerate", hint: "Another version, same instructions", onSelect: () => generate("swipe") },
        "-",
        ...NUDGES.map((n) => ({ label: n.label, onSelect: () => generate("swipe", { note: n.note }) })),
      ], { align: "start" });
    } else if (action === "msg-menu") {
      const isBot = m.role === "assistant";
      const hasTr = isBot ? m.meta?.[m.swipeIndex ?? 0]?.translation : m.translation;
      openMenu(btn, [
        ...(isBot && i === chat.messages.length - 1 ? [{ label: "Continue this reply", hint: "Write more from where it ends", disabled: busy, onSelect: () => generate("continue") }] : []),
        { label: "Copy", onSelect: () => copyMessage(m) },
        { label: hasTr ? "Hide translation" : `Translate into ${myLanguage()}`, onSelect: () => (hasTr ? hideTranslation(m) : translateMessage(m)) },
        ...(isBot ? [{ label: "Check character", hint: "Does this stay true to the definition?", disabled: checking.has(m.id), onSelect: () => runCheck(m) }] : []),
        { label: "Branch from here", hint: "A new chat that continues from this message", disabled: busy, onSelect: () => branchFrom(i) },
        ...(i < chat.messages.length - 1 ? [{ label: "Rewind to here", hint: "Delete every message after this one", disabled: busy, onSelect: () => rewindTo(i) }] : []),
        "-",
        { label: "Delete message", danger: true, disabled: busy, onSelect: () => deleteMessage(m) },
      ], { align: "start" });
    } else if (action === "pin") {
      m.pinned = !m.pinned;
      await persist(); paintLog({ scroll: false });
      toast(m.pinned ? "Pinned. This moment is always sent to the model." : "Unpinned.");
    } else if (action === "hide-translation") {
      hideTranslation(m);
    } else if (action === "continue") {
      generate("continue");
    } else if (action === "check") {
      runCheck(m);
    } else if (action === "show-check") {
      showCheck(m);
    } else if (action === "branch") {
      if (busy) return;
      branchFrom(i);
    }
  });

  async function copyMessage(m) {
    try { await navigator.clipboard.writeText(currentText(m)); toast("Copied."); }
    catch { toast("Could not copy. Your browser blocked clipboard access.", "error"); }
  }

  // Asks first unless the person turned confirmations off in Settings.
  const askFirst = (opts) => (settings.confirm?.enabled === false ? Promise.resolve(true) : confirmDialog(opts));

  async function deleteMessage(m) {
    if (busy) return;
    const ok = await askFirst({
      title: "Delete this message?",
      body: `${nameOf(m)}'s message will be removed from the chat${m.swipes?.length > 1 ? `, with all ${m.swipes.length} versions` : ""}. You can undo right after.`,
      confirm: "Delete message", danger: true,
    });
    if (!ok || busy) return;
    const i = chat.messages.indexOf(m);
    if (i === -1) return;
    chat.messages.splice(i, 1);
    await persist(); paintLog({ scroll: false });
    toast("Message deleted.", "info", {
      action: "Undo",
      onAction: async () => { chat.messages.splice(i, 0, m); await persist(); paintLog({ scroll: false }); },
    });
  }

  // ---------- Translation ----------
  // Your language comes from Settings, or from the browser if not set.
  function myLanguage() {
    if (settings.translate?.mine?.trim()) return settings.translate.mine.trim();
    try { return new Intl.DisplayNames(["en"], { type: "language" }).of(navigator.language.split("-")[0]) || "English"; }
    catch { return "English"; }
  }
  const chatLanguage = () => settings.translate?.chat?.trim() || "English";

  async function translateMessage(m) {
    const speaker = speakerOf(m) ?? bot;
    const lang = myLanguage();
    translating.add(m.id);
    setActivity(`tr-${m.id}`, "Translating…");
    paintLog({ scroll: false });
    try {
      const text = await translate({ text: stripBond(currentText(m)), to: lang, bot: speaker });
      if (!text) throw new Error("The model sent back an empty translation.");
      const tr = { lang, text };
      if (m.role === "assistant") m.meta[m.swipeIndex ?? 0] = { ...m.meta[m.swipeIndex ?? 0], translation: tr };
      else m.translation = tr;
      await persist();
    } catch (err) {
      toast(`Could not translate. ${err.message}`, "error");
    } finally {
      translating.delete(m.id);
      setActivity(`tr-${m.id}`, null);
      paintLog({ scroll: false });
    }
  }
  async function hideTranslation(m) {
    if (m.role === "assistant") delete m.meta[m.swipeIndex ?? 0].translation;
    else delete m.translation;
    await persist(); paintLog({ scroll: false });
  }

  async function saveEdit(m) {
    const value = $("#edit-box", logInner).value;
    const before = currentText(m);
    if (value === before) { editingId = null; paintLog({ scroll: false }); return; }
    const ok = await askFirst({ title: "Save your changes?", body: "The old text of this message will be replaced. You can undo right after.", confirm: "Save changes" });
    if (!ok) { $("#edit-box", logInner)?.focus(); return; } // keep editing
    const si = m.swipeIndex ?? 0;
    const put = (text) => { if (m.swipes) m.swipes[si] = text; else m.content = text; };
    put(value);
    editingId = null;
    await persist(); paintLog({ scroll: false });
    toast("Message edited.", "info", {
      action: "Undo", onAction: async () => { put(before); await persist(); paintLog({ scroll: false }); },
    });
  }
  logInner.addEventListener("keydown", (e) => {
    if (e.target.id !== "edit-box") return;
    const m = chat.messages.find((x) => x.id === editingId);
    if (e.key === "Escape") { e.stopPropagation(); editingId = null; paintLog({ scroll: false }); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && m) { e.preventDefault(); saveEdit(m); }
  });

  // ---------- Top bar ----------
  $("#persona", main).addEventListener("change", async (e) => {
    chat.personaId = e.target.value;
    startPersonaId = chat.personaId;
    rememberBotPersona(bot.id, chat.personaId);
    await persist(); paintHeader(); paintLog({ scroll: false });
  });

  // Rename in place: click the name, type, Enter saves, Esc cancels.
  const titleBtn = $("#chat-title", main);
  const titleInput = $("#title-input", main);
  function startRename() {
    if (!titleInput.hidden) return;
    titleInput.value = chat.title;
    titleBtn.hidden = true;
    titleInput.hidden = false;
    titleInput.focus(); titleInput.select();
  }
  async function endRename(save) {
    if (titleInput.hidden) return;
    const title = titleInput.value.trim();
    titleInput.hidden = true;
    titleBtn.hidden = false;
    if (save && title && title !== chat.title) {
      chat.title = title;
      await persist(); paintHeader();
      toast(`Renamed to “${title}”.`);
    }
    titleBtn.focus();
  }
  titleBtn.addEventListener("click", startRename);
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); endRename(true); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endRename(false); }
  });
  titleInput.addEventListener("blur", () => endRename(true));

  // Edit who you are without leaving the chat. The persona is shared, so
  // the dialog says which other chats it changes.
  function editPersona() {
    const p = persona();
    if (!p) return;
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Edit persona</h2>
        <div class="field"><label for="pe-name">Name</label>
          <input type="text" id="pe-name" value="${esc(p.name)}" maxlength="60" autocomplete="off"></div>
        <div class="field"><label for="pe-desc">Description</label>
          <textarea id="pe-desc" class="tall" placeholder="Appearance, personality, background, how others see you…">${esc(p.description ?? "")}</textarea>
          <p class="hint">Bots read this to know who you are. It changes ${esc(p.name || "this persona")} in every chat that uses it. Picture and more on the <a href="#/personas">Personas</a> page.</p></div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">Save</button>
        </div>
      </form>`, {
      onClose: async (v) => {
        if (v !== "ok") return;
        p.name = $("#pe-name", dlg).value.trim() || p.name;
        p.description = $("#pe-desc", dlg).value.trim();
        await personas.save(p);
        const opt = $(`#persona option[value="${CSS.escape(p.id)}"]`, main);
        if (opt) opt.textContent = p.name || "Unnamed";
        paintHeader(); paintLog({ scroll: false });
        toast(`${p.name} saved. The next reply uses the new description.`);
      },
    });
    $("#pe-desc", dlg).focus();
    $("a", dlg).addEventListener("click", () => dlg.close("cancel"));
  }
  $("#persona-edit", main).addEventListener("click", editPersona);

  if (bondOn) $("#bond", main).addEventListener("click", openBonds);
  $("#memory", main).addEventListener("click", openMemory);
  $("#cast", main).addEventListener("click", openCast);
  $("#scene", main).addEventListener("click", openScene);
  $("#model-chip", main).addEventListener("click", (e) => openModelMenu(e.currentTarget));

  function rename() {
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Rename chat</h2>
        <div class="field"><label for="rn-input">Chat name</label>
          <div class="input-group">
            <input type="text" id="rn-input" value="${esc(chat.title)}" autocomplete="off" maxlength="80">
            <button class="btn" type="button" id="rn-suggest" ${chat.messages.length < 2 ? "disabled" : ""}>Suggest</button>
          </div>
          <p class="hint">Suggest reads the chat and proposes a title like a chapter name.</p></div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">Save</button>
        </div>
      </form>`, {
      onClose: async (v) => {
        const title = $("#rn-input", dlg).value.trim();
        if (v !== "ok" || !title) return;
        chat.title = title;
        await persist(); paintHeader();
      },
    });
    const field = $("#rn-input", dlg);
    field.focus(); field.select();
    // Enter saves (the form's first button is Cancel).
    field.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); dlg.close("ok"); } });
    $("#rn-suggest", dlg).addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.classList.add("is-loading"); b.setAttribute("aria-busy", "true");
      try {
        const name = await nameChat({ bot, names: namesFor(), lines: transcript(chat.messages.slice(-40), nameOf, namesFor()) });
        if (!name) throw new Error("No name came back.");
        field.value = name;
        field.focus(); field.select();
      } catch (err) {
        toast(`No suggestion. ${err.message}`, "error");
      } finally {
        b.classList.remove("is-loading"); b.removeAttribute("aria-busy");
      }
    });
  }

  async function deleteChat() {
    if (busy) return;
    const ok = await confirmDialog({ title: "Delete this chat?", body: `“${chat.title}” and its ${chat.messages.length} messages will be gone for good.`, confirm: "Delete chat", danger: true });
    if (!ok) return;
    await chats.remove(chat.id);
    const rest = list.filter((c) => c.id !== chat.id);
    toast("Chat deleted.");
    location.hash = rest[0] ? `#/chat/${bot.id}/${rest[0].id}` : `#/chat/${bot.id}`;
  }

  function exportChat() {
    const dlg = openDialog(`<div class="dialog-body">
      <h2>Export chat</h2>
      <p>Download “${esc(chat.title)}”.</p>
      <div class="dialog-actions">
        <button class="btn" type="button" data-fmt="txt">Plain text</button>
        <button class="btn" type="button" data-fmt="md">Markdown</button>
        <button class="btn btn-primary" type="button" data-fmt="json">JSON</button>
      </div></div>`);
    $$("[data-fmt]", dlg).forEach((b) => b.addEventListener("click", () => {
      const line = (m) => applyMacros(currentText(m), namesFor(speakerOf(m) ?? bot));
      const base = `${slug(bot.name)}-${slug(chat.title)}`;
      if (b.dataset.fmt === "json") download(`${base}.json`, { bot: bot.name, cast: cast().map((c) => c.name), persona: userName(), ...chat });
      else if (b.dataset.fmt === "md") download(`${base}.md`, `# ${chat.title}\n\n` + chat.messages.map((m) => `**${nameOf(m)}:** ${line(m)}`).join("\n\n"), "text/markdown");
      else download(`${base}.txt`, chat.messages.map((m) => `${nameOf(m)}: ${line(m)}`).join("\n\n"), "text/plain");
      dlg.close();
    }));
  }

  async function previewPrompt() {
    const draft = input.value.trim();
    const speaker = pickSpeaker(draft || (chat.messages.at(-1)?.role === "user" ? chat.messages.at(-1).content : ""));
    const [s, preset, entries, conn] = await Promise.all([getSettings(), getActivePreset(), loreForBot(speaker), getActiveConnection()]);
    const hist = draft ? [...chat.messages, { role: "user", content: draft }] : chat.messages;
    const p = buildPrompt({
      bot: speaker, persona: persona(), preset, settings: s, history: withSpeakers(hist), loreEntries: entries,
      bond: bondOnFor(speaker) ? bondFor(speaker) : null,
      memory: chat.memory?.text ?? "", scene: chat.scene?.text ?? "", note: direction(), cast: group() ? others(speaker) : [],
    });
    const params = generationParams(s, speaker);
    openDialog(`<div class="dialog-body">
      <h2>What the model sees</h2>
      <p class="hint">The next request${group() ? `, answered by ${esc(speaker.name)}` : ""}${draft ? ", including your unsent message" : ""}. About <strong>${p.tokens.toLocaleString()}</strong> tokens
        · model <code>${esc(chat.model || speaker.model || conn?.model || "not set")}</code>
        · ${Object.entries(params).map(([k, v]) => `${k} ${v}`).join(", ")}
        ${p.loreUsed.length ? `· lore: ${p.loreUsed.map(esc).join(", ")}` : ""}
        ${p.dropped ? `· <strong>${p.dropped} oldest messages left out</strong> to fit the context size` : ""}</p>
      <div class="prompt-preview">${p.messages.map((m) => `<span class="role">${m.role}</span>\n${esc(m.content)}`).join("\n")}</div>
      <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
    </div>`, { wide: true });
  }

  // On a phone, Memory and Characters live in this menu instead of the bar.
  $("#more", main).addEventListener("click", (e) => openMenu(e.currentTarget, [
    ...(narrow.matches ? [
      { label: "Model", hint: `${currentModel()}${chat.model ? " (this chat)" : ""}`, onSelect: () => openModelMenu($("#more", main)) },
      { label: "Memory", hint: chat.memory?.text ? "Summary of the story so far" : "Empty so far", onSelect: openMemory },
      { label: "Scene tracker", hint: chat.scene?.text ? "Where everyone is right now" : "Off so far", onSelect: openScene },
      { label: "Characters in this chat", hint: group() ? `${everyone().length} in the scene` : "Add bots for a group scene", onSelect: openCast },
      "-",
    ] : []),
    { label: `Pinned moments (${chat.messages.filter((m) => m.pinned).length})`, hint: "Always remembered by the model", onSelect: openPinned },
    { label: `${bot.name}'s journal (${chat.journal.length})`, hint: "Private diary entries about you", onSelect: openJournal },
    { label: "Recap so far", hint: "A few lines on what has happened", onSelect: showRecap },
    { label: "Turn into a story", hint: "Rewrite the chat as prose", onSelect: openStory },
    { label: "Suggest lore from this chat", hint: "New entries from what happened", onSelect: openLoreSuggestions },
    "-",
    { label: "See the prompt", hint: "Exactly what the model gets next", onSelect: previewPrompt },
    { label: "Usage in this chat", hint: "Tokens used by replies here", onSelect: openChatUsage },
    "-",
    { label: "Rename chat", onSelect: rename },
    { label: "Export chat", onSelect: exportChat },
    "-",
    { label: "Delete chat", danger: true, onSelect: deleteChat },
  ]));

  // ---------- Start ----------
  const hasConnection = !!activeConn;
  $("#no-conn", main).hidden = hasConnection;
  paintHeader();
  paintList();
  paintLog();
  // Coming back after a break: a few lines on where the story stands.
  if (hasConnection && settings.recap?.auto !== false && chat.messages.length >= 6 && Date.now() - lastVisit > 12 * 3600 * 1000) showRecap();
  if (jumpTo) requestAnimationFrame(() => scrollToMessage(jumpTo));
  if (matchMedia("(hover: hover)").matches) input.focus();

  // ---------- Command palette ----------
  const unregister = registerCommands(() => {
    const c = (title, run, keywords = "", hint = "") => ({ group: "This chat", title, run, keywords, hint });
    return [
      c("New chat", () => $("#new-chat", main).click(), "start fresh"),
      c("Memory", openMemory, "summary remember"),
      c("Scene tracker", openScene, "where location"),
      c("Characters in this chat", openCast, "group cast add bot"),
      ...(bondOn ? [c("Bond", openBonds, "relationship meter chart")] : []),
      c("Pinned moments", openPinned, "pin remembered"),
      c(`${bot.name}'s journal`, openJournal, "diary"),
      c("Recap so far", showRecap, "summary what happened"),
      c("Turn into a story", openStory, "prose novel"),
      c("Suggest lore from this chat", openLoreSuggestions, "lorebook"),
      c("Change the model", () => openModelMenu($("#more", main)), "switch model", currentModel()),
      c("Ideas for what to say", showIdeas, "suggest replies", "Alt+S"),
      c("Write my reply", () => impersonate(), "impersonate draft", "Alt+W"),
      c("Direct the next reply", () => setDirecting(true), "note instruction", "Alt+D"),
      c("Surprise me", surprise, "twist random event"),
      c("Roll dice", openDice, "d20 roll random"),
      c(`Translate my message into ${chatLanguage()}`, translateOutgoing, "language", "Alt+T"),
      c("See the prompt", previewPrompt, "debug context"),
      c("Usage in this chat", openChatUsage, "tokens cost"),
      c("Rename chat", rename, "title"),
      c("Edit my persona", editPersona, "who i am description me user"),
      c("Export chat", exportChat, "download save"),
      c("Delete chat", deleteChat, "remove"),
    ];
  });

  return {
    cleanup: () => {
      unregister();
      controller?.abort();
      drafting?.abort();
      // Leaving after a good stretch of chat: the bot writes in its journal.
      const every = Math.max(4, Number(settings.journal?.every) || 12);
      if (settings.journal?.auto !== false && activeConn && chat.messages.length - journalFrom() >= every) journalInBackground();
      document.removeEventListener("keydown", onGlobalKey);
      main.removeEventListener("focusout", settlePage);
      document.body.classList.remove("in-chat");
    },
  };
}
