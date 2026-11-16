// VFE back-office: albums, series, collections, Starred, publishing.
// Reads and writes through the local API (src/backoffice/server.js).
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
const SVG = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  trash: SVG('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>'),
  grip: SVG('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14"/>'),
  star: SVG('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>'),
};
const LABEL = { album: "Albums", series: "Series", collection: "Collections", starred: "Starred" };
const ONE = { album: "album", series: "series", collection: "collection" };
const KEY = { album: "albums", series: "series", collection: "collections" };
const MASTER = /\.(png|tiff?|jpe?g)$/i;

let state = null;
let tab = "album";
let open = null; // slug of the item shown, in the current tab

// --- Tools -------------------------------------------------------------------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const iconBtn = (name, label, onclick, cls = "icon-btn") => h("button", { class: cls, type: "button", title: label, "aria-label": label, onclick, html: ICONS[name] });
const list = (kind) => state.data[KEY[kind]];
const item = (kind, slug) => list(kind).find((x) => x.slug === slug);
const title = (x) => (x.subtitle ? `${x.name} · ${x.subtitle}` : x.name);
const thumbUrl = (kind, slug, file) => `/assets/${kind === "album" ? "album" : "series"}/${slug}/thumbs/${file}.avif`;
const moved = (arr, from, to) => {
  const next = [...arr];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};

