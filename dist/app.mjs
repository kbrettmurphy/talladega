import { tripDays, tripEnd, allMealSlots, mealSlots, sizes, shirtTotals } from "./trip.mjs?v=2026-10-11.1";
if (new URLSearchParams(location.search).has("debug")) import("./debug.mjs");

const endpoint =
  "https://sdfleesxvattrwcsavqc.supabase.co/functions/v1/reunion-api";
const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const photoAccept = "image/*,.heic,.heif";
const blankTrip = { start: "", end: "", camp: "", sites: "", notes: "" };

// Older iPhones (iOS before 15.4) have no <dialog> or crypto.randomUUID; give them minimal stand-ins.
if (!crypto.randomUUID)
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        c ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16),
    );
if (
  typeof HTMLDialogElement !== "function" ||
  !HTMLDialogElement.prototype.showModal
) {
  document.documentElement.classList.add("no-dialog");
  for (const d of document.querySelectorAll("dialog")) {
    Object.defineProperty(d, "open", {
      get() {
        return this.hasAttribute("open");
      },
    });
    d.showModal = function () {
      this.setAttribute("open", "");
    };
    d.close = function () {
      if (this.hasAttribute("open")) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      }
    };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  });
}

let year = new Date().getFullYear(),
  years = [],
  records = [],
  token = localStorage.getItem("reunion-session") || "",
  loadingSequence = 0,
  lastLoad = 0;
let me = readJSON("reunion-me");
let albumYear = null,
  albumRecords = [],
  albumSequence = 0,
  viewerIndex = -1,
  viewerMode = "album"; // album | shirt | candidates
const photoURLs = new Map(),
  readyURLs = new Map();
let weatherCache,
  weatherSequence = 0;

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const icons = {
  home: svg(
    '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  ),
  meals: svg(
    '<path d="M7 3v18M4.5 3v5.5a2.5 2.5 0 0 0 5 0V3"/><path d="M17.5 21V3c-2.3 1-3.5 3.8-3.5 7.5V14h3.5"/>',
  ),
  people: svg(
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.7 3.2-6 6.5-6s5.9 2.3 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M17.5 14.2c2.3.4 3.7 2.4 4 5.3"/>',
  ),
  shirts: svg(
    '<path d="M8.5 4 3.5 6.8 5 11l2.2-.9V20h9.6v-9.9L19 11l1.5-4.2L15.5 4a3.5 3.5 0 0 1-7 0Z"/>',
  ),
  chat: svg(
    '<path d="M12 4.5c4.7 0 8.5 3 8.5 6.8s-3.8 6.7-8.5 6.7c-.9 0-1.8-.1-2.6-.3L5 19.5l1-3.4c-1.6-1.2-2.5-2.9-2.5-4.8 0-3.8 3.8-6.8 8.5-6.8Z"/>',
  ),
  photos: svg(
    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-4.5-4.5-8.5 7.5"/>',
  ),
  person: svg(
    '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5"/>',
  ),
};

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}
const format = (d, opts = { month: "short", day: "numeric" }) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    ...opts,
    timeZone: "UTC",
  });
const shortDate = (d) =>
  format(d, { weekday: "short", month: "short", day: "numeric" });
const plural = (n, one, many = one + "s") => n + " " + (n === 1 ? one : many);
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const dataOf = (kind, rows = records) =>
  rows.filter((r) => r.kind === kind).map((r) => ({ ...r.data, id: r.id }));
const trip = () => dataOf("trip")[0] || blankTrip;
const people = () =>
  dataOf("person").sort(
    (a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name),
  );
const crews = () =>
  [
    ...new Set([
      ...dataOf("person").map((p) => p.family),
      ...dataOf("meal").map((m) => m.family),
      me?.crew,
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
const isMe = (name) =>
  !!me && String(name).trim().toLowerCase() === me.name.trim().toLowerCase();
// Shirt photos and design candidates are stored as photos but stay out of the album.
const inAlbum = (p) => !p.shirt && !p.candidate;
const albumPhotos = () =>
  dataOf("photo", albumRecords)
    .filter(inAlbum)
    .sort((a, b) => (a.created || "").localeCompare(b.created || ""));
const shirtPlan = () =>
  dataOf("shirt")[0] || { color: "", hex: "", photo: "", notes: "" };
const shirtPhoto = () => {
  const id = shirtPlan().photo;
  return id ? dataOf("photo").find((p) => p.id === id) : null;
};
const candidates = () =>
  dataOf("photo")
    .filter((p) => p.candidate)
    .sort((a, b) => (a.created || "").localeCompare(b.created || ""));
// Votes for designs that were since removed don't count.
const votes = () => {
  const ids = new Set(candidates().map((c) => c.id));
  return dataOf("vote").filter((v) => ids.has(v.candidate));
};
const myVote = () => votes().find((v) => isMe(v.voter));
const viewerList = () =>
  viewerMode === "shirt"
    ? [shirtPhoto()].filter(Boolean)
    : viewerMode === "candidates"
      ? candidates()
      : albumPhotos();
const viewerYear = () => (viewerMode === "album" ? albumYear : year);
// Accepts #RGB, #RRGGBB, or "r, g, b" (0-255) and returns #RRGGBB, or '' when it can't be read.
function parseColor(input) {
  const v = String(input).trim();
  let m = v.match(/^#?([0-9a-f]{6})$/i);
  if (m) return "#" + m[1].toUpperCase();
  m = v.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return "#" + (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = v.match(
    /^(?:rgb\s*\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/i,
  );
  if (m && m.slice(1).every((n) => +n <= 255))
    return (
      "#" +
      m
        .slice(1)
        .map((n) => (+n).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  return "";
}
const rgbOf = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");

// ---------- Appearance ----------
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const choice = localStorage.getItem("reunion-theme"),
    root = document.documentElement;
  if (choice === "light" || choice === "dark") root.dataset.theme = choice;
  else delete root.dataset.theme;
  const dark = choice === "dark" || (choice !== "light" && darkQuery.matches);
  $('meta[name="theme-color"]').content = document.body.classList.contains(
    "locked",
  )
    ? "#0b1426"
    : dark
      ? "#000000"
      : "#f2f2f7";
}
darkQuery.addEventListener("change", applyTheme);

// ---------- Plumbing ----------
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("visible");
  try {
    el.hidePopover();
  } catch {}
  try {
    el.showPopover();
  } catch {}
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.classList.remove("visible");
    try {
      el.hidePopover();
    } catch {}
  }, 4000);
}
async function api(action, init = {}, extra = {}, requestYear = year) {
  const u = new URL(endpoint);
  u.searchParams.set("action", action);
  u.searchParams.set("year", requestYear);
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, {
    ...init,
    headers: { "x-reunion-session": token, ...init.headers },
  });
  if (!r.ok) {
    const err = await r
      .json()
      .catch(() => ({ error: "Connection failed. Please try again." }));
    if (r.status === 401 && action !== "login") lock();
    throw new Error(err.error);
  }
  return action === "photo" ? r.blob() : r.json();
}
const put = (kind, data, id = crypto.randomUUID(), saveYear = year) =>
  api(
    "save",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, data, id }),
    },
    {},
    saveYear,
  );
async function save(kind, data, id) {
  await put(kind, data, id);
  await load();
  toast("Saved for the whole family.");
}
const remove = (id, removeYear = year) =>
  api("delete", { method: "DELETE" }, { id }, removeYear);
