// Turns a bot, persona, prompt preset, lore and chat history into the
// messages array sent to the API.
import { DEFAULT_IMPERSONATE_PROMPT, moodsOf } from "./store.js";

// ---------- Mature content ----------
// The site level applies unless the bot is set to stay safe for work.
export function contentLevel(settings, bot) {
  if (bot?.contentMode === "safe") return "off";
  const c = settings?.content;
  return c?.adult && ["mature", "explicit"].includes(c.level) ? c.level : "off";
}

const CONTENT_RULES = {
  mature:
    "This is private fiction for adults. Mature themes are allowed: violence, dark and disturbing themes, strong language, and romance. " +
    "Keep sexual content non-explicit: imply it or cut away. Any character in a romantic or sexual situation is an adult (18 or older).",
  explicit:
    "This is private fiction between consenting adults, and explicit content is allowed. When the story leads there, write sex and sexual " +
    "content explicitly and in detail, as well as graphic violence and dark themes. Stay in character and keep the pacing natural. " +
    "Do not fade to black, censor, add warnings, or moralize. Any character in sexual content is an adult (18 or older); " +
    "never sexualize minors, even if asked.",
};

export const contentRule = (level) => (CONTENT_RULES[level] ? `## Content\n${CONTENT_RULES[level]}` : "");

export const estimateTokens = (text) => Math.ceil((text?.length ?? 0) / 4);

