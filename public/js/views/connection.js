import { getConnections, saveConnections, getSettings, saveSettings, newConnection, PROVIDERS } from "../store.js";
import { listModels, chatCompletion, serverConfig, normalizeBaseUrl, parseHeaders } from "../api.js";
import { $, esc, icon, confirmDialog, debounce } from "../ui.js";

export async function render(main) {
  let list = await getConnections();
  const settings = await getSettings();
  const server = await serverConfig();
  let conn = list.find((c) => c.id === settings.connectionId) ?? list[0] ?? null;
  let models = [];

  main.innerHTML = `
    <div class="wrap page">
      <h1>Connection</h1>
      <p class="lead">Works with any OpenAI-compatible API or reverse proxy: OpenAI, OpenRouter, DeepSeek, community proxies,
        local servers, and more. Save as many connections as you like and switch between them.</p>
      <div class="note page-note">${icon("info")}
        <span>Keys are saved only in this browser. In <strong>Relay</strong> mode each request passes through this site's server
          to reach your proxy; the key is used for that request and never stored. Anyone using this browser profile can see saved keys.</span></div>
      <div id="conn-root"></div>
    </div>`;
  const root = $("#conn-root", main);

  const persist = debounce(async () => {
    await saveConnections(list);
    $("#c-state", root) && ($("#c-state", root).textContent = "Saved");
  }, 300);

  function paint() {
    if (!conn) {
      root.innerHTML = `<div class="empty"><h2>No connection yet</h2>
        <p>Add the base URL and key from your provider or proxy.</p>
        <div class="actions"><button class="btn btn-primary" type="button" id="c-add">Add connection</button>
        ${server.serverKey ? `<button class="btn" type="button" id="c-add-server">Use this site's key</button>` : ""}</div></div>`;
      $("#c-add", root).addEventListener("click", () => add());
      $("#c-add-server", root)?.addEventListener("click", () => add({ name: "Site key", mode: "server", model: server.defaultModel ?? "" }));
      return;
    }
    const provider = PROVIDERS.find((p) => p.id === conn.provider) ?? PROVIDERS[0];
    root.innerHTML = `
      <div class="card">
        <div class="form-row form-row-end">
          <div class="field">
            <label for="c-pick">Active connection</label>
            <select id="c-pick">${list.map((c) => `<option value="${c.id}" ${c.id === conn.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          </div>
          <div class="actions">
            <button class="btn btn-sm" type="button" id="c-new">New</button>
            <button class="btn btn-sm" type="button" id="c-dup">Duplicate</button>
            <button class="btn btn-sm btn-danger" type="button" id="c-del">Delete</button>
          </div>
        </div>
      </div>

      <form class="card form-grid" id="c-form" novalidate autocomplete="off">
        <div class="form-row">
          <div class="field">
            <label for="c-name">Name</label>
            <input type="text" id="c-name" value="${esc(conn.name)}">
          </div>
          <div class="field">
            <label for="c-provider">Provider</label>
            <select id="c-provider">${PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === provider.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          </div>
        </div>

        <fieldset class="field">
          <legend class="field-label">How requests are sent</legend>
          <label class="check"><input type="radio" name="mode" value="relay" ${conn.mode === "relay" ? "checked" : ""}>
            <span>Relay (recommended)<small>Through this site's server. Works with any public proxy, no CORS errors.</small></span></label>
          <label class="check"><input type="radio" name="mode" value="direct" ${conn.mode === "direct" ? "checked" : ""}>
            <span>Direct from browser<small>The key never touches this site. The proxy must allow browser requests (CORS). Needed for localhost servers.</small></span></label>
          ${server.serverKey || conn.mode === "server" ? `<label class="check"><input type="radio" name="mode" value="server" ${conn.mode === "server" ? "checked" : ""}>
            <span>This site's key<small>Uses the key set by whoever runs this site${server.needsCode ? "; needs an access code" : ""}.</small></span></label>` : ""}
        </fieldset>

        <div class="form-grid" id="own-key" ${conn.mode === "server" ? "hidden" : ""}>
          <div class="field">
            <label for="c-url">Base URL</label>
            <input type="url" id="c-url" class="mono" value="${esc(conn.baseUrl)}" placeholder="https://your-proxy.example/v1" spellcheck="false" aria-describedby="c-url-hint">
            <p class="hint" id="c-url-hint">The part before <code>/chat/completions</code>. Pasting the full URL is fine; it gets trimmed.</p>
          </div>
          <div class="field">
            <label for="c-key">API key</label>
            <div class="input-group">
              <input type="password" id="c-key" class="mono" value="${esc(conn.apiKey)}" placeholder="sk-…" spellcheck="false" autocomplete="off">
              <button class="btn" type="button" id="c-show" aria-pressed="false" aria-label="Show key">${icon("eye")}</button>
            </div>
            <p class="hint">Leave empty if your proxy doesn't need one.</p>
          </div>
        </div>

        <div class="field" id="access-field" ${conn.mode === "server" && server.needsCode ? "" : "hidden"}>
          <label for="c-code">Access code</label>
          <input type="password" id="c-code" value="${esc(conn.accessCode ?? "")}" autocomplete="off">
        </div>

        <div class="field">
          <label for="c-model">Model</label>
          <div class="input-group">
            <input type="text" id="c-model" class="mono" value="${esc(conn.model)}" list="c-models" placeholder="${conn.mode === "server" ? esc(server.defaultModel || "server default") : "e.g. gpt-4o-mini, deepseek-chat"}" spellcheck="false">
            <button class="btn" type="button" id="c-fetch">Load list</button>
          </div>
          <datalist id="c-models"></datalist>
          <p class="hint" id="c-models-hint">Type a model name, or load the list your provider offers.</p>
        </div>

        <details class="more">
          <summary>Extra headers</summary>
          <div class="form-grid">
            <div class="field">
              <label for="c-headers">Headers sent with every request</label>
              <textarea id="c-headers" class="mono" placeholder="HTTP-Referer: https://my-site.example&#10;X-Title: MoonPaper" spellcheck="false">${esc(conn.headers)}</textarea>
              <p class="hint">One <code>Name: value</code> per line, or a JSON object. Some proxies want a password header here.</p>
              <p class="error-text" id="c-headers-err" hidden></p>
            </div>
          </div>
        </details>

        <div class="save-bar">
          <span class="save-state" id="c-state" aria-live="polite"></span>
          <div class="actions">
            <button class="btn btn-primary" type="button" id="c-test">Test connection</button>
          </div>
        </div>
        <div id="c-result" aria-live="polite"></div>
      </form>`;
    wire();
  }

  function wire() {
    const form = $("#c-form", root);
    const read = () => {
      conn.name = $("#c-name", root).value.trim() || "Untitled";
      conn.mode = $('input[name="mode"]:checked', root)?.value ?? "relay";
      conn.baseUrl = $("#c-url", root).value.trim();
      conn.apiKey = $("#c-key", root).value.trim();
      conn.model = $("#c-model", root).value.trim();
      conn.headers = $("#c-headers", root).value;
      conn.accessCode = $("#c-code", root).value;
      const err = $("#c-headers-err", root);
      try { parseHeaders(conn.headers); err.hidden = true; }
      catch { err.hidden = false; err.textContent = "That JSON is not valid."; }
    };
    form.addEventListener("input", (e) => {
      read();
      if (e.target.name === "mode") {
        $("#own-key", root).hidden = conn.mode === "server";
        $("#access-field", root).hidden = !(conn.mode === "server" && server.needsCode);
      }
      if (e.target.id === "c-name") $(`#c-pick option[value="${conn.id}"]`, root).textContent = conn.name;
      $("#c-state", root).textContent = "Saving…";
      persist();
    });
    $("#c-url", root).addEventListener("blur", (e) => {
      const n = normalizeBaseUrl(e.target.value);
      if (n !== e.target.value) { e.target.value = n; read(); persist(); }
    });
    $("#c-provider", root).addEventListener("change", (e) => {
      const p = PROVIDERS.find((x) => x.id === e.target.value);
      conn.provider = p.id;
      if (p.baseUrl) $("#c-url", root).value = p.baseUrl;
      if (p.id === "ollama") $('input[value="direct"]', root).checked = true;
      if (conn.name === "New connection" || PROVIDERS.some((x) => x.name === conn.name)) $("#c-name", root).value = p.id === "custom" ? conn.name : p.name;
      form.dispatchEvent(new Event("input")); // reads the form and saves
    });
    $("#c-show", root).addEventListener("click", (e) => {
      const input = $("#c-key", root);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      e.currentTarget.setAttribute("aria-pressed", String(show));
      e.currentTarget.setAttribute("aria-label", show ? "Hide key" : "Show key");
      e.currentTarget.innerHTML = icon(show ? "eyeOff" : "eye");
    });
    $("#c-fetch", root).addEventListener("click", async (e) => {
      read();
      const btn = e.currentTarget;
      btn.disabled = true;
      $("#c-models-hint", root).textContent = "Loading models…";
      try {
        models = await listModels(conn);
        $("#c-models", root).innerHTML = models.map((m) => `<option value="${esc(m)}">`).join("");
        $("#c-models-hint", root).textContent = models.length
          ? `${models.length} models found. Start typing in the box to pick one.` : "The provider returned no models. Type the name yourself.";
        if (models.length) $("#c-model", root).focus();
      } catch (err) {
        $("#c-models-hint", root).textContent = `Could not load models: ${err.message}`;
      } finally { btn.disabled = false; }
    });
    $("#c-test", root).addEventListener("click", async (e) => {
      const btn = e.currentTarget; // read before any await; it's null afterwards
      read();
      await saveConnections(list);
      $("#c-state", root).textContent = "Saved";
      const out = $("#c-result", root);
      btn.disabled = true;
      out.innerHTML = `<p class="hint">Sending a short test message…</p>`;
      const t0 = performance.now();
      try {
        const res = await chatCompletion(conn, {
          messages: [{ role: "user", content: "Reply with exactly one word: ready" }],
          max_tokens: 20, stream: false,
        }, { retries: 0 }); // a test reports what happened, straight away
        const ms = Math.round(performance.now() - t0);
        out.innerHTML = `<div class="note">${icon("check")}<span><strong>It works.</strong> Replied in ${ms} ms: “${esc(res.content.trim().slice(0, 80) || "(empty)")}”</span></div>`;
        window.dispatchEvent(new CustomEvent("api-status", { detail: true }));
      } catch (err) {
        out.innerHTML = `<div class="note bad">${icon("info")}<span><strong>Test failed.</strong> ${esc(err.message)}</span></div>`;
        window.dispatchEvent(new CustomEvent("api-status", { detail: false }));
      } finally { btn.disabled = false; }
    });

    $("#c-pick", root).addEventListener("change", async (e) => {
      conn = list.find((c) => c.id === e.target.value);
      await saveSettings({ connectionId: conn.id });
      paint();
    });
    $("#c-new", root).addEventListener("click", () => add());
    $("#c-dup", root).addEventListener("click", () => add({ ...structuredClone(conn), id: crypto.randomUUID(), name: `${conn.name} (copy)` }));
    $("#c-del", root).addEventListener("click", async () => {
      const ok = await confirmDialog({ title: `Delete “${conn.name}”?`, body: "Its saved key is removed from this browser.", confirm: "Delete connection", danger: true });
      if (!ok) return;
      list = list.filter((c) => c.id !== conn.id);
      conn = list[0] ?? null;
      await saveConnections(list);
      await saveSettings({ connectionId: conn?.id ?? null });
      paint();
    });
  }

  async function add(partial) {
    const c = newConnection(partial);
    list.push(c);
    conn = c;
    await saveConnections(list);
    await saveSettings({ connectionId: c.id });
    paint();
    $("#c-name", root)?.select();
  }

  paint();
}
