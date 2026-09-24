// Compiles bots/*.md and lore/*.md into public/library.json. The site copies
// these into each visitor's browser once, as built-in bots and lore.
import fs from "node:fs";
import { loadEntries } from "../lib/entries.js";

const GEN_KEYS = ["temperature", "top_p", "top_k", "max_tokens", "frequency_penalty", "presence_penalty", "repetition_penalty"];
const list = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

const bots = loadEntries("bots").map(({ id, title, meta, content }) => ({
  id,
  name: title,
  tagline: meta.tagline ?? "",
  avatar: meta.avatar ?? null, // e.g. "avatars/Morgan.webp", a file in public/
  tags: list(meta.tags),
  description: content,
  personality: meta.personality ?? "",
  scenario: meta.scenario ?? "",
  greeting: meta.greeting ?? "",
  altGreetings: list(meta.alternate_greetings),
  examples: meta.examples ?? "",
  model: meta.model ?? "",
  gen: Object.fromEntries(GEN_KEYS.filter((k) => meta[k] !== undefined).map((k) => [k, Number(meta[k])])),
}));

const lore = loadEntries("lore").map(({ id, title, category, keywords, priority, meta, content }) => ({
  id, title, category, keywords, priority, content,
  enabled: meta.enabled !== false,
  constant: !!meta.constant,
}));

fs.writeFileSync("public/library.json", JSON.stringify({ bots, lore }, null, 2));
console.log(`library.json: ${bots.length} bots, ${lore.length} lore entries`);
