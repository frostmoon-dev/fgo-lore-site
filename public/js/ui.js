import { escapeHTML } from "./markdown.js";

// ---------- Icons (24px, stroke) ----------
const P = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  dots: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  book: '<path d="M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2V5Z"/><path d="M5 20a2 2 0 0 0 2 1h12v-3"/><path d="M9 7h6M9 11h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3A6.5 6.5 0 0 1 21.5 20"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-7 3.5-11 8.5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  megaphone: '<path d="M4 10v4h3l7 4V6l-7 4H4Z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.5Z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z"/><path d="M12 14v6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  quill: '<path d="M20 4C12 4 7 9 5 20"/><path d="M8.5 13H14c3 0 5-3 6-9"/>',
  scroll: '<path d="M6 4h11a3 3 0 0 1 0 6h-1v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1h10M6 4a2 2 0 0 0-2 2v11M17 10H8"/>',
};

export function icon(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;
}

export const esc = escapeHTML;

// Builds DOM from an HTML string.
export function html(str) {
  const t = document.createElement("template");
  t.innerHTML = str.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Avatars ----------

export function avatarHTML(src, name, size = 40, cls = "avatar") {
  const inner = src
    ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`
    : `<span class="monogram">${esc((name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`;
  return `<span class="${cls}" style="--size:${size}px">${inner}</span>`;
}

// Loads a file into an <img>, ready for cropping or drawing.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("That file is not an image."));
    if (file.size > 25 * 1024 ** 2) return reject(new Error("That image is larger than 25 MB."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

function encode(canvas, quality) {
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}

// Centre crop without asking, for pictures that arrive inside character cards.
export async function autoCrop(file, size = 384) {
  const { img, release } = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  release();
  return encode(canvas, 0.86);
}

// Drag to move, wheel or slider to zoom. Resolves with a data URL, or null if
// the person cancels.
export async function cropImage(file, { aspect = 1, outW = 384, outH = 384, round = false, title = "Crop picture", quality = 0.86 } = {}) {
  const { img, release } = await loadImage(file);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; release(); resolve(value); } };

    const dlg = openDialog(`
      <div class="dialog-body">
        <h2>${esc(title)}</h2>
        <div class="crop-stage${round ? " is-round" : ""}" id="crop-stage" style="--crop-aspect:${aspect}" tabindex="0"
             role="group" aria-label="Crop area. Drag the picture to move it. Arrow keys nudge it, plus and minus zoom.">
          <img id="crop-img" alt="" draggable="false">
          <span class="crop-ring" aria-hidden="true"></span>
        </div>
        <div class="field">
          <label for="crop-zoom">Zoom</label>
          <input type="range" id="crop-zoom" min="1" max="4" step="0.01" value="1">
        </div>
        <p class="hint">Drag the picture to choose what stays in frame.</p>
        <div class="dialog-actions">
          <button class="btn btn-quiet" type="button" data-act="cancel">Cancel</button>
          <button class="btn" type="button" data-act="reset">Reset</button>
          <button class="btn btn-primary" type="button" data-act="save">Use picture</button>
        </div>
      </div>`, { onClose: () => finish(null) });

    const stage = $("#crop-stage", dlg);
    const view = $("#crop-img", dlg);
    const zoomInput = $("#crop-zoom", dlg);
    view.src = img.src;

    let zoom = 1;
    let ox = 0;
    let oy = 0;
    const box = () => stage.getBoundingClientRect();
    const baseScale = () => Math.max(box().width / img.naturalWidth, box().height / img.naturalHeight);
    const scale = () => baseScale() * zoom;

    function clamp() {
      const { width: w, height: h } = box();
      const dw = img.naturalWidth * scale();
      const dh = img.naturalHeight * scale();
      ox = Math.min(0, Math.max(w - dw, ox));
      oy = Math.min(0, Math.max(h - dh, oy));
    }
    function apply() {
      clamp();
      view.style.width = `${img.naturalWidth * scale()}px`;
      view.style.height = `${img.naturalHeight * scale()}px`;
      view.style.left = `${ox}px`;
      view.style.top = `${oy}px`;
    }
    function reset() {
      zoom = 1;
      zoomInput.value = "1";
      const { width: w, height: h } = box();
      ox = (w - img.naturalWidth * scale()) / 2;
      oy = (h - img.naturalHeight * scale()) / 2;
      apply();
    }
    // Zooms while keeping the point under (cx, cy) where it is.
    function zoomTo(next, cx, cy) {
      const before = scale();
      zoom = Math.min(4, Math.max(1, next));
      const ratio = scale() / before;
      ox = cx - (cx - ox) * ratio;
      oy = cy - (cy - oy) * ratio;
      zoomInput.value = String(zoom);
      apply();
    }

    const points = new Map();
    let pinchStart = 0;
    let zoomStart = 1;
    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 2) {
        const [a, b] = [...points.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = zoom;
      }
    });
    stage.addEventListener("pointermove", (e) => {
      const prev = points.get(e.pointerId);
      if (!prev) return;
      const now = { x: e.clientX, y: e.clientY };
      points.set(e.pointerId, now);
      if (points.size === 2 && pinchStart) {
        const [a, b] = [...points.values()];
        const r = box();
        zoomTo(zoomStart * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      ox += now.x - prev.x;
      oy += now.y - prev.y;
      apply();
    });
    for (const type of ["pointerup", "pointercancel"]) {
      stage.addEventListener(type, (e) => { points.delete(e.pointerId); pinchStart = 0; });
    }
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = box();
      zoomTo(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 32 : 12;
      const r = box();
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) { e.preventDefault(); ox += moves[e.key][0]; oy += moves[e.key][1]; apply(); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(zoom * 1.12, r.width / 2, r.height / 2); }
      if (e.key === "-") { e.preventDefault(); zoomTo(zoom / 1.12, r.width / 2, r.height / 2); }
    });
    zoomInput.addEventListener("input", () => {
      const r = box();
      zoomTo(Number(zoomInput.value), r.width / 2, r.height / 2);
    });

    $("[data-act=reset]", dlg).addEventListener("click", reset);
    $("[data-act=cancel]", dlg).addEventListener("click", () => dlg.close());
    $("[data-act=save]", dlg).addEventListener("click", () => {
      const s = scale();
      const { width: w, height: h } = box();
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, -ox / s, -oy / s, w / s, h / s, 0, 0, outW, outH);
      const url = encode(canvas, quality);
      finish(url);
      dlg.close();
    });

    requestAnimationFrame(reset);
    stage.focus();
  });
}

// Wires a picture picker: preview element, file input, remove button.
export function imagePicker(root, { get, set, name, crop = {}, preview: renderPreview }) {
  const preview = $(".pick-preview", root);
  const input = $("input[type=file]", root);
  const remove = $("[data-remove]", root);
  const paint = () => {
    preview.innerHTML = renderPreview ? renderPreview(get()) : avatarHTML(get(), name?.() ?? "", 96);
    remove.hidden = !get();
  };
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const url = await cropImage(file, crop);
      if (url) { set(url); paint(); }
    } catch (err) {
      toast(err.message, "error");
    }
  });
  remove.addEventListener("click", () => { set(null); paint(); });
  paint();
  return paint;
}

export function imagePickerHTML(id, { label = "Upload picture", hint = "Drag and zoom to crop. PNG, JPG, WebP or GIF.", cls = "avatar-edit" } = {}) {
  return `
    <div class="${cls}">
      <div class="pick-preview"></div>
      <div class="actions">
        <label class="btn" for="${id}">${label}</label>
        <input type="file" id="${id}" accept="image/*" class="sr-only">
        <button type="button" class="btn btn-quiet btn-danger" data-remove>Remove</button>
      </div>
      <p class="hint pick-hint">${hint}</p>
    </div>`;
}

// ---------- Menus ----------
// A small popup list of actions under a button. Arrow keys move, Esc closes
// and returns focus to the button. items: { label, hint, onSelect, danger,
// disabled } or "-" for a divider.

let openMenuEl = null;
export function closeMenu() {
  if (!openMenuEl) return;
  const { el, anchor, cleanup } = openMenuEl;
  openMenuEl = null;
  cleanup();
  el.remove();
  anchor.setAttribute("aria-expanded", "false");
}

export function openMenu(anchor, items, { align = "end" } = {}) {
  if (openMenuEl?.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = html(`<div class="menu" role="menu">${items.map((it, i) => (it === "-"
    ? '<div class="menu-sep" role="separator"></div>'
    : `<button type="button" role="menuitem" class="menu-item${it.danger ? " danger" : ""}" data-i="${i}" ${it.disabled ? "disabled" : ""}>
        <span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</button>`)).join("")}</div>`);
  document.body.append(el);

  const r = anchor.getBoundingClientRect();
  const m = el.getBoundingClientRect();
  const below = r.bottom + 4 + m.height <= innerHeight - 8;
  el.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - 4 - m.height)}px`;
  const left = align === "end" ? r.right - m.width : r.left;
  el.style.left = `${Math.min(innerWidth - m.width - 8, Math.max(8, left))}px`;

  const buttons = $$(".menu-item:not(:disabled)", el);
  const focusAt = (i) => buttons[(i + buttons.length) % buttons.length]?.focus();
  el.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(-1); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); }
    else if (e.key === "Tab") closeMenu();
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    closeMenu();
    items[Number(b.dataset.i)].onSelect?.();
  });
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const away = () => closeMenu();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", away);
  window.addEventListener("hashchange", away);
  openMenuEl = {
    el, anchor,
    cleanup: () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("hashchange", away);
    },
  };
  anchor.setAttribute("aria-expanded", "true");
  focusAt(0);
}

