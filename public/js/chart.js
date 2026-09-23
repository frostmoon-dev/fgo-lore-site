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
