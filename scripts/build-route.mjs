/*
 * Regenerates js/data.js for the walk.
 *
 *   node scripts/build-route.mjs
 *
 * DETAIL section: real legal walking route (Valhalla `pedestrian` costing on the
 * FOSSGIS demo server — avoids motorways, prefers paths/sidewalks/shoulders),
 * cut into numbered "Day" stops every ~DAY_MILES miles.
 *
 * PLANNED section: a coarse dashed line continuing down the coast — no day stops
 * yet, just so the whole intended outline shows on the map.
 *
 * Edit ANCHORS_DETAIL / DAY_MILES and re-run.
 */

import { writeFile } from "node:fs/promises";

const TRIP_NAME = "Lakewood, WA → the Pacific coast";
const DAY_MILES = 10;
const UA = "LongWalk-route-builder/1.0 (huntergray99@gmail.com)";

// [name, lng, lat] — the detailed, day-by-day section.
// Only pulls the pedestrian route through these points; day stops are placed by
// distance along the resulting path.
const ANCHORS_DETAIL = [
  ["Lakewood, WA (start)", -122.48334, 47.16118],
  ["Steilacoom — Puget Sound", -122.58948, 47.17877],
  ["DuPont, WA", -122.6318, 47.0977],
  ["Olympia, WA — Percival Landing", -122.9036, 47.0446],
  ["Aberdeen, WA", -123.8157, 46.9754],
  ["Westport, WA — the Pacific", -124.1041, 46.904],
];

// [name, lng, lat] — coarse future outline, drawn as a dim dashed line.
const ANCHORS_PLANNED = [
  ["Westport, WA", -124.104, 46.904],
  ["Grayland, WA", -124.088, 46.791],
  ["Tokeland, WA", -123.967, 46.707],
  ["Raymond, WA", -123.733, 46.686],
  ["Long Beach, WA", -124.054, 46.352],
  ["Astoria, OR", -123.831, 46.188],
  ["Seaside, OR", -123.923, 45.993],
  ["Tillamook, OR", -123.844, 45.456],
  ["Lincoln City, OR", -124.018, 44.958],
  ["Newport, OR", -124.054, 44.637],
  ["Florence, OR", -124.1, 43.983],
  ["Coos Bay, OR", -124.218, 43.367],
  ["Bandon, OR", -124.409, 43.119],
  ["Port Orford, OR", -124.497, 42.745],
  ["Gold Beach, OR", -124.421, 42.407],
  ["Brookings, OR", -124.284, 42.053],
  ["Crescent City, CA", -124.203, 41.756],
  ["Eureka, CA", -124.164, 40.802],
  ["Garberville, CA", -123.794, 40.101],
  ["Leggett, CA", -123.719, 39.869],
  ["Fort Bragg, CA", -123.805, 39.446],
  ["Mendocino, CA", -123.8, 39.308],
  ["Point Arena, CA", -123.693, 38.909],
  ["Bodega Bay, CA", -123.048, 38.333],
  ["Point Reyes, CA", -122.807, 38.07],
  ["San Francisco, CA", -122.51, 37.775],
  ["Half Moon Bay, CA", -122.429, 37.464],
  ["Santa Cruz, CA", -122.031, 36.974],
  ["Monterey, CA", -121.895, 36.6],
  ["Big Sur, CA", -121.808, 36.27],
  ["San Simeon, CA", -121.189, 35.644],
  ["Morro Bay, CA", -120.85, 35.366],
  ["Pismo Beach, CA", -120.641, 35.143],
  ["Santa Maria, CA", -120.436, 34.953],
  ["Gaviota, CA", -120.228, 34.472],
  ["Santa Barbara, CA", -119.698, 34.421],
  ["Ventura, CA", -119.229, 34.275],
  ["Malibu, CA", -118.78, 34.026],
  ["Santa Monica, CA", -118.491, 34.02],
  ["Los Angeles, CA", -118.244, 34.052],
];

/* ---------- geometry helpers ---------- */

