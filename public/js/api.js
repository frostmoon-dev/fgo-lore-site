// Talks to any OpenAI-compatible API. Three modes:
//  relay  - the browser posts to /api/chat and the site's server forwards it
//           (works with any proxy, no CORS problems, key is never stored there)
//  direct - the browser calls the proxy itself (needs CORS; required for localhost)
//  server - uses the key set in the site's environment variables

export function normalizeBaseUrl(url) {
  return String(url ?? "").trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/+$/, "");
}

export function parseHeaders(text) {
  const out = {};
  const src = String(text ?? "").trim();
  if (!src) return out;
  if (src.startsWith("{")) {
    const obj = JSON.parse(src);
    for (const [k, v] of Object.entries(obj)) out[k] = String(v);
    return out;
  }
  for (const line of src.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

let configPromise;
export function serverConfig() {
  configPromise ??= fetch("/api/config")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return configPromise;
}

function friendly(status, detail) {
  let msg = detail;
  try {
    const j = JSON.parse(detail);
    msg = j.error?.message ?? (typeof j.error === "string" ? j.error : null) ?? j.message ?? detail;
  } catch { /* not JSON */ }
  msg = String(msg || "").slice(0, 400);
  const hint = {
    400: "The API rejected the request. The model name may be wrong, or a setting is not supported by this provider.",
    401: "The API key was rejected. Check it on the Connection page.",
    402: "The provider says the account has no credit left.",
    403: "Access denied. The key may not have access to this model.",
    404: "Not found. Check the base URL and model name on the Connection page.",
    429: "Rate limited. Wait a moment and try again.",
    500: "The provider had an error on its side.",
    502: "The provider had an error on its side.",
    503: "The model is busy or briefly down.",
    504: "The provider took too long to answer.",
    529: "The provider is overloaded.",
  }[status];
  return hint ? `${hint}${msg ? ` (${status}: ${msg})` : ""}` : `The API returned ${status}${msg ? `: ${msg}` : ""}`;
}

function request(conn, path, body, signal) {
  if (!conn) throw new Error("No connection set up yet. Add one on the Connection page.");
  if (conn.mode === "direct") {
    const base = normalizeBaseUrl(conn.baseUrl);
    if (!base) throw new Error("This connection has no base URL.");
    const headers = { ...parseHeaders(conn.headers) };
    if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
    if (body) headers["Content-Type"] = "application/json";
    return fetch(`${base}/${path}`, {
      method: body ? "POST" : "GET", headers, signal,
      body: body ? JSON.stringify(body) : undefined,
    }).catch((err) => {
      if (err.name === "AbortError") throw err;
      throw new Error("Could not reach the API from the browser. It may block cross-site requests (CORS). Try Relay mode.");
    });
  }
  const connection = conn.mode === "server"
    ? { server: true, accessCode: conn.accessCode ?? "" }
    : { baseUrl: normalizeBaseUrl(conn.baseUrl), apiKey: conn.apiKey, headers: parseHeaders(conn.headers) };
  return fetch(`/api/${path === "models" ? "models" : "chat"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connection, body }),
    signal,
  }).catch((err) => {
    if (err.name === "AbortError") throw err;
    throw new Error("Could not reach this site's relay. Are you offline?");
  });
}

export async function listModels(conn) {
  const r = await request(conn, "models");
  if (!r.ok) throw new Error(friendly(r.status, await r.text()));
  const data = await r.json();
  const list = Array.isArray(data) ? data : data.data ?? data.models ?? [];
  return list.map((m) => (typeof m === "string" ? m : m.id ?? m.name)).filter(Boolean).sort();
}

// Sends a chat request. Calls onDelta as text streams in. Resolves with the
// full reply; rejects with AbortError when stopped.
import { recordUsage, getSettings } from "./store.js";
import { cachedTokens } from "./memory.js";

// Every finished request is counted. Providers that do not report token
// counts get an estimate (about four characters per token), marked as such.
function count(payload, result) {
  const u = result.usage;
  const est = (s) => Math.ceil(String(s ?? "").length / 4);
  recordUsage({
    model: payload.model,
    prompt: Number(u?.prompt_tokens) || est(payload.messages?.map((m) => m.content).join("\n")),
    completion: Number(u?.completion_tokens) || est(`${result.content}${result.reasoning ?? ""}`),
    estimated: !(u?.prompt_tokens && u?.completion_tokens),
    cached: Number(cachedTokens(u)) || 0,
  });
}

// ---------- Busy models ----------
// Free and shared models often answer "overloaded", "try again" or 429/503.
// Those are retried a few times, waiting longer each time (or as long as the
// provider asks). Only before any text has arrived, so nothing is repeated.
const BUSY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
const BUSY_TEXT = /overload|capacity|busy|temporar|unavailable|try again|rate.?limit|too many requests|timed? ?out|high demand/i;

function busyError(message, wait) {
  const err = new Error(message);
  err.busy = true;
  err.wait = wait;
  return err;
}

// Retry-After is seconds or an HTTP date.
function retryAfter(r) {
  const v = r.headers.get("retry-after");
  if (!v) return undefined;
  const ms = /^\d+(\.\d+)?$/.test(v) ? Number(v) * 1000 : Date.parse(v) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("Stopped", "AbortError"));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Stopped", "AbortError")); }, { once: true });
});

// retries: how many more tries after the first; defaults to the setting.
// onRetry({ attempt, max, delay, message }) runs before each wait.
export async function chatCompletion(conn, body, { signal, onDelta = () => {}, onRetry = () => {}, retries } = {}) {
  const max = retries ?? (await getSettings()).retry?.tries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let started = false;
    try {
      return await completeOnce(conn, body, { signal, onDelta: (r) => { started ||= !!(r.content || r.reasoning); onDelta(r); } });
    } catch (err) {
      if (err.name === "AbortError" || !err.busy || started || attempt >= max) {
        if (err.busy && attempt > 0) err.message = `${err.message} Tried ${attempt + 1} times; try again in a minute, or pick another model.`;
        throw err;
      }
      const delay = Math.min(20000, err.wait ?? 1500 * 2 ** attempt) + Math.round(Math.random() * 400);
      onRetry({ attempt: attempt + 1, max, delay, message: err.message });
      await sleep(delay, signal);
    }
  }
}

async function completeOnce(conn, body, { signal, onDelta }) {
  const payload = { ...body };
  if (conn.model) payload.model ??= conn.model;
  if (!payload.model && conn.mode !== "server") throw new Error("No model chosen. Pick one on the Connection page.");

  const r = await request(conn, "chat/completions", payload, signal);
  if (!r.ok) {
    const text = friendly(r.status, await r.text());
    // The site's relay marks its own errors; a wrong base URL is not busy.
    const relayProblem = r.headers.get("x-relay-error") === "1" && r.status !== 504;
    const clientError = [401, 402, 403, 404].includes(r.status); // wrong key, no credit, wrong model: waiting will not help
    if (!relayProblem && !clientError && (BUSY_STATUS.has(r.status) || BUSY_TEXT.test(text))) throw busyError(text, retryAfter(r));
    throw new Error(text);
  }

  const type = r.headers.get("content-type") ?? "";
  if (!payload.stream || !type.includes("text/event-stream")) {
    const data = await r.json();
    const msg = data.choices?.[0]?.message ?? {};
    const result = {
      content: msg.content ?? data.choices?.[0]?.text ?? "",
      reasoning: msg.reasoning_content ?? msg.reasoning ?? "",
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
    };
    if (!result.content && data.error) {
      const text = data.error.message ?? String(data.error);
      throw BUSY_TEXT.test(text) ? busyError(text) : new Error(text);
    }
    onDelta(result);
    count(payload, result);
    return result;
  }

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  const result = { content: "", reasoning: "", usage: null, finishReason: null };
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.error) {
        const text = json.error.message ?? String(json.error);
        throw BUSY_TEXT.test(text) ? busyError(text) : new Error(text);
      }
      const choice = json.choices?.[0];
      const delta = choice?.delta ?? {};
      result.content += delta.content ?? "";
      result.reasoning += delta.reasoning_content ?? delta.reasoning ?? "";
      if (choice?.finish_reason) result.finishReason = choice.finish_reason;
      if (json.usage) result.usage = json.usage;
      onDelta(result);
    }
  }
  count(payload, result);
  return result;
}
