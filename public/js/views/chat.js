import {
  bots, chats, lore, personas, getSettings, getActiveConnection, getActivePreset,
  getLorebooks, saveLorebooks, newLorebook, newLore, loreForBot, bondTier, uid, now,
} from "../store.js";
import { chatCompletion } from "../api.js";
import { buildPrompt, generationParams, currentText, applyMacros, readBond, stripBond, cleanImpersonation } from "../prompt.js";
import { summarize, suggestLore, checkCharacter, transcript } from "../ai.js";
import { renderMarkdown } from "../markdown.js";
import {
  $, $$, esc, icon, avatarHTML, toast, confirmDialog, promptDialog, openDialog, openMenu,
  download, slug, timeAgo, clock, autosize, sliderHTML, wireSlider,
} from "../ui.js";

function newChat(bot, personaId) {
  const openings = [bot.greeting, ...(bot.altGreetings ?? [])].filter((g) => g?.trim());
  return {
    id: uid(), botId: bot.id, personaId,
    title: `Chat · ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`,
    autoTitle: true,
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

export async function render(main, [botId, chatId]) {
  const bot = await bots.get(botId);
  if (!bot) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Not found</h2>
      <p>That bot may have been deleted.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  document.body.classList.add("in-chat");

  const [settings, allPersonas, activePersona, allBots] = await Promise.all([getSettings(), personas.all(), personas.active(), bots.all()]);
  let list = await chats.forBot(bot.id);
  let chat = (chatId && list.find((c) => c.id === chatId)) || (!chatId && list[0]) || null;
  if (!chat) {
    chat = newChat(bot, activePersona?.id ?? null);
    await chats.save(chat);
    list = await chats.forBot(bot.id);
  }
  chat.castIds ??= [];
  history.replaceState(history.state, "", `#/chat/${bot.id}/${chat.id}`);

  let busy = false;
  let controller = null;
  let pendingError = null; // shown under the log, not saved
  let editingId = null;
  let memoryBusy = false;
  const checking = new Set(); // message ids being checked

  const persona = () => allPersonas.find((p) => p.id === chat.personaId) ?? activePersona;
  const background = bot.background ?? settings.chatBackground ?? null;
  if (background) main.style.setProperty("--bg-dim", String(settings.backgroundDim ?? 0.86));
  const bondOn = settings.bond?.enabled !== false && bot.bondEnabled !== false;

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

  // ---------- Bond (with the chat's own bot) ----------
  const bondDefault = () => Number(settings.bond?.start ?? 20);
  const bondStart = () => (Number.isFinite(chat.bondStart) ? Number(chat.bondStart) : bondDefault());
  // The bond is the starting value plus the deltas of the replies now on
  // screen, so swiping, editing or deleting a reply keeps it honest.
  function bondEarned() {
    return chat.messages.reduce((total, m) => {
      const delta = m.role === "assistant" ? m.meta?.[m.swipeIndex ?? 0]?.bond : 0;
      return total + (Number.isFinite(delta) ? delta : 0);
    }, 0);
  }
  function bondFrom(base) {
    const value = Math.max(0, Math.min(100, base + bondEarned()));
    return { value, label: bondTier(value).label };
  }
  const bondNow = () => bondFrom(bondStart());

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
          <div class="title"><span id="chat-title"></span><small id="chat-sub"></small></div>
          ${bondOn ? `<button class="bond" type="button" id="bond" title="Bond with ${esc(bot.name)} · set where it starts">
            <span class="bond-label" id="bond-label"></span>
            <span class="bond-bar"><span class="bond-fill" id="bond-fill"></span></span>
          </button>` : ""}
          <button class="icon-btn hide-narrow" type="button" id="memory" aria-label="Memory" title="Memory">${icon("book")}</button>
          <button class="icon-btn hide-narrow" type="button" id="cast" aria-label="Characters in this chat" title="Characters in this chat">${icon("users")}</button>
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
            <div class="draft-bar" id="draft-bar" hidden>
              <span class="grow" id="draft-status" aria-live="polite"></span>
              <button class="btn btn-quiet btn-sm" type="button" id="draft-retry">Try again</button>
              <button class="btn btn-quiet btn-sm" type="button" id="draft-undo">Undo</button>
            </div>
            <div class="direct-bar" id="direct-bar" hidden>
              <label for="direction" class="direct-label">Direction</label>
              <input type="text" id="direction" autocomplete="off"
                placeholder="For the next reply only, e.g. time skip to nightfall" aria-describedby="direct-hint">
              <button class="icon-btn" type="button" id="direct-clear" aria-label="Remove direction" title="Remove">${icon("x")}</button>
              <span class="sr-only" id="direct-hint">Sent to the model with the next reply, then cleared. It does not appear in the chat.</span>
            </div>
            <div class="composer-box">
              <label for="input" class="sr-only">Message</label>
              <textarea id="input" rows="1" placeholder="Message ${esc(bot.name)}…" enterkeyhint="send"></textarea>
              <button class="icon-btn composer-tool" type="button" id="direct" aria-label="Direct the next reply" aria-controls="direct-bar" aria-expanded="false" title="Direct the next reply (Alt+D)">${icon("megaphone")}</button>
              <button class="icon-btn composer-tool" type="button" id="impersonate"
                aria-label="Write my reply. Uses what you typed as the idea." title="Write my reply (Alt+W)">${icon("quill")}</button>
              <button class="send-btn" type="submit" id="send" aria-label="Send message">${icon("send")}</button>
            </div>
            <div class="composer-foot">
              <label class="persona-pick"><span>Speaking as</span>
                <select id="persona">${allPersonas.map((p) => `<option value="${p.id}">${esc(p.name || "Unnamed")}</option>`).join("")}</select>
              </label>
              <label class="persona-pick" id="speaker-pick" hidden><span>Next to reply</span>
                <select id="speaker"></select>
              </label>
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

  // ---------- Sidebar ----------
  function paintList() {
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
    const c = newChat(bot, persona()?.id ?? null);
    await chats.save(c);
    location.hash = `#/chat/${bot.id}/${c.id}`;
  });

  function paintBond() {
    if (!bondOn) return;
    const { value, label } = bondNow();
    $("#bond-label", main).textContent = label;
    $("#bond-fill", main).style.width = `${value}%`;
    $("#bond", main).setAttribute("aria-label",
      `Bond with ${bot.name}: ${label}, ${value} of 100. Set where this chat starts.`);
    $("#bond", main).dataset.tier = label.toLowerCase();
  }

  // Click the meter to say how warm the two of them already are before the
  // first line. Existing replies keep their own changes on top.
  function editBondStart() {
    const earned = bondEarned();
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Bond with ${esc(bot.name)}</h2>
        <p class="hint">How close the two of them are before the first line of this chat${
          earned ? `. So far this conversation has ${earned > 0 ? "added" : "taken"} ${Math.abs(earned)}` : ""}.</p>
        ${sliderHTML({
          id: "cb-start", label: "Starting bond", min: 0, max: 100, step: 1, value: bondStart(),
        })}
        <p class="bond-read" id="cb-read"></p>
        <div class="dialog-actions">
          <button class="btn btn-quiet push" type="button" id="cb-default">Use the default (${bondDefault()})</button>
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">Save</button>
        </div>
      </form>`, {
      onClose: async (v) => {
        if (v !== "ok") return;
        chat.bondStart = Number($("#cb-start", dlg).value);
        await persist();
        paintBond();
        toast(`${bot.name} starts this chat at ${bondTier(chat.bondStart).label}.`, "ok");
      },
    });
    const read = () => {
      const { value, label } = bondFrom(Number($("#cb-start", dlg).value || 0));
      $("#cb-read", dlg).textContent = earned
        ? `The meter would read ${label}, ${value} of 100.`
        : `${bot.name} begins as ${label}.`;
    };
    wireSlider(dlg, "cb-start", read);
    $("#cb-default", dlg).addEventListener("click", () => {
      $("#cb-start", dlg).value = String(bondDefault());
      $("#cb-start-range", dlg).value = String(bondDefault());
      read();
    });
    read();
    $("#cb-start", dlg).select();
  }

  function paintHeader() {
    $("#chat-title", main).textContent = chat.title;
    const p = persona();
    $("#chat-sub", main).textContent = `with ${everyone().map((b) => b.name).join(", ")}${p ? ` · as ${p.name}` : ""}`;
    $("#persona", main).value = p?.id ?? "";
    document.title = `${bot.name} · Shiru’s Garden`;
    // Speaker picker only matters when more than one bot can answer.
    const pick = $("#speaker-pick", main);
    const select = $("#speaker", main);
    const prev = select.value || "auto";
    pick.hidden = !group();
    select.innerHTML = `<option value="auto">Auto</option>` + everyone().map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
    select.value = [...select.options].some((o) => o.value === prev) ? prev : "auto";
    select.title = "Auto picks the character your message names, otherwise whoever has been quiet longest.";
    input.placeholder = group() ? "Message the scene…" : `Message ${bot.name}…`;
    const mem = $("#memory", main);
    mem.classList.toggle("has-dot", !!chat.memory?.text?.trim());
    mem.classList.toggle("is-loading", memoryBusy);
    mem.setAttribute("aria-label", memoryBusy ? "Memory, updating" : chat.memory?.text ? "Memory" : "Memory, empty");
    $("#cast", main).classList.toggle("has-dot", group());
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

  function messageHTML(m, i) {
    const isBot = m.role === "assistant";
    const p = persona();
    const speaker = speakerOf(m);
    const name = isBot ? speaker.name : userName();
    const av = isBot ? (botById.has(speaker.id) ? botAvatar(speaker, 40) : avatarHTML(null, name, 40)) : avatarHTML(p?.avatar, name, 40);
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
    if (meta.finish === "length") info.push(`<span title="The reply hit the max reply tokens limit">cut off</span>`);
    if (bondOn && Number.isFinite(meta.bond) && meta.bond !== 0) {
      info.push(`<span class="bond-chip ${meta.bond > 0 ? "up" : "down"}" title="Bond change">${meta.bond > 0 ? "+" : "−"}${Math.abs(meta.bond)} bond</span>`);
    }
    const isChecking = checking.has(m.id);

    return `<article class="msg ${m.role} ${isLastBot ? "is-last" : ""}" data-id="${m.id}" aria-label="${esc(name)}">
      ${av}
      <div style="min-width:0">
        <div class="msg-head"><span class="msg-name">${esc(name)}</span><time class="msg-time" datetime="${new Date(m.at).toISOString()}">${clock(m.at)}</time></div>
        <div class="msg-body">${bodyHTML(m, text, streaming)}</div>
        <div class="msg-foot">
          ${swipeNav}
          <span class="msg-tools">
            <button class="icon-btn" type="button" data-action="copy" aria-label="Copy message" title="Copy">${icon("copy")}</button>
            <button class="icon-btn" type="button" data-action="edit" aria-label="Edit message" title="Edit" ${busy ? "disabled" : ""}>${icon("edit")}</button>
            ${isLastBot ? `<button class="icon-btn" type="button" data-action="regenerate" aria-label="Regenerate reply, with options" aria-haspopup="menu" aria-expanded="false" title="Regenerate" ${busy ? "disabled" : ""}>${icon("refresh")}</button>` : ""}
            ${isBot && !streaming ? `<button class="icon-btn${isChecking ? " is-loading" : ""}" type="button" data-action="check" aria-label="${isChecking ? "Checking character" : "Check this reply stays in character"}" title="Check character" ${isChecking ? "disabled" : ""}>${icon("shield")}</button>` : ""}
            <button class="icon-btn" type="button" data-action="branch" aria-label="Branch a new chat from here" title="Branch from here" ${busy ? "disabled" : ""}>${icon("branch")}</button>
            <button class="icon-btn" type="button" data-action="delete" aria-label="Delete message" title="Delete" ${busy ? "disabled" : ""}>${icon("trash")}</button>
          </span>
          ${info.length ? `<span class="msg-meta">${info.join(" · ")}</span>` : ""}
        </div>
      </div>
    </article>`;
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
  const directBtn = $("#direct", main);
  const direction = () => (directBar.hidden ? "" : directInput.value.trim());
  function setDirecting(open) {
    directBar.hidden = !open;
    directBtn.setAttribute("aria-expanded", String(open));
    directBtn.classList.toggle("is-active", open);
    if (open) directInput.focus();
    else { directInput.value = ""; }
  }
  directBtn.addEventListener("click", () => setDirecting(directBar.hidden));
  $("#direct-clear", main).addEventListener("click", () => { setDirecting(false); input.focus(); });
  directInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); setDirecting(false); input.focus(); }
    if (e.key === "Enter") { e.preventDefault(); input.focus(); }
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
    if (kind === "swipe") {
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
    const withBond = bondOn && speaker.id === bot.id;
    const directed = direction();
    const fullNote = [directed, note].filter(Boolean).join(" ");

    const [freshSettings, preset, loreEntries] = await Promise.all([getSettings(), getActivePreset(), loreForBot(speaker)]);
    const beforeBond = bondNow();
    const prompt = buildPrompt({
      bot: speaker, persona: persona(), preset, settings: freshSettings, loreEntries,
      history: withSpeakers(chat.messages.slice(0, chat.messages.indexOf(target))),
      bond: withBond ? beforeBond : null,
      memory: chat.memory?.text ?? "", note: fullNote, cast: group() ? others(speaker) : [],
    });
    const body = {
      model: speaker.model || conn.model || undefined,
      messages: prompt.messages,
      stream: freshSettings.gen.stream,
      ...generationParams(freshSettings, speaker),
    };

    paintLog();
    setBusy(true);
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
          target.swipes[si] = r.content;
          target.meta[si].reasoning = r.reasoning;
          frame ||= requestAnimationFrame(paintStream);
        },
      });
      const parsed = withBond ? readBond(res.content) : { text: stripBond(res.content), delta: 0 };
      // In a group scene models sometimes label their own line.
      if (group()) parsed.text = cleanImpersonation(parsed.text, speaker.name);
      target.swipes[si] = parsed.text;
      target.meta[si] = {
        lore: prompt.loreUsed, usage: res.usage, model: body.model,
        reasoning: res.reasoning, finish: res.finishReason,
        ...(withBond ? { bond: parsed.delta } : {}),
        ...(fullNote ? { note: fullNote } : {}),
      };
      if (!parsed.text.trim()) throw new Error("The model sent back an empty reply. Try again, or check the model name on the Connection page.");
      if (withBond && bondNow().label !== beforeBond.label) {
        toast(`${bot.name}: ${beforeBond.label} → ${bondNow().label}`);
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
      if (!partial) {
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
      setBusy(false);
      await bots.touch(bot);
      if (!pendingError && target.swipes[si]) $("#announce", main).textContent = `${speaker.name}: ${target.swipes[si]}`;
      await persist();
      paintLog({ scroll: nearBottom() || !!pendingError });
      toBottom();
    }
    if (ok) {
      if (freshSettings.check?.auto) runCheck(target, { quiet: true });
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

  // ---------- Branches ----------
  async function branchFrom(i) {
    const upTo = i + 1;
    const copy = {
      ...structuredClone(chat),
      id: uid(),
      title: `${chat.title.replace(/ \(branch\)$/, "")} (branch)`,
      autoTitle: false,
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

  // ---------- Cast (group scenes) ----------
  function openCast() {
    const candidates = allBots.filter((b) => b.id !== bot.id);
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>Characters in this chat</h2>
        <p class="hint">Add other bots to make this a group scene. ${esc(bot.name)} stays the host: the bond meter and this chat's
          place in the sidebar belong to ${esc(bot.name)}. Pick who replies next under the message box, or leave it on Auto.</p>
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
        chat.castIds = $$('input[type="checkbox"]', dlg).filter((c) => c.checked).map((c) => c.value);
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

  function showDraftBar(text, { tools = true } = {}) {
    draftBar.hidden = false;
    $("#draft-status", main).textContent = text;
    $("#draft-retry", main).hidden = !tools;
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
      memory: chat.memory?.text ?? "", cast: group() ? others(partner) : [],
    });
    const body = {
      model: partner.model || conn.model || undefined,
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
      if (chat.messages.at(-1)?.role === "user" || group()) generate("new");
      else input.focus();
      return;
    }
    hideDraftBar();
    chat.messages.push({ id: uid(), role: "user", content: text, at: now() });
    if (chat.autoTitle) { chat.title = text.replace(/\s+/g, " ").slice(0, 48) + (text.length > 48 ? "…" : ""); chat.autoTitle = false; paintHeader(); }
    input.value = "";
    fitInput();
    await persist();
    generate("new");
  }

  $("#composer", main).addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyW") { e.preventDefault(); impersonate(); return; }
    if (e.altKey && e.code === "KeyD") { e.preventDefault(); setDirecting(directBar.hidden); return; }
    const submit = settings.enterToSend ? e.key === "Enter" && !e.shiftKey && !e.isComposing : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (submit) { e.preventDefault(); send(); }
  });
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

    if (action === "copy") {
      try { await navigator.clipboard.writeText(currentText(m)); toast("Copied."); }
      catch { toast("Could not copy. Your browser blocked clipboard access.", "error"); }
    } else if (action === "edit") {
      if (busy) return;
      editingId = m.id; paintLog({ scroll: false });
    } else if (action === "cancel-edit") {
      editingId = null; paintLog({ scroll: false });
    } else if (action === "save-edit") {
      saveEdit(m);
    } else if (action === "delete") {
      if (busy) return;
      chat.messages.splice(i, 1);
      await persist(); paintLog({ scroll: false });
      toast("Message deleted.", "info", {
        action: "Undo",
        onAction: async () => { chat.messages.splice(i, 0, m); await persist(); paintLog({ scroll: false }); },
      });
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
    } else if (action === "check") {
      runCheck(m);
    } else if (action === "show-check") {
      showCheck(m);
    } else if (action === "branch") {
      if (busy) return;
      branchFrom(i);
    }
  });

  async function saveEdit(m) {
    const value = $("#edit-box", logInner).value;
    if (m.swipes) m.swipes[m.swipeIndex ?? 0] = value;
    else m.content = value;
    editingId = null;
    await persist(); paintLog({ scroll: false });
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
    await persist(); paintHeader(); paintLog({ scroll: false });
  });

  if (bondOn) $("#bond", main).addEventListener("click", editBondStart);
  $("#memory", main).addEventListener("click", openMemory);
  $("#cast", main).addEventListener("click", openCast);

  async function rename() {
    const title = await promptDialog({ title: "Rename chat", label: "Chat name", value: chat.title });
    if (!title) return;
    chat.title = title; chat.autoTitle = false;
    await persist(); paintHeader();
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
      bond: bondOn && speaker.id === bot.id ? bondNow() : null,
      memory: chat.memory?.text ?? "", note: direction(), cast: group() ? others(speaker) : [],
    });
    const params = generationParams(s, speaker);
    openDialog(`<div class="dialog-body">
      <h2>What the model sees</h2>
      <p class="hint">The next request${group() ? `, answered by ${esc(speaker.name)}` : ""}${draft ? ", including your unsent message" : ""}. About <strong>${p.tokens.toLocaleString()}</strong> tokens
        · model <code>${esc(speaker.model || conn?.model || "not set")}</code>
        · ${Object.entries(params).map(([k, v]) => `${k} ${v}`).join(", ")}
        ${p.loreUsed.length ? `· lore: ${p.loreUsed.map(esc).join(", ")}` : ""}
        ${p.dropped ? `· <strong>${p.dropped} oldest messages left out</strong> to fit the context size` : ""}</p>
      <div class="prompt-preview">${p.messages.map((m) => `<span class="role">${m.role}</span>\n${esc(m.content)}`).join("\n")}</div>
      <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
    </div>`, { wide: true });
  }

  // On a phone, Memory and Characters live in this menu instead of the bar.
  const narrow = matchMedia("(max-width: 600px)");
  $("#more", main).addEventListener("click", (e) => openMenu(e.currentTarget, [
    ...(narrow.matches ? [
      { label: "Memory", hint: chat.memory?.text ? "Summary of the story so far" : "Empty so far", onSelect: openMemory },
      { label: "Characters in this chat", hint: group() ? `${everyone().length} in the scene` : "Add bots for a group scene", onSelect: openCast },
      "-",
    ] : []),
    { label: "See the prompt", hint: "Exactly what the model gets next", onSelect: previewPrompt },
    { label: "Suggest lore from this chat", hint: "New entries from what happened", onSelect: openLoreSuggestions },
    "-",
    { label: "Rename chat", onSelect: rename },
    { label: "Export chat", onSelect: exportChat },
    "-",
    { label: "Delete chat", danger: true, onSelect: deleteChat },
  ]));

  // ---------- Start ----------
  $("#no-conn", main).hidden = !!(await getActiveConnection());
  paintHeader();
  paintList();
  paintLog();
  if (matchMedia("(hover: hover)").matches) input.focus();

  return {
    cleanup: () => {
      controller?.abort();
      drafting?.abort();
      document.removeEventListener("keydown", onGlobalKey);
      document.body.classList.remove("in-chat");
    },
  };
}