// ---------- Toasts ----------

export function toast(message, kind = "info", { action, onAction, timeout = 4200 } = {}) {
  const box = document.getElementById("toasts");
  const el = html(`<div class="toast ${kind}"><span class="msg-text">${esc(message)}</span></div>`);
  if (action) {
    const b = html(`<button type="button" class="link-btn">${esc(action)}</button>`);
    b.addEventListener("click", () => { onAction?.(); el.remove(); });
    el.append(b);
  }
  const close = html(`<button type="button" class="icon-btn" aria-label="Dismiss">${icon("x")}</button>`);
  close.addEventListener("click", () => el.remove());
  el.append(close);
  box.append(el);
  if (timeout) setTimeout(() => el.remove(), kind === "error" ? timeout * 2 : timeout);
}

// ---------- Dialogs ----------

export function openDialog(content, { wide = false, onClose } = {}) {
  const dlg = document.createElement("dialog");
  if (wide) dlg.className = "wide";
  dlg.append(typeof content === "string" ? html(content) : content);
  document.body.append(dlg);
  dlg.addEventListener("close", () => { onClose?.(dlg.returnValue); dlg.remove(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, body = "", confirm = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>${esc(title)}</h2>
        ${body ? `<p>${esc(body)}</p>` : ""}
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" value="ok" autofocus>${esc(confirm)}</button>
        </div>
      </form>`, { onClose: (v) => resolve(v === "ok") });
    $("[autofocus]", dlg)?.focus();
  });
}

export function promptDialog({ title, label, value = "", confirm = "Save" }) {
  return new Promise((resolve) => {
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body">
        <h2>${esc(title)}</h2>
        <div class="field"><label for="pd-input">${esc(label)}</label>
          <input type="text" id="pd-input" value="${esc(value)}" autocomplete="off"></div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="ok">${esc(confirm)}</button>
        </div>
      </form>`, { onClose: (v) => resolve(v === "ok" ? $("#pd-input", dlg).value.trim() : null) });
    const input = $("#pd-input", dlg);
    input.focus(); input.select();
    // Enter saves (the form's first button is Cancel).
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); dlg.close("ok"); } });
  });
}

