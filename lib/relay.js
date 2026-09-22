// Forwards a browser request to an OpenAI-compatible API, so any proxy works
// without CORS trouble. The user's key comes with each request and is never
// stored or logged. Used by api/*.js on Vercel and by dev.js locally.

const ON_VERCEL = !!process.env.VERCEL;
const SKIP_HEADERS = new Set([
  "host", "content-length", "connection", "cookie", "transfer-encoding",
  "authorization", "content-type", "accept-encoding", "origin", "referer",
]);

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Keeps the public relay from being used to reach private networks.
function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(localhost|local|internal|home|lan)$/.test(h)) return true;
  if (h === "metadata.google.internal") return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) {
    return h === "::" || h === "::1" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:");
  }
  return false;
}

function checkUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return "The base URL is not a valid URL."; }
  if (!["https:", "http:"].includes(url.protocol)) return "The base URL must start with https://.";
  if (ON_VERCEL && url.protocol !== "https:") return "The base URL must use https:// when relayed.";
  if (ON_VERCEL && isPrivateHost(url.hostname)) {
    return "The relay can't reach private or local addresses. Switch this connection to Direct mode.";
  }
  return null;
}

function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a ?? ""));
  const y = new TextEncoder().encode(String(b ?? ""));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// The site owner's own key (API_KEY in the environment). Without ACCESS_CODE
// it only works on your own computer, so a deployed site can't be used as a
// free key by strangers.
function serverKeyState() {
  const { API_KEY, ACCESS_CODE } = process.env;
  return { available: !!API_KEY && (!!ACCESS_CODE || !ON_VERCEL), needsCode: !!ACCESS_CODE };
}

export function config() {
  const { available, needsCode } = serverKeyState();
  return json({ serverKey: available, needsCode, defaultModel: available ? process.env.DEFAULT_MODEL ?? "" : "" });
}

export async function relay(request, path) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: "The request body is not valid JSON." }, 400); }
  const { connection = {}, body } = payload ?? {};

  let base;
  let key;
  let extra = {};
  if (connection.server) {
    const { available, needsCode } = serverKeyState();
    if (!available) return json({ error: "This site has no shared key available." }, 403);
    if (needsCode && !sameSecret(connection.accessCode, process.env.ACCESS_CODE)) {
      return json({ error: "Wrong access code." }, 401);
    }
    base = process.env.API_BASE_URL ?? "https://api.openai.com/v1";
    key = process.env.API_KEY;
    if (body && !body.model) body.model = process.env.DEFAULT_MODEL;
  } else {
    base = String(connection.baseUrl ?? "");
    key = connection.apiKey;
    extra = connection.headers ?? {};
  }

  const problem = checkUrl(base);
  if (problem) return json({ error: problem }, 400);

  const headers = { Accept: body?.stream ? "text/event-stream" : "application/json" };
  for (const [k, v] of Object.entries(extra).slice(0, 20)) {
    if (typeof v === "string" && /^[\w-]+$/.test(k) && !SKIP_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body) headers["Content-Type"] = "application/json";

  let upstream;
  try {
    upstream = await fetch(`${base.replace(/\/+$/, "")}/${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual", // a redirect could point somewhere private
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(290_000)].filter(Boolean)),
    });
  } catch (err) {
    const reason = err.name === "TimeoutError" ? "it took too long to answer" : err.cause?.code ?? err.message;
    return json({ error: `Could not reach the API (${reason}). Check the base URL.` }, 502);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return json({ error: `The API redirected to ${upstream.headers.get("location") ?? "another address"}. Use that URL as the base URL.` }, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
