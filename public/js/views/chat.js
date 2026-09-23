import {
  bots, chats, personas, getSettings, getActiveConnection, getActivePreset,
  loreForBot, bondTier, uid, now,
} from "../store.js";
import { chatCompletion } from "../api.js";
import { buildPrompt, generationParams, currentText, applyMacros, readBond, stripBond } from "../prompt.js";
import { renderMarkdown } from "../markdown.js";
import {
  $, $$, esc, icon, avatarHTML, toast, confirmDialog, promptDialog, openDialog,
  download, slug, timeAgo, clock, autosize, sliderHTML, wireSlider,
} from "../ui.js";

function newChat(bot, personaId) {
  const openings = [bot.greeting, ...(bot.altGreetings ?? [])].filter((g) => g?.trim());
  return {
    id: uid(), botId: bot.id, personaId,
    title: `Chat · ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`,
    autoTitle: true,
    bondStart: null, // null follows the default in Settings
    messages: openings.length
      ? [{ id: uid(), role: "assistant", swipes: openings, swipeIndex: 0, meta: openings.map(() => ({ greeting: true })), at: now() }]
      : [],
    createdAt: now(), updatedAt: now(),
  };
}

export async function render(main, [botId, chatId]) {
  const bot = await bots.get(botId);
  if (!bot) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Not found</h2>
      <p>That bot may have been deleted.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  document.body.classList.add("in-chat");

  const [settings, allPersonas, activePersona] = await Promise.all([getSettings(), personas.all(), personas.active()]);
  let list = await chats.forBot(bot.id);
  let chat = (chatId && list.find((c) => c.id === chatId)) || (!chatId && list[0]) || null;
  if (!chat) {
    chat = newChat(bot, activePersona?.id ?? null);
    await chats.save(chat);
    list = await chats.forBot(bot.id);
  }
  history.replaceState(history.state, "", `#/chat/${bot.id}/${chat.id}`);

  let busy = false;
  let controller = null;
  let pendingError = null; // shown under the log, not saved
  let editingId = null;

  const persona = () => allPersonas.find((p) => p.id === chat.personaId) ?? activePersona;
  const background = bot.background ?? settings.chatBackground ?? null;
  if (background) main.style.setProperty("--bg-dim", String(settings.backgroundDim ?? 0.86));
  const bondOn = settings.bond?.enabled !== false && bot.bondEnabled !== false;

  // Where this chat begins: its own setting, or the default from Settings.
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
  const names = () => ({ char: bot.name, user: persona()?.name || "You" });

  // The bot's picture always opens its editor.
  const botAvatar = (size, extra = "") =>
    `<a class="avatar-link${extra}" href="#/bot/${bot.id}" aria-label="Edit ${esc(bot.name)}" title="Edit ${esc(bot.name)}">${avatarHTML(bot.avatar, bot.name, size)}</a>`;

  main.innerHTML = `
    <div class="chat-layout">
      <aside class="chat-sidebar" id="sidebar" aria-label="Chats with ${esc(bot.name)}">
        <div class="chat-sidebar-head">
          <div class="chat-sidebar-bot">
            ${botAvatar(48)}
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
          ${botAvatar(36, " only-mobile")}
          <div class="title"><span id="chat-title"></span><small id="chat-sub"></small></div>
          ${bondOn ? `<button class="bond" type="button" id="bond" title="Bond with ${esc(bot.name)} · set where it starts">
            <span class="bond-label" id="bond-label"></span>
            <span class="bond-bar"><span class="bond-fill" id="bond-fill"></span></span>
          </button>` : ""}
          <button class="icon-btn" type="button" id="preview" aria-label="See the prompt sent to the model" title="See prompt">${icon("scroll")}</button>
          <button class="icon-btn hide-narrow" type="button" id="rename" aria-label="Rename chat" title="Rename">${icon("edit")}</button>
          <button class="icon-btn hide-narrow" type="button" id="export" aria-label="Export chat" title="Export">${icon("download")}</button>
          <button class="icon-btn" type="button" id="delete-chat" aria-label="Delete chat" title="Delete chat">${icon("trash")}</button>
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
            <div class="composer-box">
              <label for="input" class="sr-only">Message ${esc(bot.name)}</label>
              <textarea id="input" rows="1" placeholder="Message ${esc(bot.name)}…" enterkeyhint="send"></textarea>
              <button class="send-btn" type="submit" id="send" aria-label="Send message">${icon("send")}</button>
            </div>
            <div class="composer-foot">
              <label class="persona-pick"><span>Speaking as</span>
                <select id="persona">${allPersonas.map((p) => `<option value="${p.id}">${esc(p.name || "Unnamed")}</option>`).join("")}</select>
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
      return `<li class="${c.id === chat.id ? "is-active" : ""}">
        <a href="#/chat/${bot.id}/${c.id}" ${c.id === chat.id ? 'aria-current="page"' : ""}>
          <span class="t">${esc(c.title)}</span>
          <span class="d">${c.messages.length} message${c.messages.length === 1 ? "" : "s"} · ${timeAgo(c.updatedAt)}</span>
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
        chat.updatedAt = now();
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
    $("#chat-sub", main).textContent = `with ${bot.name}${p ? ` · as ${p.name}` : ""}`;
    $("#persona", main).value = p?.id ?? "";
    document.title = `${bot.name} · Shiru’s Garden`;
  }

  // ---------- Messages ----------
  const lastAssistantIndex = () => chat.messages.findLastIndex((m) => m.role === "assistant");

  function bodyHTML(m, text, streaming = false) {
    const meta = m.meta?.[m.swipeIndex ?? 0] ?? {};
    const think = meta.reasoning
      ? `<details class="thinking"><summary>Model's reasoning</summary><div>${esc(meta.reasoning)}</div></details>` : "";
    const clean = stripBond(text);
    const content = clean.trim() ? renderMarkdown(applyMacros(clean, names())) : (streaming ? "" : "<p><em>(empty)</em></p>");
    return think + content + (streaming ? '<span class="caret" aria-hidden="true"></span>' : "");
  }

  function messageHTML(m, i) {
    const isBot = m.role === "assistant";
    const p = persona();
    const name = isBot ? bot.name : (p?.name || "You");
    const av = isBot ? botAvatar(40) : avatarHTML(p?.avatar, name, 40);
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
    if (meta.lore?.length) info.push(meta.lore.map((t) => `<span class="chip" title="Lore used">${esc(t)}</span>`).join(""));
    if (meta.usage) info.push(`<span title="Tokens in / out">${meta.usage.prompt_tokens ?? "?"} → ${meta.usage.completion_tokens ?? "?"} tokens</span>`);
    if (meta.finish === "length") info.push(`<span title="The reply hit the max reply tokens limit">cut off</span>`);
    if (bondOn && Number.isFinite(meta.bond) && meta.bond !== 0) {
      info.push(`<span class="bond-chip ${meta.bond > 0 ? "up" : "down"}" title="Bond change">${meta.bond > 0 ? "+" : "\u2212"}${Math.abs(meta.bond)} bond</span>`);
    }

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
            ${isLastBot ? `<button class="icon-btn" type="button" data-action="regenerate" aria-label="Regenerate reply" title="Regenerate" ${busy ? "disabled" : ""}>${icon("refresh")}</button>` : ""}
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
  }

  // ---------- Generation ----------
  async function generate(kind = "new") {
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
      target = { id: uid(), role: "assistant", swipes: [""], swipeIndex: 0, meta: [{}], at: now() };
      chat.messages.push(target);
    }
    const si = target.swipeIndex;

    const [freshSettings, preset, loreEntries] = await Promise.all([getSettings(), getActivePreset(), loreForBot(bot)]);
    const beforeBond = bondNow();
    const prompt = buildPrompt({
      bot, persona: persona(), preset, settings: freshSettings, loreEntries,
      history: chat.messages.slice(0, chat.messages.indexOf(target)),
      bond: bondOn ? beforeBond : null,
    });
    const body = {
      model: bot.model || conn.model || undefined,
      messages: prompt.messages,
      stream: freshSettings.gen.stream,
      ...generationParams(freshSettings, bot),
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

    try {
      const res = await chatCompletion(conn, body, {
        signal: controller.signal,
        onDelta: (r) => {
          target.swipes[si] = r.content;
          target.meta[si].reasoning = r.reasoning;
          frame ||= requestAnimationFrame(paintStream);
        },
      });
      const parsed = bondOn ? readBond(res.content) : { text: res.content, delta: 0 };
      target.swipes[si] = parsed.text;
      target.meta[si] = {
        lore: prompt.loreUsed, usage: res.usage, model: body.model,
        reasoning: res.reasoning, finish: res.finishReason,
        ...(bondOn ? { bond: parsed.delta } : {}),
      };
      if (!parsed.text.trim()) throw new Error("The model sent back an empty reply. Try again, or check the model name on the Connection page.");
      if (bondOn && bondNow().label !== beforeBond.label) {
        toast(`${bot.name}: ${beforeBond.label} \u2192 ${bondNow().label}`);
      }
      window.dispatchEvent(new CustomEvent("api-status", { detail: true }));
      if (prompt.dropped > 0 && !chat.warnedTrim) {
        chat.warnedTrim = true;
        toast(`The chat is longer than the context size, so the oldest ${prompt.dropped} messages were left out. You can raise the context size on the Prompt page.`);
      }
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
      if (!pendingError && target.swipes[si]) $("#announce", main).textContent = `${bot.name}: ${target.swipes[si]}`;
      await persist();
      paintLog({ scroll: nearBottom() || !!pendingError });
      toBottom();
    }
  }

  async function send() {
    if (busy) { controller?.abort(); return; }
    const text = input.value.trim();
    if (!text) {
      // Empty send after your own message: ask the bot to answer it.
      if (chat.messages.at(-1)?.role === "user") generate("new");
      else input.focus();
      return;
    }
    chat.messages.push({ id: uid(), role: "user", content: text, at: now() });
    if (chat.autoTitle) { chat.title = text.replace(/\s+/g, " ").slice(0, 48) + (text.length > 48 ? "…" : ""); chat.autoTitle = false; paintHeader(); }
    input.value = "";
    fitInput();
    await persist();
    generate("new");
  }

  $("#composer", main).addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    const submit = settings.enterToSend ? e.key === "Enter" && !e.shiftKey && !e.isComposing : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (submit) { e.preventDefault(); send(); }
  });
  const onGlobalKey = (e) => { if (e.key === "Escape" && busy) controller?.abort(); };
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
      generate("swipe");
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

  $("#rename", main).addEventListener("click", async () => {
    const title = await promptDialog({ title: "Rename chat", label: "Chat name", value: chat.title });
    if (!title) return;
    chat.title = title; chat.autoTitle = false;
    await persist(); paintHeader();
  });

  $("#delete-chat", main).addEventListener("click", async () => {
    if (busy) return;
    const ok = await confirmDialog({ title: "Delete this chat?", body: `“${chat.title}” and its ${chat.messages.length} messages will be gone for good.`, confirm: "Delete chat", danger: true });
    if (!ok) return;
    await chats.remove(chat.id);
    const rest = list.filter((c) => c.id !== chat.id);
    toast("Chat deleted.");
    location.hash = rest[0] ? `#/chat/${bot.id}/${rest[0].id}` : `#/chat/${bot.id}`;
  });

  $("#export", main).addEventListener("click", () => {
    const dlg = openDialog(`<div class="dialog-body">
      <h2>Export chat</h2>
      <p>Download “${esc(chat.title)}”.</p>
      <div class="dialog-actions">
        <button class="btn" type="button" data-fmt="txt">Plain text</button>
        <button class="btn" type="button" data-fmt="md">Markdown</button>
        <button class="btn btn-primary" type="button" data-fmt="json">JSON</button>
      </div></div>`);
    $$("[data-fmt]", dlg).forEach((b) => b.addEventListener("click", () => {
      const n = names();
      const who = (m) => (m.role === "assistant" ? n.char : n.user);
      const base = `${slug(bot.name)}-${slug(chat.title)}`;
      if (b.dataset.fmt === "json") download(`${base}.json`, { bot: bot.name, persona: n.user, ...chat });
      else if (b.dataset.fmt === "md") download(`${base}.md`, `# ${chat.title}\n\n` + chat.messages.map((m) => `**${who(m)}:** ${applyMacros(currentText(m), n)}`).join("\n\n"), "text/markdown");
      else download(`${base}.txt`, chat.messages.map((m) => `${who(m)}: ${applyMacros(currentText(m), n)}`).join("\n\n"), "text/plain");
      dlg.close();
    }));
  });

  $("#preview", main).addEventListener("click", async () => {
    const [s, preset, entries, conn] = await Promise.all([getSettings(), getActivePreset(), loreForBot(bot), getActiveConnection()]);
    const draft = input.value.trim();
    const hist = draft ? [...chat.messages, { role: "user", content: draft }] : chat.messages;
    const p = buildPrompt({ bot, persona: persona(), preset, settings: s, history: hist, loreEntries: entries, bond: bondOn ? bondNow() : null });
    const params = generationParams(s, bot);
    openDialog(`<div class="dialog-body">
      <h2>What the model sees</h2>
      <p class="hint">The next request${draft ? ", including your unsent message" : ""}. About <strong>${p.tokens.toLocaleString()}</strong> tokens
        · model <code>${esc(bot.model || conn?.model || "not set")}</code>
        · ${Object.entries(params).map(([k, v]) => `${k} ${v}`).join(", ")}
        ${p.loreUsed.length ? `· lore: ${p.loreUsed.map(esc).join(", ")}` : ""}
        ${p.dropped ? `· <strong>${p.dropped} oldest messages left out</strong> to fit the context size` : ""}</p>
      <div class="prompt-preview">${p.messages.map((m) => `<span class="role">${m.role}</span>\n${esc(m.content)}`).join("\n")}</div>
      <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
    </div>`, { wide: true });
  });

  // ---------- Start ----------
  $("#no-conn", main).hidden = !!(await getActiveConnection());
  paintHeader();
  paintList();
  paintLog();
  if (matchMedia("(hover: hover)").matches) input.focus();

  return {
    cleanup: () => {
      controller?.abort();
      document.removeEventListener("keydown", onGlobalKey);
      document.body.classList.remove("in-chat");
    },
  };
}
