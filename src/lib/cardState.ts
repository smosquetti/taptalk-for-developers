import type { WordCard } from "./vocabulary";
import { shuffle } from "./vocabulary";

/**
 * Board card state: which cards are hidden from the board and until when.
 *
 * Maps card id -> { until: hide deadline (epoch ms), ms: duration chosen
 * when the hide was created, 0 = hidden forever }.
 *
 * Persisted in localStorage. In the APK the WebView runs with
 * domStorageEnabled and its local storage lives in the app's private data
 * directory — the same durability as native SharedPreferences (survives
 * restarts, wiped on uninstall/clear-data) — so no native storage bridge
 * is needed for this state.
 */

export type HideEntry = { until: number; ms: number };
export type CardState = Record<string, HideEntry>;

const STORAGE_KEY = "taptalk-card-state";

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;
const ONE_MONTH = 30 * ONE_DAY;

export const HIDE_OPTIONS: { label: string; ms: number }[] = [
  { label: "never", ms: 0 },
  { label: "1 day", ms: ONE_DAY },
  { label: "1 week", ms: ONE_WEEK },
  { label: "1 month", ms: ONE_MONTH },
];

function isHiddenEntry(entry: unknown, now: number): entry is HideEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as { until?: unknown; ms?: unknown };
  if (typeof e.ms !== "number") return false;
  if (e.ms === 0) return true; // forever
  return typeof e.until === "number" && e.until > now; // still in effect
}

export function isHidden(entry: HideEntry | undefined, now: number = Date.now()): boolean {
  return entry !== undefined && isHiddenEntry(entry, now);
}

export function loadCardState(): CardState {
  if (typeof window === "undefined") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const now = Date.now();
  const out: CardState = {};
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (isHiddenEntry(entry, now)) out[id] = entry;
  }
  return out;
}

export function saveCardState(state: CardState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — the board still works for this session.
  }
}

/** Short badge for a hide duration: ∞, 1d, 1w or 1mo. */
export function hideBadge(ms: number): string {
  if (ms === 0) return "∞";
  if (ms >= ONE_MONTH) return "1mo";
  if (ms >= ONE_WEEK) return "1w";
  return "1d";
}

/**
 * Drops `removedId` from the board and tops it back up to `size` cards,
 * filling from the shuffled pool of cards that are neither on the board
 * nor hidden under `state`.
 */
export function refillBoard(
  board: string[],
  removedId: string,
  all: readonly WordCard[],
  state: CardState,
  size: number = 20,
): string[] {
  const remaining = board.filter((id) => id !== removedId);
  const taken = new Set(remaining);
  const pool = shuffle(all.filter((c) => !taken.has(c.id) && !isHidden(state[c.id])));
  const need = Math.max(0, size - remaining.length);
  return [...remaining, ...pool.slice(0, need).map((c) => c.id)];
}
