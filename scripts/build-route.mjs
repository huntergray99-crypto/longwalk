/*
 * Regenerates js/data.js for the walk.
 *
 *   node scripts/build-route.mjs
 *
 * SEGMENTS: each is pedestrian-routed on its own (Valhalla `pedestrian` costing
 * on the FOSSGIS demo — avoids motorways, prefers paths/sidewalks/shoulders),
 * then the whole thing is cut into numbered "Day" stops every ~DAY_MILES miles.
 * Between two segments sits a CROSSING — a stretch with no legal walking route
 * (bridge with no walkway, etc.) that you shuttle or ride across.
 *
 * PLANNED: a coarse dashed line continuing down the coast — no day stops yet.
 *
 * After writing, the script cross-checks every routed point against WSDOT's
 * official non-motorized restriction layer (WA) and against OSM `motorway`
 * geometry (everywhere), and fails the build on any hit.
 *
 * Edit SEGMENTS / CROSSINGS / DAY_MILES and re-run.
 */

import { writeFile } from "node:fs/promises";

const TRIP_NAME = "Lakewood, WA → Coos Bay, OR";
const DAY_MILES = 10;
const UA = "LongWalk-route-builder/1.0 (huntergray99@gmail.com)";

// Detailed day-by-day sections. `anchors` are [name, lng, lat] and only pull
// the pedestrian route onto the road network; day stops are placed by distance.
const SEGMENTS = [
  {
    name: "Puget Sound & Washington coast",
    start: "Lakewood, WA",
    anchors: [
      ["Lakewood, WA (start)", -122.48334, 47.16118],
      ["Steilacoom — Puget Sound", -122.58948, 47.17877],
      ["DuPont, WA", -122.6318, 47.0977],
      ["Olympia, WA — Percival Landing", -122.9036, 47.0446],
      ["Aberdeen, WA", -123.8157, 46.9754],
      ["Westport, WA — the Pacific", -124.1041, 46.904],
      ["Grayland, WA", -124.088, 46.791],
      ["Tokeland, WA", -123.967, 46.707],
      ["Raymond, WA", -123.733, 46.686],
      ["South Bend, WA", -123.804, 46.664],
      ["Willapa Bay shore, WA", -123.9, 46.512],
      ["Naselle, WA", -123.74, 46.373],
      ["Seaview, WA", -124.052, 46.331],
      ["Ilwaco, WA", -124.03, 46.301],
      ["Chinook, WA", -123.945, 46.283],
      ["Megler, WA — foot of the bridge", -123.884, 46.256],
    ],
  },
  {
    name: "Oregon coast",
    start: "Astoria, OR",
    anchors: [
      ["Astoria, OR", -123.8313, 46.1879],
      ["Seaside, OR", -123.9226, 45.9932],
      ["Cannon Beach, OR", -123.9615, 45.8918],
      ["Manzanita, OR", -123.9343, 45.7154],
      ["Rockaway Beach, OR", -123.9424, 45.6134],
      ["Garibaldi, OR", -123.911, 45.5601],
      ["Tillamook, OR", -123.8443, 45.4562],
      ["Pacific City, OR", -123.962, 45.2043],
      ["Neskowin, OR", -123.986, 45.1023],
      ["Lincoln City, OR", -124.0179, 44.9582],
      ["Depoe Bay, OR", -124.0637, 44.809],
      ["Newport, OR", -124.0535, 44.6368],
      ["Waldport, OR", -124.0743, 44.4271],
      ["Yachats, OR", -124.1029, 44.3107],
      ["Florence, OR", -124.0998, 43.9826],
      ["Reedsport, OR", -124.0967, 43.7023],
      ["North Bend, OR", -124.2242, 43.4065],
      ["Coos Bay, OR", -124.2179, 43.3665],
    ],
  },
];

// A CROSSING sits after `afterSegment` (0-based). No legal on-foot route across.
const CROSSINGS = [
  {
    afterSegment: 0,
    from: [46.256, -123.884], // Megler, WA
    to: [46.1879, -123.8313], // Astoria, OR
    label: "Astoria–Megler Bridge",
    note: "No pedestrian access — cross by bike/pedestrian shuttle or a ride (~4 mi). The nearest ferry is ~50 mi upriver.",
  },
];

