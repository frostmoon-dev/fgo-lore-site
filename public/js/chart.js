// A small line chart of one character's bond over a chat. One series per
// chart (a chart per character), so no legend is needed: the heading names
// it. The y axis is the 0–100 bond meter with the bot's level names as
// reference lines. Hover or focus shows the value at each reply; a table
// view carries the same numbers for screen readers and print.
import { esc } from "./ui.js";

const W = 640;
const H = 200;
const PAD = { top: 12, right: 44, bottom: 28, left: 128 };

// points: [{ x: message number (0 = start), value, label }]
export function bondChartHTML({ id, name, points, levels }) {
  if (points.length < 2) {
    return `<p class="hint">No bond changes yet with ${esc(name)}. The chart fills in as the chat goes on.</p>`;
  }
  const maxX = Math.max(1, points.at(-1).x);
  const px = (x) => PAD.left + (x / maxX) * (W - PAD.left - PAD.right);
  const py = (v) => PAD.top + (1 - v / 100) * (H - PAD.top - PAD.bottom);
  // A step line: the bond holds its value until the next reply changes it.
  const d = points.map((p, i) => (i === 0 ? `M${px(p.x)},${py(p.value)}` : `H${px(p.x)}V${py(p.value)}`)).join("");
  const end = points.at(-1);

  return `<figure class="bond-chart" data-chart="${esc(id)}">
    <div class="bond-chart-plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${name}'s bond over this chat, from ${points[0].value} to ${end.value} out of 100`)}">
        ${levels.map((l) => `
          <line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${py(l.at)}" y2="${py(l.at)}"/>
          <text class="axis" x="${PAD.left - 8}" y="${py(l.at) + 4}" text-anchor="end">${esc(l.label)}</text>`).join("")}
        <text class="axis" x="${PAD.left}" y="${H - 8}">Start</text>
        <text class="axis" x="${W - PAD.right}" y="${H - 8}" text-anchor="end">Message ${maxX}</text>
        <path class="series" d="${d}"/>
        <circle class="end" cx="${px(end.x)}" cy="${py(end.value)}" r="4"/>
        <text class="value" x="${px(end.x) + 8}" y="${py(end.value) + 4}">${end.value}</text>
        <line class="crosshair" y1="${PAD.top}" y2="${H - PAD.bottom}" hidden/>
        <circle class="hover-dot" r="4" hidden/>
        <rect class="hit" x="${PAD.left}" y="0" width="${W - PAD.left - PAD.right}" height="${H}" tabindex="0"
          aria-label="Explore the chart with the arrow keys"/>
      </svg>
      <div class="chart-tip" role="status" hidden></div>
    </div>
    <details class="more chart-table">
      <summary>Show as a table</summary>
      <table>
        <thead><tr><th scope="col">After message</th><th scope="col">Bond</th><th scope="col">Level</th></tr></thead>
        <tbody>${points.map((p) => `<tr><td>${p.x === 0 ? "Start" : p.x}</td><td>${p.value}</td><td>${esc(p.label)}</td></tr>`).join("")}</tbody>
      </table>
    </details>
  </figure>`;
}

// Crosshair and tooltip: pointer, touch and arrow keys.
export function wireBondChart(root, points) {
  if (points.length < 2) return;
  const svg = root.querySelector("svg");
  const hit = root.querySelector(".hit");
  const cross = root.querySelector(".crosshair");
  const dot = root.querySelector(".hover-dot");
  const tip = root.querySelector(".chart-tip");
  const maxX = Math.max(1, points.at(-1).x);
  const px = (x) => PAD.left + (x / maxX) * (W - PAD.left - PAD.right);
  const py = (v) => PAD.top + (1 - v / 100) * (H - PAD.top - PAD.bottom);
  let active = points.length - 1;

  function show(i) {
    active = Math.max(0, Math.min(points.length - 1, i));
    const p = points[active];
    const x = px(p.x);
    const y = py(p.value);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.removeAttribute("hidden");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.removeAttribute("hidden");
    tip.hidden = false;
    tip.innerHTML = `<span><strong>${p.value}</strong> · ${esc(p.label)}</span><small>${p.x === 0 ? "At the start" : `After message ${p.x}`}</small>`;
    // Place the tip beside the point, flipping left near the right edge.
    const scale = svg.getBoundingClientRect().width / W;
    const left = x * scale;
    tip.style.top = `${Math.max(0, y * scale - 48)}px`;
    tip.style.left = left > svg.getBoundingClientRect().width * 0.7 ? "" : `${left + 12}px`;
    tip.style.right = left > svg.getBoundingClientRect().width * 0.7 ? `${svg.getBoundingClientRect().width - left + 12}px` : "";
  }
  function hide() { cross.setAttribute("hidden", ""); dot.setAttribute("hidden", ""); tip.hidden = true; }
  function nearest(clientX) {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(px(p.x) - x) < Math.abs(px(points[best].x) - x)) best = i; });
    return best;
  }
  hit.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  hit.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
  hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  hit.addEventListener("focus", () => show(active));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); show(active - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(active + 1); }
    if (e.key === "Home") { e.preventDefault(); show(0); }
    if (e.key === "End") { e.preventDefault(); show(points.length - 1); }
  });
}

// ---------- Usage bars ----------
// Tokens per day for the last N days: one series, so no legend; the card's
// heading names it. Bars are thin with a rounded top; hover, tap or the
// arrow keys show the exact numbers, and the table below has them all.
// Drawn at roughly the width it is shown, so its text matches the page.
const UW = 960;
const UH = 220;
const UP = { top: 16, right: 12, bottom: 28, left: 52 };

const niceMax = (v) => {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((n) => n >= v);
};
export const shortNumber = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));

// days: [{ key, label, total, prompt, completion, requests }]
export function usageChartHTML(days) {
  const max = niceMax(Math.max(...days.map((d) => d.total)));
  const band = (UW - UP.left - UP.right) / days.length;
  const barW = Math.min(24, band * 0.6);
  const py = (v) => UP.top + (1 - v / max) * (UH - UP.top - UP.bottom);
  const base = py(0);
  const ticks = [0, max / 2, max];
  const step = Math.ceil(days.length / 7); // a date under every other bar, never crowding the last
  return `<figure class="usage-chart">
    <div class="bond-chart-plot">
      <svg viewBox="0 0 ${UW} ${UH}" role="img" aria-label="Tokens used per day over the last ${days.length} days">
        ${ticks.map((t) => `<line class="grid" x1="${UP.left}" x2="${UW - UP.right}" y1="${py(t)}" y2="${py(t)}"/>
          <text class="axis" x="${UP.left - 8}" y="${py(t) + 4}" text-anchor="end">${shortNumber(t)}</text>`).join("")}
        ${days.map((d, i) => {
          const x = UP.left + band * i + (band - barW) / 2;
          const h = Math.max(d.total ? 2 : 0, base - py(d.total));
          const r = Math.min(4, h / 2, barW / 2);
          // Rounded at the top, square at the baseline.
          const path = h ? `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + barW - r}Q${x + barW},${base - h} ${x + barW},${base - h + r}V${base}Z` : "";
          return `<path class="bar" d="${path}"/>
            ${(i % step === 0 && days.length - 1 - i >= step) || i === days.length - 1 ? `<text class="axis" x="${x + barW / 2}" y="${UH - 8}" text-anchor="middle">${d.label}</text>` : ""}
            <rect class="bar-hit" data-i="${i}" x="${UP.left + band * i}" y="${UP.top}" width="${band}" height="${UH - UP.top - UP.bottom}" tabindex="${i === days.length - 1 ? 0 : -1}"
              aria-label="${d.label}: ${d.total.toLocaleString()} tokens"/>`;
        }).join("")}
      </svg>
      <div class="chart-tip" role="status" hidden></div>
    </div>
  </figure>`;
}

export function wireUsageChart(root, days) {
  const svg = root.querySelector("svg");
  const tip = root.querySelector(".chart-tip");
  const hits = [...root.querySelectorAll(".bar-hit")];
  const show = (i) => {
    const d = days[i];
    hits.forEach((h, j) => h.classList.toggle("is-active", j === i));
    tip.hidden = false;
    tip.innerHTML = `<span><strong>${d.total.toLocaleString()}</strong> tokens</span><small>${d.label} · ${d.requests} request${d.requests === 1 ? "" : "s"} · ${d.prompt.toLocaleString()} in, ${d.completion.toLocaleString()} out</small>`;
    const r = svg.getBoundingClientRect();
    const box = hits[i].getBoundingClientRect();
    const left = box.left - r.left + box.width / 2;
    tip.style.top = "0px";
    tip.style.left = left > r.width * 0.6 ? "" : `${left + 8}px`;
    tip.style.right = left > r.width * 0.6 ? `${r.width - left + 8}px` : "";
  };
  const hide = () => { tip.hidden = true; hits.forEach((h) => h.classList.remove("is-active")); };
  hits.forEach((h, i) => {
    h.addEventListener("pointerenter", () => show(i));
    h.addEventListener("pointerdown", () => show(i));
    h.addEventListener("focus", () => show(i));
    h.addEventListener("keydown", (e) => {
      const next = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
      if (next === null || !hits[next]) return;
      e.preventDefault();
      h.tabIndex = -1; hits[next].tabIndex = 0; hits[next].focus();
    });
  });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget)) hide(); });
}
