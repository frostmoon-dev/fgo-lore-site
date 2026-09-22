import {
  getPresets, savePresets, getSettings, saveSettings, bots, personas, loreForBot, bondTier,
  DEFAULT_PRESET, DEFAULT_MAIN_PROMPT, uid,
} from "../store.js";
import { buildPrompt, generationParams, estimateTokens } from "../prompt.js";
import {
  $, esc, icon, toast, confirmDialog, promptDialog, openDialog, debounce, autosize, sliderHTML, wireSlider,
} from "../ui.js";

const GEN = [
  { k: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05, hint: "Higher is more creative and less predictable. 0.7–1.0 suits roleplay." },
  { k: "top_p", label: "Top P", min: 0, max: 1, step: 0.01, hint: "Limits word choice to the most likely options. Leave at 1 unless you know you need it." },
  { k: "max_tokens", label: "Max reply tokens", min: 50, max: 4000, step: 50, hint: "Longest reply allowed. About 0.75 words per token." },
  { k: "contextTokens", label: "Context size (tokens)", min: 1000, max: 200000, step: 500, hint: "How much prompt plus history to send. Older messages drop off beyond this. Match your model's limit." },
  { k: "frequency_penalty", label: "Frequency penalty", min: -2, max: 2, step: 0.05, hint: "Above 0 discourages repeating the same words." },
  { k: "presence_penalty", label: "Presence penalty", min: -2, max: 2, step: 0.05, hint: "Above 0 nudges the model toward new topics." },
];

