"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { WordCard } from "@/lib/vocabulary";
import { loadVocabulary, shuffle } from "@/lib/vocabulary";
import {
  loadAchievements,
  loadProgress,
  recordEvent,
  scoreOf,
  type Achievement,
  type Progress,
} from "@/lib/achievements";
import {
  hideBadge,
  isHidden,
  loadCardState,
  refillBoard,
  saveCardState,
  type CardState,
  type HideEntry,
} from "@/lib/cardState";
import { speak, stopSpeaking } from "@/lib/speech";
import Card from "@/components/Card";
import DetailOverlay from "@/components/DetailOverlay";
import { useSound } from "@/components/SoundContext";

const BOARD_SIZE = 20;

export default function BoardPage() {
  const { on: soundOn } = useSound();
  const [vocabulary, setVocabulary] = useState<WordCard[] | null>(null);
  const [hidden, setHidden] = useState<CardState>({});
  const [board, setBoard] = useState<string[]>([]);
  const [selected, setSelected] = useState<WordCard | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [achList, setAchList] = useState<Achievement[]>([]);
  const [achv, setAchv] = useState<Progress | null>(null);

  // A fresh random board on every page load (i.e. every app launch).
  useEffect(() => {
    let active = true;
    const state = loadCardState();
    loadVocabulary()
      .then((cards) => {
        if (!active) return;
        setVocabulary(cards);
        setHidden(state);
        const now = Date.now();
        const pool = shuffle(cards.filter((c) => !isHidden(state[c.id], now)));
        setBoard(pool.slice(0, BOARD_SIZE).map((c) => c.id));
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load vocabulary.json",
          );
      });
    // Independent of the vocabulary: the score section still shows when
    // only achievements.json is loaded.
    loadAchievements()
      .then((list) => {
        if (!active) return;
        setAchList(list);
        setAchv(loadProgress());
      })
      .catch(() => {
        /* score section stays hidden when achievements.json is unavailable */
      });
    return () => {
      active = false;
    };
  }, []);

  const boardCards = useMemo(() => {
    if (!vocabulary) return [] as WordCard[];
    const byId = new Map(vocabulary.map((c) => [c.id, c]));
    return board
      .map((id) => byId.get(id))
      .filter((c): c is WordCard => c !== undefined);
  }, [vocabulary, board]);

  const hiddenCards = useMemo(() => {
    if (!vocabulary) return [] as { card: WordCard; entry: HideEntry }[];
    const byId = new Map(vocabulary.map((c) => [c.id, c]));
    return Object.entries(hidden)
      .map(([id, entry]) => ({ card: byId.get(id), entry }))
      .filter(
        (e): e is { card: WordCard; entry: HideEntry } => e.card !== undefined,
      );
  }, [vocabulary, hidden]);

  function pick(card: WordCard) {
    setSelected(card);
    if (soundOn) speak(card.german);
    void recordEvent("boardPick").then((r) => setAchv(r.progress));
  }

  function close() {
    stopSpeaking();
    setSelected(null);
  }

  function hideCard(card: WordCard, ms: number) {
    if (!vocabulary) return;
    const entry: HideEntry = { until: ms === 0 ? 0 : Date.now() + ms, ms };
    const next: CardState = { ...hidden, [card.id]: entry };
    setHidden(next);
    saveCardState(next);
    // The hidden card's slot is immediately taken by another card.
    setBoard((b) => refillBoard(b, card.id, vocabulary, next, BOARD_SIZE));
    stopSpeaking();
    setSelected(null);
    void recordEvent("cardsHidden").then((r) => setAchv(r.progress));
  }

  function restoreCard(id: string) {
    if (!(id in hidden)) return;
    const next: CardState = { ...hidden };
    delete next[id];
    setHidden(next);
    saveCardState(next);
    // The card re-enters the pool and lands on a board at the next shuffle.
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="flex flex-wrap items-baseline gap-x-2 font-mono text-2xl font-bold text-ice sm:text-3xl">
          <span className="text-neon">~/</span>
          <span>TapTalk</span>
          <span
            aria-hidden
            className="inline-block h-6 w-3 bg-neon align-[-0.1em] animate-blink"
          />
        </h1>
      </div>

      {achList.length > 0 && achv && (
        <ScoreSection
          score={scoreOf(achList, achv.unlocked)}
          done={Object.keys(achv.unlocked).length}
          total={achList.length}
        />
      )}

      {error && (
        <div className="rounded-2xl border border-danger/50 bg-panel p-8 text-center">
          <p className="font-mono text-lg font-bold text-danger">
            [error] {error}
          </p>
          <p className="mt-2 font-mono text-sm text-fog">
            Check that <code>public/vocabulary.json</code> is valid JSON.
          </p>
        </div>
      )}

      {!error && !vocabulary && (
        <p className="py-20 text-center font-mono text-lg text-fog">
          <span className="text-neon">$</span> loading vocabulary…
        </p>
      )}

      {!error && vocabulary && (
        <>
          <HiddenRow
            items={hiddenCards}
            open={showHidden}
            onToggle={() => setShowHidden((v) => !v)}
            onRestore={restoreCard}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {boardCards.map((card) => (
              <Card key={card.id} card={card} onPick={pick} />
            ))}
          </div>
        </>
      )}

      {selected && (
        <DetailOverlay
          card={selected}
          soundOn={soundOn}
          onClose={close}
          onHide={(ms) => hideCard(selected, ms)}
        />
      )}
    </div>
  );
}

function HiddenRow({
  items,
  open,
  onToggle,
  onRestore,
}: {
  items: { card: WordCard; entry: HideEntry }[];
  open: boolean;
  onToggle: () => void;
  onRestore: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-2 font-mono text-xs text-fog transition hover:border-neon/60 hover:text-ice"
      >
        <span aria-hidden>🗄️</span>
        hidden · {items.length}
        <span aria-hidden className="text-neon">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map(({ card, entry }) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onRestore(card.id)}
              aria-label={`Show ${card.german} on the board again`}
              className="flex items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-fog transition hover:border-mint/70 hover:text-ice active:scale-[0.98]"
            >
              <span lang="de">{card.german}</span>
              <span className="text-mint">{hideBadge(entry.ms)}</span>
              <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreSection({
  score,
  done,
  total,
}: {
  score: number;
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.max(3, (done / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-edge bg-panel p-4 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber/50 bg-surface text-2xl"
        >
          🏆
        </span>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-fog">
            Score
          </p>
          <p className="font-mono text-2xl font-bold leading-tight text-ice">
            {score} <span className="text-sm font-normal text-fog">pts</span>
          </p>
          <p className="mt-0.5 font-mono text-xs text-fog">
            {done}/{total} achievements unlocked
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Achievements unlocked"
          className="h-1.5 w-24 overflow-hidden rounded-full border border-edge bg-void sm:w-32"
        >
          <div
            className="h-full bg-gradient-to-r from-amber to-mint"
            style={{ width: `${pct}%` }}
          />
        </div>
        <Link
          href="/achievements"
          aria-label="View all achievements"
          className="rounded-full border border-neon/60 bg-surface px-4 py-2 font-mono text-sm text-neon transition hover:bg-void/50 active:scale-[0.98]"
        >
          Achievements
        </Link>
      </div>
    </div>
  );
}