async function run(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function load() {
  const seq = ++loadingSequence,
    selected = year;
  const rows = await api("state");
  if (seq !== loadingSequence || selected !== year) return;
  records = rows;
  lastLoad = Date.now();
  if (albumYear === year) albumRecords = records;
  render();
}

// ---------- Markup helpers ----------
function row({
  title,
  sub = "",
  value = "",
  tag = "div",
  attrs = "",
  cls = "",
  valueCls = "",
}) {
  const type = tag === "button" ? ' type="button"' : "";
  return `<${tag} class="row ${cls}"${type} ${attrs}><span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ""}</span>${value !== "" ? `<span class="row-value ${valueCls}">${esc(value)}</span>` : ""}</${tag}>`;
}
const note = (text) =>
  `<div class="row"><span class="row-sub">${esc(text)}</span></div>`;
const empty = (text, label = "", attr = "") =>
  `<div class="empty"><p>${esc(text)}</p>${label ? `<button type="button" class="button tinted" ${attr}>${esc(label)}</button>` : ""}</div>`;
const group = (title, inner, extra = "") =>
  `<div class="group"><div class="group-head"><h2>${esc(title)}</h2>${extra}</div>${inner}</div>`;
const sizeOptions = (current = "") =>
  '<option value="">Not yet</option>' +
  ["Youth", "Adult"]
    .map(
      (g) =>
        `<optgroup label="${g}">${sizes
          .filter((s) => s.startsWith(g))
          .map(
            (s) => `<option ${s === current ? "selected" : ""}>${s}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("");

// A crew is the group that travels, camps, and cooks together. Stored in the record's `family` field.
function crewField(current = "", none = "") {
  const list = crews();
  if (current && !list.includes(current)) list.push(current);
  const startNew = !none && !current;
  return `<label class="field"><span>Crew</span><select name="crew">${none ? `<option value="">${esc(none)}</option>` : ""}${list.map((c) => `<option ${c === current ? "selected" : ""}>${esc(c)}</option>`).join("")}<option value="__new__" ${startNew ? "selected" : ""}>New crew…</option></select></label><label class="field" data-new-crew><span>Crew name</span><input name="newCrew" maxlength="100" placeholder="e.g. Mike & Lisa"></label>`;
}
function bindCrew(form, required = false) {
  const pick = form.elements.crew,
    box = $("[data-new-crew]", form),
    input = form.elements.newCrew;
  const sync = () => {
    box.hidden = pick.value !== "__new__";
    input.required = required && !box.hidden;
  };
  pick.addEventListener("change", () => {
    sync();
    if (!box.hidden) input.focus();
  });
  sync();
}
const crewValue = (f) =>
  f.elements.crew.value === "__new__"
    ? f.elements.newCrew.value.trim()
    : f.elements.crew.value;

// ---------- Photo preparation ----------
// Every upload is decoded in the browser, scaled so its long edge is at most 2560 px, and re-encoded as
// JPEG. That shrinks phone photos to roughly 0.5–1 MB, strips location metadata, and turns HEIC into
// something every browser can show. Safari reads HEIC itself; other browsers load a converter on demand.
const maxEdge = 2560,
  jpegQuality = 0.85,
  maxSourceBytes = 60 * 1024 * 1024;
const isHeic = (file) =>
  /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
let heicConverter;
function loadHeicConverter() {
  return (heicConverter ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/heic2any.min.js";
    script.onload = () => resolve(window.heic2any);
    script.onerror = () => {
      heicConverter = null;
      reject(
        new Error(
          "Couldn’t load the HEIC converter. Check your connection and try again.",
        ),
      );
    };
    document.head.append(script);
  }));
}
async function decodeImage(blob) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {}
  }
  const img = new Image(),
    url = URL.createObjectURL(blob);
  try {
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
async function preparePhoto(file) {
  if (file.size > maxSourceBytes)
    throw new Error(`${file.name} is too large (over 60 MB).`);
  let image = await decodeImage(file);
  if (!image && isHeic(file)) {
    const heic2any = await loadHeicConverter();
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.92,
    }).catch(() => null);
    if (converted)
      image = await decodeImage(
        Array.isArray(converted) ? converted[0] : converted,
      );
  }
  if (!image)
    throw new Error(`${file.name} isn’t a photo this browser can read.`);
  const width = image.naturalWidth || image.width,
    height = image.naturalHeight || image.height,
    scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", jpegQuality),
  );
  canvas.width = canvas.height = 0;
  if (!blob)
    throw new Error(`Couldn’t prepare ${file.name}. Try a different photo.`);
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
}

// ---------- Sheets ----------
function sheet({
  title,
  body,
  save: saveLabel = "Save",
  cancel = "Cancel",
  onSave,
  danger,
}) {
  const d = $("#sheet");
  d.innerHTML = `<form><header class="sheet-bar">${onSave ? `<button type="button" class="bar-button" data-close>${esc(cancel)}</button>` : "<span></span>"}<h2 tabindex="-1" autofocus>${esc(title)}</h2>${onSave ? `<button class="bar-button strong">${esc(saveLabel)}</button>` : '<button type="button" class="bar-button strong" data-close>Done</button>'}</header><div class="sheet-body">${body}${danger ? `<div class="group"><div class="list"><button type="button" class="row center danger-text" data-danger>${esc(danger.label)}</button></div></div>` : ""}</div></form>`;
  const form = $("form", d);
  $$("[data-close]", d).forEach((b) => (b.onclick = () => d.close()));
  form.onsubmit = (e) => {
    e.preventDefault();
    run($(".strong", form), async () => {
      if ((await onSave(form)) !== false) d.close();
    });
  };
  if (danger)
    $("[data-danger]", form).onclick = (e) =>
      run(e.currentTarget, async () => {
        if ((await danger.run(form)) !== false) d.close();
      });
  if (!d.open) {
    d.showModal();
    setTimeout(() => d.getAnimations?.().forEach((a) => a.finish()), 600);
  }
  $(".sheet-body", d).scrollTop = 0;
  return form;
}

function tripSheet() {
  const t = trip();
  const form = sheet({
    title: `${year} trip`,
    body: `<div class="list">
    <label class="field"><span>Arrival</span><input type="date" name="start" value="${esc(t.start)}" min="${year}-01-01" max="${year}-12-31"></label>
    <label class="field"><span>Departure</span><input type="date" name="end" value="${esc(tripEnd(t))}" min="${esc(t.start || year+'-01-01')}"></label>
    <label class="field"><span>Campground</span><input name="camp" maxlength="100" value="${esc(t.camp)}" placeholder="e.g. GEICO West B"></label>
    <label class="field"><span>Sites</span><input name="sites" maxlength="100" value="${esc(t.sites)}" placeholder="e.g. 524 & 525"></label>
  </div>
  <div class="group"><div class="list"><label class="field stack"><span>Camping notes</span><textarea name="notes" maxlength="3000" placeholder="Arrival plans, what to bring, where to meet…">${esc(t.notes)}</textarea></label></div></div>`,
    onSave: async (f) => {
      const d = Object.fromEntries(new FormData(f));
      if (d.start || d.end) tripDays(d.start, d.end);
      if (
        t.start &&
        (t.start !== d.start || tripEnd(t) !== d.end) &&
        dataOf("meal").some((m) => m.family) &&
        !confirm(
          "Changing dates creates new meal slots. Existing claims stay saved with their old dates. Continue?",
        )
      )
        return false;
      await save("trip", d);
    },
  });
  form.elements.start.onchange = () => {
    form.elements.end.min = form.elements.start.value || year+'-01-01';
  };
}

