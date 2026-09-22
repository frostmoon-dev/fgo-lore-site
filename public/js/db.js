// Minimal promise wrapper around IndexedDB. Everything the user makes
// (bots, personas, chats, lore, settings) lives here, in their own browser.
const DB_NAME = "lore-archive";
const VERSION = 1;
export const STORES = ["bots", "personas", "chats", "lore", "kv"];

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: name === "kv" ? "key" : "id" });
        if (name === "chats") store.createIndex("botId", "botId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode = "readonly") {
  return (await open()).transaction(store, mode).objectStore(store);
}

export const db = {
  async all(store) { return done((await tx(store)).getAll()); },
  async get(store, id) { return done((await tx(store)).get(id)); },
  async put(store, value) { await done((await tx(store, "readwrite")).put(value)); return value; },
  async delete(store, id) { return done((await tx(store, "readwrite")).delete(id)); },
  async clear(store) { return done((await tx(store, "readwrite")).clear()); },
  async byIndex(store, index, value) { return done((await tx(store)).index(index).getAll(value)); },
  async getKV(key, fallback) { return (await db.get("kv", key))?.value ?? fallback; },
  async setKV(key, value) { return db.put("kv", { key, value }); },
};
