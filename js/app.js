import { ROUTE, TRIP_NAME, PLANNED, CROSSING } from "./data.js";
import { load, save, exportJSON, importJSON, storageBytes } from "./store.js";

/* ---------- derived route model ---------- */

const LEG = ROUTE[0];
const STOPS = LEG.waypoints;            // [start, Day 1, Day 2, …]
const DAYS = STOPS.slice(1);            // the walking days
const TOTAL_MILES = DAYS.reduce((s, d) => s + (d.milesFromPrev || 0), 0);

// Cumulative miles at each stop (index-aligned with STOPS).
const CUM_MILES = STOPS.reduce((acc, wp, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + (wp.milesFromPrev || 0));
  return acc;
}, []);

/* ---------- state ---------- */

let state = load();

function persist() {
  if (!save(state)) {
    toast("Couldn't save — storage may be full. Try removing some photos.");
  }
  render();
}

/* ---------- small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return node;
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- progress math ---------- */

// The walk is linear: progress is "completed through Day N". `daysDone` is that
// N (0 = not started), derived from the highest checked-off day.
function daysDone() {
  let n = 0;
  for (let i = 1; i < STOPS.length; i++) if (state.reached[STOPS[i].id]) n = i;
  return n;
}

function stats() {
  const done = daysDone();
  const walked = CUM_MILES[done];
  const remaining = Math.max(0, TOTAL_MILES - walked);
  const loggedMiles = state.log.reduce((s, e) => s + (Number(e.miles) || 0), 0);

  let onRoad = 0;
  if (state.startDate) {
    const start = new Date(state.startDate + "T00:00:00");
    const now = new Date(todayISO() + "T00:00:00");
    onRoad = Math.max(1, Math.round((now - start) / 86400000) + 1);
  }

  return {
    walked,
    remaining,
    done,
    totalDays: DAYS.length,
    onRoad,
    loggedMiles,
    pct: TOTAL_MILES ? walked / TOTAL_MILES : 0,
  };
}

/** Set progress so days 1..n are done (n = 0 clears it). */
function setProgress(n) {
  const next = {};
  for (let i = 1; i <= n; i++) next[STOPS[i].id] = true;
  state.reached = next;
  persist();
}

/* ---------- map ---------- */

let map, mapLayers, mapReady = false;
const ROUTE_BOUNDS = L.latLngBounds(LEG.geometry);
if (CROSSING) ROUTE_BOUNDS.extend(CROSSING.to);

let mapFramed = false;
let lastView = null;

function initMap() {
  const container = document.getElementById("map");
  // fadeAnimation off: with the ResizeObserver re-measure below, Leaflet's
  // tile fade-in can get stuck at opacity 0 on first paint.
  map = L.map(container, { zoomControl: true, attributionControl: true, fadeAnimation: false });
  // OSM raster tiles, recoloured to a dark theme by a CSS filter on the tile
  // pane (see style.css). Keyless and works anywhere — no CARTO/Stadia API key.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  mapLayers = L.layerGroup().addTo(map);
  mapReady = true;
  map.on("moveend", () => {
    if (mapFramed) lastView = { center: map.getCenter(), zoom: map.getZoom() };
  });
  // day markers switch between dots and numbered pins depending on zoom
  let lastZoomBand = null;
  map.on("zoomend", () => {
    const band = map.getZoom() >= PIN_ZOOM;
    if (band !== lastZoomBand) {
      lastZoomBand = band;
      drawMap();
    }
  });

  // The map panel is display:none while other tabs are open and the layout
  // settles a beat after first paint, so Leaflet keeps mis-measuring the
  // container. Re-measure on any size change (debounced through rAF to avoid a
  // ResizeObserver feedback loop); frame the route once the box is real.
  let raf = 0;
  const remeasure = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      map.invalidateSize({ pan: false });
      if (!mapFramed) {
        map.fitBounds(ROUTE_BOUNDS, { padding: [24, 28] });
        mapFramed = true;
      }
    });
  };
  new ResizeObserver(remeasure).observe(container);
  window.addEventListener("load", remeasure);
  window.addEventListener("orientationchange", () => setTimeout(remeasure, 200));
  remeasure();

  drawMap();
}

