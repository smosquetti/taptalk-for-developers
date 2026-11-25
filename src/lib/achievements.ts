// Achievement progress: per-event counters + which achievements are
// already unlocked.
//
// Everything lives in localStorage under `taptalk-achievements` — the
// same durability story as taptalk-card-state (see cardState.ts): the
// WebView's local storage survives restarts, wiped on uninstall.
//
// An achievement unlocks the moment its event counter first reaches the
// target; the unlocked id is stored with a timestamp so the score is
// stable even if achievements.json is edited later.

export type AchievementEvent =
  | "boardPick"
  | "cardsHidden"
  | "quizCompleted"
  | "quizPerfect"
  | "speakQuizCompleted"
  | "speakQuizPerfect"
  | "speakFirstTry";

export type Difficulty = "easy" | "medium" | "hard";

export type Achievement = {
  id: string;
  icon: string;
  name: string;
  description: string;
  points: number;
  difficulty: Difficulty;
  event: AchievementEvent;
  target: number;
};

export type CounterMap = Partial<Record<AchievementEvent, number>>;

export type Progress = {
  counters: CounterMap;
  /** achievement id -> unlock time (epoch ms) */
  unlocked: Record<string, number>;
};

const STORAGE_KEY = "taptalk-achievements";

const cache = new Map<string, Achievement[]>();

/**
 * Loads the achievement definitions from public/achievements.json.
 * Kept client-side on purpose, same as loadVocabulary.
 */
export async function loadAchievements(): Promise<Achievement[]> {
  const hit = cache.get("achievements");
  if (hit) return hit;
  const res = await fetch("/achievements.json");
  if (!res.ok) {
    throw new Error(`Could not load achievements.json (HTTP ${res.status})`);
  }
  const data = (await res.json()) as Achievement[];
  cache.set("achievements", data);
  return data;
}

function isProgress(p: unknown): p is Progress {
  if (typeof p !== "object" || p === null) return false;
  const o = p as { counters?: unknown; unlocked?: unknown };
  if (typeof o.counters !== "object" || o.counters === null) return false;
  if (typeof o.unlocked !== "object" || o.unlocked === null) return false;
  for (const v of Object.values(o.counters)) {
    if (typeof v !== "number" || (v as number) < 0) return false;
  }
  return true;
}

/** Read persisted progress; missing, corrupt or invalid values start fresh. */
export function loadProgress(): Progress {
  if (typeof window === "undefined") return { counters: {}, unlocked: {} };
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{"counters":{},"unlocked":{}}',
    );
    return isProgress(parsed) ? parsed : { counters: {}, unlocked: {} };
  } catch {
    return { counters: {}, unlocked: {} };
  }
}

export function saveProgress(progress: Progress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full or unavailable — progress is kept for this session.
  }
}

/** Current progress of an achievement, capped at its target ("2/7"). */
export function progressOf(
  a: Achievement,
  counters: CounterMap,
): { current: number; done: boolean } {
  const current = Math.min(counters[a.event] ?? 0, a.target);
  return { current, done: current >= a.target };
}

/** Total score: the points of every unlocked achievement. */
export function scoreOf(
  achievements: Achievement[],
  unlocked: Record<string, number>,
): number {
  let total = 0;
  for (const a of achievements) if (a.id in unlocked) total += a.points;
  return total;
}

/**
 * Records `amount` occurrences of `event`, unlocks every achievement
 * whose target is now reached, and persists the result.
 *
 * Returns the updated progress plus the achievements unlocked by this
 * call (empty when the event unlocked nothing) — for the "unlocked"
 * banner on the quiz result screens.
 */
export async function recordEvent(
  event: AchievementEvent,
  amount = 1,
): Promise<{ progress: Progress; newUnlocks: Achievement[] }> {
  const achievements = await loadAchievements();
  const progress = loadProgress();
  const counters: CounterMap = {
    ...progress.counters,
    [event]: (progress.counters[event] ?? 0) + amount,
  };
  const unlocked: Record<string, number> = { ...progress.unlocked };
  const now = Date.now();
  const newUnlocks: Achievement[] = [];
  for (const a of achievements) {
    if (a.id in unlocked) continue;
    if ((counters[a.event] ?? 0) >= a.target) {
      unlocked[a.id] = now;
      newUnlocks.push(a);
    }
  }
  const next: Progress = { counters, unlocked };
  saveProgress(next);
  return { progress: next, newUnlocks };
}
