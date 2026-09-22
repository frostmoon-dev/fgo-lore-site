import { db } from "./db.js";

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

// ---------- Defaults ----------

export const DEFAULT_MAIN_PROMPT =
  "You are {{char}}. Write {{char}}'s next reply in a fictional roleplay with {{user}}.\n" +
  "Stay in character at all times. Be vivid and specific, move the scene forward, and react to what {{user}} actually said.\n" +
  "Never speak, think, or act for {{user}}. Never mention being an AI.";

export const DEFAULT_SETTINGS = {
  personaId: null,
  connectionId: null,
  presetId: "default",
  gen: {
    temperature: 0.8,
    top_p: 1,
    max_tokens: 600,
    frequency_penalty: 0,
    presence_penalty: 0,
    contextTokens: 8000,
    stream: true,
  },
  lore: { scanDepth: 4, maxEntries: 4 },
  bond: { enabled: true, start: 20 },
  chatBackground: null,
  backgroundDim: 0.86,
  enterToSend: true,
};

// The bond meter's wording, low to high.
export const BOND_TIERS = [
  { at: 0, label: "Hostile" },
  { at: 12, label: "Wary" },
  { at: 30, label: "Civil" },
  { at: 48, label: "Warm" },
  { at: 66, label: "Close" },
  { at: 84, label: "Devoted" },
];

export function bondTier(value) {
  return [...BOND_TIERS].reverse().find((t) => value >= t.at) ?? BOND_TIERS[0];
}

export const DEFAULT_PRESET = {
  id: "default",
  name: "Default",
  main: DEFAULT_MAIN_PROMPT,
  postHistory: "",
  includeExamples: true,
  includeScenario: true,
  includePersona: true,
};

// Base URLs for common OpenAI-compatible providers. "Custom" covers any proxy.
export const PROVIDERS = [
  { id: "custom", name: "Custom proxy", baseUrl: "" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "ollama", name: "Ollama (local, direct only)", baseUrl: "http://localhost:11434/v1" },
];

export function newConnection(partial = {}) {
  return {
    id: uid(), name: "New connection", provider: "custom", baseUrl: "", apiKey: "",
    model: "", mode: "relay", headers: "", ...partial,
  };
}

export function newBot(partial = {}) {
  return {
    id: uid(), name: "", tagline: "", avatar: null, tags: [],
    description: "", personality: "", scenario: "",
    greeting: "", altGreetings: [], examples: "",
    systemPrompt: "", postHistory: "", creatorNotes: "",
    model: "", gen: {}, builtin: false,
    lorebookIds: [], background: null, bondEnabled: true,
    createdAt: now(), updatedAt: now(), lastChatAt: 0, ...partial,
  };
}

export function newPersona(partial = {}) {
  return { id: uid(), name: "", description: "", avatar: null, createdAt: now(), ...partial };
}

export function newLore(partial = {}) {
  return {
    id: uid(), title: "", category: "Other", keywords: [], priority: 0,
    content: "", enabled: true, constant: false, builtin: false,
    bookId: DEFAULT_BOOK_ID, ...partial,
  };
}

// ---------- Lorebooks ----------
// A lorebook groups lore entries. A bot uses the books linked to it, plus
// every book marked "use with every bot".

export const DEFAULT_BOOK_ID = "default";

export function newLorebook(partial = {}) {
  return { id: uid(), name: "", description: "", global: false, createdAt: now(), ...partial };
}

export async function getLorebooks() {
  const list = await db.getKV("lorebooks", null);
  if (list?.length) return list;
  return [{ id: DEFAULT_BOOK_ID, name: "World lore", description: "Entries every bot can use.", global: true, createdAt: 0 }];
}

export async function saveLorebooks(list) {
  await db.setKV("lorebooks", list);
  emit("lore");
}

// The entries a given bot should be matched against.
export async function loreForBot(bot) {
  const [books, entries] = await Promise.all([getLorebooks(), lore.all()]);
  const linked = new Set([
    ...books.filter((b) => b.global).map((b) => b.id),
    ...(bot?.lorebookIds ?? []),
  ]);
  return entries.filter((e) => linked.has(e.bookId ?? DEFAULT_BOOK_ID));
}

// ---------- Change notifications ----------

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => fn(what)); }

// ---------- Settings / connections / presets (kv store) ----------

function merge(base, extra) {
  const out = { ...base, ...extra };
  for (const k of ["gen", "lore", "bond"]) out[k] = { ...base[k], ...(extra?.[k] ?? {}) };
  return out;
}

export async function getSettings() {
  return merge(DEFAULT_SETTINGS, await db.getKV("settings", {}));
}
export async function saveSettings(patch) {
  const next = merge(await getSettings(), patch);
  await db.setKV("settings", next);
  emit("settings");
  return next;
}

export const getConnections = () => db.getKV("connections", []);
export async function saveConnections(list) { await db.setKV("connections", list); emit("connections"); }
export async function getActiveConnection() {
  const [list, settings] = await Promise.all([getConnections(), getSettings()]);
  return list.find((c) => c.id === settings.connectionId) ?? list[0] ?? null;
}

export async function getPresets() {
  const list = await db.getKV("presets", null);
  return list?.length ? list : [structuredClone(DEFAULT_PRESET)];
}
export async function savePresets(list) { await db.setKV("presets", list); emit("presets"); }
export async function getActivePreset() {
  const [list, settings] = await Promise.all([getPresets(), getSettings()]);
  return list.find((p) => p.id === settings.presetId) ?? list[0];
}