/** Called when the Map tab is shown: re-measure, restore last pan/zoom. */
function refreshMap() {
  if (!mapReady) return;
  requestAnimationFrame(() => {
    map.invalidateSize({ pan: false });
    if (mapFramed && lastView) {
      map.setView(lastView.center, lastView.zoom, { animate: false });
    }
  });
}

const BLUE = "#5aa8ff";
const BLUE_DIM = "#3a6ea5";
const CASING = "#0a0c11";
const AMBER = "#ff9d4a";
const PIN_ZOOM = 11; // at/above this zoom, every day gets a numbered pin

function drawMap() {
  if (!mapReady) return;
  mapLayers.clearLayers();

  const done = daysDone();
  const g = LEG.geometry;
  const splitGi = STOPS[done].gi;
  const ahead = g.slice(splitGi);
  const walked = splitGi > 0 ? g.slice(0, splitGi + 1) : [];

  // dim dashed "someday" outline continuing down the coast
  if (PLANNED && PLANNED.length > 1) {
    L.polyline(PLANNED, {
      color: BLUE_DIM, weight: 2, opacity: 0.5, dashArray: "2 8", lineCap: "round",
    }).addTo(mapLayers);
  }

  // the one stretch with no legal walking route — crossed by shuttle/ride
  if (CROSSING) {
    L.polyline([CROSSING.from, CROSSING.to], {
      color: AMBER, weight: 2.5, opacity: 0.9, dashArray: "5 6", lineCap: "round",
    }).addTo(mapLayers);
    L.marker(CROSSING.to, {
      icon: L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8], html: '<span class="end-pin cross"></span>' }),
      zIndexOffset: 800,
    })
      .bindPopup(`<strong>${CROSSING.label}</strong><br>${CROSSING.note}<br>Walking resumes in Astoria.`)
      .addTo(mapLayers);
  }

  // the walking route, drawn as a dark casing + a bright core so it reads on
  // any part of the basemap
  L.polyline(g, { color: CASING, weight: 8, opacity: 0.9, lineCap: "round", lineJoin: "round" }).addTo(mapLayers);
  L.polyline(ahead, {
    color: BLUE, weight: 3.5, opacity: 0.75, dashArray: "1 6", lineCap: "round",
  }).addTo(mapLayers);
  if (walked.length) {
    L.polyline(walked, { color: BLUE, weight: 4.5, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(mapLayers);
  }

  // day markers: numbered pins when zoomed in, otherwise dots with a numbered
  // pin only every 5th day (and always the current one) so they don't crowd
  const zoomedIn = mapReady && map.getZoom() >= PIN_ZOOM;
  STOPS.forEach((wp, i) => {
    if (i === 0 || i === STOPS.length - 1) return;
    const reached = i <= done;
    const asPin = zoomedIn || i % 5 === 0 || i === done;
    const marker = asPin
      ? L.marker(wp.coord, {
          icon: L.divIcon({
            className: "",
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            html: `<span class="day-pin${reached ? " done" : ""}">${i}</span>`,
          }),
        })
      : L.circleMarker(wp.coord, {
          radius: 3.5, color: CASING, weight: 1.5,
          fillColor: BLUE, fillOpacity: reached ? 1 : 0.5,
        });
    marker
      .bindPopup(`<strong>Day ${i}</strong> &middot; mile ${Math.round(CUM_MILES[i])}<br>near ${wp.near}`)
      .addTo(mapLayers);
  });

  // start / finish / "you are here"
  endMarker(STOPS[0].coord, "start", `<strong>Start</strong><br>${STOPS[0].name}`);
  endMarker(
    STOPS[STOPS.length - 1].coord, "finish",
    `<strong>Day ${STOPS.length - 1}</strong> — end of the walked route so far<br>near ${STOPS[STOPS.length - 1].near}`,
  );
  if (done > 0) {
    L.marker(STOPS[done].coord, { icon: pulseIcon(), zIndexOffset: 1000 })
      .bindPopup(`<strong>You are here</strong><br>${STOPS[done].name} &middot; near ${STOPS[done].near}`)
      .addTo(mapLayers);
  }
}

function endMarker(coord, kind, html) {
  L.marker(coord, {
    zIndexOffset: 900,
    icon: L.divIcon({
      className: "",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      html: `<span class="end-pin ${kind}"></span>`,
    }),
  })
    .bindPopup(html)
    .addTo(mapLayers);
}

function pulseIcon() {
  return L.divIcon({
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html:
      '<span style="position:absolute;inset:0;border-radius:50%;background:#5aa8ff;opacity:.35;animation:lw-ripple 2s infinite"></span>' +
      '<span style="position:absolute;inset:5px;border-radius:50%;background:#5aa8ff;border:2px solid #0a0c11"></span>',
  });
}

/* ---------- render: header ---------- */

function renderHeader() {
  const s = stats();
  const host = $("#summary");
  host.replaceChildren(
    stat(fmt(s.walked), "mi walked"),
    stat(fmt(s.remaining), "mi to go"),
    stat(`${s.done}/${s.totalDays}`, "days done"),
    stat(Math.round(s.pct * 100) + "%", "complete"),
  );
  $("#trip-name").textContent = TRIP_NAME;
  $("#overall-bar > span").style.width = (s.pct * 100).toFixed(1) + "%";
}

function stat(value, label) {
  return el("div", { class: "stat" },
    el("div", { class: "stat-value", text: value }),
    el("div", { class: "stat-label", text: label }),
  );
}

/* ---------- render: route tab ---------- */

function renderRoute() {
  const host = $("#route-list");
  const s = stats();
  host.replaceChildren();

  const head = el("section", { class: "card leg" + (s.done === s.totalDays ? " leg-done" : "") },
    el("h2", { class: "leg-name" }, LEG.name),
    el("div", { class: "leg-meta" },
      el("span", { text: `${fmt(s.walked)} / ${fmt(TOTAL_MILES)} mi · day ${s.done} of ${s.totalDays}` }),
      el("button", {
        class: "btn-ghost",
        onclick: () => setProgress(s.done === s.totalDays ? 0 : s.totalDays),
      }, s.done === s.totalDays ? "Reset" : "All done"),
    ),
    bar(s.pct),
    el("p", { class: "hint", text:
      (s.onRoad ? `Day ${s.onRoad} on the road. ` : "") +
      "Tap the day you've reached — everything before it fills in." }),
  );
  host.append(head);

  const list = el("ul", { class: "wp-list day-list" });
  STOPS.forEach((wp, i) => {
    if (i === 0) return;
    const reached = i <= s.done;
    const isTip = i === s.done; // current position
    // only label the town when it changes (or on the current day), so the list
    // reads as a run of days grouped by the place you're passing through
    const showNear = isTip || wp.near !== STOPS[i - 1].near;
    list.append(
      el("li", { class: "wp day" + (reached ? " done" : "") + (isTip ? " tip" : "") },
        el("label", { class: "wp-check" },
          el("input", {
            type: "checkbox",
            ...(reached ? { checked: "checked" } : {}),
            onchange: () => setProgress(reached ? i - 1 : i),
          }),
          el("span", { class: "wp-name" },
            el("span", { class: "day-num", text: wp.name }),
            showNear ? el("span", { class: "day-near", text: wp.near }) : null,
          ),
        ),
        el("span", { class: "wp-miles", text: `mi ${Math.round(CUM_MILES[i])}` }),
      ),
    );
  });
  host.append(el("section", { class: "card day-card" }, list));
}

function bar(pct) {
  return el("div", { class: "bar" }, el("span", { style: `width:${(pct * 100).toFixed(1)}%` }));
}

/* ---------- render: log tab ---------- */

function renderLog() {
  const host = $("#log-list");
  host.replaceChildren();

  if (state.log.length === 0) {
    host.append(el("p", { class: "empty", text: "No entries yet — log your first day above." }));
    return;
  }

  [...state.log]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    .forEach((entry) => {
      const card = el("article", { class: "card log-entry" },
        el("header", {},
          el("time", { text: prettyDate(entry.date) }),
          entry.miles ? el("span", { class: "log-miles", text: `${entry.miles} mi` }) : null,
          el("button", { class: "btn-ghost danger", onclick: () => deleteEntry(entry.id) }, "Delete"),
        ),
        entry.note ? el("p", { class: "log-note", text: entry.note }) : null,
        entry.photo ? el("img", { class: "log-photo", src: entry.photo, alt: "", loading: "lazy" }) : null,
      );
      host.append(card);
    });
}

function prettyDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function deleteEntry(id) {
  if (!confirm("Delete this log entry?")) return;
  state.log = state.log.filter((e) => e.id !== id);
  persist();
}

async function onLogSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const date = form.date.value || todayISO();
  const miles = form.miles.value ? Number(form.miles.value) : null;
  const note = form.note.value.trim();
  const file = form.photo.files[0];

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  let photo = null;
  if (file) {
    try {
      photo = await compressImage(file);
    } catch {
      toast("Couldn't process that photo — saved the entry without it.");
    }
  }

  state.log.push({ id: Date.now(), date, miles, note, photo });
  form.reset();
  form.date.value = todayISO();
  submitBtn.disabled = false;
  persist();
  toast("Day logged.");
  showTab("log");
}

