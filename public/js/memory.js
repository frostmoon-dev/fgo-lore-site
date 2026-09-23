// Long-chat memory in layers, so a bot remembers a long story without
// sending all of it every time:
//
//   Recent      every message after the last chapter, word for word
//   Chapters    a short summary per stretch of chat; the latest few are sent
//   Story       older chapters folded into one running summary
//   Facts       lasting facts kept apart, so summaries cannot blur them
//   Recall      old moments found by keyword when the chat touches them again
//
// Chapters only cover messages older than the newest KEEP_RECENT, and the
// recent part starts where the last chapter ends. That start moves once per
// chapter, not once per message, so the front of each request stays the same
// for many turns and providers that cache repeated prompts can reuse it.

export const KEEP_RECENT = 12;   // messages always sent in full
export const KEEP_CHAPTERS = 4;  // chapters sent as they are; older ones are folded
const FOLD_AFTER = 2;            // extra chapters to collect before folding again
const AUTO_CHAPTERS_PER_RUN = 2; // a long chat catches up over a few turns

// Chapters that still match the chat (a rewind can delete what they covered).
export const liveChapters = (chat) => (chat.chapters ?? []).filter((c) => c.to <= chat.messages.length);

// Everything before this index is covered by chapters or the story.
export function coveredUpTo(chat) {
  const last = liveChapters(chat).at(-1);
  return Math.min(chat.messages.length, last?.to ?? chat.memory?.upTo ?? 0);
}

// Where the word-for-word part begins. Never fewer than KEEP_RECENT messages,
// even for chats summarised under the old single-summary memory.
export function windowStart(chat, length = chat.messages.length) {
  return Math.max(0, Math.min(coveredUpTo(chat), length - KEEP_RECENT));
}

// The ranges ready to become chapters: blocks of `every` messages that are
// all older than the recent part. `all` also takes a short last block
// (for Update now).
export function pendingChapters(chat, every, { all = false, max = Infinity } = {}) {
  const out = [];
  let from = coveredUpTo(chat);
  const limit = all ? chat.messages.length : chat.messages.length - KEEP_RECENT;
  while (out.length < max && limit - from >= (all ? 2 : every)) {
    const to = Math.min(limit, from + every);
    out.push({ from, to });
    from = to;
  }
  return out;
}
export const autoChapters = (chat, every) => pendingChapters(chat, every, { max: AUTO_CHAPTERS_PER_RUN });

// Chapters beyond the newest KEEP_CHAPTERS get folded into the story once a
// few have piled up, so folding (which rewrites the story) stays rare.
export function chaptersToFold(chat) {
  const live = liveChapters(chat);
  const folded = Math.min(chat.memory?.folded ?? 0, live.length);
  const open = live.length - folded;
  return open > KEEP_CHAPTERS + FOLD_AFTER ? live.slice(folded, live.length - KEEP_CHAPTERS) : [];
}

// What the prompt gets: story, facts, the chapters not yet folded, and where
// the recent part starts.
export function memoryContext(chat) {
  const live = liveChapters(chat);
  const folded = Math.min(chat.memory?.folded ?? 0, live.length);
  return {
    story: chat.memory?.text ?? "",
    facts: chat.memory?.facts ?? "",
    chapters: live.slice(folded).map((c) => c.text),
    windowStart: windowStart(chat),
  };
}

// ---------- Recall ----------
// Plain keyword search, like the lorebook: no extra request and no special
// API. Scores each old message and folded chapter by the rarer words it
// shares with the last two messages; names count double.

const STOP = new Set(("about above after again against also always among another anything around because been before being " +
  "below between both came come could does doing done down during each even ever every from have having here hers herself " +
  "himself into itself just know like made make many maybe more most much must myself need never next only other ours over " +
  "really said same says seem should since some something still such take than that their theirs them then there these they " +
  "thing think this those though through time very want well were what when where which while will with without would your " +
  "yours yourself back look looks looked eyes voice turns turned smile smiles hand hands head face little tell told sure okay " +
  "yeah right away going gonna feel felt last first long once").split(" "));

