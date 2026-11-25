"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  loadAchievements,
  loadProgress,
  progressOf,
  scoreOf,
  type Achievement,
  type Progress,
} from "@/lib/achievements";

type Row = {
  a: Achievement;
  current: number;
  unlocked: boolean;
};

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadAchievements()
      .then((list) => {
        if (!active) return;
        setAchievements(list);
        setProgress(loadProgress());
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load achievements.json");
      });
    return () => {
      active = false;
    };
  }, []);

  // Completed on top, then in progress, then locked; within a group the
  // higher-value achievements come first.
  const rows: Row[] = useMemo(() => {
    if (!achievements || !progress) return [];
    return achievements
      .map((a) => {
        const { current } = progressOf(a, progress.counters);
        return { a, current, unlocked: a.id in progress.unlocked };
      })
      .sort((x, y) => {
        const rank = (r: Row) => (r.unlocked ? 0 : r.current > 0 ? 1 : 2);
        if (rank(x) !== rank(y)) return rank(x) - rank(y);
        return y.a.points - x.a.points;
      });
  }, [achievements, progress]);

  const score = useMemo(
    () => (achievements && progress ? scoreOf(achievements, progress.unlocked) : 0),
    [achievements, progress],
  );
  const done = useMemo(
    () => (progress ? Object.keys(progress.unlocked).length : 0),
    [progress],
  );

  if (error) {
    return (
      <div className="rounded-2xl border border-danger/50 bg-panel p-8 text-center">
        <p className="font-mono text-lg font-bold text-danger">[error] {error}</p>
        <p className="mt-2 font-mono text-sm text-fog">
          Check that <code>public/achievements.json</code> is valid JSON.
        </p>
      </div>
    );
  }

  if (!achievements || !progress) {
    return (
      <p className="py-20 text-center font-mono text-lg text-fog">
        <span className="text-neon">$</span> loading achievements…
      </p>
    );
  }

  const pct = (done / achievements.length) * 100;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.12)]">
        <div className="border-b border-edge bg-surface px-5 py-3 font-mono text-xs text-fog">
          ~/achievements
        </div>
        <div className="p-6 text-center sm:p-8">
          <div className="text-6xl" aria-hidden>
            🏆
          </div>
          <h1 className="mt-3 font-mono text-3xl font-bold text-ice">Achievements</h1>
          <p className="mt-2 text-base text-fog">
            Every term you review, hide, quiz or speak earns points.
          </p>
          <p className="mt-4 font-mono text-3xl font-bold text-ice">
            {score} <span className="text-base font-normal text-fog">pts</span>
          </p>
          <p className="mt-1 font-mono text-sm text-fog">
            {done}/{achievements.length} unlocked
          </p>
          <div
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={achievements.length}
            aria-label="Achievements unlocked"
            className="mx-auto mt-4 h-3 w-full max-w-xs overflow-hidden rounded-full border border-edge bg-void"
          >
            <div
              className="h-full bg-gradient-to-r from-amber to-mint"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Link href="/" className="font-mono text-sm text-fog transition hover:text-neon">
          ← back to board
        </Link>
      </div>

      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map((r) => (
          <AchievementRow key={r.a.id} row={r} />
        ))}
      </ul>
    </div>
  );
}

function AchievementRow({ row }: { row: Row }) {
  const { a, current, unlocked } = row;
  const active = unlocked || current > 0;
  const pct = Math.max(4, (current / a.target) * 100);
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        unlocked
          ? "border-mint/70 bg-surface shadow-[0_0_18px_rgba(52,211,153,0.12)]"
          : current > 0
            ? "border-neon/40 bg-panel"
            : "border-edge bg-panel opacity-80"
      }`}
    >
      <span aria-hidden className="text-2xl">
        {a.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 font-mono text-sm font-bold">
          <span className={unlocked ? "text-mint" : "text-ice"}>{a.name}</span>
          {unlocked && (
            <span className="rounded-full border border-mint/60 bg-void px-2 py-0.5 text-[10px] text-mint">
              ✓ unlocked
            </span>
          )}
        </p>
        <p className="mt-0.5 text-sm text-fog">{a.description}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className={`font-mono text-sm font-bold ${unlocked ? "text-mint" : "text-amber"}`}>
          {a.points} pts
        </p>
        <div
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={a.target}
          aria-label={`${a.name}: ${current} of ${a.target}`}
          className="h-1.5 w-16 overflow-hidden rounded-full border border-edge bg-void"
        >
          <div
            className={`h-full ${active ? "bg-gradient-to-r from-amber to-mint" : "bg-void"}`}
            style={{ width: `${active ? `${pct}%` : "0%"}` }}
          />
        </div>
        <p className="font-mono text-xs text-fog">
          {current}/{a.target}
        </p>
      </div>
    </li>
  );
}
