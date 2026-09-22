import { personas, newPersona, getSettings, saveSettings } from "../store.js";
import { estimateTokens } from "../prompt.js";
import { $, esc, icon, avatarHTML, imagePicker, imagePickerHTML, openDialog, confirmDialog, toast, autosize } from "../ui.js";

export async function render(main) {
  main.innerHTML = `
    <div class="wrap page">
      <div class="page-head">
        <div>
          <h1>Personas</h1>
          <p class="lead">Who you are in a chat. Bots see your persona's name wherever <code>{{user}}</code> appears, and its description tells them about you.
            Pick a default here, or switch per chat from the message box.</p>
        </div>
        <button class="btn btn-primary" type="button" id="add">New persona</button>
      </div>
      <ul class="list" id="list"></ul>
    </div>`;

  async function paint() {
    const [list, settings] = await Promise.all([personas.all(), getSettings()]);
    const activeId = list.find((p) => p.id === settings.personaId)?.id ?? list[0]?.id;
    $("#list", main).innerHTML = list.length ? list.map((p) => `
      <li class="list-item ${p.id === activeId ? "is-active" : ""}" data-id="${p.id}">
        ${avatarHTML(p.avatar, p.name, 56)}
        <div class="grow">
          <div class="title">${esc(p.name || "Unnamed")} ${p.id === activeId ? '<span class="chip">Default</span>' : ""}</div>
          <div class="sub">${esc(p.description || "No description. Bots will only know your name.")}</div>
        </div>
        <div class="actions">
          ${p.id === activeId ? "" : `<button class="btn btn-sm" type="button" data-act="default">Make default</button>`}
          <button class="icon-btn" type="button" data-act="edit" aria-label="Edit ${esc(p.name)}">${icon("edit")}</button>
          <button class="icon-btn" type="button" data-act="delete" aria-label="Delete ${esc(p.name)}" ${list.length === 1 ? "disabled title=\"Keep at least one persona\"" : ""}>${icon("trash")}</button>
        </div>
      </li>`).join("") : `<li class="empty"><h2>Nobody yet</h2><p>Make a persona so bots know who they are talking to.</p></li>`;
  }

  function edit(existing) {
    const p = structuredClone(existing ?? newPersona());
    const dlg = openDialog(`
      <form method="dialog" class="dialog-body" novalidate>
        <h2>${existing ? "Edit persona" : "New persona"}</h2>
        <div id="pav">${imagePickerHTML("persona-file", { label: "Upload picture" })}</div>
        <div class="field">
          <label for="p-name">Name</label>
          <input type="text" id="p-name" value="${esc(p.name)}" required autocomplete="off" aria-describedby="p-name-err">
          <p class="error-text" id="p-name-err" hidden>Enter a name.</p>
        </div>
        <div class="field">
          <label for="p-desc">Description <span class="count" id="p-count"></span></label>
          <textarea id="p-desc" placeholder="Appearance, personality, background, how others see you…">${esc(p.description)}</textarea>
          <p class="hint">Sent to the bot with every message. Keep it to what matters in scenes.</p>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="save" id="p-save">Save persona</button>
        </div>
      </form>`);
    const name = $("#p-name", dlg);
    const desc = $("#p-desc", dlg);
    const count = () => { $("#p-count", dlg).textContent = `~${estimateTokens(desc.value)} tokens`; };
    imagePicker($("#pav", dlg), {
      get: () => p.avatar,
      set: (v) => { p.avatar = v; },
      name: () => name.value,
      crop: { round: true, title: "Crop your picture" },
    });
    autosize(desc);
    desc.addEventListener("input", count);
    count();
    name.focus();
    $("#p-save", dlg).addEventListener("click", async (e) => {
      e.preventDefault();
      p.name = name.value.trim();
      p.description = desc.value.trim();
      if (!p.name) {
        name.setAttribute("aria-invalid", "true");
        $("#p-name-err", dlg).hidden = false;
        name.focus();
        return;
      }
      await personas.save(p);
      if ((await personas.all()).length === 1) await saveSettings({ personaId: p.id });
      dlg.close();
      toast(`${p.name} saved.`, "ok");
      paint();
    });
  }

  $("#add", main).addEventListener("click", () => edit(null));
  $("#list", main).addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const p = await personas.get(id);
    if (btn.dataset.act === "edit") edit(p);
    if (btn.dataset.act === "default") { await saveSettings({ personaId: id }); toast(`Now speaking as ${p.name} by default.`, "ok"); paint(); }
    if (btn.dataset.act === "delete") {
      const ok = await confirmDialog({ title: `Delete ${p.name}?`, body: "Chats that used this persona will fall back to your default one.", confirm: "Delete persona", danger: true });
      if (!ok) return;
      await personas.remove(id);
      const settings = await getSettings();
      if (settings.personaId === id) await saveSettings({ personaId: (await personas.all())[0]?.id ?? null });
      paint();
    }
  });

  await paint();
}