function terms(text) {
  const out = new Map();
  for (const m of String(text).matchAll(/\b([A-Za-z][A-Za-z'-]{3,})\b/g)) {
    const word = m[1].toLowerCase().replace(/'s$/, "");
    if (STOP.has(word)) continue;
    // A capitalised word mid-sentence is probably a name or place.
    const name = /^[A-Z]/.test(m[1]) && m.index > 0 && !/[.!?"“]\s*$/.test(text.slice(Math.max(0, m.index - 3), m.index));
    out.set(word, Math.max(out.get(word) ?? 1, name ? 2 : 1));
  }
  return out;
}

// docs: [{ label, text }]. Returns up to `limit` of them, best first.
export function recall(docs, query, { limit = 2, clipTo = 420 } = {}) {
  const q = terms(query);
  if (!q.size || !docs.length) return [];
  const docTerms = docs.map((d) => terms(d.text));
  const df = new Map();
  for (const t of docTerms) for (const w of t.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return docs
    .map((d, i) => {
      let score = 0; let hits = 0; let named = false;
      for (const [w, weight] of q) {
        if (!docTerms[i].has(w)) continue;
        hits++;
        score += Math.log(1 + n / df.get(w)) * weight;
        if (weight > 1 || docTerms[i].get(w) > 1) named = true;
      }
      return { d, score, hits, named };
    })
    // One shared name is enough; otherwise two ordinary words.
    .filter((x) => x.hits >= 2 || (x.named && x.hits >= 1))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({ label: d.label, text: d.text.length > clipTo ? `${d.text.slice(0, clipTo)}…` : d.text }));
}

// Old material the prompt no longer carries: folded chapters, and messages
// before the recent part that are not pinned (pinned ones are always sent).
export function recallDocs(chat, { nameOf, textOf, start = windowStart(chat) }) {
  const live = liveChapters(chat);
  const folded = live.slice(0, Math.min(chat.memory?.folded ?? 0, live.length));
  return [
    ...folded.map((c) => ({ label: `Earlier chapter (messages ${c.from + 1}–${c.to})`, text: c.text })),
    ...chat.messages.slice(0, start)
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !m.pinned && (m.role === "user" || m.role === "assistant") && textOf(m).trim())
      .map(({ m, i }) => ({ label: `Message ${i + 1}, ${nameOf(m)}`, text: textOf(m).replace(/\s+/g, " ").trim() })),
  ];
}

// ---------- Chapter replies ----------
// The model answers with a CHAPTER section and a FACTS section.
export function parseChapter(text) {
  const s = String(text ?? "");
  const chapter = /CHAPTER:\s*([\s\S]*?)(?:\n\s*FACTS:|$)/i.exec(s)?.[1]?.trim() ?? "";
  const facts = /FACTS:\s*([\s\S]*)$/i.exec(s)?.[1]?.trim() ?? "";
  return { chapter: chapter || (/FACTS:/i.test(s) ? "" : s.trim()), facts };
}

// Tokens the provider reused from its cache, when it says so.
export const cachedTokens = (usage) =>
  usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? usage?.cache_read_input_tokens ?? 0;

// Memory for a chat cut back to its first `upTo` messages (rewind, branch).
// Chapters past the cut go; facts go back to how they stood after the last
// chapter that stays; a story that folded in removed chapters is cleared so
// the next update rebuilds it from the chapters that remain.
export function trimMemory(chat, upTo) {
  const all = chat.chapters ?? [];
  const live = all.filter((c) => c.to <= upTo);
  const mem = chat.memory ? { ...chat.memory } : null;
  const changed = live.length !== all.length || (mem?.upTo ?? 0) > upTo;
  if (!mem || !changed) return { chapters: live, memory: mem, changed };
  const folded = Math.min(mem.folded ?? 0, all.length);
  if (folded > live.length) { mem.text = ""; mem.folded = 0; }
  if ((mem.upTo ?? 0) > upTo) { mem.text = ""; mem.upTo = 0; mem.folded = 0; }
  mem.facts = live.at(-1)?.factsAfter ?? (live.length ? mem.facts ?? "" : "");
  return { chapters: live, memory: mem, changed };
}
