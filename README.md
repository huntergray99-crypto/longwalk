# LongWalk

A mobile-first PWA to plan and track a long-distance walking journey. No backend,
no accounts — everything lives in your browser's local storage on one device.

Current route: **Tacoma → Los Angeles**, broken into ~10-mile walking days
(the distance covered per day), following the US-101 / CA-1 road corridor.

**Features**

- Interactive map (Leaflet + OpenStreetMap): walked portion solid green, the rest
  dashed orange, with a dot for every walking day and a "you are here" marker.
- Route tab: a numbered list of every day (Day 1 … Day 139) with the town you're
  passing and the cumulative mile. Tap the day you've reached and everything
  before it fills in.
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
distance, edit `ANCHORS` / `DAY_MILES` in
[`scripts/build-route.mjs`](scripts/build-route.mjs) and regenerate:

```bash
node scripts/build-route.mjs
```

The `ANCHORS` list only pulls the drawn line onto the road network — the day
stops are placed by distance along that line, every ~`DAY_MILES` miles (the
script nudges the day count so each day lands within 9–11 mi). The script calls
the public OSRM demo server, so it needs a connection when you run it — the app
itself stays fully offline.

## Not built yet (ask when you want them)

- Extending the route back to Seattle / on to San Diego / the full country outline.
- Instagram auto-posting (needs a small backend + the Instagram Graph API — can't
  run from a static site).
- Social sharing, a dedicated stats page, GPX import/export, in-app route editing.
