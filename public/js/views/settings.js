import { getSettings, saveSettings, exportAll, importAll, wipeAll } from "../store.js";
import {
  $, $$, esc, icon, toast, confirmDialog, download, pickFile,
  imagePicker, imagePickerHTML, sliderHTML, wireSlider, debounce,
} from "../ui.js";

const SIZES = [["sm", "Small"], ["md", "Default"], ["lg", "Large"], ["xl", "Largest"]];

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

// A row of radios drawn as one pill.
function segmentedHTML(name, options, value) {
  return `<div class="segmented">${options.map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>`;
}

function bytes(n) {
  if (!n) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export async function render(main) {
  const settings = await getSettings();
  const themePref = readPref("theme", "system");
  const textPref = readPref("textSize", "md");
  const chatTextPref = readPref("chatTextSize", "md");

  main.innerHTML = `
    <div class="wrap page">
      <h1>Settings</h1>
      <p class="lead">How the site looks and behaves, and your data.</p>

      <div class="card">
        <h2 class="card-title">Appearance</h2>
        <p class="lead">Saved in this browser and applied straight away.</p>
        <div class="form-grid">
          <fieldset class="field">
            <legend class="field-label">Theme</legend>
            ${segmentedHTML("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], themePref)}
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">Text size</legend>
            ${segmentedHTML("text-size", SIZES, textPref)}
            <p class="hint">Menus, forms and headings across the site.</p>
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">Chat message size</legend>
            ${segmentedHTML("chat-text-size", SIZES, chatTextPref)}
            <p class="hint">Only the messages and the box you type in. Adds to the text size above.</p>
          </fieldset>
          <div class="text-preview" aria-hidden="true">
            <div class="msg-body"><p>The tea has gone cold. <em>She sets the cup down without drinking.</em> “You came back later than you said.”</p></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Chat background</h2>
        <p class="lead">Used for every bot that has no background of its own.</p>
        <div class="form-grid">
          <div id="bg">${imagePickerHTML("bg-file", {
            label: "Upload background",
            hint: "Dimmed behind your chats so the text stays readable.",
            cls: "bg-edit",
          })}</div>
          ${sliderHTML({
            id: "dim", label: "Dim behind the text", min: 0.4, max: 0.98, step: 0.02,
            value: settings.backgroundDim, hint: "Higher hides more of the picture. Keep it high enough to read comfortably.",
          })}
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Bond</h2>
        <div class="form-grid">
          <label class="check"><input type="checkbox" id="bond-enabled" ${settings.bond.enabled ? "checked" : ""}>
            <span>Track a bond in chats<small>The bot rates each exchange, the meter in the chat header moves, and the bot is told where it stands. Turn it off per bot in the bot's Scene settings.</small></span></label>
          ${sliderHTML({
            id: "bond-start", label: "Bond at the start of a chat", min: 0, max: 100, step: 1,
            value: settings.bond.start, hint: "0 is hostile, 100 is devoted. New chats begin here.",
          })}
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Memory</h2>
        <p class="lead">Each chat keeps a running summary, so bots remember what happened after old messages fall out of the context size. You can read and edit it from the book button in a chat.</p>
        <div class="form-grid">
          <label class="check"><input type="checkbox" id="mem-enabled" ${settings.memory.enabled ? "checked" : ""}>
            <span>Update memory automatically<small>Uses one extra request each time it updates.</small></span></label>
          ${sliderHTML({
            id: "mem-every", label: "Update after this many new messages", min: 6, max: 60, step: 2,
            value: settings.memory.every, hint: "Lower keeps the summary fresher but costs more requests.",
          })}
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Chat</h2>
        <label class="check"><input type="checkbox" id="enter" ${settings.enterToSend ? "checked" : ""}>
          <span>Enter sends the message<small>Off: Enter adds a new line and Ctrl+Enter sends. Handy on phones.</small></span></label>
        <label class="check"><input type="checkbox" id="check-auto" ${settings.check.auto ? "checked" : ""}>
          <span>Check every reply for staying in character<small>Flags replies that break the bot's definition. Each check is a second request to your API, so it costs more.</small></span></label>
        <details class="more">
          <summary>Keyboard shortcuts</summary>
          <ul class="hint shortcut-list">
            <li><code>Enter</code> send · <code>Shift+Enter</code> new line</li>
            <li><code>Esc</code> stop the reply being written</li>
            <li><code>Alt+W</code> write my reply · <code>Alt+D</code> direct the next reply</li>
            <li><code>Ctrl+Enter</code> save an edited message · <code>Esc</code> cancel editing</li>
            <li><code>Ctrl+S</code> save in the bot editor</li>
          </ul>
        </details>
      </div>

      <h2 class="sub">Your data</h2>
      <div class="card">
        <p class="lead" id="usage">Everything lives in this browser's storage.</p>
        <div class="form-grid">
          <label class="check"><input type="checkbox" id="with-keys">
            <span>Include API keys in the backup<small>Only if you will keep the file private.</small></span></label>
          <div class="actions">
            <button class="btn btn-primary" type="button" id="backup">Download backup</button>
            <button class="btn" type="button" id="restore">Restore from backup</button>
            <button class="btn" type="button" id="persist" hidden>Protect from automatic cleanup</button>
          </div>
          <p class="hint">Restoring adds to what is here and replaces items with the same ID. Browsers can clear site data when space runs low, so keep a backup.</p>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Danger zone</h2>
        <p class="lead">Deletes every bot, chat, persona, lore entry, preset and saved key on this browser. Built-in bots come back on reload.</p>
        <button class="btn btn-danger" type="button" id="wipe">Delete all data</button>
      </div>
    </div>`;

  async function paintUsage() {
    if (!navigator.storage?.estimate) return;
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    $("#usage", main).textContent = `Using ${bytes(usage)} of about ${bytes(quota)} available in this browser.${persisted ? " Protected from automatic cleanup." : ""}`;
    $("#persist", main).hidden = persisted || !navigator.storage.persist;
  }

  $$('input[name="theme"]', main).forEach((r) => r.addEventListener("change", () => {
    const pref = r.value;
    try { pref === "system" ? localStorage.removeItem("theme") : localStorage.setItem("theme", pref); } catch {}
    const dark = pref === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : pref === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    $("#theme-toggle").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }));
  // Text sizes live in localStorage so theme-init.js can apply them before paint.
  const sizePref = (name, storageKey, dataKey) => $$(`input[name="${name}"]`, main).forEach((r) => r.addEventListener("change", () => {
    try { r.value === "md" ? localStorage.removeItem(storageKey) : localStorage.setItem(storageKey, r.value); } catch {}
    if (r.value === "md") delete document.documentElement.dataset[dataKey];
    else document.documentElement.dataset[dataKey] = r.value;
  }));
  sizePref("text-size", "textSize", "text");
  sizePref("chat-text-size", "chatTextSize", "chatText");

  $("#enter", main).addEventListener("change", (e) => saveSettings({ enterToSend: e.target.checked }).then(() => toast("Saved.", "ok")));

  imagePicker($("#bg", main), {
    get: () => settings.chatBackground,
    set: (v) => { settings.chatBackground = v; saveSettings({ chatBackground: v }).then(() => toast("Saved.", "ok")); },
    crop: { aspect: 16 / 9, outW: 1600, outH: 900, quality: 0.82, title: "Crop the chat background" },
    preview: (url) => (url
      ? `<span class="bg-thumb"><img src="${esc(url)}" alt=""></span>`
      : `<span class="bg-thumb is-empty">No background</span>`),
  });
  const saveDim = debounce(() => saveSettings({ backgroundDim: Number($("#dim", main).value) }), 300);
  wireSlider(main, "dim", saveDim);
  $("#mem-enabled", main).addEventListener("change", (e) => saveSettings({ memory: { ...settings.memory, enabled: e.target.checked } }).then((next) => { settings.memory = next.memory; toast("Saved.", "ok"); }));
  const saveEvery = debounce(async () => {
    const every = Math.min(60, Math.max(6, Number($("#mem-every", main).value) || 20));
    settings.memory = (await saveSettings({ memory: { ...settings.memory, every } })).memory;
  }, 300);
  wireSlider(main, "mem-every", saveEvery);
  $("#check-auto", main).addEventListener("change", (e) => saveSettings({ check: { auto: e.target.checked } }).then(() => toast("Saved.", "ok")));
  $("#bond-enabled", main).addEventListener("change", (e) => saveSettings({ bond: { ...settings.bond, enabled: e.target.checked } }).then(() => toast("Saved.", "ok")));
  const saveStart = debounce(() => saveSettings({ bond: { ...settings.bond, start: Number($("#bond-start", main).value) } }), 300);
  wireSlider(main, "bond-start", saveStart);

  $("#backup", main).addEventListener("click", async () => {
    const data = await exportAll({ includeKeys: $("#with-keys", main).checked });
    download(`shirus-garden-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
  });
  $("#restore", main).addEventListener("click", async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = await confirmDialog({
        title: "Restore this backup?",
        body: `${data.bots?.length ?? 0} bots, ${data.chats?.length ?? 0} chats, ${data.personas?.length ?? 0} personas and ${data.lore?.length ?? 0} lore entries. Items with the same ID are replaced.`,
        confirm: "Restore",
      });
      if (!ok) return;
      await importAll(data);
      toast("Backup restored.", "ok");
      paintUsage();
    } catch (err) {
      toast(err instanceof SyntaxError ? "That file is not valid JSON." : err.message, "error");
    }
  });
  $("#persist", main).addEventListener("click", async () => {
    const ok = await navigator.storage.persist();
    toast(ok ? "Your data is now protected from automatic cleanup." : "The browser declined. Keep a backup to be safe.", ok ? "ok" : "error");
    paintUsage();
  });
  $("#wipe", main).addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Delete all data?", body: "This cannot be undone. Download a backup first if you might want anything back.", confirm: "Delete everything", danger: true });
    if (!ok) return;
    await wipeAll();
    location.hash = "#/";
    location.reload();
  });

  paintUsage();
}
