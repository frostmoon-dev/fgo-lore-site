import { bots, newBot, getSettings, getLorebooks, loreForBot } from "../store.js";
import { toCard, cardPng } from "../card.js";
import { estimateTokens } from "../prompt.js";
import {
  $, $$, esc, icon, imagePicker, imagePickerHTML, avatarHTML, toast, confirmDialog,
  download, slug, parseTags, autosize, sliderHTML, wireSlider,
} from "../ui.js";

const TEXT_FIELDS = [
  { key: "description", label: "Definition", rows: "tall", required: true,
    hint: "Who they are, how they think, how they talk, and their rules. This is the core of the bot. Use <code>{{char}}</code> and <code>{{user}}</code>." },
  { key: "greeting", label: "First message", hint: "What they say to open a new chat. Leave empty to let the user speak first." },
  { key: "scenario", label: "Scenario", hint: "Where and when the chat starts, and the situation between you." },
  { key: "examples", label: "Example dialogue", rows: "tall", mono: true,
    hint: "Sample exchanges that show their voice. Start each with <code>&lt;START&gt;</code>, then lines like <code>{{user}}: …</code> and <code>{{char}}: …</code>." },
];

export async function render(main, [id]) {
  const existing = id ? await bots.get(id) : null;
  if (id && !existing) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Not found</h2>
      <p>That bot may have been deleted.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  const bot = structuredClone(existing ?? newBot());
  bot.lorebookIds ??= [];
  const settings = await getSettings();
  const books = await getLorebooks();
  let saved = JSON.stringify(bot);
  const isNew = !existing;

  main.innerHTML = `
    <div class="wrap page">
      <div class="page-head">
        <div>
          <h1 id="title">${esc(bot.name || "Unnamed")}</h1>
        </div>
      </div>
      <form class="editor-layout" id="form" novalidate>
        <div class="form-grid">
          <div class="card">
            <h2 class="card-title">Identity</h2>
            <p class="lead">How the bot appears in your library and in chat.</p>
            <div class="form-grid">
              <div id="avatar">${imagePickerHTML("avatar-file", { label: "Upload picture" })}</div>
              <div class="form-row">
                <div class="field">
                  <label for="name">Name <span class="count">required</span></label>
                  <input type="text" id="name" value="${esc(bot.name)}" required autocomplete="off" aria-describedby="name-err">
                  <p class="error-text" id="name-err" hidden>Give the bot a name.</p>
                </div>
                <div class="field">
                  <label for="tags">Tags</label>
                  <input type="text" id="tags" value="${esc(bot.tags.join(", "))}" placeholder="fantasy, royalty, slow-burn" autocomplete="off">
                </div>
              </div>
              <div class="field">
                <label for="tagline">Tagline <span class="count" id="tagline-count"></span></label>
                <input type="text" id="tagline" value="${esc(bot.tagline)}" maxlength="140" placeholder="One line shown on the bot's card" autocomplete="off">
              </div>
            </div>
          </div>

          <div class="card">
            <h2 class="card-title">Character</h2>
            <p class="lead">What the model is told about this bot.</p>
            <div class="form-grid">
              ${TEXT_FIELDS.map((f) => `
                <div class="field">
                  <label for="${f.key}">${f.label} <span class="count" data-count="${f.key}"></span></label>
                  <textarea id="${f.key}" class="${f.rows ?? ""} ${f.mono ? "mono" : ""}" aria-describedby="${f.key}-hint">${esc(bot[f.key])}</textarea>
                  <p class="hint" id="${f.key}-hint">${f.hint}</p>
                </div>`).join("")}

              <div class="field">
                <span class="field-label">Alternate first messages</span>
                <p class="hint">Extra openings. When starting a chat you can switch between them.</p>
                <div id="alts" class="form-grid" style="gap:var(--s3)"></div>
                <div><button type="button" class="btn btn-sm" id="add-alt">Add another opening</button></div>
              </div>
            </div>
          </div>

          <div class="card">
            <h2 class="card-title">Scene</h2>
            <p class="lead">The backdrop for chats with this bot, and the lore it can draw on.</p>
            <div class="form-grid">
              <div class="field">
                <span class="field-label">Chat background</span>
                <div id="background">${imagePickerHTML("background-file", {
                  label: "Upload background",
                  hint: "Shown behind this bot's chats, dimmed so the text stays readable. Leave empty to use the one in Settings.",
                  cls: "bg-edit",
                })}</div>
              </div>
              <fieldset class="field">
                <legend class="field-label">Lorebooks</legend>
                <p class="hint">Which sets of lore this bot can draw on. <a href="#/lore">Manage lorebooks</a>.</p>
                <div id="books">${books.map((bk) => `
                  <label class="check">
                    <input type="checkbox" data-book="${esc(bk.id)}" ${bk.global ? "checked disabled" : (bot.lorebookIds.includes(bk.id) ? "checked" : "")}>
                    <span>${esc(bk.name)}${bk.global ? "<small>Used with every bot.</small>" : (bk.description ? `<small>${esc(bk.description)}</small>` : "")}</span>
                  </label>`).join("")}</div>
              </fieldset>
              <label class="check"><input type="checkbox" id="bond-on" ${bot.bondEnabled === false ? "" : "checked"}>
                <span>Track the bond with this bot<small>Shows a bond meter in the chat header and lets it colour how warm the bot is.</small></span></label>
            </div>
          </div>

          <div class="card">
            <details class="more">
              <summary>Advanced</summary>
              <div class="form-grid">
                <div class="field">
                  <label for="personality">Personality summary</label>
                  <textarea id="personality" placeholder="Short trait list, e.g. cold, regal, secretly loyal">${esc(bot.personality)}</textarea>
                </div>
                <div class="field">
                  <label for="systemPrompt">System prompt override</label>
                  <textarea id="systemPrompt" class="mono" placeholder="Leave empty to use the Prompt page's main prompt">${esc(bot.systemPrompt)}</textarea>
                  <p class="hint">Replaces the main prompt for this bot only. Put <code>{{original}}</code> in it to include the main prompt as well.</p>
                </div>
                <div class="field">
                  <label for="postHistory">Post-history instructions override</label>
                  <textarea id="postHistory" class="mono" placeholder="Leave empty to use the Prompt page's setting">${esc(bot.postHistory)}</textarea>
                  <p class="hint">Sent after the chat history, so the model gives it the most weight. <code>{{original}}</code> works here too.</p>
                </div>
                <div class="field">
                  <label for="model">Model override</label>
                  <input type="text" id="model" class="mono" value="${esc(bot.model)}" placeholder="Leave empty to use the connection's model" autocomplete="off">
                </div>
                <div class="form-row">
                  ${sliderHTML({ id: "g-temperature", label: "Temperature", min: 0, max: 2, step: 0.05, value: bot.gen.temperature ?? "", allowBlank: true, hint: `Empty = global (${settings.gen.temperature})` })}
                  ${sliderHTML({ id: "g-max_tokens", label: "Max reply tokens", min: 50, max: 4000, step: 50, value: bot.gen.max_tokens ?? "", allowBlank: true, hint: `Empty = global (${settings.gen.max_tokens})` })}
                </div>
                <div class="field">
                  <label for="creatorNotes">Creator notes</label>
                  <textarea id="creatorNotes" placeholder="Notes for yourself or people you share the card with. Not sent to the model.">${esc(bot.creatorNotes)}</textarea>
                </div>
              </div>
            </details>
          </div>
        </div>

        <aside class="editor-aside" aria-label="Summary and actions">
          <div class="bot-card">
            <div class="portrait" id="preview-portrait"></div>
            <div class="bot-card-body">
              <div class="bot-card-name" id="preview-name"></div>
              <p class="bot-card-tagline" id="preview-tagline"></p>
              <p class="hint" id="token-total"></p>
            </div>
          </div>
          <div class="card card-tight">
            <div class="actions actions-col">
              <button class="btn btn-primary" type="submit">Save bot</button>
              ${isNew ? "" : `<a class="btn" href="#/chat/${bot.id}">Chat</a>`}
              <button class="btn" type="button" id="export-png" ${isNew ? "disabled" : ""}>Export PNG card</button>
              <button class="btn" type="button" id="export-json" ${isNew ? "disabled" : ""}>Export JSON</button>
              ${isNew ? "" : `<button class="btn" type="button" id="duplicate">Duplicate</button>
              <button class="btn btn-danger" type="button" id="delete">Delete bot</button>`}
            </div>
            <p class="save-state" id="save-state" aria-live="polite"></p>
          </div>
        </aside>
      </form>
    </div>`;

  const form = $("#form", main);
  const val = (sel) => $(sel, main).value;

  // ---- Alternate greetings ----
  function paintAlts() {
    const box = $("#alts", main);
    box.innerHTML = bot.altGreetings.map((g, i) => `
      <div class="field">
        <label for="alt-${i}">Opening ${i + 2}
          <button type="button" class="link-btn" data-remove-alt="${i}" style="min-height:auto">Remove</button></label>
        <textarea id="alt-${i}" data-alt="${i}">${esc(g)}</textarea>
      </div>`).join("");
    $$("[data-alt]", box).forEach((t) => { autosize(t); t.addEventListener("input", () => { bot.altGreetings[t.dataset.alt] = t.value; update(); }); });
    $$("[data-remove-alt]", box).forEach((b) => b.addEventListener("click", () => { bot.altGreetings.splice(Number(b.dataset.removeAlt), 1); paintAlts(); update(); }));
  }
  $("#add-alt", main).addEventListener("click", () => {
    bot.altGreetings.push("");
    paintAlts(); update();
    $(`#alt-${bot.altGreetings.length - 1}`, main).focus();
  });

  // ---- Read form into bot ----
  function collect() {
    bot.name = val("#name").trim();
    bot.tagline = val("#tagline").trim();
    bot.tags = parseTags(val("#tags"));
    for (const k of ["description", "greeting", "scenario", "examples", "personality", "systemPrompt", "postHistory", "creatorNotes"]) bot[k] = val(`#${k}`);
    bot.model = val("#model").trim();
    bot.lorebookIds = $$("[data-book]", main).filter((c) => c.checked && !c.disabled).map((c) => c.dataset.book);
    bot.bondEnabled = $("#bond-on", main).checked;
    bot.gen = {};
    for (const k of ["temperature", "max_tokens"]) {
      const v = val(`#g-${k}`);
      if (v !== "") bot.gen[k] = Number(v);
    }
  }

  function paintPreview() {
    $("#preview-portrait", main).innerHTML = avatarHTML(bot.avatar, bot.name, 300, "portrait");
    $("#preview-name", main).textContent = bot.name || "Unnamed";
    $("#preview-tagline", main).textContent = bot.tagline || "Add a tagline to show here.";
    $("#title", main).textContent = bot.name || "Unnamed";
    const perm = [bot.description, bot.personality, bot.scenario, bot.examples, bot.systemPrompt, bot.postHistory].join("");
    $("#token-total", main).textContent = `About ${estimateTokens(perm).toLocaleString()} tokens of definition sent with every message.`;
  }

  function update() {
    collect();
    paintPreview();
    for (const el of $$("[data-count]", main)) el.textContent = `~${estimateTokens(bot[el.dataset.count]).toLocaleString()} tokens`;
    $("#tagline-count", main).textContent = `${bot.tagline.length}/140`;
    const dirty = isDirty();
    const state = $("#save-state", main);
    state.classList.toggle("dirty", dirty);
    state.textContent = dirty ? "Unsaved changes" : isNew ? "" : "All changes saved";
  }
  let deleted = false;
  const isDirty = () => { if (deleted) return false; collect(); return JSON.stringify(bot) !== saved; };

  imagePicker($("#avatar", main), {
    get: () => bot.avatar,
    set: (v) => { bot.avatar = v; update(); },
    name: () => val("#name"),
    crop: { round: true, title: "Crop the bot's picture" },
  });
  imagePicker($("#background", main), {
    get: () => bot.background,
    set: (v) => { bot.background = v; update(); },
    crop: { aspect: 16 / 9, outW: 1600, outH: 900, quality: 0.82, title: "Crop the chat background" },
    preview: (url) => (url
      ? `<span class="bg-thumb"><img src="${esc(url)}" alt=""></span>`
      : `<span class="bg-thumb is-empty">No background</span>`),
  });
  $$("textarea", main).forEach(autosize);
  wireSlider(main, "g-temperature", update);
  wireSlider(main, "g-max_tokens", update);
  form.addEventListener("input", update);
  paintAlts();
  update();

  async function save() {
    collect();
    const nameInput = $("#name", main);
    const bad = !bot.name;
    nameInput.setAttribute("aria-invalid", String(bad));
    $("#name-err", main).hidden = !bad;
    if (bad) { nameInput.focus(); toast("Give the bot a name before saving.", "error"); return false; }
    bot.altGreetings = bot.altGreetings.filter((g) => g.trim());
    await bots.save(bot);
    saved = JSON.stringify(bot);
    toast(`${bot.name} saved.`, "ok");
    if (isNew) location.hash = `#/bot/${bot.id}`;
    else { paintAlts(); update(); }
    return true;
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } };
  document.addEventListener("keydown", onKey);

  // Everything the bot can actually draw on, so the card travels complete.
  const loreFor = () => loreForBot(bot);
  $("#export-json", main)?.addEventListener("click", async () => {
    download(`${slug(bot.name)}.json`, toCard(bot, await loreFor()));
  });
  $("#export-png", main)?.addEventListener("click", async () => {
    try { download(`${slug(bot.name)}.png`, await cardPng(bot, await loreFor())); }
    catch (err) { toast(`Could not make the PNG: ${err.message}`, "error"); }
  });
  $("#duplicate", main)?.addEventListener("click", async () => {
    if (isDirty()) { toast("Save your changes first, then duplicate.", "error"); return; }
    const copy = newBot({ ...structuredClone(bot), builtin: false, name: `${bot.name} (copy)`, lastChatAt: 0 });
    copy.id = crypto.randomUUID();
    await bots.save(copy);
    toast("Duplicated. You are now editing the copy.", "ok");
    location.hash = `#/bot/${copy.id}`;
  });
  $("#delete", main)?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: `Delete ${bot.name || "this bot"}?`,
      body: "This also deletes every chat with this bot. It cannot be undone.",
      confirm: "Delete bot", danger: true,
    });
    if (!ok) return;
    await bots.remove(bot.id);
    deleted = true; // nothing left to lose; skip the unsaved-changes prompt
    toast(`${bot.name} deleted.`);
    location.hash = "#/";
  });

  return {
    isDirty,
    cleanup: () => document.removeEventListener("keydown", onKey),
  };
}