function haversineMi(a, b) {
  const R = 3958.7613;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Valhalla returns an encoded polyline at precision 6.
function decodePolyline(str, precision = 6) {
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  const factor = 10 ** precision;
  while (index < str.length) {
    let shift = 0, result = 0, byte;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

function rdp(points, tol = 0.00035) {
  if (points.length < 3) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx !== -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(i);
  return out;
}
function segDist(p, a, b) {
  const [px, py] = p;
  let [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx || dy) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) { ax = bx; ay = by; } else if (t > 0) { ax += dx * t; ay += dy * t; }
  }
  return Math.hypot(px - ax, py - ay);
}
const r5 = (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];

/* ---------- Valhalla ---------- */

// Pedestrian-banned motorway stretches the router would otherwise use.
// Each is a tight polygon hugging the mainline (GeoJSON [lon,lat] rings).
const EXCLUDE_POLYGONS = [
  // SR-8 mainline at the US-101 interchange west of Tumwater (highway=motorway,
  // foot prohibited). Forces the route onto Old Highway 410 / Old Olympic Hwy,
  // rejoining SR-8's walkable (foot=permissive) shoulder just west of here.
  [[-123.026, 47.056], [-123.008, 47.056], [-123.008, 47.059], [-123.026, 47.059], [-123.026, 47.056]],
];

async function valhallaPedestrian(anchors) {
  const body = {
    locations: anchors.map(([, lng, lat]) => ({ lat, lon: lng, type: "break" })),
    costing: "pedestrian",
    costing_options: { pedestrian: { use_ferry: 1, walking_speed: 5.0 } },
    exclude_polygons: EXCLUDE_POLYGONS,
    directions_options: { units: "miles" },
  };
  const res = await fetch("https://valhalla1.openstreetmap.de/route", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Valhalla ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const legs = json.trip.legs;
  // stitch all legs' shapes into one [lat,lng] polyline
  let pts = [];
  for (const leg of legs) {
    const seg = decodePolyline(leg.shape, 6);
    if (pts.length) seg.shift();
    pts = pts.concat(seg);
  }
  return pts;
}

/* ---------- build ---------- */

async function main() {
  process.stderr.write("Routing DETAIL section (pedestrian) …\n");
  const full = await valhallaPedestrian(ANCHORS_DETAIL);

  const cum = [0];
  for (let i = 1; i < full.length; i++) cum[i] = cum[i - 1] + haversineMi(full[i - 1], full[i]);
  const total = cum[cum.length - 1];

  let days = Math.round(total / DAY_MILES);
  while (total / days > 11) days++;
  while (days > 1 && total / days < 9) days--;
  const spacing = total / days;

  const at = (mile) => {
    if (mile <= 0) return full[0];
    if (mile >= total) return full[full.length - 1];
    let lo = 0, hi = full.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < mile) lo = m + 1; else hi = m; }
    const i = Math.max(1, lo);
    const t = (mile - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [full[i - 1][0] + (full[i][0] - full[i - 1][0]) * t, full[i - 1][1] + (full[i][1] - full[i - 1][1]) * t];
  };
  const nearestName = (pt) => {
    let best = ANCHORS_DETAIL[0][0], bd = Infinity;
    for (const [name, lng, lat] of ANCHORS_DETAIL) {
      const d = haversineMi(pt, [lat, lng]);
      if (d < bd) { bd = d; best = name.replace(/\s*[—(].*$/, "").trim(); }
    }
    return best;
  };

  const keepIdx = rdp(full);
  const nodes = keepIdx.map((i) => ({ mi: cum[i], coord: full[i], stop: null }));
  const stops = [];
  for (let k = 1; k <= days; k++) {
    const mi = k === days ? total : k * spacing;
    const node = { mi, coord: at(mi), stop: k };
    nodes.push(node); stops.push(node);
  }
  nodes.sort((a, b) => a.mi - b.mi || (a.stop ? 1 : -1));

  const geometry = nodes.map((n) => r5(n.coord));
  const giOf = new Map();
  nodes.forEach((n, i) => { if (n.stop) giOf.set(n.stop, i); });

  const waypoints = [{ id: "start", name: "Lakewood, WA", coord: r5(full[0]), gi: 0 }];
  let prev = 0;
  for (const s of stops) {
    waypoints.push({
      id: `d${s.stop}`,
      name: `Day ${s.stop}`,
      near: nearestName(s.coord),
      coord: r5(s.coord),
      milesFromPrev: Math.round((s.mi - prev) * 10) / 10,
      gi: giOf.get(s.stop),
    });
    prev = s.mi;
  }

  // PLANNED: just the coastal town anchors as a dim dashed "someday" line.
  // Detailed pedestrian routing for the coast happens in a later pass.
  const planned = ANCHORS_PLANNED.map(([, lng, lat]) => r5([lat, lng]));

  const body =
    `/*\n` +
    ` * GENERATED by scripts/build-route.mjs — do not hand-edit.\n` +
    ` * DETAIL: ${waypoints.length - 1} walking days (~${DAY_MILES} mi), Lakewood WA -> the Pacific,\n` +
    ` * routed with Valhalla pedestrian costing (legal on-foot paths).\n` +
    ` * PLANNED: coarse dashed outline continuing down the coast.\n` +
    ` */\n\n` +
    `export const TRIP_NAME = ${JSON.stringify(TRIP_NAME)};\n` +
    `export const DAY_MILES = ${DAY_MILES};\n\n` +
    `export const ROUTE = [\n` +
    `  {\n` +
    `    id: "main",\n` +
    `    name: ${JSON.stringify(TRIP_NAME)},\n` +
    `    waypoints: [\n` +
    waypoints.map((w) => `      ${JSON.stringify(w)},`).join("\n") +
    `\n    ],\n` +
    `    geometry: [${geometry.map((c) => `[${c[0]},${c[1]}]`).join(",")}],\n` +
    `  },\n` +
    `];\n\n` +
    `export const PLANNED = [${planned.map((c) => `[${c[0]},${c[1]}]`).join(",")}];\n`;

  await writeFile(new URL("../js/data.js", import.meta.url), body);
  process.stderr.write(
    `Wrote js/data.js — DETAIL ${Math.round(total)} mi / ${days} days (avg ${(total / days).toFixed(1)}), ` +
      `${geometry.length} line pts; PLANNED ${planned.length} pts.\n`,
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