// "Added by Valerie · Last changed by Linda, Sat, Oct 10 · 3:42 PM" (names come from each device's "Who's this?").
function mealHistory(m, slot) {
  const changed = records.find((r) => r.id === `${year}-meal-${slot}`)?.updated_at;
  const added = m.addedBy ? `Added by ${m.addedBy}` : "";
  if (m.by && m.by !== m.addedBy) return [added, `Last changed by ${m.by}, ${when(changed)}`].filter(Boolean).join(" · ");
  return added && changed ? `${added}, ${when(changed)}` : added;
}

function addMealSheet(date) {
  const planned = mealSlots(trip().start, tripEnd(trip()), dataOf("meal")).map((s) => s.id);
  const missing = allMealSlots(date, date).filter((s) => !planned.includes(s.id));
  if (missing.length === 1) return mealSheet(missing[0].id);
  const form = sheet({
    title: "Add a meal",
    body: group(
      format(date, { weekday: "long", month: "short", day: "numeric" }),
      `<div class="list">${missing.map((s) => row({ tag: "button", attrs: `data-pick-meal="${s.id}"`, cls: "nav", title: s.meal })).join("")}</div>`,
    ),
  });
  $$("[data-pick-meal]", form).forEach((b) => (b.onclick = () => mealSheet(b.dataset.pickMeal)));
}

function mealSheet(slot) {
  const s = allMealSlots(trip().start, tripEnd(trip())).find((x) => x.id === slot);
  if (!s) return;
  const m = dataOf("meal").find((x) => x.slot === slot) || {
    family: "",
    menu: "",
  };
  const inPlan = mealSlots(trip().start, tripEnd(trip()), dataOf("meal")).some((x) => x.id === slot);
  const form = sheet({
    title: `${format(s.date, { weekday: "long" })} ${s.meal.toLowerCase()}`,
    save: !inPlan ? "Add" : m.family ? "Save" : "Claim",
    body: `<div class="list">${crewField(m.family || me?.crew || "", "Nobody yet")}</div>
      <div class="group"><div class="list"><label class="field stack"><span>On the menu</span><textarea name="menu" maxlength="1000" placeholder="Main dish, sides, supplies needed…">${esc(m.menu)}</textarea></label></div>${inPlan ? `<p class="group-foot">${esc(mealHistory(m, slot))}</p>` : ""}</div>`,
    onSave: (f) =>
      save("meal", { slot, family: crewValue(f), menu: f.elements.menu.value, included: true, by: me?.name || "" }),
    danger: inPlan
      ? {
          label: "Remove meal from plan",
          run: () => save("meal", { slot, family: m.family, menu: m.menu, included: false, by: me?.name || "" }),
        }
      : null,
  });
  bindCrew(form);
}

function personSheet(id) {
  const p = id
    ? dataOf("person").find((x) => x.id === id)
    : { name: "", family: me?.crew || "", size: "", diet: "" };
  if (!p) return;
  const form = sheet({
    title: id ? "Edit person" : "Add person",
    save: id ? "Save" : "Add",
    body: `<div class="list">
      <label class="field"><span>Name</span><input name="name" required maxlength="100" value="${esc(p.name)}" placeholder="First and last" autocomplete="off"></label>
      ${crewField(p.family)}
      <label class="field"><span>Shirt size</span><select name="size">${sizeOptions(p.size)}</select></label>
      <label class="field"><span>Food needs</span><input name="diet" maxlength="300" value="${esc(p.diet)}" placeholder="Allergies or diets"></label>
    </div><p class="group-foot">A crew is whoever travels, camps, and cooks together. Name it after the grown-ups, like “Mike & Lisa.”</p>`,
    onSave: (f) =>
      save(
        "person",
        {
          name: f.elements.name.value,
          family: crewValue(f),
          size: f.elements.size.value,
          diet: f.elements.diet.value,
        },
        id || crypto.randomUUID(),
      ),
    danger: id
      ? {
          label: "Remove from roster",
          run: async () => {
            if (!confirm(`Remove ${p.name} for everyone?`)) return false;
            await remove(id);
            await load();
            toast("Removed.");
          },
        }
      : null,
  });
  bindCrew(form, true);
}

function shirtSheet() {
  const plan = shirtPlan(),
    current = shirtPhoto();
  const form = sheet({
    title: `${year} shirt`,
    body: `<div class="list">
      <label class="field"><span>Color name</span><input name="color" maxlength="100" value="${esc(plan.color)}" placeholder="e.g. Safety orange"></label>
      <div class="field"><span>Exact color</span><input name="hex" maxlength="20" value="${esc(plan.hex)}" placeholder="#FF6A13 or 255, 106, 19" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Color code"><input type="color" class="swatch-input" value="${esc(plan.hex || "#0A6CFF")}" aria-label="Pick a color"></div>
    </div>
    <p class="group-foot" data-color-note></p>
    <div class="group"><div class="list">
      ${current ? `<div class="row shirt-photo-row"><img class="shirt-thumb" alt="Current shirt photo" data-shirt-thumb><span class="row-main">Current photo</span><label class="row-switch">Remove <input type="checkbox" name="removePhoto" class="switch"></label></div>` : ""}
      <label class="field"><span>${current ? "Replace photo" : "Shirt photo"}</span><input name="photo" type="file" accept="${photoAccept}"></label>
    </div><p class="group-foot">A mockup, a sample, or last year’s shirt. Any photo works, including iPhone HEIC.</p></div>
    <div class="group"><div class="list"><label class="field stack"><span>Design and order notes</span><textarea name="notes" maxlength="3000" placeholder="Design idea, order deadline, printer…">${esc(plan.notes)}</textarea></label></div></div>`,
    onSave: async (f) => {
      const typed = f.elements.hex.value.trim(),
        hex = typed ? parseColor(typed) : "";
      if (typed && !hex)
        throw new Error(
          "Use a color code like #FF6A13 or RGB numbers like 255, 106, 19.",
        );
      const file = f.elements.photo.files[0];
      let photo = plan.photo || "";
      if (file) {
        const button = $(".strong", f);
        button.textContent = "Preparing…";
        const body = new FormData();
        body.append(
          "file",
          await preparePhoto(file).finally(() => {
            button.textContent = "Save";
          }),
        );
        body.append("caption", `${year} shirt`);
        body.append("purpose", "shirt");
        photo = (await api("upload", { method: "POST", body })).id || "";
      } else if (f.elements.removePhoto?.checked) photo = "";
      await save("shirt", {
        color: f.elements.color.value,
        hex,
        photo,
        notes: f.elements.notes.value,
      });
      if (plan.photo && plan.photo !== photo)
        await remove(plan.photo)
          .then(load)
          .catch(() => {});
    },
  });
  const text = form.elements.hex,
    picker = $(".swatch-input", form),
    noteEl = $("[data-color-note]", form);
  const sync = () => {
    const hex = parseColor(text.value);
    if (hex) picker.value = hex.toLowerCase();
    noteEl.textContent = !text.value.trim()
      ? "Tap the swatch to pick, or type a hex code or RGB numbers."
      : hex
        ? `${hex} · RGB ${rgbOf(hex)}`
        : "Not a color code yet.";
  };
  text.addEventListener("input", sync);
  picker.addEventListener("input", () => {
    text.value = picker.value.toUpperCase();
    sync();
  });
  sync();
  if (current)
    photoURL(current.id, year)
      .then((url) => {
        const img = $("[data-shirt-thumb]", form);
        if (img) img.src = url;
      })
      .catch(() => {});
}

