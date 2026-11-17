"use client";

import { useEffect, useMemo, useState } from "react";
import type { CategoryId, WordCard } from "@/lib/vocabulary";
import { CATEGORIES, loadVocabulary } from "@/lib/vocabulary";
import { speak, stopSpeaking } from "@/lib/speech";
import Card from "@/components/Card";
import CategoryBar from "@/components/CategoryBar";
import DetailOverlay from "@/components/DetailOverlay";
import { useSound } from "@/components/SoundContext";

type BoardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; cards: WordCard[] };

export default function BoardPage() {
  const { on: soundOn } = useSound();
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [selected, setSelected] = useState<WordCard | null>(null);

  useEffect(() => {
    let active = true;
    loadVocabulary()
      .then((cards) => {
        if (active) setState({ status: "ready", cards });
      })
      .catch((e) => {
        if (active)
          setState({
            status: "error",
            message:
              e instanceof Error ? e.message : "Could not load vocabulary.json",
          });
      });
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(
    () =>
      state.status === "ready"
        ? state.cards.filter((c) => category === "all" || c.category === category)
        : [],
    [state, category],
  );

  function pick(card: WordCard) {
    setSelected(card);
    if (soundOn) speak(card.german);
  }

  function close() {
    stopSpeaking();
    setSelected(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="flex flex-wrap items-baseline gap-x-2 font-mono text-2xl font-bold text-ice sm:text-3xl">
          <span className="text-neon">~/</span>
          <span>taptalk</span>
          <span aria-hidden className="inline-block h-6 w-3 bg-neon align-[-0.1em] animate-blink" />
        </h1>
        <p className="mt-2 font-mono text-sm text-fog">
          200 terms · 17 categories — tap a card to see and hear a German
          dev term with its article and example.
        </p>
      </div>

      {state.status === "loading" && (
        <p className="py-20 text-center font-mono text-lg text-fog">
          <span className="text-neon">$</span> loading vocabulary…
        </p>
      )}

      {state.status === "error" && (
        <div className="rounded-2xl border border-danger/50 bg-panel p-8 text-center">
          <p className="font-mono text-lg font-bold text-danger">
            [error] {state.message}
          </p>
          <p className="mt-2 font-mono text-sm text-fog">
            Check that <code>public/vocabulary.json</code> is valid JSON.
          </p>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <CategoryBar
            categories={CATEGORIES}
            active={category}
            onSelect={setCategory}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((card) => (
              <Card key={card.id} card={card} onPick={pick} />
            ))}
          </div>
        </>
      )}

      {selected && (
        <DetailOverlay card={selected} soundOn={soundOn} onClose={close} />
      )}
    </div>
  );
}
