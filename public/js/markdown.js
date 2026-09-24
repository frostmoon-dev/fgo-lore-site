// Small, safe Markdown renderer. Text is escaped first, so bot cards and
// model output can never inject HTML. Supports *actions* in italics, the
// usual roleplay convention.

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inline(s, { quotes }) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    // An action whose closing * never came (a cut-off or still-streaming
    // reply) runs in italics to the end of the line instead of showing a *.
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]+)$/, "$1<em>$2</em>");
  if (quotes) s = s.replace(/(&quot;|“)(.+?)(&quot;|”)/g, '<span class="q">$1$2$3</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// One line of a message for lists (recent chats, pinned moments): cut at a
// word near `max` characters, with *actions* and **bold** still formatted.
export function previewHTML(src, max = 120) {
  let text = String(src ?? "").replace(/\s+/g, " ").trim();
  if (text.length > max) {
    text = text.slice(0, max).replace(/\s+\S*$/, "").replace(/[\s*_~]+$/, "");
    if ((text.match(/\*\*/g) || []).length % 2) text = text.replace(/\*\*(?!.*\*\*)/, ""); // a bold cut in half
    text += "…";
  }
  return inline(escapeHTML(text), { quotes: false });
}

export function renderMarkdown(src, { quotes = false } = {}) {
  const lines = escapeHTML(src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;
  let fence = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, { quotes })).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, { quotes })}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${fence.join("\n")}</code></pre>`); fence = null; }
      else fence.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); fence = []; continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^&gt;\s?(.*)$/);

    if (!line.trim()) { flushPara(); flushList(); }
    else if (heading) {
      flushPara(); flushList();
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inline(heading[2], { quotes })}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet ?? numbered)[1]);
    } else if (quote) {
      flushPara(); flushList();
      out.push(`<blockquote>${inline(quote[1], { quotes })}</blockquote>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  if (fence !== null) out.push(`<pre><code>${fence.join("\n")}</code></pre>`);
  flushPara(); flushList();
  return out.join("");
}