function compressImage(file, maxDim = 1100, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = el("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

/* ---------- render: more tab ---------- */

function renderMore() {
  $("#start-date").value = state.startDate || "";
  const kb = storageBytes(state) / 1024;
  const size = kb < 1 ? "under 1 KB" : kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  const photos = state.log.filter((e) => e.photo).length;
  $("#storage-note").textContent =
    `Saved data: ${size} · ${photos} ${photos === 1 ? "photo" : "photos"}. Browser limit is usually around 5 MB.`;
}

function onStartDateChange(e) {
  state.startDate = e.target.value || null;
  persist();
}

function doExport() {
  const blob = new Blob([exportJSON(state)], { type: "application/json" });
  const a = el("a", {
    href: URL.createObjectURL(blob),
    download: `longwalk-backup-${todayISO()}.json`,
  });
  document.body.append(a);
  a.click();
  a.remove();
}

function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = importJSON(reader.result);
      persist();
      toast("Backup restored.");
    } catch {
      toast("That doesn't look like a LongWalk backup.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* ---------- tabs ---------- */

function showTab(name) {
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === name));
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "map") setTimeout(refreshMap, 60);
  if (name === "route") {
    setTimeout(() => {
      const tip = $(".wp.day.tip") || $(".wp.day");
      tip?.scrollIntoView({ block: "center" });
    }, 40);
  }
  history.replaceState(null, "", "#" + name);
}

/* ---------- full render ---------- */

function render() {
  renderHeader();
  renderRoute();
  renderLog();
  renderMore();
  drawMap();
}

/* ---------- boot ---------- */

function boot() {
  $("#log-form").addEventListener("submit", onLogSubmit);
  $("#log-form").date.value = todayISO();
  $("#start-date").addEventListener("change", onStartDateChange);
  $("#export-btn").addEventListener("click", doExport);
  $("#import-file").addEventListener("change", onImportFile);
  $$(".tabbar button").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab)),
  );

  const start = (location.hash || "#map").slice(1);
  showTab(["map", "route", "log", "more"].includes(start) ? start : "map");

  initMap();
  render();
  refreshMap();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
