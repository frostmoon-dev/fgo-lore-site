// Local server: serves public/ and runs the same api/*.js handlers Vercel
// uses. Start with `npm start`. (Named dev.js, not server.js, because Vercel
// treats a root server.js as the whole app.)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve("public");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};
const api = {
  "/api/chat": () => import("./api/chat.js"),
  "/api/models": () => import("./api/models.js"),
  "/api/config": () => import("./api/config.js"),
};

async function handleApi(req, res, load) {
  const { default: handler } = await load();
  const controller = new AbortController();
  res.on("close", () => controller.abort()); // stop the upstream call if the tab goes away
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: { "content-type": req.headers["content-type"] ?? "application/json" },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req),
    duplex: "half",
    signal: controller.signal,
  });
  const response = await handler.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).on("error", () => res.end()).pipe(res);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const load = api[req.url.split("?")[0]];
  try {
    if (load) await handleApi(req, res, load);
    else serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, "127.0.0.1", () => {
  // 127.0.0.1 = only your own computer can open the site.
  console.log(`Shiru’s Garden running at http://localhost:${PORT}`);
});
