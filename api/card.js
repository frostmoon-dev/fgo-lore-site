// POST /api/card {creator, slug} -> the character card PNG for that Chub page.
// Browsers can't always fetch from Chub directly (CORS), so this asks for
// the one card and passes it on. It only ever talks to Chub's card store,
// and it builds the address itself from two plain names, so it cannot be
// pointed at any other site.

const CARDS = process.env.CHUB_CARDS_BASE ?? "https://avatars.charhub.io/avatars";
const MAX_BYTES = 20 * 1024 * 1024;
const NAME = /^[\w.-]{1,120}$/;

const json = (data, status) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function handle(request) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  let ref;
  try { ref = await request.json(); } catch { return json({ error: "The request body is not valid JSON." }, 400); }
  const { creator, slug } = ref ?? {};
  if (!NAME.test(creator ?? "") || !NAME.test(slug ?? "") || [creator, slug].some((s) => /^\.+$/.test(s))) {
    return json({ error: "That is not a Chub character link." }, 400);
  }
  let res;
  try {
    res = await fetch(`${CARDS}/${encodeURIComponent(creator)}/${encodeURIComponent(slug)}/chara_card_v2.png`, {
      headers: { Accept: "image/png" }, signal: AbortSignal.timeout(20000),
    });
  } catch {
    return json({ error: "Could not reach Chub. Try again, or download the card and import the file." }, 502);
  }
  // Chub may hand the card over from its CDN; only a secure address is accepted.
  if (!process.env.CHUB_CARDS_BASE && new URL(res.url).protocol !== "https:") {
    return json({ error: "Chub sent the card over an insecure connection, so it was not imported." }, 502);
  }
  if (res.status === 404) return json({ error: "Chub has no card at that link. Check the link, or the bot may be private or removed." }, 404);
  if (!res.ok) return json({ error: `Chub answered with an error (${res.status}). Download the card from the page and import the file instead.` }, 502);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ error: "That card is too large to import." }, 413);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json({ error: "That card is too large to import." }, 413);
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    return json({ error: "Chub did not send a card picture. Download the card from the page and import the file instead." }, 502);
  }
  return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}

export default { fetch: handle };
