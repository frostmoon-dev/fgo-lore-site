// A bot's scrapbook: everything kept from your time together, on one page.
// Nothing new is stored here; it gathers what chats already hold (pinned
// moments, liked replies, journal entries, chapters, hidden thoughts, the
// bond) across every chat with the bot.
import { bots, chats, personas, getSettings, bondLevels, bondPoints } from "../store.js";
import { currentText, stripBond, applyMacros } from "../prompt.js";
import { liveChapters } from "../memory.js";
import { previewHTML, renderMarkdown } from "../markdown.js";
import { bondChartHTML, wireBondChart } from "../chart.js";
import { $, esc, avatarHTML, timeAgo } from "../ui.js";

const DAY = 86400000;

export async function render(main, [id]) {
  const bot = await bots.get(id);
  if (!bot) {
    main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Not found</h2>
      <p>That bot may have been deleted.</p><div class="actions"><a class="btn btn-primary" href="#/">Back to bots</a></div></div></div>`;
    return;
  }
  const [list, settings, persona] = await Promise.all([chats.forBot(bot.id), getSettings(), personas.active()]);
  const names = { char: bot.name, user: persona?.name || "you" };
  const fill = (t) => applyMacros(t, names);
  const when = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const jump = (c, m) => `#/chat/${bot.id}/${c.id}?m=${m.id}`;

  // ---- Gather ----
  const messages = list.reduce((n, c) => n + c.messages.length, 0);
  const first = Math.min(...list.map((c) => c.createdAt ?? c.messages[0]?.at ?? Date.now()), Date.now());
  const days = Math.max(1, Math.round((Date.now() - first) / DAY));
  const pinned = list.flatMap((c) => c.messages.filter((m) => m.pinned).map((m) => ({ c, m, at: m.at ?? 0 })));
  const thoughts = list.flatMap((c) => c.messages
    .filter((m) => m.role === "assistant" && (m.botId ?? bot.id) === bot.id && m.meta?.[m.swipeIndex ?? 0]?.thought)
    .map((m) => ({ c, m, text: m.meta[m.swipeIndex ?? 0].thought, at: m.at ?? 0 })));
  const journal = list.flatMap((c) => (c.journal ?? []).map((e) => ({ c, ...e })));
  const chapters = list.flatMap((c) => liveChapters(c).map((ch, i) => ({ c, n: i + 1, text: ch.text, at: c.messages[Math.max(0, ch.to - 1)]?.at ?? 0 })));
  // A liked reply's key is "<message id>:<version>".
  const liked = (bot.liked ?? []).map((e) => {
    const c = list.find((x) => x.id === e.chatId);
    const m = c?.messages.find((x) => x.id === String(e.key ?? "").split(":")[0]);
    return { ...e, c, m };
  });
  const newest = (a, b) => b.at - a.at;
  // The bond, from the chat where it moved most recently.
  const bondOn = settings.bond?.enabled !== false && bot.bondEnabled !== false;
  const bondChat = bondOn ? list.find((c) => bondPoints(c, bot, Number(settings.bond?.start ?? 20)).length > 2) : null;
  const points = bondChat ? bondPoints(bondChat, bot, Number(settings.bond?.start ?? 20)) : [];

  const section = (key, title, count, body, empty, { counted = true } = {}) => `
    <section class="card scrap-section" id="scrap-${key}" aria-labelledby="scrap-${key}-h">
      <h2 class="card-title" id="scrap-${key}-h">${title}${count && counted ? ` <span class="n">${count}</span>` : ""}</h2>
      ${count ? body : `<p class="hint">${empty}</p>`}
    </section>`;
  const item = ({ c, m, text, at, label, full = false }) => `
    <li class="scrap-item">
      ${full ? `<div class="scrap-text">${renderMarkdown(fill(text), { quotes: true })}</div>` : `<p class="scrap-text">${previewHTML(fill(text), 320, { quotes: true })}</p>`}
      <p class="scrap-meta">${label ? `${esc(label)} · ` : ""}${c ? `${esc(c.title ?? "A chat")} · ` : ""}${at ? when(at) : ""}
        ${c && m ? ` · <a href="${jump(c, m)}">Open in the chat</a>` : ""}</p>
    </li>`;

  main.innerHTML = `
    <div class="wrap page scrapbook">
      <div class="page-head">
        <div class="scrap-head">
          ${avatarHTML(bot.avatar, bot.name, 96)}
          <div>
            <h1>${esc(bot.name)}'s scrapbook</h1>
            <p class="lead">${list.length
              ? `${list.length} chat${list.length === 1 ? "" : "s"} · ${messages.toLocaleString()} messages · together since ${when(first)} (${days} day${days === 1 ? "" : "s"})`
              : "Nothing kept yet. Moments you pin or like, journal entries and chapters gather here."}</p>
          </div>
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="#/chat/${bot.id}">Chat</a>
          <a class="btn" href="#/bot/${bot.id}">Edit bot</a>
        </div>
      </div>
      <div class="scrap-grid">
        ${bondOn ? section("bond", "The bond", points.length ? 1 : 0,
          `<p class="hint">In ${esc(bondChat?.title ?? "your latest chat")}.</p>
           <div data-chart>${bondChartHTML({ id: `scrap-${bot.id}`, name: bot.name, points, levels: bondLevels(bot) })}</div>`,
          "The chart fills in as the bond moves in a chat.", { counted: false }) : ""}
        ${section("pinned", "Pinned moments", pinned.length,
          `<ul class="scrap-list">${pinned.sort(newest).map((p) => item({ ...p, text: stripBond(currentText(p.m)), label: p.m.role === "user" ? "You" : bot.name })).join("")}</ul>`,
          "Pin a message in a chat (the pin under it) to keep it here, and always remembered by the bot.")}
        ${section("liked", "Liked replies", liked.length,
          `<ul class="scrap-list">${[...liked].sort(newest).map((l) => item({ c: l.c, m: l.m, text: l.text, at: l.at })).join("")}</ul>`,
          "Tap the heart under a reply you love. Liked replies also teach the bot the style you want.")}
        ${section("thoughts", "Things left unsaid", thoughts.length,
          `<ul class="scrap-list">${thoughts.sort(newest).map((t) => item({ ...t })).join("")}</ul>`,
          bot.thoughts ? "Hidden thoughts the bot adds after its replies gather here." : "Turn on Hidden thoughts in the bot's editor, and the private thoughts it adds gather here.")}
        ${section("journal", `${esc(bot.name)}'s journal`, journal.length,
          `<ul class="scrap-list">${journal.sort(newest).map((e) => `
            <li class="journal-entry"><header><span>${esc(e.c.title ?? "A chat")}</span><time>${when(e.at)}</time></header>
              <div class="prose">${renderMarkdown(fill(e.text), { quotes: true })}</div></li>`).join("")}</ul>`,
          "After a good stretch of chat, the bot writes a short diary entry when you leave. They gather here.")}
        ${section("chapters", "Chapters", chapters.length,
          `<ul class="scrap-list">${chapters.sort(newest).map((ch) => item({ c: ch.c, text: ch.text, at: ch.at, label: `Chapter ${ch.n}`, full: true })).join("")}</ul>`,
          "Long chats are summed up in chapters by memory. They gather here.")}
      </div>
    </div>`;
  if (points.length) wireBondChart($("[data-chart]", main), points);
  document.title = `${bot.name}'s scrapbook · MoonPaper`;
}
