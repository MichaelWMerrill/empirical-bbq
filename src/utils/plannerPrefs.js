/*
 * Planner preferences remembered on this device (localStorage), under ONE
 * namespaced key: the cooker class and insulation blanket flag from the cook
 * conditions card (display-only; nothing reads them into the cook-time model),
 * and autoLocate, a boolean opt-in for re-detecting the location on load.
 * autoLocate is true or false once the user has decided, and null before that.
 * Only booleans and the cooker id are stored here, never coordinates.
 *
 * Writes merge into whatever is already stored, so other planner preferences
 * added later under the same key are preserved. Reads and writes never throw
 * (storage can be blocked); the page works without it.
 */

export const PREFS_KEY = 'ebq:cook-planner';

export const COOKER_CLASSES = [
  { id: 'pellet', label: 'Pellet' },
  { id: 'offset', label: 'Offset' },
  { id: 'kamado', label: 'Kamado' },
  { id: 'kettle', label: 'Kettle' },
  { id: 'electric', label: 'Electric' },
];

export const DEFAULT_PREFS = { cooker: 'pellet', blanket: false, autoLocate: null };

const COOKER_IDS = COOKER_CLASSES.map((c) => c.id);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRaw(storage) {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

/** Current preferences, with invalid or missing values replaced by the defaults. */
export function readPrefs(storage = defaultStorage()) {
  const raw = readRaw(storage);
  return {
    cooker: COOKER_IDS.includes(raw.cooker) ? raw.cooker : DEFAULT_PREFS.cooker,
    blanket: raw.blanket === true,
    autoLocate: typeof raw.autoLocate === 'boolean' ? raw.autoLocate : null,
  };
}

/** Merge a patch ({ cooker?, blanket?, autoLocate? }) into storage. Invalid values are ignored. */
export function writePrefs(patch, storage = defaultStorage()) {
  const next = { ...readRaw(storage) };
  if (patch && COOKER_IDS.includes(patch.cooker)) next.cooker = patch.cooker;
  if (patch && typeof patch.blanket === 'boolean') next.blanket = patch.blanket;
  if (patch && typeof patch.autoLocate === 'boolean') next.autoLocate = patch.autoLocate;
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the choice just is not remembered */
  }
  return readPrefs(storage);
}
