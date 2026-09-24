import {
  bots, chats, lore, personas, getConnections, getLorebooks, saveLorebooks, newLorebook, seriesGroups,
  getMeta, setMeta, exportAll, markBackedUp,
} from "../store.js";
import { whatsNewCardHTML, showWhatsNew, APP_VERSION } from "../help.js";
import { importCardFile, importChubLink } from "../card.js";
import { $, $$, esc, icon, avatarHTML, toast, timeAgo, download, openDialog } from "../ui.js";
import { currentText } from "../prompt.js";

export async function render(main) {
  const [allBots, allChats, conns, persona] = await Promise.all([
    bots.all(), chats.all(), getConnections(), personas.active(),
  ]);
  const byId = new Map(allBots.map((b) => [b.id, b]));
  const recent = allChats.filter((c) => byId.has(c.botId) && c.messages.length > 1)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const tags = [...new Set(allBots.flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b));
  // Series: one per bot (the fandom or world), shown as its own filter and as
  // headings on the list. Only offered once some bot has one.
  const NONE = "\u0000none";
  const allGroups = seriesGroups(allBots);
  const hasSeries = allGroups.some((g) => g.key);
  const seriesKeyOf = (b) => (b.series ?? "").trim().toLowerCase();

  const steps = [
    { done: conns.length > 0, text: "Connect an API or proxy", href: "#/connection" },
    { done: !!persona?.name, text: "Choose who you are", href: "#/personas" },
    { done: allChats.length > 0, text: "Start a chat", href: allBots[0] ? `#/chat/${allBots[0].id}` : "#/bot/new" },
  ];
  const next = steps.find((s) => !s.done);

  // Chats live only in this browser. After a week without a backup (once
  // there is something worth keeping), the home page says so.
  const meta = await getMeta();
  const messageCount = allChats.reduce((n, c) => n + c.messages.length, 0);
  const week = 7 * 86400000;
  const needsBackup = messageCount >= 20 && Date.now() > (meta.backupSnoozeUntil ?? 0) &&
    (!meta.lastBackupAt || Date.now() - meta.lastBackupAt > week);
  const newsCard = await whatsNewCardHTML();

  main.innerHTML = `
    <div class="wrap page">
      <div class="page-head">
        <div>
          <h1>Your bots</h1>
          <p class="lead">Write characters, give them faces and a world, then talk to them through your own
            API key or proxy. Everything stays in this browser.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" id="import" aria-haspopup="dialog">Import</button>
          <a class="btn btn-primary" href="#/bot/new">New bot</a>
        </div>
      </div>

      ${needsBackup ? `
        <section class="notice-card warn" id="backup-card" aria-labelledby="backup-title">
          <span class="notice-icon" aria-hidden="true">${icon("shield")}</span>
          <div class="grow">
            <h2 class="card-title" id="backup-title">Back up your chats</h2>
            <p class="hint">${meta.lastBackupAt ? `Your last backup was ${timeAgo(meta.lastBackupAt)}.` : "You have not downloaded a backup yet."}
              Your ${messageCount.toLocaleString()} messages live only in this browser; clearing site data or losing this device would lose them.</p>
          </div>
          <div class="actions">
            <button class="btn btn-sm btn-primary" type="button" id="backup-now">Download backup</button>
            <button class="btn btn-sm btn-quiet" type="button" id="backup-later">Remind me in 3 days</button>
          </div>
        </section>` : ""}
      ${newsCard}
      ${next ? `
        <section class="card" aria-labelledby="setup-title">
          <h2 class="card-title" id="setup-title">Finish setting up</h2>
          <ol class="setup-steps">
            ${steps.map((s, i) => `<li class="${s.done ? "is-done" : ""}">
              <span class="step-mark" aria-hidden="true">${s.done ? icon("check") : i + 1}</span>
              <span class="grow">${esc(s.text)}</span>
              <span class="sr-only">${s.done ? "done" : "still to do"}</span>
              ${s === next ? `<a class="btn btn-sm btn-primary" href="${s.href}">Continue</a>` : ""}
            </li>`).join("")}
          </ol>
        </section>` : ""}

      ${recent.length ? `
        <section class="section" aria-labelledby="recent-title">
          <h2 class="sub" id="recent-title">Recent chats</h2>
          <ul class="list" id="recent-list">
            ${recent.map((c) => {
              const b = byId.get(c.botId);
              return `<li class="list-item">
                <a class="avatar-link" href="#/bot/${b.id}" aria-label="Edit ${esc(b.name)}" title="Edit ${esc(b.name)}">${avatarHTML(b.avatar, b.name, 40)}</a>
                <div class="grow">
                  <div class="title">${esc(b.name)}</div>
                  <div class="sub">${esc(currentText(c.messages.at(-1)).slice(0, 120))}</div>
                </div>
                <span class="sub">${timeAgo(c.updatedAt)}</span>
                <div class="actions">
                  <a class="btn btn-sm" href="#/chat/${b.id}/${c.id}">Open<span class="sr-only"> chat with ${esc(b.name)}</span></a>
                  <button class="icon-btn" type="button" data-del-chat="${c.id}" aria-label="Delete chat with ${esc(b.name)}: ${esc(c.title)}" title="Delete chat">${icon("trash")}</button>
                </div>
              </li>`;
            }).join("")}
          </ul>
        </section>` : ""}

      <section class="section" aria-labelledby="bots-title">
        <h2 class="sub" id="bots-title">All bots</h2>
        <div class="toolbar">
          <label class="search"><span class="sr-only">Search bots</span>
            <input type="search" id="q" placeholder="Search bots" autocomplete="off"></label>
          <label class="sr-only" for="sort">Sort bots</label>
          <select id="sort" class="w-auto">
            <option value="updatedAt">Recently edited</option>
            <option value="lastChatAt">Recently chatted</option>
            <option value="name">Name A to Z</option>
          </select>
        </div>
        ${hasSeries ? `<div class="chips series-filter" role="group" aria-label="Filter by series">
          <button type="button" class="chip" data-series="" aria-pressed="true">All <span class="n">${allBots.length}</span></button>
          ${allGroups.map((g) => `<button type="button" class="chip" data-series="${esc(g.key || NONE)}" aria-pressed="false">${esc(g.name || "No series")} <span class="n">${g.bots.length}</span></button>`).join("")}
        </div>` : ""}
        ${tags.length ? `<div class="chips tag-filter" role="group" aria-label="Filter by tag">
          ${tags.map((t) => `<button type="button" class="chip" aria-pressed="false" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
        </div>` : ""}
        <div class="bot-grid" id="grid"></div>
        <p class="sr-only" id="grid-status" aria-live="polite"></p>
      </section>
    </div>`;

  const grid = $("#grid", main);
  const q = $("#q", main);
  const sort = $("#sort", main);
  const activeTags = new Set();
  let activeSeries = "";
  try { activeSeries = localStorage.getItem("botSeries") ?? ""; } catch { /* private mode */ }
  if (activeSeries && !allGroups.some((g) => (g.key || NONE) === activeSeries)) activeSeries = "";
  const inSeries = (b) => !activeSeries || (activeSeries === NONE ? !seriesKeyOf(b) : seriesKeyOf(b) === activeSeries);

  function paint() {
    const term = q.value.trim().toLowerCase();
    // Tags from other series are hidden, and stop filtering while hidden.
    const shownTags = new Set(allBots.filter(inSeries).flatMap((b) => b.tags));
    $$("[data-tag]", main).forEach((btn) => {
      btn.hidden = !shownTags.has(btn.dataset.tag);
      if (btn.hidden && activeTags.delete(btn.dataset.tag)) btn.setAttribute("aria-pressed", "false");
    });
    $$("[data-series]", main).forEach((btn) => btn.setAttribute("aria-pressed", String((btn.dataset.series || "") === activeSeries)));
    const list = allBots.filter((b) => inSeries(b) &&
      (!term || [b.name, b.tagline, b.series ?? "", ...b.tags].join(" ").toLowerCase().includes(term)) &&
      [...activeTags].every((t) => b.tags.includes(t)));
    const key = sort.value;
    list.sort(key === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => (b[key] ?? 0) - (a[key] ?? 0));
    list.sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite)); // favourites first, order kept within each group

    if (!allBots.length) {
      grid.innerHTML = `<div class="empty span-all"><h2>No bots yet</h2>
        <p>Write your first bot, or import a character card in PNG or JSON form from another site.</p>
        <div class="actions"><a class="btn btn-primary" href="#/bot/new">New bot</a></div></div>`;
    } else if (!list.length) {
      grid.innerHTML = `<p class="hint span-all">No bots match. <button class="link-btn" type="button" id="clear">Clear filters</button></p>`;
      $("#clear", grid).addEventListener("click", () => {
        q.value = ""; activeTags.clear(); activeSeries = "";
        $$("[data-tag]", main).forEach((b) => b.setAttribute("aria-pressed", "false"));
        paint();
      });
    } else {
      // Showing every series: a heading over each one, so a large library scans by fandom.
      // Favourites keep their place at the front, as a section of their own.
      const favs = list.filter((b) => b.favorite);
      let groups = !activeSeries && hasSeries ? seriesGroups(list.filter((b) => !b.favorite)) : [{ key: "", name: "", bots: list }];
      if (!activeSeries && hasSeries && favs.length) groups = [{ key: "\u0000fav", name: "Favourites", bots: favs }, ...groups];
      groups = groups.filter((g) => g.bots.length);
      const heads = groups.length > 1;
      grid.innerHTML = groups.map((g) => (heads
        ? `<h3 class="series-head span-all">${esc(g.name || "No series")} <span class="n">${g.bots.length}</span></h3>` : "") + g.bots.map((b) => `
        <article class="bot-card${b.favorite ? " is-favorite" : ""}">
          <div class="portrait">${avatarHTML(b.avatar, b.name, 212, "portrait")}</div>
          <div class="bot-card-body">
            <h3 class="bot-card-name"><a href="#/chat/${b.id}">${esc(b.name || "Unnamed")}</a></h3>
            <p class="bot-card-tagline">${esc(b.tagline || b.description.slice(0, 120) || "No description yet.")}</p>
            <div class="bot-card-meta">
              <span class="when">${b.lastChatAt ? timeAgo(b.lastChatAt) : "Never chatted"}</span>
              <span class="bot-card-actions">
                <button class="icon-btn fav-btn${b.favorite ? " is-on" : ""}" type="button" data-fav="${b.id}" aria-pressed="${b.favorite ? "true" : "false"}"
                  aria-label="${b.favorite ? `Remove ${esc(b.name)} from favourites` : `Add ${esc(b.name)} to favourites`}" title="${b.favorite ? "Favourite" : "Add to favourites"}">${icon("star")}</button>
                <a class="icon-btn" href="#/bot/${b.id}" aria-label="Edit ${esc(b.name)}" title="Edit">${icon("edit")}</a>
              </span>
            </div>
          </div>
        </article>`).join("")).join("") +
        // Under series headings it would look like part of the last series; New bot is at the top anyway.
        (term || activeTags.size || activeSeries || heads ? "" : `<a class="new-card" href="#/bot/new">New bot</a>`);
    }
    $("#grid-status", main).textContent = `${list.length} of ${allBots.length} bots shown`;
  }

  // Recent chats: delete straight away, with Undo.
  $("#recent-list", main)?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del-chat]");
    if (!btn) return;
    const gone = allChats.find((c) => c.id === btn.dataset.delChat);
    if (!gone) return;
    const row = btn.closest("li");
    const next = row.nextElementSibling ?? row.previousElementSibling;
    await chats.remove(gone.id);
    row.remove();
    if (!$("#recent-list li", main)) $("#recent-list", main).closest("section").remove();
    else next?.querySelector("[data-del-chat]")?.focus();
    toast(`Deleted “${gone.title}” with ${byId.get(gone.botId)?.name ?? "a bot"}.`, "info", {
      action: "Undo", timeout: 8000,
      onAction: async () => { await chats.restore(gone); window.dispatchEvent(new HashChangeEvent("hashchange")); },
    });
  });

  grid.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-fav]");
    if (!btn) return;
    const b = allBots.find((x) => x.id === btn.dataset.fav);
    await bots.setFavorite(b, !b.favorite);
    paint();
    $(`[data-fav="${CSS.escape(b.id)}"]`, grid)?.focus();
    toast(b.favorite ? `${b.name} is a favourite. Favourites stay at the front.` : `${b.name} removed from favourites.`);
  });

  $("#backup-now", main)?.addEventListener("click", async (e) => {
    const card = e.currentTarget.closest("section");
    download(`moonpaper-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll({ includeKeys: false }));
    await markBackedUp();
    card.remove();
    toast("Backup downloaded. API keys were left out; keep the file somewhere safe.", "ok");
  });
  $("#backup-later", main)?.addEventListener("click", async (e) => {
    const card = e.currentTarget.closest("section");
    await setMeta({ backupSnoozeUntil: Date.now() + 3 * 86400000 });
    card.remove();
    toast("You will be reminded again in 3 days.");
  });
  $("#news-open", main)?.addEventListener("click", (e) => { e.currentTarget.closest("section").remove(); showWhatsNew(); });
  $("#news-close", main)?.addEventListener("click", async (e) => {
    e.currentTarget.closest("section").remove();
    await setMeta({ whatsNewSeen: APP_VERSION });
  });

  q.addEventListener("input", paint);
  sort.addEventListener("change", () => {
    try { localStorage.setItem("botSort", sort.value); } catch { /* private mode */ }
    paint();
  });
  try { sort.value = localStorage.getItem("botSort") || "updatedAt"; } catch { /* private mode */ }
  $$("[data-series]", main).forEach((btn) => btn.addEventListener("click", () => {
    activeSeries = btn.dataset.series;
    try { activeSeries ? localStorage.setItem("botSeries", activeSeries) : localStorage.removeItem("botSeries"); } catch { /* private mode */ }
    paint();
  }));
  $$("[data-tag]", main).forEach((btn) => btn.addEventListener("click", () => {
    const t = btn.dataset.tag;
    activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t);
    btn.setAttribute("aria-pressed", String(activeTags.has(t)));
    paint();
  }));

  // ---------- Import ----------
  // Saves one imported card: the bot, and its lorebook if it came with one.
  async function keep({ bot, lore: entries }) {
    // A card with no series joins one you already use when a tag names it,
    // e.g. a Chub card tagged "Honkai: Star Rail". The tag then goes.
    if (!bot.series) {
      const known = seriesGroups(await bots.all()).filter((g) => g.key);
      const match = known.find((g) => bot.tags.some((t) => t.trim().toLowerCase() === g.key));
      if (match) { bot.series = match.name; bot.tags = bot.tags.filter((t) => t.trim().toLowerCase() !== match.key); }
    }
    if (entries.length) {
      const books = await getLorebooks();
      const book = newLorebook({ name: `${bot.name} lore`, description: "Came with an imported character card." });
      books.push(book);
      await saveLorebooks(books);
      bot.lorebookIds = [book.id];
      for (const e of entries) await lore.save({ ...e, bookId: book.id });
    }
    await bots.save(bot);
    return bot;
  }
  const saved = (bot, entries) => `Imported ${bot.name}${entries.length ? ` with a lorebook of ${entries.length} entries` : ""}.`;

  // Several files at once: each one is tried, and every problem is reported.
  async function importFiles(files) {
    files = [...files];
    if (!files.length) return;
    const done = [];
    for (const file of files) {
      try {
        const result = await importCardFile(file);
        done.push({ bot: await keep(result), entries: result.lore });
      } catch (err) {
        toast(err.message, "error");
      }
    }
    if (done.length === 1) {
      toast(saved(done[0].bot, done[0].entries), "ok");
      location.hash = `#/bot/${done[0].bot.id}`;
    } else if (done.length > 1) {
      toast(`Imported ${done.length} bots: ${done.map((d) => d.bot.name).join(", ")}.`, "ok");
      window.dispatchEvent(new HashChangeEvent("hashchange")); // redraw the list
    }
  }

  const chooseFiles = () => new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".png,.json,application/json,image/png";
    input.onchange = () => resolve(input.files);
    input.click();
  });

  function openImport() {
    const dlg = openDialog(`
      <div class="dialog-body import-dialog">
        <h2>Import a bot</h2>
        <section class="import-way" aria-labelledby="imp-file-h">
          <h3 id="imp-file-h">From a card file</h3>
          <p class="hint">PNG or JSON character cards, from Chub, SillyTavern or any site that exports them. You can pick several.</p>
          <button type="button" class="drop-zone" id="imp-drop">
            ${icon("upload")}<span><strong>Choose card files</strong><span class="drop-hint"> or drop them here</span></span>
          </button>
        </section>
        <section class="import-way" aria-labelledby="imp-link-h">
          <h3 id="imp-link-h">From a Chub link</h3>
          <form class="inline-form" id="imp-link-form">
            <label for="imp-link" class="sr-only">Chub character link</label>
            <input type="url" id="imp-link" placeholder="chub.ai/characters/…" autocomplete="off" required>
            <button class="btn btn-primary" type="submit" id="imp-link-go">Import</button>
          </form>
          <p class="hint" id="imp-link-state" aria-live="polite">Paste the address of the character's page.</p>
        </section>
        <section class="import-way" aria-labelledby="imp-paste-h">
          <h3 id="imp-paste-h">Paste a definition</h3>
          <p class="hint">For sites with no card download. Paste the character text you can see, and the model sorts it
            into the right fields without rewriting it.</p>
          <a class="btn" href="#/bot/new?paste" id="imp-paste">Paste a definition</a>
        </section>
        <details class="more import-help">
          <summary>Where do I get bots?</summary>
          <ol class="steps-list">
            <li>Sites such as Chub share character cards openly. Open a character's page there.</li>
            <li>Use the page's download option and choose PNG or JSON: the card, not the plain picture.</li>
            <li>Import that file here, or paste the page's address above.</li>
          </ol>
          <p class="hint">Some sites have no card download. If the character's text is shown on its page, use Paste a
            definition. If its creator hid the definition, it cannot be imported; that choice is theirs to make.</p>
        </details>
        <form method="dialog" class="dialog-actions"><button class="btn btn-ghost">Close</button></form>
      </div>`);
    const drop = $("#imp-drop", dlg);
    drop.addEventListener("click", async () => { const files = await chooseFiles(); if (files?.length) { dlg.close(); importFiles(files); } });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); dlg.close(); importFiles(e.dataTransfer.files); });
    $("#imp-paste", dlg).addEventListener("click", () => dlg.close());
    $("#imp-link-form", dlg).addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#imp-link-go", dlg);
      const state = $("#imp-link-state", dlg);
      btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true");
      state.textContent = "Fetching the card from Chub…";
      state.classList.remove("error-text");
      try {
        const result = await importChubLink($("#imp-link", dlg).value);
        const bot = await keep(result);
        dlg.close();
        toast(saved(bot, result.lore), "ok");
        location.hash = `#/bot/${bot.id}`;
      } catch (err) {
        state.textContent = err.message;
        state.classList.add("error-text");
      } finally {
        btn.classList.remove("is-loading"); btn.removeAttribute("aria-busy");
      }
    });
  }
  $("#import", main).addEventListener("click", openImport);

  // Card files dropped anywhere on this page are imported too.
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let depth = 0;
  const overlay = document.createElement("div");
  overlay.className = "drop-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div>${icon("upload")}<p>Drop card files to import them</p></div>`;
  main.append(overlay);
  const onEnter = (e) => { if (!hasFiles(e) || document.querySelector("dialog[open]")) return; depth++; overlay.hidden = false; };
  const onLeave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; };
  const onOver = (e) => { if (hasFiles(e) && !overlay.hidden) e.preventDefault(); };
  const onDrop = (e) => {
    if (!hasFiles(e) || overlay.hidden) return;
    e.preventDefault(); depth = 0; overlay.hidden = true;
    importFiles(e.dataTransfer.files);
  };
  document.addEventListener("dragenter", onEnter);
  document.addEventListener("dragleave", onLeave);
  document.addEventListener("dragover", onOver);
  document.addEventListener("drop", onDrop);

  paint();
  return {
    cleanup() {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("drop", onDrop);
    },
  };
}