function candidateSheet() {
  sheet({
    title: "Add designs",
    save: "Upload",
    body: `<div class="list">
      <label class="field"><span>Name</span><input name="caption" maxlength="200" placeholder="Optional, e.g. Checkered flag"></label>
      <label class="field"><span>Designs</span><input name="files" type="file" accept="${photoAccept}" multiple required></label>
    </div><p class="group-foot">Mockups, sketches, or photos of samples. Each one becomes a choice everyone can vote on.</p>`,
    onSave: async (f) => {
      const files = [...f.elements.files.files],
        button = $(".strong", f);
      let done = 0;
      try {
        for (const file of files) {
          button.textContent = `${done + 1} of ${files.length}…`;
          const body = new FormData();
          body.append("file", await preparePhoto(file));
          body.append("caption", f.elements.caption.value);
          body.append("purpose", "candidate");
          await api("upload", { method: "POST", body });
          done++;
        }
      } finally {
        button.textContent = "Upload";
        await load();
      }
      toast(`${plural(done, "design")} added to the vote.`);
    },
  });
}

function designSheet(id) {
  const c = candidates().find((x) => x.id === id);
  if (!c) return;
  sheet({
    title: "Edit design",
    body: `<div class="list"><label class="field"><span>Name</span><input name="caption" maxlength="200" value="${esc(c.caption || "")}" placeholder="e.g. Checkered flag" autocomplete="off"></label></div>`,
    onSave: (f) => save("photo", { caption: f.elements.caption.value }, id),
    danger: {
      label: "Remove design",
      run: async () => {
        if (!confirm("Remove this design and its votes for everyone?")) return false;
        await remove(id);
        await load();
        toast("Design removed.");
      },
    },
  });
}

function votersSheet(id) {
  const c = candidates().find((x) => x.id === id);
  if (!c) return;
  const names = votes()
    .filter((v) => v.candidate === id)
    .map((v) => v.voter)
    .sort((a, b) => a.localeCompare(b));
  sheet({
    title: c.caption || "Design",
    body: group(
      plural(names.length, "vote"),
      `<div class="list">${names.map((n) => row({ title: isMe(n) ? `${n} (you)` : n })).join("") || note("No votes yet.")}</div>`,
    ),
  });
}

async function castVote(id) {
  if (!me) {
    toast("Tell us who you are first, so your vote counts once.");
    whoSheet();
    return;
  }
  const mine = myVote();
  if (mine?.candidate === id) {
    await remove(mine.id);
    await load();
    toast("Vote taken back.");
  } else {
    await put("vote", { voter: me.name, candidate: id });
    await load();
    toast(mine ? "Vote changed." : "Vote counted.");
  }
}

function yearSheet() {
  const list = [...new Set([...years, year])].sort((a, b) => b - a);
  const form = sheet({
    title: "Reunion year",
    save: "Add",
    body: `
    <div class="group"><div class="list">${list.map((y) => `<button type="button" class="row" data-pick-year="${y}"><span class="row-main">${y}</span>${y === year ? '<span class="check" aria-label="Selected">✓</span>' : ""}</button>`).join("")}</div></div>
    ${group("Add a year", `<div class="list"><label class="field"><span>Year</span><input name="newYear" type="number" inputmode="numeric" min="2000" max="2100" required value="${Math.max(...list) + 1}"></label></div><p class="group-foot">Add next year’s trip, or a past one to hold its photos.</p>`)}`,
    onSave: (f) => switchYear(Number(f.elements.newYear.value), true),
  });
  $$("[data-pick-year]", form).forEach(
    (b) =>
      (b.onclick = () =>
        run(b, async () => {
          $("#sheet").close();
          await switchYear(Number(b.dataset.pickYear));
        })),
  );
}

function settingsSheet() {
  const theme = localStorage.getItem("reunion-theme") || "system";
  const form = sheet({
    title: "Settings",
    body: `
    ${group("On this device", `<div class="list"><button type="button" class="row nav" data-who><span class="row-main">You are</span><span class="row-value">${me ? esc(me.name) : "Not set"}</span></button></div><p class="group-foot">Fills in your name for chat and your crew for meals. Everyone still shares one family password.</p>`)}
    ${group("Appearance", `<div class="segmented">${["system", "light", "dark"].map((v) => `<label><input type="radio" name="theme" value="${v}" class="visually-hidden" ${v === theme ? "checked" : ""}><span>${v[0].toUpperCase() + v.slice(1)}</span></label>`).join("")}</div><p class="group-foot">System matches your device’s light or dark setting.</p>`)}
    <div class="group"><div class="list"><button type="button" class="row center tint" data-refresh>Refresh plans</button><button type="button" class="row center danger-text" data-lock>Lock this device</button></div><p class="group-foot">Locking signs this device out until the family password is entered again.</p></div>`,
  });
  $$('[name="theme"]', form).forEach(
    (r) =>
      (r.onchange = () => {
        if (r.value === "system") localStorage.removeItem("reunion-theme");
        else localStorage.setItem("reunion-theme", r.value);
        applyTheme();
      }),
  );
  $("[data-who]", form).onclick = () => whoSheet();
  $("[data-refresh]", form).onclick = (e) =>
    run(e.currentTarget, async () => {
      await load();
      toast("Up to date.");
    });
  $("[data-lock]", form).onclick = () => {
    $("#sheet").close();
    lock();
  };
}

function whoSheet() {
  const ps = people();
  const pick = ps.length
    ? group(
        "Pick yourself",
        `<div class="list">${ps.map((p) => `<button type="button" class="row" data-me="${esc(p.id)}"><span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc(p.family)}</span></span>${isMe(p.name) ? '<span class="check" aria-label="Selected">✓</span>' : ""}</button>`).join("")}</div>`,
      )
    : "";
  const typed = me && !ps.some((p) => isMe(p.name)) ? me.name : "";
  const form = sheet({
    title: "Who’s this?",
    cancel: me ? "Cancel" : "Skip",
    body: `<p class="sheet-intro">This only remembers your name on this device, so chat and meals know it’s you.</p>${pick}
      ${group(
        ps.length ? "Not on the list?" : "Your name",
        `<div class="list">
        <label class="field"><span>Name</span><input name="name" maxlength="100" placeholder="First and last" value="${esc(typed)}" autocomplete="name"></label>
        ${crewField(me?.crew || "", "Not sure yet")}
        <label class="row"><span class="row-main">Add me to the ${year} roster</span><input type="checkbox" name="join" class="switch" ${typed ? "" : "checked"}></label>
      </div>`,
      )}`,
    onSave: async (f) => {
      const name = f.elements.name.value.trim(),
        crew = crewValue(f);
      if (!name)
        throw new Error("Pick yourself from the list or type your name.");
      if (
        f.elements.join.checked &&
        !ps.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())
      ) {
        if (!crew) throw new Error("Choose a crew so you can join the roster.");
        await save("person", { name, family: crew, size: "", diet: "" });
      }
      setMe({ name, crew });
      toast(`Hi, ${name.split(" ")[0]}!`);
    },
    danger: me
      ? { label: "Forget me on this device", run: () => setMe(null) }
      : null,
  });
  bindCrew(form);
  $$("[data-me]", form).forEach(
    (b) =>
      (b.onclick = () => {
        const p = ps.find((x) => x.id === b.dataset.me);
        setMe({ name: p.name, crew: p.family });
        $("#sheet").close();
        toast(`Hi, ${p.name.split(" ")[0]}!`);
      }),
  );
}
function setMe(value) {
  me = value;
  if (value) localStorage.setItem("reunion-me", JSON.stringify(value));
  else localStorage.removeItem("reunion-me");
  render();
}

