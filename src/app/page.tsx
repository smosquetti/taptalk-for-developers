"use client";

import { useEffect, useMemo, useState } from "react";
import type { WordCard } from "@/lib/vocabulary";
import { loadVocabulary, shuffle } from "@/lib/vocabulary";
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
          <span>taptalk</span>
          <span
            aria-hidden
            className="inline-block h-6 w-3 bg-neon align-[-0.1em] animate-blink"
          />
        </h1>
        <p className="mt-2 font-mono text-sm text-fog">
          20 random cards out of 200 — a fresh board every launch. Tap a card
          to see and hear the term; hide the ones you already know.
        </p>
      </div>

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
