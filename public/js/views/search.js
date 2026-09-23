import { bots, chats, personas } from "../store.js";
import { currentText, stripBond, applyMacros } from "../prompt.js";
import { $, esc, avatarHTML, debounce, timeAgo } from "../ui.js";

const MAX_RESULTS = 60;

// Finds text across every chat on this browser. Opening a result jumps to
// the message and highlights it.
export async function render(main, [query = ""]) {
  const [allBots, allChats, allPersonas] = await Promise.all([bots.all(), chats.all(), personas.all()]);
  const botById = new Map(allBots.map((b) => [b.id, b]));
  const personaName = (c) => allPersonas.find((p) => p.id === c.personaId)?.name || "You";
  const initial = query; // the router has already decoded it

  main.innerHTML = `
    <div class="wrap page">
      <h1>Search chats</h1>
      <p class="lead">Every message in every chat on this browser. Open a result to jump straight to it.</p>
      <label class="search search-page"><span class="sr-only">Search all chats</span>
        <input type="search" id="q" value="${esc(initial)}" placeholder="A name, a place, a line you remember" autocomplete="off"></label>
      <p class="hint" id="count" aria-live="polite"></p>
      <ul class="list" id="results"></ul>
    </div>`;

  const q = $("#q", main);
  const results = $("#results", main);

  function snippet(text, at, len) {
    const from = Math.max(0, at - 60);
    const to = Math.min(text.length, at + len + 90);
    return `${from > 0 ? "…" : ""}${esc(text.slice(from, at))}<mark>${esc(text.slice(at, at + len))}</mark>${esc(text.slice(at + len, to))}${to < text.length ? "…" : ""}`;
  }

  function paint() {
    const term = q.value.trim();
    history.replaceState(history.state, "", term ? `#/search?q=${encodeURIComponent(term)}` : "#/search");
    if (term.length < 2) {
      results.innerHTML = "";
      $("#count", main).textContent = term ? "Type at least two letters." : "";
      return;
    }
    const lower = term.toLowerCase();
    const hits = [];
    for (const c of [...allChats].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const host = botById.get(c.botId);
      if (!host) continue;
      for (const m of c.messages) {
        const speaker = m.role === "user" ? null : botById.get(m.botId ?? c.botId) ?? host;
        const text = applyMacros(stripBond(currentText(m)), { char: speaker?.name ?? host.name, user: personaName(c) }).replace(/\s+/g, " ");
        const at = text.toLowerCase().indexOf(lower);
        if (at === -1) continue;
        hits.push({ c, m, host, speaker, text, at });
        if (hits.length >= MAX_RESULTS) break;
      }
      if (hits.length >= MAX_RESULTS) break;
    }
    $("#count", main).textContent = hits.length
      ? `${hits.length}${hits.length >= MAX_RESULTS ? "+" : ""} message${hits.length === 1 ? "" : "s"} found`
      : "Nothing found. Try another word.";
    results.innerHTML = hits.map(({ c, m, host, speaker, text, at }) => `
      <li class="list-item search-hit">
        ${avatarHTML(speaker ? speaker.avatar : null, speaker ? speaker.name : personaName(c), 36)}
        <div class="grow">
          <div class="title">${esc(speaker ? speaker.name : personaName(c))}
            <span class="sub-inline">in ${esc(c.title)} with ${esc(host.name)} · ${timeAgo(m.at)}</span></div>
          <p class="hit-text">${snippet(text, at, term.length)}</p>
        </div>
        <a class="btn btn-sm" href="#/chat/${host.id}/${c.id}?m=${m.id}">Open<span class="sr-only"> this message</span></a>
      </li>`).join("");
  }

  q.addEventListener("input", debounce(paint, 200));
  paint();
  q.focus();
}