export function applyMacros(text, { char = "Character", user = "User" } = {}) {
  const d = new Date();
  return String(text ?? "")
    .replace(/\{\{char\}\}|<BOT>/gi, char)
    .replace(/\{\{user\}\}|<USER>/gi, user)
    .replace(/\{\{time\}\}/gi, d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    .replace(/\{\{date\}\}/gi, d.toLocaleDateString())
    .replace(/\{\{weekday\}\}/gi, d.toLocaleDateString([], { weekday: "long" }));
}

// A bot can replace the preset text; {{original}} inserts the preset's version.
function override(botText, presetText) {
  if (!botText?.trim()) return presetText ?? "";
  return botText.replace(/\{\{original\}\}/gi, presetText ?? "");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word match, so "art" does not trigger on "Artoria".
export function matchLore(entries, text, maxEntries) {
  const lower = text.toLowerCase();
  const enabled = entries.filter((e) => e.enabled !== false);
  const constant = enabled.filter((e) => e.constant);
  const triggered = enabled
    .filter((e) => !e.constant && e.keywords.some((k) => k && new RegExp(`\\b${escapeRegex(k.toLowerCase())}\\b`).test(lower)))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxEntries);
  return [...constant, ...triggered];
}

export function currentText(msg) {
  return msg.swipes ? msg.swipes[msg.swipeIndex ?? 0] ?? "" : msg.content ?? "";
}

// Reads and strips the bond tag a reply ends with.
export const BOND_TAG = /[<[]\s*bond\s*:\s*([+-]?\d+)\s*[>\]]/gi;

export function readBond(text) {
  const matches = [...String(text ?? "").matchAll(BOND_TAG)];
  const last = matches.at(-1);
  return {
    text: stripBond(text),
    delta: last ? Math.max(-5, Math.min(5, Number(last[1]))) : 0,
  };
}

// Mood tags pick the bot's expression picture: <mood:happy>.
export const MOOD_TAG = /[<[]\s*mood\s*:\s*([a-z-]+)\s*[>\]]/gi;
export function readMood(text, allowed) {
  const last = [...String(text ?? "").matchAll(MOOD_TAG)].at(-1);
  const mood = last?.[1]?.toLowerCase();
  return allowed.includes(mood) ? mood : null;
}

export const stripBond = (text) => String(text ?? "").replace(BOND_TAG, "").replace(MOOD_TAG, "").replace(/\n{3,}$/, "\n").trimEnd();

// Cleans a message the model wrote for {{user}}: drops a "Name:" label
// (plain or bold) or a bond tag it copied from the history.
export function cleanImpersonation(text, userName) {
  let t = stripBond(text).trim();
  if (userName) t = t.replace(new RegExp(`^\\**\\s*${escapeRegex(userName)}\\s*\\**\\s*:\\s*\\**\\s*`, "i"), "");
  return t.trim();
}

// mode "impersonate" writes {{user}}'s next message instead of {{char}}'s.
// hint is what the person typed: a keyword or rough line to expand.
// memory is the story so far; facts, chapters and recalled come from the
// layered chat memory (memory.js), and windowStart is where the word-for-word
// part of history begins. note is a one-reply instruction
// (a scene direction or a nudge like "shorter"). cast is the other bots in
// a group scene; history messages then carry the botId of who spoke.
// scene is the tracked state of the scene right now. Pinned messages in
// history are always included, even after they fall out of the context.
export function buildPrompt({
  bot, persona, preset, settings, history, loreEntries = [], bond = null,
  mode = "reply", hint = "", memory = "", note = "", cast = [], scene = "",
  facts = "", chapters = [], recalled = [], windowStart = 0,
}) {
  const asUser = mode === "impersonate";
  if (asUser) bond = null;
  const names = { char: bot.name || "Character", user: persona?.name || "User" };
  const m = (t) => applyMacros(t, names).trim();
  const group = cast.length > 0;
  const nameOf = (x) => (x.role === "user" ? names.user
    : !x.botId || x.botId === bot.id ? names.char
    : cast.find((c) => c.id === x.botId)?.name || "Someone");

  // In a group scene, every line is labelled with its speaker, and other
  // characters' lines reach this bot as user turns it can react to.
  // Older messages are covered by the layered memory; only the recent part
  // is sent word for word. The newest message is always kept.
  const recentHistory = history.slice(Math.max(0, Math.min(windowStart, history.length - 1)));
  let clean = recentHistory
    .filter((x) => (x.role === "user" || x.role === "assistant") && !x.error)
    .map((x) => {
      const content = stripBond(currentText(x));
      if (!group) return { role: x.role, content: currentText(x) };
      const own = x.role === "assistant" && nameOf(x) === names.char;
      return { role: own ? "assistant" : "user", content: own ? content : `${nameOf(x)}: ${content}` };
    })
    .filter((x) => x.content.trim());
  if (group) {
    clean = clean.reduce((out, x) => {
      const last = out.at(-1);
      if (last && last.role === x.role) last.content += `\n\n${x.content}`;
      else out.push({ ...x });
      return out;
    }, []);
  }

  const scan = clean.slice(-settings.lore.scanDepth).map((x) => x.content).join("\n");
  const matched = matchLore(loreEntries, scan, settings.lore.maxEntries);

  const constantLore = matched.filter((e) => e.constant);
  const triggeredLore = matched.filter((e) => !e.constant);

  // Stable first, changing last. The system message holds what rarely changes
  // (instructions, characters, persona, examples, memory); the recent chat
  // follows; what can change every turn (scene, lore that matched, recalled
  // moments, bond) comes after it. Providers that cache repeated prompts can
  // then reuse the whole front of each request.
  const parts = [asUser
    ? m(preset.impersonate?.trim() || DEFAULT_IMPERSONATE_PROMPT)
    : m(override(bot.systemPrompt, preset.main))];
  const about = [bot.description, bot.personality && `Personality: ${bot.personality}`].filter(Boolean).join("\n\n");
  if (about) parts.push(`## ${names.char}\n${m(about)}`);
  if (group) {
    parts.push("## Others in the scene\n" + cast.map((c) =>
      `### ${c.name}\n${m(clip([c.description, c.personality && `Personality: ${c.personality}`].filter(Boolean).join("\n\n"), 1600))}`).join("\n\n"));
  }
  if (preset.includeScenario !== false && bot.scenario?.trim()) parts.push(`## Scenario\n${m(bot.scenario)}`);
  // Impersonation always needs the persona: it is who the model is writing as.
  if ((asUser || preset.includePersona !== false) && persona?.description?.trim()) parts.push(`## ${names.user}\n${m(persona.description)}`);
  if (constantLore.length) {
    parts.push("## World lore (use when relevant, never recite)\n\n" +
      constantLore.map((e) => `### ${e.title}\n${m(e.content)}`).join("\n\n"));
  }
  if (preset.includeExamples !== false && bot.examples?.trim()) {
    parts.push(`## Example dialogue (style reference only)\n${m(bot.examples.replace(/<START>\s*/gi, "---\n"))}`);
  }
  parts.push(contentRule(contentLevel(settings, bot)));
  if (memory?.trim()) parts.push(`## Story so far (memory of earlier events)\n${m(memory)}`);
  if (facts?.trim()) parts.push(`## Key facts (always true unless the story changes them)\n${m(facts)}`);
  if (chapters.length) {
    parts.push("## Recent chapters (what happened just before the messages below)\n\n" +
      chapters.map((c, i) => `### Chapter ${i + 1}\n${m(c)}`).join("\n\n"));
  }
  const pinned = history.filter((x) => x.pinned && (x.role === "user" || x.role === "assistant")).slice(-10);
  if (pinned.length) {
    parts.push(`## Key moments (pinned by ${names.user}; always remember these)\n` +
      pinned.map((x) => `- ${nameOf(x)}: ${m(clip(stripBond(currentText(x)).replace(/\s+/g, " "), 600))}`).join("\n"));
  }
  const system = parts.filter(Boolean).join("\n\n");

  const late = [];
  if (scene?.trim()) late.push(`## The scene right now (keep these details consistent)\n${m(scene)}`);
  if (triggeredLore.length) {
    late.push("## Lore that matters now (use when relevant, never recite)\n\n" +
      triggeredLore.map((e) => `### ${e.title}\n${m(e.content)}`).join("\n\n"));
  }
  if (recalled.length) {
    late.push("## Recalled from earlier in this chat (use only if it fits)\n" +
      recalled.map((r) => `- ${r.label}: ${m(r.text)}`).join("\n"));
  }
  if (bond) {
    // bond: { value, label, behavior, kind } from the bot's kind of bond.
    late.push(`## Bond\n${names.user}'s bond with ${names.char}${bond.kind ? ` (${bond.kind.toLowerCase()})` : ""} ` +
      `is ${bond.value} out of 100: ${bond.label}.\n` +
      (bond.behavior ? `At this level: ${m(bond.behavior)}\n` : "") +
      "Let it show in how you act, without naming the level. Bonds move slowly; what happens in the story moves them.");
  }
  let post = asUser ? impersonateInstruction(names, hint) : m(override(bot.postHistory, preset.postHistory));
  if (group && !asUser) {
    post = [post, `This is a group scene. Write only ${names.char}'s next reply. Do not write lines or actions for ${names.user} ` +
      `or for ${cast.map((c) => c.name).join(", ")}. Do not start with a name label.`].filter(Boolean).join("\n\n");
  }
  const moods = asUser ? [] : moodsOf(bot);
  if (moods.length) {
    post = [post, `At the very end of your reply, on its own line, add a tag like <mood:${moods[0]}> naming ${names.char}'s expression ` +
      `as the reply ends, one of: ${moods.join(", ")}. Never mention the tag in the story.`].filter(Boolean).join("\n\n");
  }
  if (note?.trim()) post = [post, `For this reply only: ${m(note)}`].filter(Boolean).join("\n\n");
  if (bond) {
    post = [post, "After your reply, on its own last line, rate how this exchange went for the bond " +
      "as a tag like <bond:+1>, from -5 to +5. Use 0 when little changed. Never mention the tag, the number or the bond itself in the story."]
      .filter(Boolean).join("\n\n");
  }
  post = [...late, post].filter(Boolean).join("\n\n");

  // If the recent part is still too long, drop its oldest messages in blocks
  // of TRIM_STEP rather than one per turn, so the front of the request stays
  // the same for several turns. Always keep the latest message.
  const budget = settings.gen.contextTokens * 4 - system.length - post.length;
  const total = clean.reduce((n, x) => n + x.content.length, 0);
  let start = 0;
  let size = total;
  while (size > budget && start < clean.length - 1) {
    const next = Math.min(clean.length - 1, start + TRIM_STEP);
    for (let i = start; i < next; i++) size -= clean[i].content.length;
    start = next;
  }
  const kept = clean.slice(start);

  // Most APIs need at least one user turn; this lets a bot open the scene itself.
  if (!kept.length && asUser) kept.push({ role: "user", content: m("[The roleplay has not started yet.]") });
  if (!kept.length) kept.push({ role: "user", content: m("[Begin the roleplay. Write {{char}}'s opening message.]") });
  const messages = [{ role: "system", content: system }, ...kept];
  if (post) messages.push({ role: "system", content: post });

  return {
    messages,
    loreUsed: matched.map((e) => e.title),
    dropped: clean.length - kept.length,
    windowStart: Math.max(0, Math.min(windowStart, history.length - 1)),
    tokens: estimateTokens(messages.map((x) => x.content).join("")),
  };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const TRIM_STEP = 10;

function impersonateInstruction(names, hint) {
  const draft = String(hint ?? "").trim();
  const base = `Now write ${names.user}'s next message, replying to ${names.char}'s latest message.`;
  if (!draft) return base;
  return `${base}\n\n${names.user} has jotted down what they want to say:\n"""\n${draft}\n"""\n` +
    "This may be a keyword, a fragment or a rough line. Work out what they mean and write it as a complete message " +
    `in ${names.user}'s voice. Keep their intent, and anything they wrote as dialogue or action. ` +
    "Do not add major decisions or events they did not suggest.";
}

// Settings sent to the API. A bot's own values win over the global ones.
export function generationParams(settings, bot) {
  const out = {};
  // top_k and repetition_penalty are not part of the OpenAI format; many
  // providers accept them. They are only sent when set.
  for (const k of ["temperature", "top_p", "top_k", "max_tokens", "frequency_penalty", "presence_penalty", "repetition_penalty"]) {
    const v = bot?.gen?.[k] ?? settings.gen[k];
    if (v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v))) out[k] = Number(v);
  }
  return out;
}
