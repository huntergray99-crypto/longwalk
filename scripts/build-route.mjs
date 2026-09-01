/*
 * Regenerates js/data.js for the Tacoma -> Los Angeles walk.
 *
 *   node scripts/build-route.mjs
 *
 * It snaps a line to real roads (US-101 / CA-1 corridor and connectors) with the
 * public OSRM demo server, then drops a numbered "Day" stop every ~DAY_MILES
 * miles along that line — the distance the walker covers in a day. Edit ANCHORS
 * or DAY_MILES and re-run.
 */

import { writeFile } from "node:fs/promises";

const TRIP_NAME = "Tacoma → Los Angeles";
const DAY_MILES = 10; // nominal miles per walking day; stops land within ~9–11

// [lng, lat], ordered south-bound. These only pull the line onto the road
// network — the day stops are placed by distance, not from this list.
const ANCHORS = [
  ["Tacoma, WA", -122.4443, 47.2529],
  ["Olympia, WA", -122.9007, 47.0379],
  ["Aberdeen, WA", -123.8157, 46.9754],
  ["Raymond, WA", -123.7332, 46.6857],
  ["Astoria, OR", -123.8313, 46.1879],
  ["Seaside, OR", -123.9226, 45.9932],
  ["Tillamook, OR", -123.8443, 45.4562],
  ["Lincoln City, OR", -124.0179, 44.9582],
  ["Newport, OR", -124.0535, 44.6368],
  ["Florence, OR", -124.0998, 43.9826],
  ["Coos Bay, OR", -124.2179, 43.3665],
  ["Bandon, OR", -124.4085, 43.119],
  ["Port Orford, OR", -124.4973, 42.7446],
  ["Gold Beach, OR", -124.4213, 42.4073],
  ["Brookings, OR", -124.284, 42.0526],
  ["Crescent City, CA", -124.2026, 41.7558],
  ["Klamath, CA", -124.0381, 41.5262],
  ["Eureka, CA", -124.1637, 40.8021],
  ["Fortuna, CA", -124.1573, 40.5982],
  ["Garberville, CA", -123.7936, 40.1013],
  ["Leggett, CA", -123.7194, 39.869],
  ["Fort Bragg, CA", -123.8053, 39.4457],
  ["Mendocino, CA", -123.7995, 39.3076],
  ["Point Arena, CA", -123.6931, 38.9088],
  ["Gualala, CA", -123.533, 38.7669],
  ["Bodega Bay, CA", -123.048, 38.333],
  ["Point Reyes Station, CA", -122.8067, 38.0697],
  ["Stinson Beach, CA", -122.6444, 37.9005],
  ["San Francisco, CA", -122.4194, 37.7749],
  ["Pacifica, CA", -122.4869, 37.6138],
  ["Half Moon Bay, CA", -122.4286, 37.4636],
  ["Santa Cruz, CA", -122.0308, 36.9741],
  ["Monterey, CA", -121.8947, 36.6002],
  ["Big Sur, CA", -121.8081, 36.2704],
  ["Gorda, CA", -121.4613, 35.9052],
  ["San Simeon, CA", -121.1889, 35.6436],
  ["Morro Bay, CA", -120.8499, 35.3658],
  ["San Luis Obispo, CA", -120.6596, 35.2828],
  ["Pismo Beach, CA", -120.6413, 35.1428],
  ["Santa Maria, CA", -120.4357, 34.953],
  ["Gaviota, CA", -120.2277, 34.4722],
  ["Santa Barbara, CA", -119.6982, 34.4208],
  ["Ventura, CA", -119.229, 34.2746],
  ["Oxnard, CA", -119.1771, 34.1975],
  ["Malibu, CA", -118.7798, 34.0259],
  ["Santa Monica, CA", -118.4912, 34.0195],
  ["Los Angeles, CA", -118.2437, 34.0522],
];

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const MI_PER_M = 1 / 1609.344;