function uploadSheet() {
  const now = new Date().getFullYear(),
    choices = [];
  for (let y = now + 1; y >= 2000; y--) choices.push(y);
  sheet({
    title: "Add photos",
    save: "Upload",
    body: `<div class="list">
      <label class="field"><span>Year</span><select name="year">${choices.map((y) => `<option ${y === albumYear ? "selected" : ""}>${y}</option>`).join("")}</select></label>
      <label class="field"><span>Caption</span><input name="caption" maxlength="200" placeholder="Optional"></label>
      <label class="field"><span>Photos</span><input name="files" type="file" accept="${photoAccept}" multiple required></label>
    </div><p class="group-foot">Any photos, including iPhone HEIC. Large photos are resized automatically. Old photos are welcome; pick the year they were taken.</p>`,
    onSave: async (f) => {
      const target = Number(f.elements.year.value),
        files = [...f.elements.files.files],
        button = $(".strong", f);
      const known = await api("years");
      if (!known.includes(target))
        await put("trip", blankTrip, undefined, target);
      years = [...new Set([...known, target])];
      let done = 0;
      try {
        for (const file of files) {
          button.textContent = `${done + 1} of ${files.length}…`;
          const body = new FormData();
          body.append("file", await preparePhoto(file));
          body.append("caption", f.elements.caption.value);
          await api("upload", { method: "POST", body }, {}, target);
          done++;
        }
      } finally {
        button.textContent = "Upload";
        if (target === year) await load();
        await setAlbumYear(target, true);
      }
      toast(`${plural(done, "photo")} added to ${target}.`);
    },
  });
}

// ---------- Rendering ----------
function render() {
  $("#year-label").textContent = year;
  const avatar = $("#settings-button");
  avatar.innerHTML = me ? esc(initials(me.name)) : icons.person;
  avatar.classList.toggle("set", !!me);
  renderOverview();
  renderMeals();
  renderRoster();
  renderShirts();
  renderMessages();
  renderAlbum();
}

function renderOverview() {
  const t = trip(),
    days = t.start ? tripDays(t.start, tripEnd(t)) : null;
  const until = t.start
    ? Math.round((Date.parse(t.start) - Date.parse(today())) / 86400000)
    : null;
  const [number, label] =
    until === null
      ? ["", "Pick our dates to start the countdown."]
      : until > 1
        ? [until, "days until we go racin'."]
        : until === 1
          ? ["1", "day to go. Pack the cooler."]
          : today() <= tripEnd(t)
            ? ["🏁", "It’s reunion weekend!"]
            : [String(year), "In the memory books."];
  $("#count-number").textContent = number;
  $("#count-number").hidden = !number;
  $("#count-label").textContent = label;
  $("#hero-dates").textContent = days
    ? `${shortDate(days[0])} – ${shortDate(days[days.length - 1])}`
    : "";
  $("#hero-action").hidden = !!t.start;
  $("#trip-list").innerHTML =
    row({ title: "Arrival", value: days ? shortDate(days[0]) : "Not set" }) +
    row({ title: "Departure", value: days ? shortDate(days[days.length - 1]) : "—" }) +
    row({ title: "Campground", value: t.camp || "Not set" }) +
    row({ title: "Sites", value: t.sites || "Not set" }) +
    (t.notes ? row({ title: "Notes", sub: t.notes }) : "");
  const ps = dataOf("person"),
    meals = dataOf("meal"),
    slots = days ? mealSlots(t.start, tripEnd(t), dataOf("meal")) : [],
    claimed = slots.filter((s) =>
      meals.some((m) => m.slot === s.id && m.family),
    ).length,
    needed = ps.filter((p) => !p.size).length;
  const msgs = dataOf("message").sort((a, b) =>
      b.created.localeCompare(a.created),
    ),
    photos = dataOf("photo").filter(inAlbum);
  const glance = (href, icon, title, value, sub = "", valueCls = "") =>
    `<a class="row nav" href="${href}"><span class="row-icon ${icon}">${icons[icon]}</span><span class="row-main"><span class="row-title">${title}</span>${sub ? `<span class="row-sub one-line">${esc(sub)}</span>` : ""}</span><span class="row-value ${valueCls}">${esc(value)}</span></a>`;
  $("#glance").innerHTML =
    glance(
      "#meals",
      "meals",
      "Meals",
      days ? `${claimed} of ${slots.length} claimed` : "Set dates",
      "",
      days && claimed < slots.length ? "warn" : "",
    ) +
    glance(
      "#people",
      "people",
      "People",
      plural(ps.length, "person", "people"),
    ) +
    glance(
      "#shirts",
      "shirts",
      "Shirts",
      !ps.length ? "—" : needed ? `${needed} needed` : "All sizes in",
    ) +
    glance(
      "#messages",
      "chat",
      "Chat",
      msgs.length ? plural(msgs.length, "message") : "Quiet",
      msgs[0] ? `${msgs[0].author}: ${msgs[0].text}` : "",
    ) +
    glance("#photos", "photos", "Photos", plural(photos.length, "photo"));
  renderWeather();
}