// [name, lng, lat] — coarse future outline, drawn as a dim dashed line.
const ANCHORS_PLANNED = [
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

const ALL_ANCHORS = SEGMENTS.flatMap((s) => s.anchors);

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

// Pedestrian-banned motorway the router would otherwise use. Tight [lon,lat] rings.
const EXCLUDE_POLYGONS = [
  // SR-8 mainline at the US-101 interchange west of Tumwater — foot prohibited.
  // Forces the route onto Old Highway 410 / Old Olympic Hwy, rejoining SR-8's
  // walkable (foot=permissive) shoulder just west of here.
  [[-123.026, 47.056], [-123.008, 47.056], [-123.008, 47.059], [-123.026, 47.059], [-123.026, 47.056]],
];

async function valhallaLeg(anchors) {
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
  let pts = [];
  for (const leg of json.trip.legs) {
    const seg = decodePolyline(leg.shape, 6);
    if (pts.length) seg.shift();
    pts = pts.concat(seg);
  }
  return pts;
}

/** The FOSSGIS demo caps a request at 200 km, so route in overlapping chunks. */
async function valhallaPedestrian(anchors, chunk = 5) {
  let pts = [];
  for (let i = 0; i < anchors.length - 1; i += chunk - 1) {
    const slice = anchors.slice(i, i + chunk);
    process.stderr.write(`  ${slice[0][0]} … ${slice[slice.length - 1][0]}\n`);
    const seg = await valhallaLeg(slice);
    if (pts.length) seg.shift();
    pts = pts.concat(seg);
    await new Promise((r) => setTimeout(r, 500));
  }
  return pts;
}

/* ---------- build ---------- */

async function main() {
  // 1. route every segment on its own
  const fulls = [];
  for (const seg of SEGMENTS) {
    process.stderr.write(`Routing "${seg.name}" (pedestrian) …\n`);
    fulls.push(await valhallaPedestrian(seg.anchors));
  }

  // 2. concatenate into one polyline, carrying cumulative WALKING miles
  //    (a crossing between segments contributes 0). Track where the gaps land.
  const allPts = [];
  const allCum = [];
  const fullGaps = []; // index in allPts of the last vertex before a crossing
  let running = 0;
  fulls.forEach((f, si) => {
    for (let i = 0; i < f.length; i++) {
      if (i > 0) running += haversineMi(f[i - 1], f[i]);
      allPts.push(f[i]);
      allCum.push(running);
    }
    if (si < fulls.length - 1) fullGaps.push(allPts.length - 1);
  });
  const total = running;

  let days = Math.round(total / DAY_MILES);
  while (total / days > 11) days++;
  while (days > 1 && total / days < 9) days--;
  const spacing = total / days;

  const at = (mile) => {
    if (mile <= 0) return allPts[0];
    if (mile >= total) return allPts[allPts.length - 1];
    let lo = 0, hi = allPts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (allCum[m] < mile) lo = m + 1; else hi = m; }
    const i = Math.max(1, lo);
    const span = allCum[i] - allCum[i - 1];
    if (span <= 0) return allPts[i]; // sitting on a zero-length (crossing) segment
    const t = (mile - allCum[i - 1]) / span;
    return [
      allPts[i - 1][0] + (allPts[i][0] - allPts[i - 1][0]) * t,
      allPts[i - 1][1] + (allPts[i][1] - allPts[i - 1][1]) * t,
    ];
  };
  const nearestName = (pt) => {
    let best = ALL_ANCHORS[0][0], bd = Infinity;
    for (const [name, lng, lat] of ALL_ANCHORS) {
      const d = haversineMi(pt, [lat, lng]);
      if (d < bd) { bd = d; best = name.replace(/\s*[—(].*$/, "").trim(); }
    }
    return best;
  };

  // 3. simplify each segment for drawing, then merge with the day-stop nodes
  const keepIdx = [];
  let base = 0;
  for (const f of fulls) {
    for (const i of rdp(f)) keepIdx.push(base + i);
    base += f.length;
  }
  const nodes = keepIdx.map((i) => ({
    mi: allCum[i], coord: allPts[i], stop: null, gap: fullGaps.includes(i),
  }));
  const stops = [];
  for (let k = 1; k <= days; k++) {
    const mi = k === days ? total : k * spacing;
    const node = { mi, coord: at(mi), stop: k };
    nodes.push(node);
    stops.push(node);
  }
  nodes.sort((a, b) => a.mi - b.mi || (a.stop ? 1 : -1));

  const geometry = nodes.map((n) => r5(n.coord));
  const giOf = new Map();
  const gaps = [];
  nodes.forEach((n, i) => {
    if (n.stop) giOf.set(n.stop, i);
    if (n.gap) gaps.push(i);
  });

  const waypoints = [{ id: "start", name: SEGMENTS[0].start, coord: r5(allPts[0]), gi: 0 }];
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

  // crossings, tagged with the geometry index of the gap they sit at
  const crossings = CROSSINGS.map((c) => ({ ...c, gi: gaps[c.afterSegment] }));
  const resumes = SEGMENTS.slice(1).map((s, i) => ({
    gi: gaps[i] + 1, name: s.start,
  }));

  const planned = ANCHORS_PLANNED.map(([, lng, lat]) => r5([lat, lng]));

  const body =
    `/*\n` +
    ` * GENERATED by scripts/build-route.mjs — do not hand-edit.\n` +
    ` * ${waypoints.length - 1} walking days (~${DAY_MILES} mi), ${TRIP_NAME}.\n` +
    ` * Pedestrian-routed (Valhalla). CROSSINGS mark stretches with no legal\n` +
    ` * on-foot route. PLANNED is the coarse dashed outline still to come.\n` +
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
    `    gaps: ${JSON.stringify(gaps)},\n` +
    `  },\n` +
    `];\n\n` +
    `export const CROSSINGS = ${JSON.stringify(crossings)};\n` +
    `export const RESUMES = ${JSON.stringify(resumes)};\n\n` +
    `export const PLANNED = [${planned.map((c) => `[${c[0]},${c[1]}]`).join(",")}];\n`;

  await writeFile(new URL("../js/data.js", import.meta.url), body);
  process.stderr.write(
    `Wrote js/data.js — ${Math.round(total)} mi / ${days} days (avg ${(total / days).toFixed(1)}), ` +
      `${geometry.length} line pts, ${gaps.length} crossing(s); PLANNED ${planned.length} pts.\n`,
  );

  await verifyLegal(allPts);
}

// The Columbia River — WSDOT's layer authoritatively covers everything north of
// it (including frontage roads that hug I-5); the OSM-motorway fallback only
// runs south of it, where no such state layer is wired in.
const WSDOT_SOUTH_EDGE = 46.28;

/**
 * Cross-check the routed line against:
 *  1. WSDOT's "State Route Permanent Bike Restrictions" layer (WA) — the state
 *     routes where pedestrians/bicycles are legally prohibited.
 *  2. OSM `highway=motorway` geometry (south of WSDOT_SOUTH_EDGE) — a proxy for
 *     foot-banned limited-access where no state layer is wired in.
 * Any hit fails the build.
 */
async function verifyLegal(routePts) {
  process.stderr.write("Checking route legality …\n");
  const lats = routePts.map((p) => p[0]);
  const lngs = routePts.map((p) => p[1]);
  const bbox = [Math.min(...lngs) - 0.05, Math.min(...lats) - 0.05, Math.max(...lngs) + 0.05, Math.max(...lats) + 0.05];

  const restricted = []; // [{segs:[[lat,lng]...], src}]
  // WSDOT
  try {
    const env = { xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } };
    const url =
      "https://data.wsdot.wa.gov/arcgis/rest/services/Shared/ActiveTransportationData/MapServer/0/query" +
      "?where=1%3D1&outFields=StateRouteNumber&returnGeometry=true&outSR=4326&f=json" +
      "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects" +
      `&geometry=${encodeURIComponent(JSON.stringify(env))}`;
    const j = await (await fetch(url, { headers: { "User-Agent": UA } })).json();
    for (const f of j.features || []) {
      for (const pa of f.geometry.paths || []) restricted.push({ pts: pa.map((p) => [p[1], p[0]]), src: `WSDOT SR ${f.attributes.StateRouteNumber}` });
    }
  } catch (e) {
    process.stderr.write(`  ! WSDOT check skipped (${e.message})\n`);
  }
  // OSM motorway
  try {
    const q = `[out:json][timeout:60];way["highway"~"^(motorway|motorway_link)$"](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});out geom;`;
    const j = await (await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
    })).json();
    for (const el of j.elements || []) {
      const g = (el.geometry || []).filter((p) => p.lat < WSDOT_SOUTH_EDGE);
      if (g.length > 1) restricted.push({ pts: g.map((p) => [p.lat, p.lon]), src: `OSM motorway ${el.tags?.ref || ""}`.trim() });
    }
  } catch (e) {
    process.stderr.write(`  ! OSM motorway check skipped (${e.message})\n`);
  }

  const near = [];
  for (const p of routePts) {
    let min = Infinity, src = "";
    for (const seg of restricted) {
      if (seg.src.startsWith("OSM") && p[0] >= WSDOT_SOUTH_EDGE) continue; // WSDOT owns the north
      for (let i = 1; i < seg.pts.length; i++) {
        const d = pointToSeg(p, seg.pts[i - 1], seg.pts[i]);
        if (d < min) { min = d; src = seg.src; }
      }
    }
    if (min < 22) near.push({ p, src, m: Math.round(min) });
  }

  if (near.length === 0) {
    process.stderr.write(`  PASS — 0 of ${routePts.length} points on a restricted / limited-access road.\n`);
  } else {
    process.stderr.write(`  FAIL — ${near.length} point(s) too close to a restricted road:\n`);
    for (const n of near.slice(0, 12)) {
      process.stderr.write(`    ${n.src}  ${n.m} m  @ ${n.p[0].toFixed(5)},${n.p[1].toFixed(5)}\n`);
    }
    process.exitCode = 1;
  }
}

function pointToSeg(p, a, b) {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111320;
  const P = [p[1] * k, p[0] * 110540];
  const A = [a[1] * k, a[0] * 110540];
  const B = [b[1] * k, b[0] * 110540];
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - (A[0] + dx * t), P[1] - (A[1] + dy * t));
}

main().catch((err) => { console.error(err); process.exit(1); });
