/*
 * LongWalk persistence layer.
 *
 * Everything lives in localStorage under one key. No backend, no accounts.
 * Shape:
 *   {
 *     version: 1,
 *     reached: { [waypointId]: true },      // waypoints marked as reached
 *     log: [ { id, date, miles, note, photo } ],  // daily entries, photo = dataURL|null
 *     startDate: "YYYY-MM-DD" | null
 *   }
 */

const KEY = "longwalk.v1";

const EMPTY = { version: 1, reached: {}, log: [], startDate: null };

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const data = JSON.parse(raw);
    return { ...structuredClone(EMPTY), ...data };
  } catch (err) {
    console.error("LongWalk: could not read saved data, starting fresh.", err);
    return structuredClone(EMPTY);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    // Most likely the quota is full (usually from photos).
    console.error("LongWalk: save failed.", err);
    return false;
  }
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (typeof data !== "object" || data === null) throw new Error("Not a LongWalk backup.");
  return { ...structuredClone(EMPTY), ...data };
}

/** Rough size of the saved blob, for the storage meter. */
export function storageBytes(state) {
  return new Blob([JSON.stringify(state)]).size;
}