const weather = {
  0: ["☀️", "Clear"],
  1: ["🌤️", "Mostly clear"],
  2: ["⛅️", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌧️", "Heavy drizzle"],
  61: ["🌦️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  71: ["🌨️", "Light snow"],
  73: ["🌨️", "Snow"],
  75: ["❄️", "Heavy snow"],
  80: ["🌦️", "Showers"],
  81: ["🌧️", "Showers"],
  82: ["⛈️", "Heavy showers"],
  95: ["⛈️", "Thunderstorms"],
  96: ["⛈️", "Thunderstorms"],
  99: ["⛈️", "Thunderstorms"],
};
async function renderWeather() {
  const seq = ++weatherSequence,
    t = trip(),
    el = $("#weather");
  if (!t.start) {
    el.innerHTML = note("Pick trip dates to see the weekend outlook.");
    return;
  }
  const dates = tripDays(t.start, tripEnd(t)),
    now = today();
  if (dates[dates.length - 1] < now) {
    el.innerHTML = note("This trip is in the memory books.");
    return;
  }
  if ((Date.parse(t.start) - Date.parse(now)) / 86400000 > 15) {
    el.innerHTML = note("Forecasts show up about two weeks before the trip.");
    return;
  }
  if (!el.children.length) el.innerHTML = note("Loading the outlook…");
  try {
    if (!weatherCache || Date.now() - weatherCache.at > 1800000) {
      const r = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=33.6132&longitude=-86.1183&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=16",
      );
      if (!r.ok) throw new Error();
      weatherCache = { at: Date.now(), data: (await r.json()).daily };
    }
    if (seq !== weatherSequence) return;
    const d = weatherCache.data,
      temp = (v) => (v === null ? "—" : Math.round(v) + "°");
    el.innerHTML = dates
      .map((date) => {
        const i = d.time.indexOf(date);
        if (i < 0)
          return row({
            title: format(date, { weekday: "long" }),
            sub: date < now ? "Past date" : "Not in the forecast yet",
          });
        const [emoji, text] = weather[d.weather_code[i]] || ["🌡️", "Mixed"];
        return `<div class="row"><span class="wx" aria-hidden="true">${emoji}</span><span class="row-main"><span class="row-title">${format(date, { weekday: "long" })}</span><span class="row-sub">${text} · ${d.precipitation_probability_max[i] ?? "—"}% rain${(Date.parse(date) - Date.parse(now)) / 86400000 > 7 ? " · early estimate" : ""}</span></span><span class="row-value temps"><b>${temp(d.temperature_2m_max[i])}</b> ${temp(d.temperature_2m_min[i])}</span></div>`;
      })
      .join("");
  } catch {
    if (seq === weatherSequence)
      el.innerHTML = note(
        "Weather is unavailable right now. Your plans are still saved.",
      );
  }
}

function renderMeals() {
  const t = trip(),
    el = $("#meal-list");
  if (!t.start) {
    el.innerHTML = empty(
      "Set arrival and departure dates to plan meals for the trip.",
      "Pick our dates",
      "data-edit-trip",
    );
    return;
  }
  const meals = dataOf("meal"),
    slots = mealSlots(t.start, tripEnd(t), dataOf("meal"));
  const unclaimed = slots.filter((s) => !meals.find((m) => m.slot === s.id)?.family).length;
  el.innerHTML = (unclaimed
    ? `<div class="callout" role="status"><b>${plural(unclaimed, "meal")} still ${unclaimed === 1 ? "needs" : "need"} a crew.</b> Tap one to claim it.</div>`
    : "") + tripDays(t.start, tripEnd(t))
    .map((date) =>
      group(
        format(date, { weekday: "long", month: "short", day: "numeric" }),
        `<div class="list">${(() => {
          // Only planned meals are listed; the rest are offered through "Add a meal".
          const planned = slots.filter((s) => s.date === date),
            missing = allMealSlots(date, date).filter((s) => !planned.some((x) => x.id === s.id));
          const rows = planned.map((s) => {
            const m = meals.find((x) => x.slot === s.id) || {};
            return row({
              tag: "button",
              attrs: `data-meal="${s.id}"`,
              cls: m.family ? "nav" : "nav unclaimed",
              title: s.meal,
              sub: m.menu || (m.family ? "" : "Nobody’s cooking yet"),
              value: m.family || "Claim",
              valueCls: m.family ? (m.family === me?.crew ? "mine" : "") : "claim",
            });
          });
          if (!planned.length) rows.push(note("No meals planned"));
          if (missing.length)
            rows.push(`<button type="button" class="row center tint" data-add-meal="${date}">+ Add a meal</button>`);
          return rows.join("");
        })()}</div>`,
      ),
    )
    .join("");
}

function renderRoster() {
  const ps = people(),
    el = $("#roster");
  if (!ps.length) {
    el.innerHTML = empty(
      "No one is on the roster yet.",
      "Add the first person",
      "data-add-person",
    );
    return;
  }
  const byCrew = new Map();
  ps.forEach((p) => byCrew.set(p.family, [...(byCrew.get(p.family) || []), p]));
  el.innerHTML =
    `<p class="page-note">${plural(ps.length, "person", "people")} in ${plural(byCrew.size, "crew")}</p>` +
    [...byCrew]
      .map(([crew, list]) =>
        group(
          crew,
          `<div class="list">${list.map((p) => row({ tag: "button", attrs: `data-edit-person="${esc(p.id)}"`, cls: "nav", title: p.name + (isMe(p.name) ? " (you)" : ""), sub: p.diet ? "Food: " + p.diet : "", value: p.size || "Size needed", valueCls: p.size ? "" : "warn" })).join("")}</div>`,
          `<span class="group-count">${list.length}</span>`,
        ),
      )
      .join("");
}

function renderShirts() {
  const plan = shirtPlan(),
    ps = people(),
    totals = shirtTotals(ps),
    have = ps.filter((p) => p.size).length,
    pic = shirtPhoto();
  const swatch = plan.hex
    ? `<span class="swatch" style="background:${plan.hex}"></span>`
    : "";
  $("#shirt-plan").innerHTML =
    (pic
      ? `<button type="button" class="shirt-hero" data-shirt-photo aria-label="View shirt photo"><img alt="${esc(year + " shirt")}" data-shirt-img></button>`
      : "") +
    `<div class="row">${swatch}<span class="row-main"><span class="row-title">${esc(plan.color || (plan.hex ? "Custom color" : "Color not set"))}</span>${plan.hex ? `<span class="row-sub">${plan.hex} · RGB ${rgbOf(plan.hex)}</span>` : ""}</span></div>` +
    (plan.notes ? row({ title: "Notes", sub: plan.notes }) : "");
  if (pic)
    photoURL(pic.id, year)
      .then((url) => {
        const img = $("[data-shirt-img]");
        if (img) {
          img.onload = () => img.classList.add("ready");
          img.src = url;
        }
      })
      .catch(() => {});
  renderCandidates();
  $("#shirt-totals").innerHTML = have
    ? sizes
        .filter((s) => totals[s])
        .map((s) => row({ title: s, value: "× " + totals[s] }))
        .join("") + row({ title: "Total", value: have, cls: "strong-row" })
    : note("Add people and sizes to build the order.");
  $("#shirt-summary").textContent = ps.length
    ? `${have} of ${ps.length} sizes collected` +
      (ps.length > have ? ` · ${ps.length - have} still needed` : "")
    : "";
  $("#size-list").innerHTML =
    ps
      .map(
        (p) =>
          `<div class="row"><span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc(p.family)}</span></span><select class="${p.size ? "" : "warn"}" aria-label="Shirt size for ${esc(p.name)}" data-size-for="${esc(p.id)}">${sizeOptions(p.size)}</select></div>`,
      )
      .join("") || note("Everyone’s sizes will show up here.");
}

function renderCandidates() {
  const list = candidates(),
    all = votes(),
    mine = myVote(),
    top = Math.max(0, ...list.map((c) => all.filter((v) => v.candidate === c.id).length));
  $("#candidate-list").innerHTML = list.length
    ? list
        .map((c, i) => {
          const voters = all.filter((v) => v.candidate === c.id).map((v) => v.voter),
            picked = mine?.candidate === c.id,
            leading = top > 0 && voters.length === top,
            url = readyURLs.get(c.id);
          return `<div class="candidate${picked ? " picked" : ""}">
            <button type="button" class="candidate-pic" data-candidate="${i}" aria-label="View ${esc(c.caption || `design ${i + 1}`)}"><img alt="" data-candidate-img="${esc(c.id)}" ${url ? `src="${url}" class="ready"` : ""}>${leading ? '<span class="candidate-badge">Leading</span>' : ""}</button>
            <div class="candidate-info">
              <button type="button" class="candidate-name" data-edit-design="${esc(c.id)}" aria-label="Edit ${esc(c.caption || `design ${i + 1}`)}"><span class="row-title">${esc(c.caption || `Design ${i + 1}`)}</span><span class="link">Edit</span></button>
              ${voters.length ? `<button type="button" class="vote-count" data-voters="${esc(c.id)}">${plural(voters.length, "vote")} ›</button>` : '<span class="row-sub">No votes yet</span>'}
            </div>
            <button type="button" class="vote-button" data-vote="${esc(c.id)}" aria-pressed="${picked}">${picked ? "✓ Your vote" : "Vote"}</button>
          </div>`;
        })
        .join("")
    : empty("No designs yet. Add a few and let everyone vote.", "Add designs", "data-add-candidates");
  $("#candidate-foot").textContent = list.length
    ? me
      ? "One vote each. Tap your vote again to take it back, or vote for another design to switch."
      : "Set “Who’s this?” in Settings so your vote counts once."
    : "";
  $$("[data-candidate-img]:not(.ready)").forEach((img) =>
    photoURL(img.dataset.candidateImg, year)
      .then((url) => {
        img.onload = () => img.classList.add("ready");
        img.src = url;
      })
      .catch(() => img.closest(".candidate-pic")?.classList.add("failed")),
  );
}

function when(iso) {
  const d = new Date(iso),
    time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  return d.toDateString() === new Date().toDateString()
    ? time
    : d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }) +
        " · " +
        time;
}
function renderMessages() {
  const msgs = dataOf("message").sort((a, b) =>
      a.created.localeCompare(b.created),
    ),
    el = $("#message-list");
  el.innerHTML = msgs.length
    ? msgs
        .map((m, i) => {
          const mine = isMe(m.author),
            prev = msgs[i - 1],
            grouped =
              prev &&
              prev.author === m.author &&
              Date.parse(m.created) - Date.parse(prev.created) < 600000;
          return `<div class="msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}">${grouped ? "" : `<div class="msg-meta"><b>${mine ? "You" : esc(m.author)}</b> <time>${esc(when(m.created))}</time></div>`}<div class="bubble">${esc(m.text)}</div><button type="button" class="msg-delete" data-delete-message="${esc(m.id)}">Delete</button></div>`;
        })
        .join("")
    : empty(
        "Start the conversation. Messages show up here for the whole family.",
      );
}
const scrollThread = () =>
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));

