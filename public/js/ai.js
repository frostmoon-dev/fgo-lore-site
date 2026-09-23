// One-off model tasks that are not the chat reply itself: memory summaries,
// lore suggestions, drafting a bot, and checking a reply against its
// character. Each sends one request through the active connection and
// returns plain data. None of them streams.
import { getActiveConnection, getSettings } from "./store.js";
import { chatCompletion } from "./api.js";
import { currentText, stripBond, applyMacros, contentLevel, contentRule } from "./prompt.js";

export async function ask(messages, { bot, maxTokens = 800, temperature = 0.4, signal } = {}) {
  const [conn, settings] = await Promise.all([getActiveConnection(), getSettings()]);
  if (!conn) throw new Error("Set up an API connection first, on the Connection page.");
  // Every task follows the same content level as the chat itself, so a
  // summary, idea or translation neither censors nor adds what the chat allows.
  const rule = contentRule(contentLevel(settings, bot));
  if (rule && messages[0]?.role === "system") messages = [{ ...messages[0], content: `${messages[0].content}\n\n${rule}` }, ...messages.slice(1)];
  const res = await chatCompletion(conn, {
    model: bot?.model || conn.model || undefined,
    messages, stream: false, max_tokens: maxTokens, temperature,
  }, { signal });
  window.dispatchEvent(new CustomEvent("api-status", { detail: true }));
  return String(res.content ?? "").trim();
}

// Models often wrap JSON in a code fence or add a sentence around it.
export function parseJSON(text) {
  const src = String(text ?? "").replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(src); } catch { /* look for the JSON inside */ }
  for (const [open, close] of [["[", "]"], ["{", "}"]]) {
    const a = src.indexOf(open);
    const b = src.lastIndexOf(close);
    if (a !== -1 && b > a) {
      try { return JSON.parse(src.slice(a, b + 1)); } catch { /* try the other shape */ }
    }
  }
  throw new Error("The model did not answer in the expected format. Try again, or use a stronger model.");
}

