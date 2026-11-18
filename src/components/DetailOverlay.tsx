"use client";

import { useEffect, useRef, useState } from "react";
import type { WordCard } from "@/lib/vocabulary";
import { speak, speaking } from "@/lib/speech";
import { HIDE_OPTIONS } from "@/lib/cardState";

type Props = {
  card: WordCard;
  soundOn: boolean;
  onClose: () => void;
  onHide: (ms: number) => void;
};

export default function DetailOverlay({ card, soundOn, onClose, onHide }: Props) {
  const [article, ...rest] = card.german.split(" ");
  const restJoined = rest.join(" ");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Which button started the current utterance, if any. Kept in a ref so
  // the polling interval always reads the latest value.
  const activeKindRef = useRef<"word" | "example" | null>(null);
  // Tapping a card speaks the German word before this modal mounts, so if
  // TTS is already mid-utterance when we open, start with the Word button
  // highlighted; the polling interval below keeps it in sync.
  const [speakingKind, setSpeakingKind] = useState<"word" | "example" | null>(
    () => (speaking() ? "word" : null),
  );

  // The native TTS bridge clears `speechSynthesis.speaking` when an
  // utterance finishes, so poll that flag: the button that started the
  // sound is highlighted while it plays, and the highlight is cleared
  // when the TTS is done.
  useEffect(() => {
    const id = setInterval(() => {
      if (speaking()) {
        if (!activeKindRef.current) activeKindRef.current = "word";
        const kind = activeKindRef.current;
        setSpeakingKind((prev) => (prev === kind ? prev : kind));
      } else {
        setSpeakingKind(null);
      }
    }, 150);
    return () => clearInterval(id);
  }, []);

  const play = (kind: "word" | "example") => {
    if (!soundOn) return;
    activeKindRef.current = kind;
    setSpeakingKind(kind);
    speak(kind === "word" ? card.german : card.exampleDe);
  };

  const playButtonClass = (kind: "word" | "example") =>
    `flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition active:scale-[0.98] ${
      speakingKind === kind
        ? "border-neon/80 bg-surface text-neon shadow-[0_0_14px_rgba(34,211,238,0.25)]"
        : "border-edge bg-surface text-ice hover:border-neon/60"
    }`;

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

      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.15)]">
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

        <div className="space-y-4 overflow-y-auto p-6">
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
              onClick={() => play("word")}
              aria-pressed={speakingKind === "word"}
              className={playButtonClass("word")}
            >
              <span aria-hidden>🔊</span> Word
            </button>
            <button
              type="button"
              onClick={() => play("example")}
              aria-pressed={speakingKind === "example"}
              className={playButtonClass("example")}
            >
              <span aria-hidden>🔊</span> Example
            </button>
          </div>

          <div className="rounded-lg border border-edge bg-void/60 p-4">
            <p className="font-mono text-xs text-fog">
              <span className="text-mint">$</span> show again
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HIDE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onHide(opt.ms)}
                  aria-label={`Hide ${card.german} from the board ${opt.label}`}
                  className={`rounded-lg border px-2 py-2.5 font-mono text-xs font-semibold transition active:scale-[0.98] ${
                    opt.ms === 0
                      ? "border-danger/50 bg-surface text-fog hover:border-danger/80 hover:text-ice"
                      : "border-edge bg-surface text-fog hover:border-amber/70 hover:text-ice"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-fog">
              The card leaves the board — another takes its place.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
