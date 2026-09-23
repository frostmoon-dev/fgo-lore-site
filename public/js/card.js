// Character Card V2/V3 import and export (the format SillyTavern, Chub and
// most roleplay frontends share). PNG cards carry the JSON, base64-encoded,
// in a tEXt chunk named "chara" (V2) or "ccv3" (V3).
import { newBot, newLore } from "./store.js";
import { autoCrop } from "./ui.js";

const utf8ToB64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

// ---------- PNG chunks ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readTextChunks(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error("That PNG file is damaged or not a PNG.");
  const out = {};
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === "tEXt") {
      const data = bytes.subarray(pos + 8, pos + 8 + len);
      const zero = data.indexOf(0);
      const key = new TextDecoder("latin1").decode(data.subarray(0, zero));
      out[key.toLowerCase()] = new TextDecoder("latin1").decode(data.subarray(zero + 1));
    }
    if (type === "IEND") break;
    pos += 12 + len;
  }
  return out;
}

function withTextChunk(pngBuf, key, text) {
  const bytes = new Uint8Array(pngBuf);
  const payload = new TextEncoder().encode(`${key}\0${text}`);
  const chunk = new Uint8Array(12 + payload.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, payload.length);
  chunk.set([116, 69, 88, 116], 4); // "tEXt"
  chunk.set(payload, 8);
  dv.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));
  const iend = bytes.length - 12; // IEND is always the last 12 bytes
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(bytes.subarray(iend), iend + chunk.length);
  return out;
}

// ---------- Import ----------

function fromCard(json) {
  const d = json.data ?? json; // V1 cards have the fields at the top level
  if (!d || typeof d !== "object" || !(d.name || d.char_name)) throw new Error("No character found in that file.");
  const ext = d.extensions?.shirus_garden ?? d.extensions?.lore_archive ?? {};
  const bot = newBot({
    name: d.name ?? d.char_name ?? "",
    tagline: ext.tagline ?? (d.creator_notes ?? "").split("\n")[0].slice(0, 140),
    description: d.description ?? d.char_persona ?? "",
    personality: d.personality ?? "",
    scenario: d.scenario ?? d.world_scenario ?? "",
    greeting: d.first_mes ?? d.char_greeting ?? "",
    altGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.filter(Boolean) : [],
    examples: d.mes_example ?? d.example_dialogue ?? "",
    systemPrompt: d.system_prompt ?? "",
    postHistory: d.post_history_instructions ?? "",
    creatorNotes: d.creator_notes ?? "",
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    model: ext.model ?? "",
    gen: ext.gen ?? {},
    avatar: ext.avatar ?? null,
    ...(ext.contentMode === "safe" ? { contentMode: "safe" } : {}),
    ...(ext.bondKind ? { bondKind: ext.bondKind, bondLevels: ext.bondLevels ?? null, bondMilestones: ext.bondMilestones !== false } : {}),
  });
  const lore = (d.character_book?.entries ?? []).map((e, i) =>
    newLore({
      title: e.name || e.comment || `${bot.name} entry ${i + 1}`,
      category: bot.name || "Imported",
      keywords: [...(e.keys ?? []), ...(e.secondary_keys ?? [])].map(String),
      priority: Number(e.priority ?? e.insertion_order ?? 0),
      content: e.content ?? "",
      enabled: e.enabled !== false,
      constant: !!e.constant,
    }));
  return { bot, lore };
}

export async function importCardFile(file) {
  if (file.type === "image/png" || /\.png$/i.test(file.name)) {
    const chunks = readTextChunks(await file.arrayBuffer());
    const raw = chunks.ccv3 ?? chunks.chara;
    if (!raw) throw new Error("This PNG has no character card inside it.");
    const result = fromCard(JSON.parse(b64ToUtf8(raw)));
    result.bot.avatar = await autoCrop(file);
    return result;
  }
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { throw new Error("That file is not valid JSON or a PNG card."); }
  return fromCard(json);
}

// ---------- Export ----------

export function toCard(bot, loreEntries = []) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: bot.name,
      description: bot.description,
      personality: bot.personality,
      scenario: bot.scenario,
      first_mes: bot.greeting,
      mes_example: bot.examples,
      creator_notes: bot.creatorNotes || bot.tagline,
      system_prompt: bot.systemPrompt,
      post_history_instructions: bot.postHistory,
      alternate_greetings: bot.altGreetings,
      tags: bot.tags,
      creator: "",
      character_version: "",
      character_book: loreEntries.length ? {
        entries: loreEntries.map((e, i) => ({
          keys: e.keywords, content: e.content, name: e.title, enabled: e.enabled !== false,
          insertion_order: i, priority: e.priority, constant: !!e.constant, extensions: {},
        })),
        extensions: {},
      } : undefined,
      extensions: { shirus_garden: {
        tagline: bot.tagline, model: bot.model, gen: bot.gen,
        bondKind: bot.bondKind, bondLevels: bot.bondLevels, bondMilestones: bot.bondMilestones, contentMode: bot.contentMode,
      } },
    },
  };
}

async function avatarPng(bot) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (bot.avatar) {
    const img = new Image();
    img.src = bot.avatar;
    await img.decode();
    ctx.drawImage(img, 0, 0, size, size);
  } else {
    ctx.fillStyle = "#f2ebdd"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#6e1e2b"; ctx.font = "italic 280px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((bot.name || "?").charAt(0).toUpperCase(), size / 2, size / 2 + 10);
  }
  return new Promise((r) => canvas.toBlob(r, "image/png"));
}

export async function cardPng(bot, loreEntries) {
  const png = await (await avatarPng(bot)).arrayBuffer();
  const out = withTextChunk(png, "chara", utf8ToB64(JSON.stringify(toCard(bot, loreEntries))));
  return new Blob([out], { type: "image/png" });
}