// "Name: text" lines, for tasks that read a chat rather than continue it.
export function transcript(messages, nameOf, names) {
  return messages
    .map((m) => `${nameOf(m)}: ${applyMacros(stripBond(currentText(m)), names).trim()}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n\n");
}

const clip = (s, n) => (String(s ?? "").length > n ? `${String(s).slice(0, n)}…` : String(s ?? ""));

// ---------- Memory ----------

export async function summarize({ bot, names, previous, lines, signal }) {
  const system =
    `You keep the memory for a long roleplay between ${names.user} and ${names.char}. ` +
    "Write a compact summary a writer could use to continue the story without the full chat. Include: key events in order, " +
    "promises and secrets, injuries or changes of state, where everyone is now, and how the relationship has changed. " +
    "Use short bullet points under the headings Events, Facts, Relationship and Now. Past tense for events. No commentary. " +
    "Keep it under 350 words. Keep what still matters from the previous summary and drop what no longer does.";
  const user = `${previous?.trim() ? `Previous summary:\n${previous.trim()}\n\n` : ""}New messages:\n\n${lines}`;
  return ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 700, signal });
}

// ---------- Lore suggestions ----------

export async function suggestLore({ bot, names, lines, existing, signal }) {
  const system =
    "You maintain a lorebook for a roleplay. Read the chat and propose new lore entries for lasting facts that came up: " +
    "places, people, groups, objects, events, rules of the world. Skip small talk and anything already covered by an existing title. " +
    "Answer with JSON only: an array of at most 6 objects with keys " +
    '"title" (short), "category" (one of Place, Person, Group, Object, Event, Rule, Other), ' +
    '"keywords" (2 to 5 lowercase words or names that would appear in text about it), and "content" (2 to 4 factual sentences). ' +
    "Return [] if nothing is worth saving.";
  const user = `Existing lore titles: ${existing.length ? existing.join(", ") : "none"}\n\nChat between ${names.user} and ${names.char}:\n\n${lines}`;
  const list = parseJSON(await ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 1400, signal }));
  if (!Array.isArray(list)) throw new Error("The model did not return a list of entries.");
  return list
    .filter((e) => e && typeof e.title === "string" && typeof e.content === "string" && e.title.trim() && e.content.trim())
    .map((e) => ({
      title: e.title.trim().slice(0, 80),
      category: ["Place", "Person", "Group", "Object", "Event", "Rule", "Other"].includes(e.category) ? e.category : "Other",
      keywords: (Array.isArray(e.keywords) ? e.keywords : String(e.keywords ?? "").split(","))
        .map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 6),
      content: e.content.trim(),
    }));
}

// ---------- Bot drafting ----------

export async function draftBot({ idea, signal }) {
  const system =
    "You write character definitions for a roleplay site. From the idea given, create one original character. " +
    "Answer with JSON only, an object with these string keys: " +
    '"name"; "tagline" (one line, under 120 characters); "tags" (3 to 6 comma-separated lowercase tags); ' +
    '"description" (the core definition: who they are, history, how they think, how they talk, and 4 to 6 behaviour rules, written with {{char}} and {{user}}, 200 to 350 words, plain text with short sections); ' +
    '"personality" (a short trait list); "scenario" (where and how the first scene starts, 1 to 3 sentences, using {{user}}); ' +
    '"greeting" (the opening message in {{char}}\'s voice, 60 to 150 words, actions in *asterisks*); ' +
    '"examples" (two short example exchanges, each starting with <START>, lines prefixed {{user}}: and {{char}}:); ' +
    '"bondKind" (how a relationship with {{user}} would grow: one of affection, romance, rivalry, loyalty, fear). ' +
    "Give the character a specific voice, a contradiction, and a flaw. Avoid generic traits. Do not write for {{user}} beyond the examples.";
  const draft = parseJSON(await ask([{ role: "system", content: system }, { role: "user", content: `Idea: ${idea}` }], { maxTokens: 2200, temperature: 0.8, signal }));
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("The model did not return a character.");
  const str = (v) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v.trim() : "");
  return {
    name: str(draft.name), tagline: str(draft.tagline).slice(0, 140), tags: str(draft.tags),
    description: str(draft.description), personality: str(draft.personality), scenario: str(draft.scenario),
    greeting: str(draft.greeting), examples: str(draft.examples),
    bondKind: ["affection", "romance", "rivalry", "loyalty", "fear"].includes(draft.bondKind) ? draft.bondKind : "",
  };
}

// ---------- Character check ----------

export async function checkCharacter({ bot, names, reply, context, signal }) {
  const definition = applyMacros([bot.description, bot.personality && `Personality: ${bot.personality}`].filter(Boolean).join("\n\n"), names);
  const system =
    `You are an editor checking whether a roleplay reply stays true to ${names.char}. ` +
    "Compare the reply with the character definition and the recent context. Flag only real breaks: out-of-character behaviour or voice, " +
    `contradicting established facts, speaking or acting for ${names.user}, or mentioning being an AI. Do not flag style preferences. ` +
    'Answer with JSON only: {"ok": true or false, "issues": [short strings, at most 4], "fix": "one sentence on how to fix it, or empty"}.';
  const user = `Character definition:\n${clip(definition, 6000)}\n\nRecent context:\n${clip(context, 3000)}\n\nReply to check:\n${reply}`;
  const out = parseJSON(await ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 400, temperature: 0.2, signal }));
  const issues = (Array.isArray(out?.issues) ? out.issues : []).map(String).filter(Boolean).slice(0, 4);
  return { ok: out?.ok !== false && !issues.length, issues, fix: typeof out?.fix === "string" ? out.fix : "" };
}

// ---------- Reply suggestions ----------

export async function suggestReplies({ bot, names, persona, lines, signal }) {
  const system =
    `You help ${names.user} decide what to do next in a roleplay with ${names.char}. ` +
    `Offer three clearly different options for ${names.user}'s next message: for example one bold, one careful, one that changes direction. ` +
    `Each must fit ${names.user}'s personality and react to ${names.char}'s latest message. Never write ${names.char}'s words. ` +
    'Answer with JSON only: an array of 3 objects with "label" (2 to 5 words, an action, e.g. "Call her bluff") and ' +
    `"text" (the full message in ${names.user}'s voice, 1 to 3 sentences, actions in *asterisks*).`;
  const user = `${persona?.trim() ? `About ${names.user}:\n${persona.trim()}\n\n` : ""}Recent chat:\n\n${lines}`;
  const list = parseJSON(await ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 600, temperature: 0.9, signal }));
  if (!Array.isArray(list)) throw new Error("The model did not return a list of options.");
  return list
    .filter((o) => o && typeof o.text === "string" && o.text.trim())
    .slice(0, 3)
    .map((o) => ({ label: clip(String(o.label || o.text).trim(), 40), text: o.text.trim() }));
}

// ---------- Translation ----------