// ---------- Album ----------
function photoURL(id, photoYear) {
  if (!photoURLs.has(id))
    photoURLs.set(
      id,
      api("photo", {}, { id }, photoYear)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          readyURLs.set(id, url);
          return url;
        })
        .catch((e) => {
          photoURLs.delete(id);
          throw e;
        }),
    );
  return photoURLs.get(id);
}
function clearPhotos() {
  readyURLs.forEach((u) => URL.revokeObjectURL(u));
  readyURLs.clear();
  photoURLs.clear();
}
const thumbObserver = new IntersectionObserver(
  (entries) =>
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      thumbObserver.unobserve(e.target);
      const img = e.target,
        shownYear = albumYear;
      photoURL(img.dataset.id, shownYear)
        .then((url) => {
          if (shownYear !== albumYear) return;
          img.onload = () => img.classList.add("ready");
          img.src = url;
        })
        .catch(() => {
          img.closest(".thumb")?.classList.add("failed");
        });
    }),
  { rootMargin: "400px" },
);

async function setAlbumYear(y, force = false) {
  if (y === albumYear && !force) return;
  if (y !== albumYear) clearPhotos();
  albumYear = y;
  if (y === year) {
    albumRecords = records;
    renderAlbum();
    return;
  }
  const seq = ++albumSequence;
  albumRecords = [];
  renderAlbum(true);
  try {
    const rows = await api("state", {}, {}, y);
    if (seq !== albumSequence) return;
    albumRecords = rows;
  } catch (e) {
    toast(e.message);
  }
  renderAlbum();
}
function renderAlbum(loading = false) {
  if (albumYear === null) return;
  const list = [...new Set([...years, year, albumYear])].sort((a, b) => b - a);
  $("#album-years").innerHTML = list
    .map(
      (y) =>
        `<button type="button" class="chip" data-album-year="${y}" aria-pressed="${y === albumYear}">${y}</button>`,
    )
    .join("");
  const photos = albumPhotos();
  $("#album-note").textContent = loading
    ? "Loading…"
    : photos.length
      ? plural(photos.length, "photo") + " from " + albumYear
      : "";
  const grid = $("#photo-grid");
  grid.innerHTML =
    photos
      .map((p, i) => {
        const url = readyURLs.get(p.id);
        return `<button type="button" class="thumb" data-photo="${i}" aria-label="${esc(p.caption || `Photo ${i + 1}`)}"><img alt="" data-id="${esc(p.id)}" ${url ? `src="${url}" class="ready"` : ""}></button>`;
      })
      .join("") ||
    (loading
      ? ""
      : empty(
          `No photos from ${albumYear} yet.`,
          "Add photos",
          "data-add-photos",
        ));
  $$("img:not(.ready)", grid).forEach((img) => thumbObserver.observe(img));
}

function openViewer(i, mode = "album") {
  viewerIndex = i;
  viewerMode = mode;
  $("#viewer-delete").hidden = mode === "shirt";
  showViewerPhoto();
  if (!$("#viewer").open) $("#viewer").showModal();
}
async function showViewerPhoto() {
  const photos = viewerList(),
    p = photos[viewerIndex],
    shownYear = viewerYear();
  if (!p) {
    $("#viewer").close();
    return;
  }
  $("#viewer-count").textContent = `${viewerIndex + 1} of ${photos.length}`;
  $("#viewer-caption").textContent = p.caption || "";
  $(".viewer .prev").hidden = viewerIndex === 0;
  $(".viewer .next").hidden = viewerIndex === photos.length - 1;
  const img = $("#viewer-img"),
    link = $("#viewer-download");
  img.alt = p.caption || "Family reunion photo";
  link.download = `talladega-${shownYear}-${p.id}.${(p.path || ".jpg").split(".").pop()}`;
  const ready = readyURLs.get(p.id);
  if (ready) {
    img.src = ready;
    link.href = ready;
    return;
  }
  img.removeAttribute("src");
  link.removeAttribute("href");
  try {
    const url = await photoURL(p.id, shownYear);
    if (viewerList()[viewerIndex]?.id === p.id) {
      img.src = url;
      link.href = url;
    }
  } catch (e) {
    toast(e.message);
  }
}
function stepViewer(delta) {
  const next = viewerIndex + delta;
  if (next >= 0 && next < viewerList().length) {
    viewerIndex = next;
    showViewerPhoto();
  }
}

// ---------- Navigation ----------
function showPage() {
  let page = location.hash.slice(1) || "overview";
  if (
    !["overview", "meals", "people", "shirts", "messages", "photos"].includes(
      page,
    )
  )
    page = "overview";
  const section = page === "shirts" ? "people" : page;
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === section));
  const mark = (a, on) =>
    on
      ? a.setAttribute("aria-current", "page")
      : a.removeAttribute("aria-current");
  $$("#tabs a").forEach((a) => mark(a, a.hash === "#" + section));
  $$("#people .segmented a").forEach((a) => mark(a, a.hash === "#" + page));
  $("#roster-pane").hidden = page === "shirts";
  $("#shirts-pane").hidden = page !== "shirts";
  $("#add-person").hidden = page === "shirts";
  if (page === "messages") scrollThread();
  else window.scrollTo(0, 0);
  heroVideo(
    section === "overview" && !document.body.classList.contains("locked"),
  );
}