let statusTimer;
function setStatus(text) {
  $("#status").textContent = text;
  clearTimeout(statusTimer);
  if (text && !text.endsWith("…")) statusTimer = setTimeout(() => ($("#status").textContent = ""), 2500);
}
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 6000);
}
async function load() {
  const r = await fetch("/admin/api/state");
  state = await r.json();
  if (state.error) throw new Error(state.error);
}
async function request(url, init) {
  const r = await fetch(url, init);
  const data = await r.json();
  if (!r.ok || data.error) {
    setStatus("");
    toast(data.error ?? "Could not save.");
    throw new Error(data.error);
  }
  return data.result;
}
async function post(route, body, saving = "Saving…") {
  setStatus(saving);
  const result = await request(`/admin/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  setStatus("Saved");
  return result;
}
// Redraw from the server's state, keeping the scroll position.
async function refresh() {
  const top = document.scrollingElement.scrollTop;
  await load();
  render();
  document.scrollingElement.scrollTop = top;
}
const save = (route, body) => post(route, body).then(refresh, refresh);

function confirmDialog(text, action, destructive = true) {
  return new Promise((ok) => {
    const d = h("dialog", {},
      h("h3", {}, text),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", onclick: () => (d.close(), ok(false)) }, "Cancel"),
        h("button", { class: `btn primary${destructive ? " danger" : ""}`, type: "button", onclick: () => (d.close(), ok(true)) }, action)));
    d.addEventListener("close", () => (d.remove(), ok(false)));
    document.body.append(d);
    d.showModal();
    // A destructive action keeps the focus on Cancel; otherwise Enter confirms.
    d.querySelectorAll(".btn")[destructive ? 0 : 1].focus();
  });
}

// A reorderable list: grip last, drag and drop, Alt + ↑ / ↓.
function sortable(items, row, onMove, rowAttrs = () => ({})) {
  const ul = h("ul", { class: "list" });
  let from = null;
  items.forEach((it, i) => {
    const li = h("li", { tabindex: "0", ...rowAttrs(it, i) }, row(it, i), h("span", { class: "grip", title: "Drag to rearrange", html: ICONS.grip, onmousedown: () => (li.draggable = true), onclick: (e) => e.stopPropagation() }));
    li.addEventListener("dragstart", () => ((from = i), li.classList.add("dragging")));
    li.addEventListener("dragend", () => ((li.draggable = false), li.classList.remove("dragging")));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (from != null && from !== i) onMove(from, i);
      from = null;
    });
    li.addEventListener("keydown", (e) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (to >= 0 && to < items.length) onMove(i, to);
    });
    ul.append(li);
  });
  return ul;
}

const eraLabel = (era) => h("span", { class: "state", "data-state": era }, era === "archive" ? "Archive" : "Current");
const eraSelect = (value, onchange) =>
  h("select", { class: "plain", onchange: (e) => onchange(e.target.value) },
    h("option", { value: "current", selected: value === "current" }, "Current"),
    h("option", { value: "archive", selected: value === "archive" }, "Archive"));
// A text field saved when it loses focus, if it changed.
const field = (value, onsave, attrs = {}) =>
  h("input", { class: "plain", value: value ?? "", ...attrs, onchange: (e) => onsave(e.target.value), onkeydown: (e) => e.key === "Enter" && e.target.blur() });

// --- Lists -------------------------------------------------------------------
function renderList(kind) {
  const items = list(kind);
  const create = async () => {
    const slug = await askSlug(kind);
    if (!slug) return;
    await post("item", { kind, slug, create: true });
    open = slug;
    await refresh();
  };
  const row = (x) => {
    const n = kind === "collection" ? x.albums.length : x.images.length;
    const first = kind !== "collection" && x.images[0];
    return h("span", { class: "grow", style: "display:flex;align-items:center;gap:10px" },
      kind === "collection" ? null : first ? h("img", { class: "thumb", src: thumbUrl(kind, x.slug, first.file), alt: "", loading: "lazy" }) : h("span", { class: "thumb" }),
      h("span", { class: "grow" }, x.name, x.subtitle ? h("span", { class: "subtitle" }, ` · ${x.subtitle}`) : null),
      eraLabel(x.era),
      h("span", { class: "meta" }, kind === "collection" ? `${n} album${n === 1 ? "" : "s"}` : `${n} image${n === 1 ? "" : "s"}`));
  };
  return h("div", { class: "page" },
    h("div", { class: "head" }, h("h1", {}, LABEL[kind]), h("button", { class: "btn", type: "button", onclick: create, html: `${ICONS.plus} New ${ONE[kind]}` })),
    kind === "album" ? h("p", { class: "muted small" }, "The first ten are the site's Latest albums.") : null,
    items.length
      ? sortable(items, row, (from, to) => save("items/order", { kind, slugs: moved(items, from, to).map((x) => x.slug) }), (x) => ({
          class: "row",
          onclick: () => ((open = x.slug), render(), window.scrollTo(0, 0)),
          onkeydown: (e) => e.key === "Enter" && !e.altKey && ((open = x.slug), render()),
        }))
      : h("p", { class: "empty" }, `No ${ONE[kind]} yet.`));
}

function askSlug(kind) {
  return new Promise((ok) => {
    const input = h("input", { class: "field", placeholder: kind === "collection" ? "openWorlds" : "metroExodus", style: "width:100%" });
    const done = (v) => (d.close(), ok(v));
    const d = h("dialog", {},
      h("h3", {}, `New ${ONE[kind]}`),
      h("p", { class: "muted small" }, "Its slug names the address and the media folder; it can't change afterwards."),
      input,
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", onclick: () => done(null) }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onclick: () => done(input.value.trim() || null) }, "Create")));
    input.addEventListener("keydown", (e) => e.key === "Enter" && done(input.value.trim() || null));
    d.addEventListener("close", () => (d.remove(), ok(null)));
    document.body.append(d);
    d.showModal();
    input.focus();
  });
}

// --- One album or series -------------------------------------------------------
function renderItem(kind, x) {
  const set = (patch) => save("item", { kind, slug: x.slug, patch });
  const props = h("div", { class: "props" },
    h("span", { class: "k" }, "Era"), h("div", { class: "v" }, eraSelect(x.era, (era) => set({ era }))),
    ...(kind === "album"
      ? [h("span", { class: "k" }, "Developer"), h("div", { class: "v" }, field(x.developer, (developer) => set({ developer }), { placeholder: "Empty" })),
         h("span", { class: "k" }, "Publisher"), h("div", { class: "v" }, field(x.publisher, (publisher) => set({ publisher }), { placeholder: "Same as developer" }))]
      : [h("span", { class: "k" }, "Description"), h("div", { class: "v" }, field(x.description, (description) => set({ description }), { placeholder: "Empty" }))]),
    h("span", { class: "k" }, "Address"),
    h("div", { class: "v" }, h("a", { class: "muted", href: `/index.html?${kind}=${x.slug}`, target: "_blank" }, `?${kind}=${x.slug}`)));

  const remove = async () => {
    if (!(await confirmDialog(`Delete “${title(x)}” and its ${x.images.length} images?`, "Delete"))) return;
    await post("item/delete", { kind, slug: x.slug });
    open = null;
    await refresh();
  };
  const reencode = async () => {
    if (!(await confirmDialog(`Re-encode the ${x.images.length} images of “${title(x)}” from their downloads?`, "Re-encode", false))) return;
    await post("images/reencode", { kind, slug: x.slug }, "Re-encoding…");
    await refresh();
  };

  return h("div", { class: "page wide" },
    h("button", { class: "back", type: "button", onclick: () => ((open = null), render()) }, `← ${LABEL[kind]}`),
    h("div", { class: "titles" },
      h("input", { class: "title-input", value: x.name, "aria-label": "Name", onchange: (e) => set({ name: e.target.value }), onkeydown: (e) => e.key === "Enter" && e.target.blur() }),
      kind === "album" ? h("input", { class: "subtitle-input", value: x.subtitle, placeholder: "Subtitle", "aria-label": "Subtitle", onchange: (e) => set({ subtitle: e.target.value }), onkeydown: (e) => e.key === "Enter" && e.target.blur() }) : null),
    h("div", { style: "margin-top:14px" }, props),
    h("div", { class: "actions" },
      x.images.length ? h("button", { class: "btn", type: "button", onclick: reencode }, "Re-encode images") : null,
      h("button", { class: "btn danger", type: "button", onclick: remove, html: `${ICONS.trash} Delete ${ONE[kind]}` })),
    h("div", { class: "section" },
      h("p", { class: "section-title" }, `${x.images.length} image${x.images.length === 1 ? "" : "s"}`),
      dropZone(kind, x),
      imageGrid(kind, x)));
}

// Drop masters (PNG, TIFF, JPEG) to add them, in the natural order of their names.
function dropZone(kind, x) {
  const progress = h("p", { class: "progress", hidden: true });
  const input = h("input", { type: "file", multiple: true, accept: ".png,.tif,.tiff,.jpg,.jpeg", hidden: true, id: "pick", onchange: (e) => upload([...e.target.files]) });
  const zone = h("div", { class: "drop" }, "Drop PNG, TIFF or JPEG masters here, or ", h("label", { for: "pick" }, "choose files"), ".", input, progress);
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  zone.addEventListener("dragover", (e) => hasFiles(e) && (e.preventDefault(), zone.classList.add("over")));
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.remove("over");
    upload([...e.dataTransfer.files]);
  });
  async function upload(files) {
    const masters = files.filter((f) => MASTER.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
    if (!masters.length) return toast("Only PNG, TIFF or JPEG files.");
    progress.hidden = false;
    for (const [k, f] of masters.entries()) {
      progress.textContent = `Adding ${k + 1} of ${masters.length}: ${f.name}…`;
      setStatus("Encoding…");
      try {
        await request(`/admin/api/images/add?kind=${kind}&slug=${encodeURIComponent(x.slug)}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      } catch {
        break;
      }
    }
    setStatus("Saved");
    await refresh();
  }
  return zone;
}

