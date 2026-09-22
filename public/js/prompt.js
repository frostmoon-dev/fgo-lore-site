// Turns a bot, persona, prompt preset, lore and chat history into the
// messages array sent to the API.

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

export const stripBond = (text) => String(text ?? "").replace(BOND_TAG, "").replace(/\n{3,}$/, "\n").trimEnd();

export function buildPrompt({ bot, persona, preset, settings, history, loreEntries = [], bond = null }) {
  const names = { char: bot.name || "Character", user: persona?.name || "User" };
  const m = (t) => applyMacros(t, names).trim();

  const clean = history
    .filter((x) => (x.role === "user" || x.role === "assistant") && !x.error)
    .map((x) => ({ role: x.role, content: currentText(x) }))
    .filter((x) => x.content.trim());

  const scan = clean.slice(-settings.lore.scanDepth).map((x) => x.content).join("\n");
  const matched = matchLore(loreEntries, scan, settings.lore.maxEntries);

  const parts = [m(override(bot.systemPrompt, preset.main))];
  const about = [bot.description, bot.personality && `Personality: ${bot.personality}`].filter(Boolean).join("\n\n");
  if (about) parts.push(`## ${names.char}\n${m(about)}`);
  if (preset.includeScenario !== false && bot.scenario?.trim()) parts.push(`## Scenario\n${m(bot.scenario)}`);
  if (preset.includePersona !== false && persona?.description?.trim()) parts.push(`## ${names.user}\n${m(persona.description)}`);
  if (matched.length) {
    parts.push("## World lore (use when relevant, never recite)\n\n" +
      matched.map((e) => `### ${e.title}\n${m(e.content)}`).join("\n\n"));
  }
  if (preset.includeExamples !== false && bot.examples?.trim()) {
    parts.push(`## Example dialogue (style reference only)\n${m(bot.examples.replace(/<START>\s*/gi, "---\n"))}`);
  }
  if (bond) {
    parts.push(`## Bond\n${names.user}'s bond with ${names.char} is ${bond.value} out of 100 (${bond.label}).\n` +
      "Let it show in how warm, guarded or hostile you are. Bonds move slowly, and rudeness or lies push them down.");
  }
  const system = parts.filter(Boolean).join("\n\n");
  let post = m(override(bot.postHistory, preset.postHistory));
  if (bond) {
    post = [post, "After your reply, on its own last line, rate how this exchange went for the bond " +
      "as a tag like <bond:+1>, from -5 to +5. Use 0 when little changed. Never mention the tag, the number or the bond itself in the story."]
      .filter(Boolean).join("\n\n");
  }

  // Keep the newest messages that fit. Always keep the latest one.
  const budget = settings.gen.contextTokens * 4 - system.length - post.length;
  let used = 0;
  const kept = [];
  for (let i = clean.length - 1; i >= 0; i--) {
    used += clean[i].content.length;
    if (used > budget && kept.length > 0) break;
    kept.unshift(clean[i]);
  }

  // Most APIs need at least one user turn; this lets a bot open the scene itself.
  if (!kept.length) kept.push({ role: "user", content: m("[Begin the roleplay. Write {{char}}'s opening message.]") });
  const messages = [{ role: "system", content: system }, ...kept];
  if (post) messages.push({ role: "system", content: post });

  return {
    messages,
    loreUsed: matched.map((e) => e.title),
    dropped: clean.length - kept.length,
    tokens: estimateTokens(messages.map((x) => x.content).join("")),
  };
}

// Settings sent to the API. A bot's own values win over the global ones.
export function generationParams(settings, bot) {
  const out = {};
  for (const k of ["temperature", "top_p", "max_tokens", "frequency_penalty", "presence_penalty"]) {
    const v = bot?.gen?.[k] ?? settings.gen[k];
    if (v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v))) out[k] = Number(v);
  }
  return out;
}