export async function translate({ text, to, bot, signal }) {
  const system =
    `Translate the user's text into ${to}. Keep the meaning, tone and formatting exactly: *asterisk actions*, "quotes", ` +
    "names, line breaks and markdown. Do not add notes, explanations or quotation marks around the result. Output only the translation.";
  return ask([{ role: "system", content: system }, { role: "user", content: text }], { bot, maxTokens: 1600, temperature: 0.2, signal });
}

// ---------- Scene tracker ----------

export async function updateScene({ bot, names, previous, lines, signal }) {
  const system =
    `You track the current state of a roleplay scene between ${names.user} and ${names.char}. ` +
    "From the previous state and the latest messages, write the state as it is now. Use exactly these lines, " +
    'each starting with its label: "Location:", "Time:", "Present:", "Mood:", "Appearance:", "Holding:". ' +
    "Keep each line short. Carry details forward unless the messages change them. Write unknown if nothing is known. No other text.";
  const user = `${previous?.trim() ? `Previous state:\n${previous.trim()}\n\n` : ""}Latest messages:\n\n${lines}`;
  return ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 300, temperature: 0.2, signal });
}

// ---------- Recap ----------

export async function recap({ bot, names, memory, lines, signal }) {
  const system =
    `Write a short "previously on" recap of a roleplay between ${names.user} and ${names.char}, to help ${names.user} pick the story back up. ` +
    `Two to four sentences of plain prose, past tense, ending with where things stand right now. Refer to ${names.user} as "you". No headings, no lists.`;
  const user = `${memory?.trim() ? `Summary of earlier events:\n${memory.trim()}\n\n` : ""}Most recent messages:\n\n${lines}`;
  return ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 300, temperature: 0.5, signal });
}

// ---------- Story ----------

export async function storyFrom({ bot, names, lines, pov, signal }) {
  const voice = pov === "char"
    ? `first person, from ${names.char}'s point of view, past tense`
    : "third person, past tense";
  const system =
    `Rewrite this roleplay chat as a piece of fiction in ${voice}. Keep every event, choice and important line of dialogue, in order. ` +
    "Turn actions and dialogue into flowing prose with paragraphs; trim repetition and out-of-story chatter. Do not add new plot events. " +
    "Start with a short title on its own line, prefixed with #. Use markdown paragraphs only.";
  return ask([{ role: "system", content: system }, { role: "user", content: clip(lines, 24000) }], { bot, maxTokens: 3200, temperature: 0.7, signal });
}

// ---------- Chat names ----------

export async function nameChat({ bot, names, lines, signal }) {
  const system =
    `Suggest a title for this roleplay chat between ${names.user} and ${names.char}, like a chapter title: ` +
    "2 to 6 words, specific to what happened, no quotes, no trailing punctuation. Answer with the title only.";
  const out = await ask([{ role: "system", content: system }, { role: "user", content: clip(lines, 8000) }], { bot, maxTokens: 30, temperature: 0.8, signal });
  return out.split("\n")[0].replace(/^["'“”#\s]+|["'“”.\s]+$/g, "").slice(0, 60);
}

// ---------- Journal ----------

export async function journalEntry({ bot, names, previous, lines, signal }) {
  const system =
    `You are ${names.char}, writing in your private journal after time spent with ${names.user}. ` +
    `Write one entry in first person, in ${names.char}'s own voice, personality and way of speaking: what happened, ` +
    `what you really think and feel about ${names.user} now, and anything you would never say aloud. ` +
    "80 to 160 words. No date line, no heading, no sign-off. Stay consistent with your earlier entries.";
  const user = `${previous?.trim() ? `Your last entry:\n${previous.trim()}\n\n` : ""}What happened since:\n\n${lines}`;
  return ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 400, temperature: 0.8, signal });
}

// ---------- Surprise ----------

export async function surpriseEvent({ bot, names, lines, scene, signal }) {
  const system =
    `Invent one surprising event for the next moment of a roleplay between ${names.user} and ${names.char}: ` +
    "an arrival, an interruption, a discovery, a change in weather, a secret slipping out, an accident. " +
    "It must fit the setting and the current scene, raise the stakes or add interest, and leave room for both characters to react. " +
    `Do not decide what ${names.user} does. Answer with one or two short sentences describing the event only, written as an instruction, ` +
    'for example "A messenger bursts in with news of a fire in the east wing."';
  const user = `${scene?.trim() ? `The scene right now:\n${scene.trim()}\n\n` : ""}Recent chat:\n\n${lines}`;
  const out = await ask([{ role: "system", content: system }, { role: "user", content: user }], { bot, maxTokens: 120, temperature: 1, signal });
  return out.replace(/^["“]|["”]$/g, "").trim();
}
