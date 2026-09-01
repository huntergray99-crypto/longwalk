# LongWalk

A mobile-first PWA to plan and track a long-distance walking journey. No backend,
no accounts — everything lives in your browser's local storage on one device.

Current route: **Lakewood, WA → the Pacific coast at Westport**, 10 walking days
of ~10 miles (the distance covered per day). A dim dashed line continues the
intended outline down the coast toward LA — that section gets day-by-day routing
in a later pass.

**Features**

- Interactive map (Leaflet, dark): the route in blue with a dot for every walking
  day, a green start marker, and a pulsing "you are here".
- Route tab: a numbered list of every day with the town you're passing and the
  cumulative mile. Tap the day you've reached and everything before it fills in.
- Header totals: miles walked, miles to go, days done, % complete. Set a trip
  start date in **More** to also track "Day N on the road".
- Daily log — date, miles, a note, an optional photo (auto-compressed). Add a day
  from your phone in a few taps.
- Works offline once loaded. Installable to your home screen. Map tiles cache as
  you view them, so areas you've panned over stay available with no signal.
- Export / import a JSON backup from **More**.

## Run it

Static site — any static host or local server works.

```bash
cd ~/LongWalk
python3 -m http.server 8000
```

Open `http://localhost:8000`. A service worker + `localStorage` need a real
origin (`http://localhost` counts; opening the file directly does not).

Deploy by copying the folder to GitHub Pages, Netlify, Cloudflare Pages, etc.
Everything is relative-path, so it works from a subdirectory.

## Editing the route

`js/data.js` is generated — don't hand-edit it. To change the route or the daily
distance, edit `ANCHORS_DETAIL` / `DAY_MILES` in
[`scripts/build-route.mjs`](scripts/build-route.mjs) and regenerate:

```bash
node scripts/build-route.mjs
```

`ANCHORS_DETAIL` only pulls the line onto the road network — the day stops are
placed by distance along it, every ~`DAY_MILES` miles (the script nudges the day
count so each day lands within 9–11 mi). Routing uses the public **Valhalla
pedestrian** profile (legal on-foot paths — avoids motorways, prefers
sidewalks/paths/shoulders), plus `EXCLUDE_POLYGONS` for spots the router would
otherwise cut through illegally (e.g. the SR-8 motorway interchange west of
Tumwater). Needs a connection when you run it — the app itself stays offline.

**Legality check:** after generating, the script cross-checks every point on the
line against WSDOT's official *State Route Permanent Bike Restrictions* layer —
the state routes where pedestrians and bicycles are legally prohibited
(Interstates, US-101's Olympia bypass, etc.) — and fails if the route touches
one. The current route passes (0 of 3,624 points). Note WA also allows walking
the shoulder of ordinary state highways facing traffic (RCW 46.61.250); SR-8 and
SR-12 are limited-access for *cars* but open to non-motorized travel.

## Not built yet (ask when you want them)

- Extending the route back to Seattle / on to San Diego / the full country outline.
- Instagram auto-posting (needs a small backend + the Instagram Graph API — can't
  run from a static site).
- Social sharing, a dedicated stats page, GPX import/export, in-app route editing.
