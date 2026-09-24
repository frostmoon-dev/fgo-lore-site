import { getSettings, saveSettings, exportAll, importAll, wipeAll, getUsage, clearUsage, dayKey, getMeta, markBackedUp } from "../store.js";
import { usageChartHTML, wireUsageChart, shortNumber } from "../chart.js";
import { installState, promptInstall, onInstallChange } from "../install.js";
import {
  $, $$, esc, icon, toast, confirmDialog, download, pickFile,
  imagePicker, imagePickerHTML, sliderHTML, wireSlider, debounce, timeAgo,
} from "../ui.js";

const SIZES = [["sm", "Small"], ["md", "Default"], ["lg", "Large"], ["xl", "Largest"]];

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

// A row of radios drawn as one pill.
function segmentedHTML(name, options, value) {
  return `<div class="segmented">${options.map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>`;
}

const LANGUAGES = [
  "English", "Thai", "Japanese", "Korean", "Chinese (Simplified)", "Chinese (Traditional)", "Vietnamese", "Indonesian",
  "Malay", "Filipino", "Hindi", "Spanish", "Portuguese", "French", "German", "Italian", "Dutch", "Polish", "Russian",
  "Ukrainian", "Turkish", "Arabic",
];

function browserLanguage() {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(navigator.language.split("-")[0]) || "English"; }
  catch { return "English"; }
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
  const contentPref = settings.content.adult ? settings.content.level : "off";
  const textPref = readPref("textSize", "md");
  const chatTextPref = readPref("chatTextSize", "md");

  main.innerHTML = `
    <div class="wrap page">
      <h1>Settings</h1>
      <p class="lead">How the site looks and behaves, and your data.</p>

      <div class="card" id="set-appearance">
        <h2 class="card-title">Appearance</h2>
        <p class="lead">Saved in this browser and applied straight away.</p>
        <div class="form-grid">
          <fieldset class="field">
            <legend class="field-label">Theme</legend>
            ${segmentedHTML("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], themePref)}
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">Colours</legend>
            ${segmentedHTML("palette", [["moon", "Moon Cell"], ["paper", "Paper"]], readPref("palette", "moon"))}
            <p class="hint">Moon Cell is violet and rose, after BB. Paper is warm cream and clay.</p>
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
          <fieldset class="field">
            <legend class="field-label">Chat font</legend>
            ${segmentedHTML("chat-font", [["rounded", "Rounded"], ["serif", "Book"], ["clear", "Clear"], ["plain", "Plain"]], readPref("chatFont", "rounded"))}
            <p class="hint">Clear is made for low vision and tired eyes: letters like I, l and 1 never look alike.</p>
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">Chat actions</legend>
            ${segmentedHTML("chat-actions", [["italic", "Italic"], ["upright", "Upright"]], readPref("chatActions", "italic"))}
            <p class="hint">How *actions* look. Upright is easier to read in long passages; they keep their softer colour.</p>
          </fieldset>
          <fieldset class="field">
            <legend class="field-label">Chat picture size</legend>
            ${segmentedHTML("chat-pic", [["sm", "Small"], ["md", "Medium"], ["lg", "Large"]], readPref("chatPic", "lg"))}
            <p class="hint">Avatars and expressions beside each message.</p>
          </fieldset>
          <div class="text-preview" aria-hidden="true">
            <div class="msg-body"><p>The tea has gone cold. <em>She sets the cup down without drinking.</em> “You came back later than you said.”</p></div>
          </div>
        </div>
      </div>

      <div class="card" id="set-install">
        <h2 class="card-title">Install as an app</h2>
        <p class="lead">Put MoonPaper on your home screen or in your app list. It opens full screen, loads instantly,
          and your bots and chats open even without internet. Replies still need your connection.</p>
        <div id="install-box" aria-live="polite"></div>
      </div>

      <div class="card" id="set-content">
        <h2 class="card-title">Mature content</h2>
        <p class="lead">What the model may write in your chats. Off by default. Mature and Explicit are for adults only.</p>
        <div class="form-grid">
          <fieldset class="field">
            <legend class="field-label">Level</legend>
            ${segmentedHTML("content-level", [["off", "Off"], ["mature", "Mature"], ["explicit", "Explicit"]], contentPref)}
            <p class="hint" id="content-about"></p>
          </fieldset>
          <p class="note">${icon("info")}<span>Characters in any sexual content are always adults. Your model provider's own rules still apply, and some models refuse
            explicit content whatever this says. A bot can be kept safe for work in its own settings.</span></p>
        </div>
      </div>

      <div class="card" id="set-background">
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

      <div class="card" id="set-bond">
        <h2 class="card-title">Bond</h2>
        <div class="form-grid">
          <label class="check"><input type="checkbox" id="bond-enabled" ${settings.bond.enabled ? "checked" : ""}>
            <span>Track a bond in chats<small>The bot rates each exchange, the meter in the chat header moves, and the bot is told where it stands. Turn it off per bot in the bot's Scene settings.</small></span></label>
          ${sliderHTML({
            id: "bond-start", label: "Bond at the start of a chat", min: 0, max: 100, step: 1,
            value: settings.bond.start, hint: "0 is the lowest level of a bond, 100 the highest. What the levels are called depends on each bot's kind of bond. New chats begin here.",
          })}
        </div>
      </div>

      <div class="card" id="set-languages">
        <h2 class="card-title">Languages</h2>
        <p class="lead">For translating in chats: read any message in your language, and write in your language and send it in the chat's language.</p>
        <div class="form-row">
          <div class="field">
            <label for="lang-mine">Your language</label>
            <input type="text" id="lang-mine" list="languages" value="${esc(settings.translate.mine)}" placeholder="${esc(browserLanguage())}" autocomplete="off">
            <p class="hint">Messages are translated into this. Empty uses your browser's language (${esc(browserLanguage())}).</p>
          </div>
          <div class="field">
            <label for="lang-chat">Language of your chats</label>
            <input type="text" id="lang-chat" list="languages" value="${esc(settings.translate.chat)}" autocomplete="off">
            <p class="hint">Your messages are translated into this before you send them.</p>
          </div>
        </div>
        <datalist id="languages">${LANGUAGES.map((l) => `<option value="${l}">`).join("")}</datalist>
      </div>

      <div class="card" id="set-memory">
        <h2 class="card-title">Memory</h2>
        <p class="lead">Long chats are remembered in layers: the newest messages word for word, older ones as short chapters, the oldest folded into a story so far, and lasting facts in their own list. Each reply sends far fewer tokens than the whole chat, and old moments come back when they are mentioned again. Read and edit it all from the book button in a chat.</p>
        <div class="form-grid">
          <label class="check"><input type="checkbox" id="mem-enabled" ${settings.memory.enabled ? "checked" : ""}>
            <span>Update memory automatically<small>Uses one extra request per chapter, and one now and then to fold old chapters.</small></span></label>
          ${sliderHTML({
            id: "mem-every", label: "Messages per chapter", min: 6, max: 60, step: 2,
            value: settings.memory.every, hint: "Smaller chapters keep more detail but cost more requests.",
          })}
        </div>
      </div>

      <div class="card" id="set-chat">
        <h2 class="card-title">Chat</h2>
        <label class="check"><input type="checkbox" id="enter" ${settings.enterToSend ? "checked" : ""}>
          <span>Enter sends the message<small>Off: Enter adds a new line and Ctrl+Enter sends. Handy on phones.</small></span></label>
        <label class="check"><input type="checkbox" id="journal-on" ${settings.journal.auto ? "checked" : ""}>
          <span>Let bots keep a journal<small>When you leave a chat after ${settings.journal.every} or more new messages, the bot writes a short private diary entry about it. One request each time. Read entries from the chat's ⋯ menu.</small></span></label>
        <label class="check"><input type="checkbox" id="confirm-on" ${settings.confirm.enabled ? "checked" : ""}>
          <span>Ask before changing a chat<small>Before deleting a message, saving an edit, branching, or removing a character from a scene.</small></span></label>
        <label class="check"><input type="checkbox" id="recap-auto" ${settings.recap.auto ? "checked" : ""}>
          <span>Recap when I come back to a chat<small>After a break of 12 hours or more, a few lines on where the story stands. One request each time.</small></span></label>
        <label class="check"><input type="checkbox" id="check-auto" ${settings.check.auto ? "checked" : ""}>
          <span>Check every reply for staying in character<small>Flags replies that break the bot's definition. Each check is a second request to your API, so it costs more.</small></span></label>
        <details class="more">
          <summary>Keyboard shortcuts</summary>
          <ul class="hint shortcut-list">
            <li><code>Enter</code> send · <code>Shift+Enter</code> new line</li>
            <li><code>Esc</code> stop the reply being written</li>
            <li><code>Alt+W</code> write my reply · <code>Alt+S</code> ideas for what to say</li>
            <li><code>Alt+D</code> direct the next reply · <code>Alt+T</code> translate my message</li>
            <li><code>Ctrl+Enter</code> save an edited message · <code>Esc</code> cancel editing</li>
            <li><code>Ctrl+S</code> save in the bot editor</li>
          </ul>
        </details>
      </div>

      <h2 class="sub" id="usage-title">Usage</h2>
      <div class="card" id="set-usage" aria-labelledby="usage-title">
        <p class="lead">Tokens sent to and received from your API by this browser: replies and every extra task, like memory and ideas.</p>
        <div class="form-grid">
          <div id="usage-body"></div>
          <details class="more">
            <summary>Prices, for a cost estimate</summary>
            <div class="form-row">
              <div class="field"><label for="price-in">Input, US$ per million tokens</label>
                <input type="number" id="price-in" min="0" step="0.01" inputmode="decimal" value="${esc(settings.usage.priceIn)}" placeholder="e.g. 3"></div>
              <div class="field"><label for="price-out">Output, US$ per million tokens</label>
                <input type="number" id="price-out" min="0" step="0.01" inputmode="decimal" value="${esc(settings.usage.priceOut)}" placeholder="e.g. 15"></div>
            </div>
            <p class="hint">Find these on your provider's pricing page. The estimate uses one price for every model.</p>
          </details>
        </div>
      </div>

      <h2 class="sub">Help</h2>
      <div class="card" id="set-help">
        <p class="lead">Press <kbd>Ctrl K</kbd> anywhere, or the search button at the top, to find any page, bot, setting or chat action.</p>
        <div class="actions">
          <button class="btn" type="button" id="show-tour">Show the welcome tour</button>
          <button class="btn" type="button" id="show-news">What's new</button>
        </div>
      </div>

      <h2 class="sub">Your data</h2>
      <div class="card" id="set-data">
        <p class="lead" id="usage">Everything lives in this browser's storage.</p>
        <p class="hint" id="last-backup"></p>
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

      <div class="card" id="set-danger">
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
  $$('input[name="palette"]', main).forEach((r) => r.addEventListener("change", () => {
    try { r.value === "moon" ? localStorage.removeItem("palette") : localStorage.setItem("palette", r.value); } catch {}
    if (r.value === "paper") delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = r.value;
  }));
  // Text sizes live in localStorage so theme-init.js can apply them before paint.
  const sizePref = (name, storageKey, dataKey) => $$(`input[name="${name}"]`, main).forEach((r) => r.addEventListener("change", () => {
    try { r.value === "md" ? localStorage.removeItem(storageKey) : localStorage.setItem(storageKey, r.value); } catch {}
    if (r.value === "md") delete document.documentElement.dataset[dataKey];
    else document.documentElement.dataset[dataKey] = r.value;
  }));
  sizePref("text-size", "textSize", "text");
  sizePref("chat-text-size", "chatTextSize", "chatText");
  $$('input[name="chat-pic"]', main).forEach((r) => r.addEventListener("change", () => {
    try { r.value === "lg" ? localStorage.removeItem("chatPic") : localStorage.setItem("chatPic", r.value); } catch {}
    if (r.value === "lg") delete document.documentElement.dataset.chatPic;
    else document.documentElement.dataset.chatPic = r.value;
  }));
  $$('input[name="chat-actions"]', main).forEach((r) => r.addEventListener("change", () => {
    try { r.value === "italic" ? localStorage.removeItem("chatActions") : localStorage.setItem("chatActions", r.value); } catch {}
    if (r.value === "italic") delete document.documentElement.dataset.chatActions;
    else document.documentElement.dataset.chatActions = r.value;
  }));
  $$('input[name="chat-font"]', main).forEach((r) => r.addEventListener("change", () => {
    try { r.value === "rounded" ? localStorage.removeItem("chatFont") : localStorage.setItem("chatFont", r.value); } catch {}
    if (r.value === "rounded") delete document.documentElement.dataset.chatFont;
    else document.documentElement.dataset.chatFont = r.value;
  }));

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
  const saveLangs = debounce(async () => {
    settings.translate = (await saveSettings({ translate: {
      mine: $("#lang-mine", main).value.trim(),
      chat: $("#lang-chat", main).value.trim() || "English",
    } })).translate;
    toast("Saved.", "ok");
  }, 500);
  $("#lang-mine", main).addEventListener("input", saveLangs);
  $("#lang-chat", main).addEventListener("input", saveLangs);
  // ---- Usage ----
  async function paintUsageStats() {
    const usage = await getUsage();
    const body = $("#usage-body", main);
    const price = { in: Number(settings.usage.priceIn), out: Number(settings.usage.priceOut) };
    const priced = price.in > 0 || price.out > 0;
    const cost = (d) => (d.prompt * (price.in || 0) + d.completion * (price.out || 0)) / 1e6;
    const money = (n) => (n < 0.01 && n > 0 ? "under $0.01" : `$${n.toFixed(2)}`);
    const range = (n) => {
      const out = { prompt: 0, completion: 0, requests: 0, estimated: 0, cached: 0, models: {} };
      for (let i = 0; i < n; i++) {
        const d = usage.days[dayKey(Date.now() - i * 86400000)];
        if (!d) continue;
        for (const k of ["prompt", "completion", "requests", "estimated", "cached"]) out[k] += d[k] ?? 0;
        for (const [name, m] of Object.entries(d.models ?? {})) {
          const t = (out.models[name] ??= { prompt: 0, completion: 0, requests: 0 });
          t.prompt += m.prompt; t.completion += m.completion; t.requests += m.requests;
        }
      }
      return out;
    };
    const today = range(1);
    const week = range(7);
    const month = range(30);
    if (!month.requests) {
      body.innerHTML = `<p class="note">${icon("info")}<span>Nothing used yet. Numbers appear here after your first chat reply.</span></p>`;
      return;
    }
    const tile = (k, d) => `<div class="usage-tile"><span class="k">${k}</span>
      <span class="v">${shortNumber(d.prompt + d.completion)}</span>
      <span class="s">tokens · ${d.requests} request${d.requests === 1 ? "" : "s"}${priced ? ` · ${money(cost(d))}` : ""}</span></div>`;
    const days = Array.from({ length: 14 }, (_, i) => {
      const t = Date.now() - (13 - i) * 86400000;
      const d = usage.days[dayKey(t)] ?? { prompt: 0, completion: 0, requests: 0 };
      return {
        label: new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }),
        prompt: d.prompt, completion: d.completion, requests: d.requests, total: d.prompt + d.completion,
      };
    });
    const models = Object.entries(month.models).sort((a, b) => (b[1].prompt + b[1].completion) - (a[1].prompt + a[1].completion));
    body.innerHTML = `
      <div class="form-grid">
        <div class="usage-tiles">${tile("Today", today)}${tile("Last 7 days", week)}${tile("Last 30 days", month)}</div>
        <div><h3 class="field-label">Tokens per day, last 14 days</h3>${usageChartHTML(days)}</div>
        <details class="more">
          <summary>By model, last 30 days</summary>
          <table class="usage-table">
            <thead><tr><th scope="col">Model</th><th scope="col" class="num">Requests</th><th scope="col" class="num">In</th><th scope="col" class="num">Out</th>${priced ? '<th scope="col" class="num">Cost</th>' : ""}</tr></thead>
            <tbody>${models.map(([name, m]) => `<tr><td>${esc(name)}</td><td class="num">${m.requests}</td>
              <td class="num">${m.prompt.toLocaleString()}</td><td class="num">${m.completion.toLocaleString()}</td>${priced ? `<td class="num">${money(cost(m))}</td>` : ""}</tr>`).join("")}</tbody>
          </table>
        </details>
        ${month.cached ? `<p class="hint">${Math.round((month.cached / Math.max(1, month.prompt)) * 100)}% of input tokens in the last 30 days (${month.cached.toLocaleString()}) were reused from your provider's cache, which most providers charge less for.</p>` : ""}
        ${month.estimated ? `<p class="hint">${month.estimated} of ${month.requests} requests were estimated at about 4 characters per token, because the provider did not report exact counts.</p>` : ""}
        <div><button class="btn btn-sm btn-quiet btn-danger" type="button" id="usage-clear">Clear usage history</button></div>
      </div>`;
    wireUsageChart($(".usage-chart", body), days);
    $("#usage-clear", body).addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Clear usage history?", body: "The token counts are removed from this browser. Your chats are not affected.", confirm: "Clear", danger: true });
      if (!ok) return;
      await clearUsage();
      paintUsageStats();
    });
  }
  paintUsageStats();
  const savePrices = debounce(async () => {
    settings.usage = (await saveSettings({ usage: { priceIn: $("#price-in", main).value, priceOut: $("#price-out", main).value } })).usage;
    paintUsageStats();
  }, 400);
  $("#price-in", main).addEventListener("input", savePrices);
  $("#price-out", main).addEventListener("input", savePrices);

  // ---- Install ----
  function paintInstall() {
    const box = $("#install-box", main);
    const state = installState();
    box.innerHTML = {
      installed: `<p class="note">${icon("check")}<span>Installed. You are using MoonPaper as an app.</span></p>`,
      ready: `<button class="btn btn-primary" type="button" id="install">Install app</button>`,
      ios: `<ol class="steps-list"><li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>`,
      manual: `<p class="hint">Open your browser's menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
        If you do not see it, your browser may not support installing sites; Chrome and Edge do.</p>`,
    }[state];
    $("#install", box)?.addEventListener("click", async (e) => {
      e.currentTarget.classList.add("is-loading");
      const ok = await promptInstall();
      toast(ok ? "Installing. Look for MoonPaper on your home screen or app list." : "Not installed. You can install any time from here.", ok ? "ok" : "info");
      paintInstall();
    });
  }
  paintInstall();
  const stopInstall = onInstallChange(paintInstall);

  // ---- Mature content, behind an 18+ check ----
  const CONTENT_ABOUT = {
    off: "No instruction is added. The model follows its own defaults, usually suitable for general audiences.",
    mature: "Violence, dark themes, strong language and romance. Sexual content stays implied, never explicit.",
    explicit: "Explicit sexual content, graphic violence and dark themes, written without censoring or fading to black.",
  };
  const paintContent = (level) => { $("#content-about", main).textContent = CONTENT_ABOUT[level]; };
  paintContent(contentPref);
  $$('input[name="content-level"]', main).forEach((r) => r.addEventListener("change", async () => {
    let level = r.value;
    if (level !== "off" && !settings.content.adult) {
      const adult = await confirmDialog({
        title: "Are you 18 or older?",
        body: "Mature and Explicit content is for adults only. Only continue if you are 18 or older and it is legal for you to view this content where you live.",
        confirm: "I am 18 or older",
      });
      if (!adult) {
        level = "off";
        $('input[name="content-level"][value="off"]', main).checked = true;
      }
    }
    const adult = settings.content.adult || level !== "off";
    settings.content = (await saveSettings({ content: { level, adult } })).content;
    paintContent(level);
    toast(level === "off" ? "Mature content is off." : `Content level: ${level === "mature" ? "Mature" : "Explicit"}.`, "ok");
  }));

  $("#journal-on", main).addEventListener("change", (e) => saveSettings({ journal: { ...settings.journal, auto: e.target.checked } }).then(() => toast("Saved.", "ok")));
  $("#confirm-on", main).addEventListener("change", (e) => saveSettings({ confirm: { enabled: e.target.checked } }).then(() => toast("Saved.", "ok")));
  $("#recap-auto", main).addEventListener("change", (e) => saveSettings({ recap: { auto: e.target.checked } }).then(() => toast("Saved.", "ok")));
  $("#check-auto", main).addEventListener("change", (e) => saveSettings({ check: { auto: e.target.checked } }).then(() => toast("Saved.", "ok")));
  $("#bond-enabled", main).addEventListener("change", (e) => saveSettings({ bond: { ...settings.bond, enabled: e.target.checked } }).then(() => toast("Saved.", "ok")));
  const saveStart = debounce(() => saveSettings({ bond: { ...settings.bond, start: Number($("#bond-start", main).value) } }), 300);
  wireSlider(main, "bond-start", saveStart);

  $("#backup", main).addEventListener("click", async () => {
    const data = await exportAll({ includeKeys: $("#with-keys", main).checked });
    download(`moonpaper-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
    await markBackedUp();
    paintLastBackup();
  $("#show-tour", main).addEventListener("click", async () => (await import("../help.js")).showTour());
  $("#show-news", main).addEventListener("click", async () => (await import("../help.js")).showWhatsNew());
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

  async function paintLastBackup() {
    const at = (await getMeta()).lastBackupAt;
    $("#last-backup", main).textContent = at ? `Last backup: ${timeAgo(at)}.` : "No backup downloaded from this browser yet.";
  }
  paintLastBackup();
  $("#show-tour", main).addEventListener("click", async () => (await import("../help.js")).showTour());
  $("#show-news", main).addEventListener("click", async () => (await import("../help.js")).showWhatsNew());

  // Opened from the command palette or a reminder: go straight to a section.
  let focus = null;
  try { focus = sessionStorage.getItem("settingsFocus"); sessionStorage.removeItem("settingsFocus"); } catch {}
  if (focus) requestAnimationFrame(() => {
    const el = $(`#set-${focus}`, main);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.add("flash-card");
  });
  return { cleanup: () => stopInstall() };
}