async function osrmGeometry(anchorSlice) {
  const coords = anchorSlice.map((a) => `${a[1]},${a[2]}`).join(";");
  const url = `${OSRM}${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const json = await res.json();
  if (json.code !== "Ok") throw new Error(`OSRM ${json.code}`);
  return json.routes[0].geometry.coordinates; // [[lng,lat],...]
}

function haversineMi(a, b) {
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Ramer–Douglas–Peucker on [lat,lng] points. ~0.001° ≈ 75 m. */
function simplify(points, tol = 0.001) {
  if (points.length < 3) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(i);
  return out;
}

function segDist(p, a, b) {
  const [px, py] = p;
  let [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx || dy) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) { ax = bx; ay = by; }
    else if (t > 0) { ax += dx * t; ay += dy * t; }
  }
  return Math.hypot(px - ax, py - ay);
}

const round5 = (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];

async function main() {
  // OSRM's demo server gets unhappy past ~25 waypoints, so fetch in chunks
  // that overlap by one anchor and stitch.
  const CHUNK = 20;
  let lnglat = [];
  for (let i = 0; i < ANCHORS.length - 1; i += CHUNK - 1) {
    const slice = ANCHORS.slice(i, i + CHUNK);
    process.stderr.write(`Routing ${slice[0][0]} … ${slice[slice.length - 1][0]}\n`);
    const g = await osrmGeometry(slice);
    if (lnglat.length) g.shift();
    lnglat = lnglat.concat(g);
    await new Promise((r) => setTimeout(r, 400));
  }

  // full polyline as [lat,lng] with cumulative miles
  const full = lnglat.map((c) => [c[1], c[0]]);
  const cum = [0];
  for (let i = 1; i < full.length; i++) cum[i] = cum[i - 1] + haversineMi(full[i - 1], full[i]);
  const total = cum[cum.length - 1];

  // choose a day count that keeps every day within 9–11 mi
  let days = Math.round(total / DAY_MILES);
  while (total / days > 11) days++;
  while (total / days < 9) days--;
  const spacing = total / days;

  // interpolate a point at a given cumulative mile
  function at(mile) {
    if (mile <= 0) return full[0];
    if (mile >= total) return full[full.length - 1];
    let lo = 0;
    let hi = full.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < mile) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const t = (mile - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [
      full[i - 1][0] + (full[i][0] - full[i - 1][0]) * t,
      full[i - 1][1] + (full[i][1] - full[i - 1][1]) * t,
    ];
  }

  const nearestAnchor = (pt) => {
    let best = ANCHORS[0];
    let bd = Infinity;
    for (const a of ANCHORS) {
      const d = haversineMi(pt, [a[2], a[1]]);
      if (d < bd) { bd = d; best = a; }
    }
    return best[0];
  };

  // build the merged geometry: simplified shape points + the day stops,
  // ordered by cumulative distance, so each stop has an exact index.
  const keepIdx = simplify(full);
  const nodes = keepIdx.map((i) => ({ mi: cum[i], coord: full[i], stop: null }));
  const stops = [];
  for (let k = 1; k <= days; k++) {
    const mi = k === days ? total : k * spacing;
    const coord = at(mi);
    const node = { mi, coord, stop: k };
    nodes.push(node);
    stops.push(node);
  }
  nodes.sort((a, b) => a.mi - b.mi || (a.stop ? 1 : -1));

  const geometry = nodes.map((n) => round5(n.coord));
  const giOf = new Map();
  nodes.forEach((n, i) => { if (n.stop) giOf.set(n.stop, i); });

  const waypoints = [
    { id: "start", name: ANCHORS[0][0], coord: round5(full[0]), gi: 0 },
  ];
  let prevMi = 0;
  for (const s of stops) {
    waypoints.push({
      id: `d${s.stop}`,
      name: `Day ${s.stop}`,
      near: nearestAnchor(s.coord),
      coord: round5(s.coord),
      milesFromPrev: Math.round((s.mi - prevMi) * 10) / 10,
      gi: giOf.get(s.stop),
    });
    prevMi = s.mi;
  }

  const body =
    `/*\n` +
    ` * GENERATED by scripts/build-route.mjs — do not hand-edit.\n` +
    ` * ${waypoints.length - 1} walking days, Tacoma -> Los Angeles, ~${DAY_MILES} mi/day,\n` +
    ` * snapped to the US-101 / CA-1 road corridor via OSRM.\n` +
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
    `];\n`;

  await writeFile(new URL("../js/data.js", import.meta.url), body);
  process.stderr.write(
    `Wrote js/data.js — ${Math.round(total)} mi, ${days} days, avg ${(total / days).toFixed(1)} mi/day, ${geometry.length} line points.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