// ---------- Misc ----------

export function download(filename, data, type = "application/json") {
  const blob = data instanceof Blob ? data : new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] ?? null);
    input.click();
  });
}

export function slug(s) {
  return String(s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

export function timeAgo(t) {
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), "day");
  return new Date(t).toLocaleDateString();
}

export function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function debounce(fn, ms = 400) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

export function autosize(textarea) {
  const fit = () => { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight + 2}px`; };
  textarea.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

export const parseTags = (s) => [...new Set(String(s).split(",").map((t) => t.trim()).filter(Boolean))];

// Numeric slider + number box kept in sync.
export function sliderHTML({ id, label, min, max, step, value, hint = "", allowBlank = false }) {
  return `<div class="field slider-field">
    <label for="${id}">${esc(label)}</label>
    <div class="slider-row">
      <input type="range" id="${id}-range" min="${min}" max="${max}" step="${step}" value="${value === "" ? min : value}" aria-label="${esc(label)}" tabindex="-1">
      <input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${esc(value)}" ${allowBlank ? 'placeholder="default"' : ""} inputmode="decimal">
    </div>
    ${hint ? `<p class="hint">${hint}</p>` : ""}
  </div>`;
}

export function wireSlider(root, id, onChange) {
  const num = $(`#${id}`, root);
  const range = $(`#${id}-range`, root);
  range.addEventListener("input", () => { num.value = range.value; onChange?.(); });
  num.addEventListener("input", () => { if (num.value !== "") range.value = num.value; onChange?.(); });
}
