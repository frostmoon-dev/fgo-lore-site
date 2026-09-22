import { lore, newLore, newLorebook, getLorebooks, saveLorebooks, bots, DEFAULT_BOOK_ID } from "../store.js";
import { estimateTokens, matchLore } from "../prompt.js";
import { renderMarkdown } from "../markdown.js";
import { $, $$, esc, icon, toast, confirmDialog, promptDialog, parseTags, autosize, download, pickFile, slug } from "../ui.js";

export async function render(main, [id]) {
  let entries = await lore.all();
  let books = await getLorebooks();
  let bookId = rememberedBook();
  let entry = id === "new" ? newLore({ bookId }) : entries.find((e) => e.id === id) ?? null;
  if (entry) bookId = entry.bookId ?? DEFAULT_BOOK_ID;

  function rememberedBook() {
    try { return localStorage.getItem("lorebook") || DEFAULT_BOOK_ID; } catch { return DEFAULT_BOOK_ID; }
  }
  const book = () => books.find((b) => b.id === bookId) ?? books[0];
  const rememberBook = () => { try { localStorage.setItem("lorebook", bookId); } catch { /* private mode */ } };
  let saved = entry ? JSON.stringify(entry) : "";
  const isNew = () => !entries.some((e) => e.id === entry?.id);

  main.innerHTML = `
    <div class="wrap page">
      <div class="page-head">
        <div>
          <h1>Lore</h1>
          <p class="lead">Short facts about your world, kept in lorebooks. An entry is added to the prompt only when one of
            its keywords shows up in recent messages, and only from the books a bot uses.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" id="import">Import</button>
          <button class="btn" type="button" id="export" ${entries.length ? "" : "disabled"}>Export</button>
          <a class="btn btn-primary" href="#/lore/new">New entry</a>
        </div>
      </div>
      <div class="card book-bar">
        <div class="form-row form-row-end">
          <div class="field">
            <label for="book-pick">Lorebook</label>
            <select id="book-pick"></select>
          </div>
          <div class="actions">
            <button class="btn btn-sm" type="button" id="book-new">New book</button>
            <button class="btn btn-sm" type="button" id="book-rename">Rename</button>
            <button class="btn btn-sm btn-danger" type="button" id="book-del">Delete</button>
          </div>
        </div>
        <label class="check"><input type="checkbox" id="book-global">
          <span>Use this book with every bot<small>Otherwise a bot only sees it when you tick it in the bot's Scene settings.</small></span></label>
        <p class="hint" id="book-used"></p>
      </div>

      <div class="lore-layout">
        <nav class="lore-nav card card-tight" aria-label="Lore entries">
          <label class="sr-only" for="lore-q">Filter entries</label>
          <input type="search" id="lore-q" placeholder="Filter entries" autocomplete="off">
          <div id="lore-list"></div>
        </nav>
        <div id="lore-main"></div>
      </div>
    </div>`;

  function inBook(e) {
    return (e.bookId ?? DEFAULT_BOOK_ID) === bookId;
  }

  function paintNav() {
    const q = $("#lore-q", main).value.trim().toLowerCase();
    const groups = {};
    entries.filter(inBook)
      .filter((e) => !q || [e.title, e.category, ...e.keywords].join(" ").toLowerCase().includes(q))
      .forEach((e) => (groups[e.category || "Other"] ??= []).push(e));
    const cats = Object.keys(groups).sort();
    $("#lore-list", main).innerHTML = cats.length ? cats.map((c) => `
      <h3>${esc(c)}</h3>
      <ul>${groups[c].map((e) => `<li><a href="#/lore/${e.id}" class="${e.enabled === false ? "off" : ""}" ${e.id === entry?.id ? 'aria-current="page"' : ""}>
        ${esc(e.title || "Untitled")}${e.constant ? ` <span class="chip" title="Always included">always</span>` : ""}</a></li>`).join("")}</ul>`).join("")
      : `<p class="hint">${entries.filter(inBook).length ? "Nothing matches." : "This book is empty."}</p>`;
  }

  async function paintBooks() {
    $("#book-pick", main).innerHTML = books
      .map((b) => `<option value="${esc(b.id)}" ${b.id === bookId ? "selected" : ""}>${esc(b.name)}${b.global ? " (all bots)" : ""}</option>`).join("");
    $("#book-global", main).checked = !!book()?.global;
    $("#book-del", main).disabled = books.length < 2;
    const count = entries.filter(inBook).length;
    const users = book()?.global ? [] : (await bots.all()).filter((b) => (b.lorebookIds ?? []).includes(bookId));
    const many = `${count} ${count === 1 ? "entry" : "entries"}`;
    $("#book-used", main).textContent = book()?.global
      ? `${many}, offered to every bot.`
      : `${many}. Used by ${users.length ? users.map((b) => b.name).join(", ") : "no bots yet"}.`;
  }
  $("#lore-q", main).addEventListener("input", paintNav);

  function paintMain() {
    const box = $("#lore-main", main);
    if (!entry) {
      box.innerHTML = entries.length
        ? `<div class="empty"><h2>Choose an entry</h2><p>Pick one from the list to read or edit it.</p></div>`
        : `<div class="empty"><h2>This book is empty</h2>
            <p>Add places, factions, people and rules. Keep each entry to a few lines a bot needs to act correctly.</p>
            <div class="actions"><a class="btn btn-primary" href="#/lore/new">New entry</a></div></div>`;
      return;
    }
    const cats = [...new Set(entries.map((e) => e.category))].sort();
    box.innerHTML = `
      <form class="card form-grid" id="lore-form" novalidate>
        <div class="field">
          <label for="l-title">Title</label>
          <input type="text" id="l-title" value="${esc(entry.title)}" required autocomplete="off">
        </div>
        <div class="form-row">
          <div class="field">
            <label for="l-book">Lorebook</label>
            <select id="l-book">${books.map((b) => `<option value="${esc(b.id)}" ${(entry.bookId ?? DEFAULT_BOOK_ID) === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label for="l-cat">Category</label>
            <input type="text" id="l-cat" value="${esc(entry.category)}" list="l-cats" autocomplete="off">
            <datalist id="l-cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
          </div>
        </div>
        <div class="field">
          <label for="l-keys">Keywords</label>
          <input type="text" id="l-keys" value="${esc(entry.keywords.join(", "))}" placeholder="chaldea, security organization" autocomplete="off" aria-describedby="l-keys-hint">
          <p class="hint" id="l-keys-hint">Comma separated. Whole words only, not case sensitive: <code>art</code> won't match “Artoria”.</p>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="l-pri">Priority</label>
            <input type="number" id="l-pri" value="${esc(entry.priority)}" step="1" inputmode="numeric">
            <p class="hint">Higher wins when more entries match than the limit allows.</p>
          </div>
          <div class="field">
            <span class="field-label">Behavior</span>
            <label class="check"><input type="checkbox" id="l-on" ${entry.enabled !== false ? "checked" : ""}><span>Enabled</span></label>
            <label class="check"><input type="checkbox" id="l-const" ${entry.constant ? "checked" : ""}><span>Always include<small>Ignores keywords. Use sparingly.</small></span></label>
          </div>
        </div>
        <div class="field">
          <label for="l-body">Content <span class="count" id="l-count"></span></label>
          <textarea id="l-body" class="tall">${esc(entry.content)}</textarea>
          <p class="hint">Two to six short lines. Markdown works. <code>{{char}}</code> and <code>{{user}}</code> are filled in.</p>
        </div>
        <details class="more">
          <summary>Test keywords</summary>
          <div class="form-grid">
            <div class="field"><label for="l-test">Sample message</label>
              <input type="text" id="l-test" placeholder="Type a line to see if this entry would trigger" autocomplete="off"></div>
            <p class="hint" id="l-test-out" aria-live="polite"></p>
          </div>
        </details>
        <details class="more">
          <summary>Preview</summary>
          <div class="prose" id="l-preview"></div>
        </details>
        <div class="save-bar">
          <span class="save-state" id="l-state" aria-live="polite"></span>
          <div class="actions">
            ${isNew() ? "" : `<button class="btn btn-danger" type="button" id="l-del">Delete</button>`}
            <button class="btn btn-primary" type="submit">Save entry</button>
          </div>
        </div>
      </form>`;

    const form = $("#lore-form", box);
    autosize($("#l-body", box));
    const collect = () => {
      entry.title = $("#l-title", box).value.trim();
      entry.category = $("#l-cat", box).value.trim() || "Other";
      entry.bookId = $("#l-book", box).value;
      entry.keywords = parseTags($("#l-keys", box).value);
      entry.priority = Number($("#l-pri", box).value) || 0;
      entry.enabled = $("#l-on", box).checked;
      entry.constant = $("#l-const", box).checked;
      entry.content = $("#l-body", box).value;
    };
    const update = () => {
      collect();
      $("#l-count", box).textContent = `~${estimateTokens(entry.content)} tokens`;
      $("#l-preview", box).innerHTML = renderMarkdown(entry.content, { quotes: false }) || "<p class='hint'>Nothing written yet.</p>";
      const dirty = isDirty();
      $("#l-state", box).classList.toggle("dirty", dirty);
      $("#l-state", box).textContent = dirty ? "Unsaved changes" : "Saved";
      const test = $("#l-test", box).value;
      $("#l-test-out", box).textContent = !test ? "" : matchLore([{ ...entry, constant: false, enabled: true }], test, 1).length
        ? "✓ This entry would be added." : "✗ No keyword matched.";
    };
    form.addEventListener("input", update);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      collect();
      if (!entry.title) { $("#l-title", box).setAttribute("aria-invalid", "true"); $("#l-title", box).focus(); toast("Give the entry a title.", "error"); return; }
      if (!entry.keywords.length && !entry.constant) toast("No keywords, so this entry will never be added. Add some or tick Always include.");
      const wasNew = isNew();
      await lore.save(entry);
      saved = JSON.stringify(entry);
      entries = await lore.all();
      if (entry.bookId !== bookId) { bookId = entry.bookId; rememberBook(); }
      toast(`${entry.title} saved.`, "ok");
      if (wasNew) location.hash = `#/lore/${entry.id}`;
      else { paintNav(); paintBooks(); update(); }
    });
    $("#l-del", box)?.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: `Delete “${entry.title}”?`, confirm: "Delete entry", danger: true });
      if (!ok) return;
      await lore.remove(entry.id);
      saved = JSON.stringify(entry);
      entry = null;
      location.hash = "#/lore";
    });
    update();
    if (isNew()) $("#l-title", box).focus();
  }

  const isDirty = () => {
    if (!entry || !$("#lore-form", main)) return false;
    return JSON.stringify(entry) !== saved;
  };

  $("#export", main).addEventListener("click", () => download(`${slug(book()?.name ?? "lorebook")}.json`, {
    format: "shirus-garden-lorebook",
    name: book()?.name ?? "Lorebook",
    entries: entries.filter(inBook).map(({ id, builtin, bookId: _b, ...rest }) => rest),
  }));
  $("#import", main).addEventListener("click", async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      // Our own export, a plain array, or a SillyTavern-style world/character book.
      let rows = data.entries ?? data;
      if (!Array.isArray(rows)) rows = Object.values(rows ?? {});
      const made = rows.map((r) => newLore({
        bookId,
        title: r.title ?? r.name ?? r.comment ?? "Imported entry",
        category: r.category ?? "Imported",
        keywords: (r.keywords ?? r.keys ?? r.key ?? []).map(String),
        priority: Number(r.priority ?? r.order ?? r.insertion_order ?? 0),
        content: r.content ?? "",
        enabled: r.enabled ?? !r.disable,
        constant: !!r.constant,
      })).filter((e) => e.content.trim());
      if (!made.length) throw new Error("No lore entries found in that file.");
      for (const e of made) await lore.save(e);
      entries = await lore.all();
      paintNav();
      paintBooks();
      toast(`Imported ${made.length} entries into ${book()?.name}.`, "ok");
    } catch (err) {
      toast(err.message.startsWith("No lore") ? err.message : "That file is not a lorebook this site can read.", "error");
    }
  });

  $("#book-pick", main).addEventListener("change", (e) => {
    bookId = e.target.value;
    rememberBook();
    entry = null;
    paintBooks();
    paintNav();
    paintMain();
  });
  $("#book-global", main).addEventListener("change", async (e) => {
    book().global = e.target.checked;
    await saveLorebooks(books);
    paintBooks();
    paintNav();
  });
  $("#book-new", main).addEventListener("click", async () => {
    const name = await promptDialog({ title: "New lorebook", label: "Name", confirm: "Create" });
    if (!name) return;
    const bk = newLorebook({ name });
    books.push(bk);
    await saveLorebooks(books);
    bookId = bk.id;
    rememberBook();
    entry = null;
    paintBooks(); paintNav(); paintMain();
  });
  $("#book-rename", main).addEventListener("click", async () => {
    const name = await promptDialog({ title: "Rename lorebook", label: "Name", value: book().name });
    if (!name) return;
    book().name = name;
    await saveLorebooks(books);
    paintBooks(); paintMain();
  });
  $("#book-del", main).addEventListener("click", async () => {
    if (books.length < 2) return;
    const count = entries.filter(inBook).length;
    const ok = await confirmDialog({
      title: `Delete "${book().name}"?`,
      body: count ? `Its ${count} entries are deleted too. This cannot be undone.` : "The book is empty.",
      confirm: "Delete book", danger: true,
    });
    if (!ok) return;
    for (const e of entries.filter(inBook)) await lore.remove(e.id);
    books = books.filter((b) => b.id !== bookId);
    await saveLorebooks(books);
    // Bots linking to it forget it.
    for (const bot of await bots.all()) {
      if ((bot.lorebookIds ?? []).includes(bookId)) {
        await bots.save({ ...bot, lorebookIds: bot.lorebookIds.filter((x) => x !== bookId) });
      }
    }
    entries = await lore.all();
    bookId = books[0].id;
    rememberBook();
    entry = null;
    paintBooks(); paintNav(); paintMain();
  });

  paintBooks();
  paintNav();
  paintMain();
  return { isDirty };
}