// The Home video loads after sign-in, starts muted (browsers block autoplay
// with sound), and pauses while another tab is showing.
function heroVideo(play) {
  const frame = $("#hero-video");
  if (play && !frame.src) frame.src = frame.dataset.src;
  else if (frame.src) ytCommand(play ? "playVideo" : "pauseVideo");
}
const ytCommand = (func) =>
  $("#hero-video").contentWindow?.postMessage(
    JSON.stringify({ event: "command", func, args: [] }),
    "*",
  );

async function switchYear(y, create = false) {
  if (y !== albumYear) clearPhotos();
  year = y;
  albumYear = y;
  await load();
  if (create && !dataOf("trip").length) {
    await put("trip", blankTrip);
    years = [...new Set([...years, y])];
    await load();
  }
}

function lock() {
  document.documentElement.classList.remove("checking");
  token = "";
  localStorage.removeItem("reunion-session");
  document.body.classList.add("locked");
  heroVideo(false);
  $$("dialog").forEach((d) => d.open && d.close());
  applyTheme();
  $("#login-password").focus();
}
async function unlock() {
  years = await api("years");
  if (years.length && !years.includes(year)) year = years[0];
  albumYear = year;
  await load();
  document.body.classList.remove("locked");
  document.documentElement.classList.remove("checking");
  applyTheme();
  showPage();
  if (!me)
    setTimeout(() => {
      window.scrollTo(0, 0);
      if (!me && !document.body.classList.contains("locked")) whoSheet();
    }, 700);
}

// ---------- Events ----------
$$("#tabs a").forEach((a) =>
  a.insertAdjacentHTML("afterbegin", icons[a.dataset.icon]),
);
document.addEventListener("click", (e) => {
  const bubble = e.target.closest(".bubble");
  if (bubble) {
    bubble.parentElement.classList.toggle("picked");
    return;
  }
  const t = e.target.closest("button,a");
  if (!t) return;
  const d = t.dataset;
  if (d.meal) mealSheet(d.meal);
  else if (d.addMeal) addMealSheet(d.addMeal);
  else if ("editTrip" in d) tripSheet();
  else if (d.editPerson) personSheet(d.editPerson);
  else if ("addPerson" in d) personSheet();
  else if ("editShirt" in d) shirtSheet();
  else if ("addPhotos" in d) uploadSheet();
  else if (d.photo) openViewer(Number(d.photo));
  else if ("shirtPhoto" in d) openViewer(0, "shirt");
  else if (d.candidate) openViewer(Number(d.candidate), "candidates");
  else if ("addCandidates" in d) candidateSheet();
  else if (d.vote) run(t, () => castVote(d.vote));
  else if (d.editDesign) designSheet(d.editDesign);
  else if (d.voters) votersSheet(d.voters);
  else if (d.albumYear) setAlbumYear(Number(d.albumYear));
  else if (d.deleteMessage) {
    if (confirm("Delete this message for everyone?"))
      run(t, async () => {
        await remove(d.deleteMessage);
        await load();
      });
  }
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("[data-size-for]");
  if (!s) return;
  const p = dataOf("person").find((x) => x.id === s.dataset.sizeFor);
  run(s, () =>
    save(
      "person",
      { name: p.name, family: p.family, size: s.value, diet: p.diet || "" },
      p.id,
    ),
  );
});
$("#sheet").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
$("#year-button").onclick = yearSheet;
$("#settings-button").onclick = settingsSheet;

$("#export-shirts").onclick = () => {
  const cell = (s) =>
    '"' +
    String(s)
      .replace(/^[=+@-]/, "'")
      .replaceAll('"', '""') +
    '"';
  const rows = [
    ["Name", "Crew", "Shirt size"],
    ...people().map((p) => [p.name, p.family, p.size || "NEEDED"]),
  ];
  const url = URL.createObjectURL(
    new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "talladega-shirts-" + year + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const composer = $("#composer"),
  grow = () => {
    const t = composer.elements.text;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 160) + "px";
  };
composer.elements.text.addEventListener("input", grow);
composer.elements.text.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    !e.shiftKey &&
    matchMedia("(pointer: fine)").matches
  ) {
    e.preventDefault();
    if (composer.requestSubmit) composer.requestSubmit();
    else composer.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});
composer.onsubmit = (e) => {
  e.preventDefault();
  const text = composer.elements.text.value.trim();
  if (!text) return;
  if (!me) {
    whoSheet();
    return;
  }
  run($("button", composer), async () => {
    await put("message", { author: me.name, text });
    composer.elements.text.value = "";
    grow();
    await load();
    scrollThread();
  });
};

$("#viewer [data-close]").onclick = () => $("#viewer").close();
$(".viewer .prev").onclick = () => stepViewer(-1);
$(".viewer .next").onclick = () => stepViewer(1);
$("#viewer").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") stepViewer(-1);
  if (e.key === "ArrowRight") stepViewer(1);
});
let touchX = null;
$(".viewer-stage").addEventListener(
  "touchstart",
  (e) => {
    touchX = e.touches.length === 1 ? e.touches[0].clientX : null;
  },
  { passive: true },
);
$(".viewer-stage").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
});
$("#viewer-delete").onclick = (e) => {
  if (viewerMode === "candidates") {
    const c = candidates()[viewerIndex];
    if (!c || !confirm("Remove this design and its votes for everyone?")) return;
    run(e.currentTarget, async () => {
      await remove(c.id);
      await load();
      toast("Design removed.");
      if (!candidates().length) $("#viewer").close();
      else {
        viewerIndex = Math.min(viewerIndex, candidates().length - 1);
        showViewerPhoto();
      }
    });
    return;
  }
  const p = albumPhotos()[viewerIndex];
  if (!p || !confirm("Delete this photo for everyone?")) return;
  run(e.currentTarget, async () => {
    await remove(p.id, albumYear);
    if (albumYear === year) await load();
    else await setAlbumYear(albumYear, true);
    toast("Photo deleted.");
    if (!albumPhotos().length) $("#viewer").close();
    else {
      viewerIndex = Math.min(viewerIndex, albumPhotos().length - 1);
      showViewerPhoto();
    }
  });
};

window.addEventListener("hashchange", showPage);
$("#sound-toggle").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") === "false";
  ytCommand(on ? "unMute" : "mute");
  if (on) ytCommand("playVideo");
  e.currentTarget.setAttribute("aria-pressed", on);
  e.currentTarget.title = on ? "Mute" : "Turn sound on";
});
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    token &&
    !document.body.classList.contains("locked") &&
    Date.now() - lastLoad > 60000
  )
    load().catch(() => {});
});

$("#login-form").onsubmit = (e) => {
  e.preventDefault();
  run($("button", e.currentTarget), async () => {
    const result = await api("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("#login-password").value }),
    });
    token = result.token;
    if ($("#remember").checked) localStorage.setItem("reunion-session", token);
    else localStorage.removeItem("reunion-session");
    $("#login-password").value = "";
    $("#login-password").blur();
    await unlock();
  });
};

applyTheme();
showPage();
// An expired or revoked session gets a 401, which locks the app via api(). Any other failure
// (usually no signal) keeps the saved sign-in and offers a retry instead of the password form.
function resume() {
  $("#splash-text").textContent = "Loading your plans…";
  $("#splash-retry").hidden = true;
  unlock().catch(() => {
    if (!token) return;
    $("#splash-text").textContent = "Couldn’t reach the server. Check your connection and try again.";
    $("#splash-retry").hidden = false;
  });
}
$("#splash-retry").onclick = resume;
if (token) resume();
else lock();
