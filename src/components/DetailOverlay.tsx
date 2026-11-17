"use client";

import { useEffect } from "react";
import type { WordCard } from "@/lib/vocabulary";
import { speak } from "@/lib/speech";

type Props = {
  card: WordCard;
  soundOn: boolean;
  onClose: () => void;
};

export default function DetailOverlay({ card, soundOn, onClose }: Props) {
  const [article, ...rest] = card.german.split(" ");
  const restJoined = rest.join(" ");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const play = (text: string) => {
    if (soundOn) speak(text);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={card.german}
      className="fixed inset-0 z-40 flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-surface text-xl text-fog transition hover:border-neon/60 hover:text-ice"
      >
        ✕
      </button>

      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.15)]">
        <div className="flex items-center gap-2 border-b border-edge bg-surface px-4 py-3">
          <span aria-hidden className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
          </span>
          <span className="ml-2 truncate font-mono text-xs text-fog">
            ~/vocabulary/{card.id}
          </span>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <h2
              lang="de"
              className="break-words font-mono text-4xl font-bold leading-tight text-ice"
            >
              <span className="text-neon drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
                {article}
              </span>
              {restJoined && <span> {restJoined}</span>}
            </h2>
            <p className="mt-2 font-mono text-sm text-fog">
              <span className="text-mint">{"//"}</span> english:{" "}
              {card.english}
            </p>
          </div>

          <div className="rounded-lg border border-edge bg-void/60 p-4">
            <p lang="de" className="font-mono text-sm leading-relaxed text-ice">
              <span className="text-mint">$</span> “{card.exampleDe}”
            </p>
            <p className="mt-2 font-mono text-xs leading-relaxed text-fog">
              <span className="text-mint">$</span> “{card.exampleEn}”
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => play(card.german)}
              className="flex items-center justify-center gap-2 rounded-lg border border-neon/60 bg-surface px-4 py-3 text-sm font-semibold text-neon transition hover:bg-void/60 active:scale-[0.98]"
            >
              <span aria-hidden>🔊</span> Word
            </button>
            <button
              type="button"
              onClick={() => play(card.exampleDe)}
              className="flex items-center justify-center gap-2 rounded-lg border border-edge bg-surface px-4 py-3 text-sm font-semibold text-ice transition hover:border-neon/60 active:scale-[0.98]"
            >
              <span aria-hidden>🔊</span> Example
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