export async function render(main) {
  let presets = await getPresets();
  let settings = await getSettings();
  let preset = presets.find((p) => p.id === settings.presetId) ?? presets[0];

  main.innerHTML = `
    <div class="wrap page">
      <h1>The prompt</h1>
      <p class="lead">What every bot is told before your chat. Changes save as you type.
        A bot's own <em>System prompt override</em> (in its Advanced settings) replaces the main prompt for that bot.</p>

      <div class="card">
        <div class="form-row form-row-end">
          <div class="field">
            <label for="preset">Prompt preset</label>
            <select id="preset"></select>
          </div>
          <div class="actions">
            <button class="btn btn-sm" type="button" id="p-new">New</button>
            <button class="btn btn-sm" type="button" id="p-dup">Duplicate</button>
            <button class="btn btn-sm" type="button" id="p-rename">Rename</button>
            <button class="btn btn-sm btn-danger" type="button" id="p-del">Delete</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="form-grid" id="preset-form">
          <div class="field">
            <label for="main-prompt">Main prompt <span class="count" id="main-count"></span></label>
            <textarea id="main-prompt" class="tall mono" aria-describedby="main-hint"></textarea>
            <p class="hint" id="main-hint">Sent first, before the bot's definition.
              <button type="button" class="link-btn" id="reset-main">Reset to default</button></p>
          </div>
          <div class="field">
            <label for="post-history">Post-history instructions <span class="count" id="post-count"></span></label>
            <textarea id="post-history" class="mono" placeholder="e.g. Reply in 2–4 paragraphs. Write {{char}}'s actions in *asterisks*." aria-describedby="post-hint"></textarea>
            <p class="hint" id="post-hint">Sent last, after the chat history. Models follow it most closely, so use it for style and length rules.</p>
          </div>
          <fieldset class="field">
            <legend class="field-label">Include in the prompt</legend>
            <label class="check"><input type="checkbox" id="inc-scenario"><span>Scenario<small>The bot's scenario field.</small></span></label>
            <label class="check"><input type="checkbox" id="inc-persona"><span>Your persona<small>Your persona's description.</small></span></label>
            <label class="check"><input type="checkbox" id="inc-examples"><span>Example dialogue<small>Helps the voice, but costs tokens on every message.</small></span></label>
          </fieldset>
          <details class="more">
            <summary>Macros you can use</summary>
            <div class="form-grid"><p class="hint">
              <code>{{char}}</code> bot's name · <code>{{user}}</code> your persona's name ·
              <code>{{date}}</code> · <code>{{time}}</code> · <code>{{weekday}}</code> ·
              <code>{{original}}</code> (in a bot's override: the text from this page).</p></div>
          </details>
        </div>
      </div>

      <div class="card">
        <div class="page-head page-head-tight">
          <div><h2 class="card-title">Preview</h2><p class="lead">See the exact prompt a bot would get right now.</p></div>
          <div class="input-group">
            <label class="sr-only" for="preview-bot">Bot to preview</label>
            <select id="preview-bot"></select>
            <button class="btn" type="button" id="preview">Preview</button>
          </div>
        </div>
      </div>

      <h2 class="sub">Generation</h2>
      <div class="card">
        <p class="lead">Defaults for every bot. A bot can override temperature and length in its own settings.</p>
        <div class="form-grid">
          <div class="form-row">${GEN.map((g) => sliderHTML({ id: `gen-${g.k}`, label: g.label, min: g.min, max: g.max, step: g.step, value: settings.gen[g.k], hint: g.hint })).join("")}</div>
          <label class="check"><input type="checkbox" id="stream"><span>Stream replies<small>Show words as they arrive. Turn off if your proxy does not support streaming.</small></span></label>
        </div>
      </div>

      <h2 class="sub">Lore</h2>
      <div class="card">
        <p class="lead">Lore entries are added when their keywords appear in recent messages. <a href="#/lore">Manage lore</a>.</p>
        <div class="form-row">
          ${sliderHTML({ id: "lore-scan", label: "Messages to scan", min: 1, max: 20, step: 1, value: settings.lore.scanDepth, hint: "How many recent messages are checked for keywords." })}
          ${sliderHTML({ id: "lore-max", label: "Max entries", min: 0, max: 20, step: 1, value: settings.lore.maxEntries, hint: "Most entries added at once (always-on entries don't count)." })}
        </div>
      </div>
      <p class="save-state save-pill" id="state" aria-live="polite"></p>
    </div>`;

  const mainTa = $("#main-prompt", main);
  const postTa = $("#post-history", main);
  const state = $("#state", main);
  const fits = [autosize(mainTa), autosize(postTa)];
  const flash = () => { state.classList.remove("dirty"); state.textContent = "Saved"; };

  function paintPresets() {
    $("#preset", main).innerHTML = presets.map((p) => `<option value="${p.id}" ${p.id === preset.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    mainTa.value = preset.main;
    postTa.value = preset.postHistory;
    $("#inc-scenario", main).checked = preset.includeScenario !== false;
    $("#inc-persona", main).checked = preset.includePersona !== false;
    $("#inc-examples", main).checked = preset.includeExamples !== false;
    $("#p-del", main).disabled = presets.length < 2;
    counts();
    fits.forEach((f) => f());
  }
  function counts() {
    $("#main-count", main).textContent = `~${estimateTokens(mainTa.value)} tokens`;
    $("#post-count", main).textContent = `~${estimateTokens(postTa.value)} tokens`;
  }

  const savePreset = debounce(async () => { await savePresets(presets); flash(); }, 350);
  $("#preset-form", main).addEventListener("input", () => {
    preset.main = mainTa.value;
    preset.postHistory = postTa.value;
    preset.includeScenario = $("#inc-scenario", main).checked;
    preset.includePersona = $("#inc-persona", main).checked;
    preset.includeExamples = $("#inc-examples", main).checked;
    counts();
    state.classList.add("dirty"); state.textContent = "Saving…";
    savePreset();
  });
  $("#reset-main", main).addEventListener("click", () => {
    mainTa.value = DEFAULT_MAIN_PROMPT;
    mainTa.dispatchEvent(new Event("input", { bubbles: true }));
  });

  async function selectPreset(id) {
    preset = presets.find((p) => p.id === id) ?? presets[0];
    settings = await saveSettings({ presetId: preset.id });
    paintPresets();
  }
  $("#preset", main).addEventListener("change", (e) => selectPreset(e.target.value));
  $("#p-new", main).addEventListener("click", async () => {
    const name = await promptDialog({ title: "New preset", label: "Preset name", value: "", confirm: "Create" });
    if (!name) return;
    const p = { ...structuredClone(DEFAULT_PRESET), id: uid(), name };
    presets.push(p); await savePresets(presets); selectPreset(p.id);
  });
  $("#p-dup", main).addEventListener("click", async () => {
    const p = { ...structuredClone(preset), id: uid(), name: `${preset.name} (copy)` };
    presets.push(p); await savePresets(presets); selectPreset(p.id);
    toast("Preset duplicated.", "ok");
  });
  $("#p-rename", main).addEventListener("click", async () => {
    const name = await promptDialog({ title: "Rename preset", label: "Preset name", value: preset.name });
    if (!name) return;
    preset.name = name; await savePresets(presets); paintPresets();
  });
  $("#p-del", main).addEventListener("click", async () => {
    if (presets.length < 2) return;
    const ok = await confirmDialog({ title: `Delete “${preset.name}”?`, confirm: "Delete preset", danger: true });
    if (!ok) return;
    presets = presets.filter((p) => p.id !== preset.id);
    await savePresets(presets); selectPreset(presets[0].id);
  });

  // ---- Generation + lore settings ----
  const saveGen = debounce(async () => {
    const gen = { stream: $("#stream", main).checked };
    for (const g of GEN) {
      const v = $(`#gen-${g.k}`, main).value;
      if (v !== "") gen[g.k] = Math.min(g.max, Math.max(g.min, Number(v)));
    }
    const loreSet = { scanDepth: Number($("#lore-scan", main).value) || 1, maxEntries: Number($("#lore-max", main).value) || 0 };
    settings = await saveSettings({ gen, lore: loreSet });
    flash();
  }, 350);
  for (const g of GEN) wireSlider(main, `gen-${g.k}`, saveGen);
  wireSlider(main, "lore-scan", saveGen);
  wireSlider(main, "lore-max", saveGen);
  $("#stream", main).checked = settings.gen.stream;
  $("#stream", main).addEventListener("change", saveGen);

  // ---- Preview ----
  const allBots = await bots.all();
  $("#preview-bot", main).innerHTML = allBots.length
    ? allBots.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")
    : `<option value="">No bots yet</option>`;
  $("#preview", main).disabled = !allBots.length;
  $("#preview", main).addEventListener("click", async () => {
    const bot = allBots.find((b) => b.id === $("#preview-bot", main).value);
    if (!bot) return;
    const [persona, entries, s] = await Promise.all([personas.active(), loreForBot(bot), getSettings()]);
    const history = bot.greeting ? [{ role: "assistant", content: bot.greeting }] : [];
    const start = Number(s.bond?.start ?? 20);
    const bondOn = s.bond?.enabled !== false && bot.bondEnabled !== false;
    const p = buildPrompt({
      bot, persona, preset, settings: s, history, loreEntries: entries,
      bond: bondOn ? { value: start, label: bondTier(start).label } : null,
    });
    openDialog(`<div class="dialog-body">
      <h2>${esc(bot.name)}'s prompt</h2>
      <p class="hint">About <strong>${p.tokens.toLocaleString()}</strong> tokens before you say anything ·
        ${Object.entries(generationParams(s, bot)).map(([k, v]) => `${k} ${v}`).join(", ")}</p>
      <div class="prompt-preview">${p.messages.map((m) => `<span class="role">${m.role}</span>\n${esc(m.content)}`).join("\n")}</div>
      <form method="dialog" class="dialog-actions"><button class="btn btn-primary">Close</button></form>
    </div>`, { wide: true });
  });

  paintPresets();
}
