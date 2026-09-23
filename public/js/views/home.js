import { bots, chats, lore, personas, getConnections, getLorebooks, saveLorebooks, newLorebook } from "../store.js";
import { importCardFile } from "../card.js";
import { $, $$, esc, icon, avatarHTML, toast, pickFile, timeAgo } from "../ui.js";
import { currentText } from "../prompt.js";

export async function render(main) {
  const [allBots, allChats, conns, persona] = await Promise.all([
    bots.all(), chats.all(), getConnections(), personas.active(),
  ]);
  const byId = new Map(allBots.map((b) => [b.id, b]));
  const recent = allChats.filter((c) => byId.has(c.botId) && c.messages.length > 1)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const tags = [...new Set(allBots.flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b));

  const steps = [
    { done: conns.length > 0, text: "Connect an API or proxy", href: "#/connection" },
    { done: !!persona?.name, text: "Choose who you are", href: "#/personas" },
    { done: allChats.length > 0, text: "Start a chat", href: allBots[0] ? `#/chat/${allBots[0].id}` : "#/bot/new" },
  ];
  const next = steps.find((s) => !s.done);

  main.innerHTML = `
    <div class="wrap page">
      <div class="page-head">
        <div>
          <h1>Your bots</h1>
          <p class="lead">Write characters, give them faces and a world, then talk to them through your own
            API key or proxy. Everything stays in this browser.</p>
        </div>
        <div class="actions">
          <button class="btn" type="button" id="import">Import card</button>
          <a class="btn btn-primary" href="#/bot/new">New bot</a>
        </div>
      </div>

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
          <ul class="list">
            ${recent.map((c) => {
              const b = byId.get(c.botId);
              return `<li class="list-item">
                <a class="avatar-link" href="#/bot/${b.id}" aria-label="Edit ${esc(b.name)}" title="Edit ${esc(b.name)}">${avatarHTML(b.avatar, b.name, 40)}</a>
                <div class="grow">
                  <div class="title">${esc(b.name)}</div>
                  <div class="sub">${esc(currentText(c.messages.at(-1)).slice(0, 120))}</div>
                </div>
                <span class="sub">${timeAgo(c.updatedAt)}</span>
                <a class="btn btn-sm" href="#/chat/${b.id}/${c.id}">Open<span class="sr-only"> chat with ${esc(b.name)}</span></a>
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

  function paint() {
    const term = q.value.trim().toLowerCase();
    const list = allBots.filter((b) =>
      (!term || [b.name, b.tagline, ...b.tags].join(" ").toLowerCase().includes(term)) &&
      [...activeTags].every((t) => b.tags.includes(t)));
    const key = sort.value;
    list.sort(key === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => (b[key] ?? 0) - (a[key] ?? 0));

    if (!allBots.length) {
      grid.innerHTML = `<div class="empty span-all"><h2>No bots yet</h2>
        <p>Write your first bot, or import a character card in PNG or JSON form from another site.</p>
        <div class="actions"><a class="btn btn-primary" href="#/bot/new">New bot</a></div></div>`;
    } else if (!list.length) {
      grid.innerHTML = `<p class="hint span-all">No bots match. <button class="link-btn" type="button" id="clear">Clear filters</button></p>`;
      $("#clear", grid).addEventListener("click", () => {
        q.value = ""; activeTags.clear();
        $$("[data-tag]", main).forEach((b) => b.setAttribute("aria-pressed", "false"));
        paint();
      });
    } else {
      grid.innerHTML = list.map((b) => `
        <article class="bot-card">
          <div class="portrait">${avatarHTML(b.avatar, b.name, 212, "portrait")}</div>
          <div class="bot-card-body">
            <h3 class="bot-card-name"><a href="#/chat/${b.id}">${esc(b.name || "Unnamed")}</a></h3>
            <p class="bot-card-tagline">${esc(b.tagline || b.description.slice(0, 120) || "No description yet.")}</p>
            <div class="bot-card-meta">
              <span class="when">${b.lastChatAt ? timeAgo(b.lastChatAt) : "Never chatted"}</span>
              <span class="bot-card-actions">
                <a class="icon-btn" href="#/bot/${b.id}" aria-label="Edit ${esc(b.name)}" title="Edit">${icon("edit")}</a>
              </span>
            </div>
          </div>
        </article>`).join("") + (term || activeTags.size ? "" : `<a class="new-card" href="#/bot/new">New bot</a>`);
    }
    $("#grid-status", main).textContent = `${list.length} of ${allBots.length} bots shown`;
  }

  q.addEventListener("input", paint);
  sort.addEventListener("change", () => {
    try { localStorage.setItem("botSort", sort.value); } catch { /* private mode */ }
    paint();
  });
  try { sort.value = localStorage.getItem("botSort") || "updatedAt"; } catch { /* private mode */ }
  $$("[data-tag]", main).forEach((btn) => btn.addEventListener("click", () => {
    const t = btn.dataset.tag;
    activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t);
    btn.setAttribute("aria-pressed", String(activeTags.has(t)));
    paint();
  }));

  $("#import", main).addEventListener("click", async () => {
    const file = await pickFile(".png,.json,application/json,image/png");
    if (!file) return;
    try {
      const { bot, lore: entries } = await importCardFile(file);
      if (entries.length) {
        const books = await getLorebooks();
        const book = newLorebook({ name: `${bot.name} lore`, description: "Came with an imported character card." });
        books.push(book);
        await saveLorebooks(books);
        bot.lorebookIds = [book.id];
        for (const e of entries) await lore.save({ ...e, bookId: book.id });
      }
      await bots.save(bot);
      toast(`Imported ${bot.name}${entries.length ? ` with a lorebook of ${entries.length} entries` : ""}.`, "ok");
      location.hash = `#/bot/${bot.id}`;
    } catch (err) {
      toast(err.message, "error");
    }
  });

  paint();
}