// ---------- Records ----------

const sortBy = (key) => (a, b) => (b[key] ?? 0) - (a[key] ?? 0);

export const bots = {
  all: async () => (await db.all("bots")).sort(sortBy("updatedAt")),
  get: (id) => db.get("bots", id),
  async save(bot) { bot.updatedAt = now(); await db.put("bots", bot); emit("bots"); return bot; },
  // Marks a chat without counting as an edit.
  async touch(bot) { bot.lastChatAt = now(); await db.put("bots", bot); },
  async remove(id) {
    for (const c of await chats.forBot(id)) await db.delete("chats", c.id);
    await db.delete("bots", id);
    emit("bots");
  },
};

export const personas = {
  all: async () => (await db.all("personas")).sort((a, b) => a.createdAt - b.createdAt),
  get: (id) => db.get("personas", id),
  async save(p) { await db.put("personas", p); emit("personas"); return p; },
  async remove(id) { await db.delete("personas", id); emit("personas"); },
  async active() {
    const [list, settings] = await Promise.all([personas.all(), getSettings()]);
    return list.find((p) => p.id === settings.personaId) ?? list[0] ?? null;
  },
};

export const chats = {
  forBot: async (botId) => (await db.byIndex("chats", "botId", botId)).sort(sortBy("updatedAt")),
  all: () => db.all("chats"),
  get: (id) => db.get("chats", id),
  async save(chat) { chat.updatedAt = now(); await db.put("chats", chat); return chat; },
  remove: (id) => db.delete("chats", id),
};

export const lore = {
  all: async () => (await db.all("lore")).sort((a, b) => a.title.localeCompare(b.title)),
  get: (id) => db.get("lore", id),
  async save(e) { await db.put("lore", e); emit("lore"); return e; },
  async remove(id) { await db.delete("lore", id); emit("lore"); },
};

// ---------- First run + built-in library ----------

// Built-ins come from bots/*.md and lore/*.md, compiled to library.json at
// build time. Each is copied in once; after that the user owns the copy, and
// deleting it does not bring it back.
export async function seed() {
  const seeded = new Set(await db.getKV("seeded", []));
  let library = { bots: [], lore: [] };
  try {
    const r = await fetch("library.json", { cache: "no-cache" });
    if (r.ok) library = await r.json();
  } catch { /* offline or no build step: nothing to seed */ }

  for (const b of library.bots ?? []) {
    const id = `builtin-${b.id}`;
    if (seeded.has(id)) continue;
    await db.put("bots", newBot({ ...b, id, builtin: true }));
    seeded.add(id);
  }
  for (const e of library.lore ?? []) {
    const id = `builtin-${e.id}`;
    if (seeded.has(id)) continue;
    await db.put("lore", newLore({ ...e, id, builtin: true }));
    seeded.add(id);
  }
  // Entries written before lorebooks existed belong to the default book.
  for (const e of await lore.all()) {
    if (!e.bookId) await db.put("lore", { ...e, bookId: DEFAULT_BOOK_ID });
  }
  await db.setKV("seeded", [...seeded]);

  if ((await personas.all()).length === 0) {
    const p = await personas.save(newPersona({ name: "Traveler", description: "" }));
    await saveSettings({ personaId: p.id });
  }
}

// ---------- Backup ----------

export const BACKUP_FORMAT = "shirus-garden-backup";
// The old name is still accepted, so earlier backups restore.
const BACKUP_FORMATS = [BACKUP_FORMAT, "lore-archive-backup"];

export async function exportAll({ includeKeys = false } = {}) {
  const [b, p, c, l, books, settings, connections, presets] = await Promise.all([
    db.all("bots"), db.all("personas"), db.all("chats"), db.all("lore"),
    getLorebooks(), getSettings(), getConnections(), getPresets(),
  ]);
  return {
    format: BACKUP_FORMAT, version: 2, exportedAt: new Date().toISOString(),
    bots: b, personas: p, chats: c, lore: l, lorebooks: books, settings, presets,
    connections: connections.map((x) => (includeKeys ? x : { ...x, apiKey: "" })),
  };
}

export async function importAll(data) {
  if (!BACKUP_FORMATS.includes(data?.format)) throw new Error("This is not a backup file from this site.");
  for (const [store, rows] of [["bots", data.bots], ["personas", data.personas], ["chats", data.chats], ["lore", data.lore]]) {
    for (const row of rows ?? []) await db.put(store, row);
  }
  if (data.lorebooks?.length) await db.setKV("lorebooks", data.lorebooks);
  if (data.settings) await db.setKV("settings", data.settings);
  if (data.presets?.length) await db.setKV("presets", data.presets);
  if (data.connections?.length) {
    const existing = await getConnections();
    const byId = new Map(existing.map((c) => [c.id, c]));
    // Keep a key already saved here if the backup was made without keys.
    for (const c of data.connections) byId.set(c.id, { ...c, apiKey: c.apiKey || byId.get(c.id)?.apiKey || "" });
    await db.setKV("connections", [...byId.values()]);
  }
  emit("all");
}

export async function wipeAll() {
  for (const s of ["bots", "personas", "chats", "lore", "kv"]) await db.clear(s);
  emit("all");
}