// The images: drag to reorder, star to feature, trash to remove.
function imageGrid(kind, x) {
  const grid = h("div", { class: "images" });
  let from = null;
  const files = x.images.map((i) => i.file);
  const reorder = (a, b) => save("images/order", { kind, slug: x.slug, files: moved(files, a, b) });
  x.images.forEach((img, i) => {
    const star = iconBtn("star", img.featured ? "Featured: click to unfeature" : "Feature", (e) => {
      e.stopPropagation();
      save("images/feature", { kind, slug: x.slug, file: img.file, featured: !img.featured });
    });
    if (img.featured) star.classList.add("on");
    const del = iconBtn("trash", "Delete", async (e) => {
      e.stopPropagation();
      if (await confirmDialog(`Delete image ${i + 1}?`, "Delete")) save("images/delete", { kind, slug: x.slug, file: img.file });
    });
    const tile = h("div", { class: `tile${img.featured ? " featured" : ""}`, draggable: "true", tabindex: "0", style: `width:${Math.round(120 * img.ratio)}px`, title: img.file },
      h("img", { src: thumbUrl(kind, x.slug, img.file), alt: "", loading: "lazy" }),
      h("span", { class: "n" }, i + 1),
      h("span", { class: "tools" }, star, del));
    tile.addEventListener("dragstart", (e) => {
      from = i;
      tile.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
    tile.addEventListener("dragover", (e) => {
      if (from == null) return;
      e.preventDefault();
      tile.classList.add("target");
    });
    tile.addEventListener("dragleave", () => tile.classList.remove("target"));
    tile.addEventListener("drop", (e) => {
      if (from == null) return;
      e.preventDefault();
      tile.classList.remove("target");
      // Dropped on the right half: after this image; on the left half: before it.
      const rect = tile.getBoundingClientRect();
      let to = e.clientX - rect.left > rect.width / 2 ? i + 1 : i;
      if (from < to) to--;
      if (to !== from) reorder(from, to);
      from = null;
    });
    tile.addEventListener("keydown", (e) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const to = e.key === "ArrowLeft" ? i - 1 : i + 1;
      if (to >= 0 && to < files.length) reorder(i, to);
    });
    grid.append(tile);
  });
  return grid;
}

// --- One collection -------------------------------------------------------------
function renderCollection(c) {
  const set = (patch) => save("item", { kind: "collection", slug: c.slug, patch });
  const albums = c.albums.map((s) => item("album", s)).filter(Boolean);
  const others = state.data.albums.filter((a) => !c.albums.includes(a.slug));
  const remove = async () => {
    if (!(await confirmDialog(`Delete the collection “${c.name}”? Its albums stay.`, "Delete"))) return;
    await post("item/delete", { kind: "collection", slug: c.slug });
    open = null;
    await refresh();
  };
  return h("div", { class: "page" },
    h("button", { class: "back", type: "button", onclick: () => ((open = null), render()) }, "← Collections"),
    h("div", { class: "titles" }, h("input", { class: "title-input", value: c.name, "aria-label": "Name", onchange: (e) => set({ name: e.target.value }), onkeydown: (e) => e.key === "Enter" && e.target.blur() })),
    h("div", { class: "props", style: "margin-top:14px" },
      h("span", { class: "k" }, "Era"), h("div", { class: "v" }, eraSelect(c.era, (era) => set({ era }))),
      h("span", { class: "k" }, "Description"), h("div", { class: "v" }, field(c.description, (description) => set({ description }), { placeholder: "Empty" }))),
    h("div", { class: "actions" }, h("button", { class: "btn danger", type: "button", onclick: remove, html: `${ICONS.trash} Delete collection` })),
    h("div", { class: "section" },
      h("p", { class: "section-title" }, "Albums"),
      albums.length
        ? sortable(albums, (a) => h("span", { class: "grow" }, title(a), " ", iconBtn("trash", "Remove", () => set({ albums: c.albums.filter((s) => s !== a.slug) }))), (from, to) => set({ albums: moved(c.albums, from, to) }))
        : h("p", { class: "empty" }, "No album yet."),
      others.length
        ? h("div", { class: "add-row" },
            h("select", { class: "field", onchange: (e) => e.target.value && set({ albums: [...c.albums, e.target.value] }) },
              h("option", { value: "" }, "Add an album…"),
              others.map((a) => h("option", { value: a.slug }, title(a)))))
        : null));
}

// --- Starred ------------------------------------------------------------------
function renderStarred() {
  const starred = structuredClone(state.data.starred);
  const commit = () => save("starred", { starred });
  const sourceSelect = (m) => {
    if (Array.isArray(m.source)) return h("span", { class: "muted small" }, `${m.source.length} albums`);
    return h("select", { class: "plain", onchange: (e) => ((m.source = e.target.value), commit()) },
      ["all", "current", "archive"].map((s) => h("option", { value: s, selected: m.source === s }, s === "all" ? "All albums" : s === "current" ? "Current albums" : "Archive albums")));
  };
  const mixRow = (m) =>
    h("span", { class: "grow mix" },
      field(m.name, (name) => ((m.name = name), commit()), { "aria-label": "Name" }),
      sourceSelect(m),
      h("label", { class: "small muted", style: "display:inline-flex;gap:6px;align-items:center" },
        h("input", { type: "checkbox", class: "switch", checked: m.random, onchange: (e) => ((m.random = e.target.checked), commit()) }), "Shuffle"),
      h("input", { class: "plain", type: "number", min: "1", placeholder: "No cap", value: m.count ?? "", title: "Maximum images", onchange: (e) => ((m.count = e.target.value ? Number(e.target.value) : undefined), commit()) }));
  const addMix = () => {
    let n = 1;
    while (starred.mixes.some((m) => m.id === `mix-${n}`)) n++;
    starred.mixes.push({ id: `mix-${n}`, name: "New mix", source: "all", random: false });
    commit();
  };
  const all = [
    ...state.data.albums.map((a) => ({ type: "album", slug: a.slug, label: `Album · ${title(a)}` })),
    ...state.data.series.map((s) => ({ type: "series", slug: s.slug, label: `Series · ${s.name}` })),
    ...state.data.collections.map((c) => ({ type: "collection", slug: c.slug, label: `Collection · ${c.name}` })),
  ];
  const labelOf = (p) => all.find((x) => x.type === p.type && x.slug === p.slug)?.label ?? `${p.type} · ${p.slug}`;
  const unpinned = all.filter((x) => !starred.pinned.some((p) => p.type === x.type && p.slug === x.slug));
  return h("div", { class: "page" },
    h("div", { class: "head" }, h("h1", {}, "Starred")),
    h("p", { class: "muted small" }, "The Explore menu's first section. The first mix is the home page."),
    h("h2", {}, "Mixes"),
    starred.mixes.length
      ? sortable(starred.mixes, (m, i) => h("span", { class: "grow", style: "display:flex;align-items:center;gap:8px" }, mixRow(m), iconBtn("trash", "Delete", () => (starred.mixes.splice(i, 1), commit()))), (a, b) => ((starred.mixes = moved(starred.mixes, a, b)), commit()))
      : h("p", { class: "empty" }, "No mix: the home page is empty."),
    h("div", { class: "add-row" }, h("button", { class: "btn", type: "button", onclick: addMix, html: `${ICONS.plus} Add mix` })),
    h("h2", {}, "Pinned"),
    starred.pinned.length
      ? sortable(starred.pinned, (p, i) => h("span", { class: "grow" }, labelOf(p), " ", iconBtn("trash", "Remove", () => (starred.pinned.splice(i, 1), commit()))), (a, b) => ((starred.pinned = moved(starred.pinned, a, b)), commit()))
      : h("p", { class: "empty" }, "Nothing pinned."),
    unpinned.length
      ? h("div", { class: "add-row" },
          h("select", { class: "field", onchange: (e) => {
            const x = unpinned[Number(e.target.value)];
            if (x) (starred.pinned.push({ type: x.type, slug: x.slug }), commit());
          } }, h("option", { value: "" }, "Pin…"), unpinned.map((x, i) => h("option", { value: i }, x.label))))
      : null);
}

// --- Publish -------------------------------------------------------------------
async function openPublish() {
  const body = h("div", {}, h("p", { class: "muted" }, "Checking…"));
  const message = h("input", { class: "field", placeholder: "Update the gallery", "aria-label": "Commit message" });
  const go = h("button", { class: "btn primary", type: "button", disabled: true }, "Publish");
  const d = h("dialog", { class: "publish" }, h("h3", {}, "Publish"), body,
    h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => d.close() }, "Close"), go));
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  let r;
  try {
    r = await request("/admin/api/publish");
  } catch {
    return d.close();
  }
  const nothing = !r.media.pending && !r.changes.length && !r.unpushed;
  body.replaceChildren(...[
    r.problems.length ? h("ul", { class: "problems" }, r.problems.map((p) => h("li", {}, p))) : null,
    r.media.error ? h("p", { class: "problems" }, "The cdn can't be reached:") : h("p", { class: "section-title" }, r.media.pending ? "Media to mirror" : "Media: in sync with the cdn."),
    r.media.pending || r.media.error ? h("pre", {}, r.media.text) : null,
    h("p", { class: "section-title" }, r.changes.length ? "Site changes" : "Site: nothing to commit."),
    r.changes.length ? h("pre", {}, r.changes.join("\n")) : null,
    r.unpushed ? h("p", { class: "small muted" }, `${r.unpushed} commit${r.unpushed === 1 ? "" : "s"} not pushed yet.`) : null,
    nothing ? null : message,
  ].filter(Boolean));
  go.disabled = nothing || r.problems.length > 0 || r.media.error;
  go.onclick = async () => {
    go.disabled = true;
    go.textContent = "Publishing…";
    try {
      const log = await post("publish", { message: message.value.trim() }, "Publishing…");
      body.replaceChildren(h("p", {}, "Published. The site deploys in a minute or two."), h("pre", {}, log));
      go.remove();
    } catch {
      go.disabled = false;
      go.textContent = "Publish";
    }
  };
  if (!nothing) message.focus();
}

// --- Page ------------------------------------------------------------------------
function render() {
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  let view;
  if (tab === "starred") view = renderStarred();
  else {
    const x = open && item(tab, open);
    if (!x) open = null;
    view = !x ? renderList(tab) : tab === "collection" ? renderCollection(x) : renderItem(tab, x);
  }
  main.replaceChildren(view);
  if (state.problems?.length) toast(state.problems.join(" "));
}

for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    open = null;
    render();
  });
}
$("#publish").addEventListener("click", openPublish);
await load();
render();
