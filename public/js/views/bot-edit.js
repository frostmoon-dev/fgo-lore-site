import { bots, newBot, getSettings, getLorebooks, loreForBot, BOND_KINDS, BOND_POINTS, bondLevels, EXPRESSIONS, MOOD_SUGGESTIONS, moodName } from "../store.js";
import { toCard, cardPng } from "../card.js";
import { estimateTokens } from "../prompt.js";
import { draftBot } from "../ai.js";
import {
  $, $$, esc, icon, imagePicker, imagePickerHTML, avatarHTML, toast, confirmDialog,
  download, slug, parseTags, autosize, sliderHTML, wireSlider,
} from "../ui.js";

const CONTENT_NAMES = { off: "Off", mature: "Mature", explicit: "Explicit" };

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
  bot.bondKind ??= "affection";
  bot.bondLevels ??= null;
  bot.bondMilestones ??= true;
  bot.contentMode ??= "site";
  bot.expressions ??= {};
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
            <details class="more" id="idea-box" ${isNew ? "open" : ""}>
              <summary>Start from an idea</summary>
              <div class="form-grid">
                <p class="hint">Describe the character in a line or two. The model drafts the name, definition, scenario,
                  first message and example dialogue for you to edit. Nothing is saved until you press Save bot.</p>
                <div class="field">
                  <label for="idea">Idea</label>
                  <textarea id="idea" placeholder="A tired knight who guards a cursed library and hates visitors"></textarea>
                </div>
                <div class="actions">
                  <button class="btn btn-primary" type="button" id="draft">Draft the bot</button>
                  <span class="hint" id="draft-state" aria-live="polite"></span>
                </div>
              </div>
            </details>
          </div>
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
            <h2 class="card-title">Expressions</h2>
            <p class="lead">Optional. Upload a face for each mood, and chats show the one that matches each reply.
              Leave any of them empty; the bot only uses the moods you fill in.</p>
            <div class="expr-grid" id="expr-grid"></div>
            <div class="expr-add">
              <div class="field"><label for="mood-new">Add a mood</label>
                <div class="input-group">
                  <input type="text" id="mood-new" placeholder="e.g. devious" maxlength="24" autocomplete="off" spellcheck="false">
                  <button class="btn" type="button" id="mood-add">Add</button>
                </div>
                <p class="hint">One or two words. The bot picks from every mood that has a picture.</p>
              </div>
              <div class="chips" id="mood-suggest" aria-label="Suggested moods"></div>
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
              <div class="field">
                <label for="content-mode">Mature content</label>
                <select id="content-mode" aria-describedby="content-mode-hint">
                  <option value="site" ${bot.contentMode !== "safe" ? "selected" : ""}>Follow the site setting (${CONTENT_NAMES[settings.content?.adult ? settings.content.level : "off"] ?? "Off"})</option>
                  <option value="safe" ${bot.contentMode === "safe" ? "selected" : ""}>Always safe for work</option>
                </select>
                <p class="hint" id="content-mode-hint">Set the site level in <a href="#/settings">Settings</a>. Safe for work keeps this bot's chats clean whatever the site allows.</p>
              </div>
              <label class="check"><input type="checkbox" id="bond-on" ${bot.bondEnabled === false ? "" : "checked"}>
                <span>Track the bond with this bot<small>Shows a bond meter in the chat header and lets it shape how the bot treats you.</small></span></label>
              <div class="bond-setup form-grid" id="bond-setup">
                <div class="field">
                  <label for="bond-kind">Kind of bond</label>
                  <select id="bond-kind" aria-describedby="bond-kind-about">
                    ${Object.entries(BOND_KINDS).map(([k, v]) => `<option value="${k}" ${bot.bondKind === k ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
                    <option value="custom" ${bot.bondKind === "custom" ? "selected" : ""}>Custom</option>
                  </select>
                  <p class="hint" id="bond-kind-about"></p>
                </div>
                <details class="more">
                  <summary>The six levels</summary>
                  <div class="bond-levels" id="bond-levels">
                    ${BOND_POINTS.map((at, i) => `
                      <div class="bond-level">
                        <span class="bond-at" aria-hidden="true">${at}+</span>
                        <div class="field">
                          <label class="sr-only" for="bl-label-${i}">Name of level ${i + 1}, from ${at}</label>
                          <input type="text" id="bl-label-${i}" data-level-label="${i}" autocomplete="off" maxlength="32">
                          <label class="sr-only" for="bl-behavior-${i}">How the bot acts at level ${i + 1}</label>
                          <textarea id="bl-behavior-${i}" data-level-behavior="${i}" rows="2"></textarea>
                        </div>
                      </div>`).join("")}
                  </div>
                  <p class="hint">What the bond is called at each point on the meter, and how the bot acts there. The bot is told the current level with every reply.
                    Changing any of these makes this bot's bond Custom. Use <code>{{user}}</code> for you.</p>
                </details>
                <label class="check"><input type="checkbox" id="bond-milestones" ${bot.bondMilestones === false ? "" : "checked"}>
                  <span>Mark level changes in the chat<small>Shows a divider when the bond changes level, and asks the next reply to show the change.</small></span></label>
              </div>
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
    bot.bondKind = val("#bond-kind");
    bot.bondLevels = bot.bondKind === "custom"
      ? BOND_POINTS.map((_, i) => ({ label: val(`#bl-label-${i}`).trim(), behavior: val(`#bl-behavior-${i}`).trim() }))
      : null;
    bot.bondMilestones = $("#bond-milestones", main).checked;
    bot.contentMode = val("#content-mode");
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

  let paintAvatar = null;
  function update() {
    collect();
    paintPreview();
    if (!bot.avatar) paintAvatar?.(); // the letter placeholder follows the name
    for (const el of $$("[data-count]", main)) el.textContent = `~${estimateTokens(bot[el.dataset.count]).toLocaleString()} tokens`;
    $("#tagline-count", main).textContent = `${bot.tagline.length}/140`;
    const dirty = isDirty();
    const state = $("#save-state", main);
    state.classList.toggle("dirty", dirty);
    state.textContent = dirty ? "Unsaved changes" : isNew ? "" : "All changes saved";
  }
  let deleted = false;
  const isDirty = () => { if (deleted) return false; collect(); return JSON.stringify(bot) !== saved; };

  paintAvatar = imagePicker($("#avatar", main), {
    get: () => bot.avatar,
    set: (v) => { bot.avatar = v; update(); },
    name: () => val("#name"),
    crop: { round: true, title: "Crop the bot's picture" },
  });
  // ---------- Expressions ----------
  // The six defaults, then the bot's own moods. A mood added here stays an
  // empty slot until it gets a picture; empty ones are not saved or used.
  const baseKeys = EXPRESSIONS.map((e) => e.key);
  const labelOf = (k) => EXPRESSIONS.find((e) => e.key === k)?.label ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, " ");
  const pendingMoods = [];
  const customKeys = () => [...new Set([...Object.keys(bot.expressions).filter((k) => !baseKeys.includes(k)), ...pendingMoods])];
  function paintExpressions(focusKey) {
    const keys = [...baseKeys, ...customKeys()];
    $("#expr-grid", main).innerHTML = keys.map((k) => `
      <div class="expr-slot" id="expr-${k}">
        <span class="expr-slot-head"><span class="field-label">${esc(labelOf(k))}</span>
          ${baseKeys.includes(k) || bot.expressions[k] ? "" : `<button class="icon-btn" type="button" data-remove-mood="${k}" aria-label="Remove the ${esc(labelOf(k))} mood" title="Remove mood">${icon("x")}</button>`}</span>
        ${imagePickerHTML(`expr-file-${k}`, { label: "Upload", hint: "", cls: "expr-edit" })}
      </div>`).join("");
    for (const k of keys) {
      imagePicker($(`#expr-${k}`, main), {
        get: () => bot.expressions[k] ?? null,
        set: (v) => {
          if (v) bot.expressions[k] = v; else delete bot.expressions[k];
          // A mood of the bot's own goes when its picture goes; the × only
          // shows while it has none.
          if (!baseKeys.includes(k)) {
            const i = pendingMoods.indexOf(k);
            if (!v && i >= 0) pendingMoods.splice(i, 1);
            paintExpressions();
          }
          update();
        },
        crop: { aspect: 1, outW: 384, outH: 384, title: `${labelOf(k)} expression` },
        preview: (url) => (url
          ? `<span class="expr-thumb"><img src="${esc(url)}" alt="${esc(labelOf(k))} expression"></span>`
          : `<span class="expr-thumb is-empty" aria-hidden="true">${esc(labelOf(k))}</span>`),
      });
    }
    const taken = new Set(keys);
    $("#mood-suggest", main).innerHTML = MOOD_SUGGESTIONS.filter((m) => !taken.has(m))
      .map((m) => `<button type="button" class="chip" data-suggest-mood="${m}">+ ${esc(labelOf(m))}</button>`).join("");
    if (focusKey) $(`#expr-${focusKey} .btn`, main)?.focus();
  }
  function addMood(raw) {
    const k = moodName(raw);
    if (!k) { toast("Give the mood a name, like devious or mocking.", "error"); $("#mood-new", main).focus(); return; }
    if (baseKeys.includes(k) || customKeys().includes(k)) { toast(`${labelOf(k)} is already there.`); $(`#expr-${k} .btn`, main)?.focus(); return; }
    pendingMoods.push(k);
    $("#mood-new", main).value = "";
    paintExpressions(k);
  }
  $("#mood-add", main).addEventListener("click", () => addMood($("#mood-new", main).value));
  $("#mood-new", main).addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addMood(e.target.value); } });
  $("#mood-suggest", main).addEventListener("click", (e) => {
    const s = e.target.closest("[data-suggest-mood]");
    if (s) addMood(s.dataset.suggestMood);
  });
  $("#expr-grid", main).addEventListener("click", (e) => {
    const r = e.target.closest("[data-remove-mood]");
    if (!r) return;
    const k = r.dataset.removeMood;
    delete bot.expressions[k];
    const i = pendingMoods.indexOf(k);
    if (i >= 0) pendingMoods.splice(i, 1);
    paintExpressions();
    update();
    toast(`${labelOf(k)} removed. Save the bot to keep the change.`);
  });
  paintExpressions();
  imagePicker($("#background", main), {
    get: () => bot.background,
    set: (v) => { bot.background = v; update(); },
    crop: { aspect: 16 / 9, outW: 1600, outH: 900, quality: 0.82, title: "Crop the chat background" },
    preview: (url) => (url
      ? `<span class="bg-thumb"><img src="${esc(url)}" alt=""></span>`
      : `<span class="bg-thumb is-empty">No background</span>`),
  });
  // ---- Kind of bond ----
  function paintBondLevels(list) {
    list.forEach((l, i) => {
      $(`#bl-label-${i}`, main).value = l.label;
      const ta = $(`#bl-behavior-${i}`, main);
      ta.value = l.behavior;
      ta.dispatchEvent(new Event("input")); // refit its height
    });
  }
  function paintBondKind() {
    const k = val("#bond-kind");
    $("#bond-kind-about", main).textContent = k === "custom"
      ? "Your own six levels, set below."
      : BOND_KINDS[k].about.replace("{{user}}", "you");
    $("#bond-setup", main).hidden = !$("#bond-on", main).checked;
  }
  $("#bond-kind", main).addEventListener("change", () => {
    const k = val("#bond-kind");
    // Custom starts from whatever the levels said before.
    if (k !== "custom") paintBondLevels(BOND_KINDS[k].levels);
    paintBondKind();
    update();
  });
  // Editing a level makes the bond this bot's own. Runs before the form's
  // own input handler, so the save sees "custom".
  $("#bond-levels", main).addEventListener("input", (e) => {
    if (e.isTrusted && val("#bond-kind") !== "custom") { $("#bond-kind", main).value = "custom"; paintBondKind(); }
  });
  $("#bond-on", main).addEventListener("change", paintBondKind);
  paintBondLevels(bondLevels(bot));
  paintBondKind();

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
    // Replace, so Back skips the empty "new bot" form.
    if (isNew) location.replace(`#/bot/${bot.id}`);
    else { paintAlts(); update(); }
    return true;
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });

  // ---- Draft from an idea ----
  async function draftFromIdea() {
    const idea = val("#idea").trim();
    const btn = $("#draft", main);
    const state = $("#draft-state", main);
    if (!idea) { $("#idea", main).focus(); state.textContent = "Write an idea first."; return; }
    collect();
    if ([bot.description, bot.greeting, bot.scenario, bot.examples].some((v) => v.trim())) {
      const ok = await confirmDialog({
        title: "Replace what is written?",
        body: "The draft fills the definition, scenario, first message and example dialogue, replacing what is there now. You can still leave without saving.",
        confirm: "Replace with a draft",
      });
      if (!ok) return;
    }
    btn.classList.add("is-loading");
    btn.setAttribute("aria-busy", "true");
    state.textContent = "Drafting. This can take a little while.";
    try {
      const d = await draftBot({ idea });
      const set = (id, v) => { if (v) { const el = $(`#${id}`, main); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };
      if (!val("#name").trim()) set("name", d.name);
      for (const k of ["tagline", "tags", "description", "personality", "scenario", "greeting", "examples"]) set(k, d[k]);
      if (d.bondKind) { $("#bond-kind", main).value = d.bondKind; $("#bond-kind", main).dispatchEvent(new Event("change")); }
      state.textContent = "Draft ready. Read it through, change anything, then save.";
      $("#name", main).scrollIntoView({ behavior: "smooth", block: "center" });
      toast(`Drafted ${d.name || "a bot"}. Nothing is saved yet.`, "ok");
    } catch (err) {
      state.textContent = "";
      toast(err.message, "error");
    } finally {
      btn.classList.remove("is-loading");
      btn.removeAttribute("aria-busy");
    }
  }
  $("#draft", main).addEventListener("click", draftFromIdea);
  $("#idea", main).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); draftFromIdea(); }
  });
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
