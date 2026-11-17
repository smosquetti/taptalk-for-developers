"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoryId, WordCard } from "@/lib/vocabulary";
import { CATEGORIES, loadVocabulary, shuffle } from "@/lib/vocabulary";
import { speak, stopSpeaking } from "@/lib/speech";
import CategoryBar from "@/components/CategoryBar";
import { useSound } from "@/components/SoundContext";

type Mode = "listen" | "read";
type Phase = "ready" | "playing" | "done";

type Question = {
  target: WordCard;
  options: WordCard[];
};

const ROUNDS = 8;

export default function QuizPage() {
  const { on: soundOn } = useSound();
  const [phase, setPhase] = useState<Phase>("ready");
  const [mode, setMode] = useState<Mode>("listen");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [round, setRound] = useState(0);
  const [firstTryHits, setFirstTryHits] = useState(0);
  const [hadMiss, setHadMiss] = useState(false);
  const [correctId, setCorrectId] = useState<string | null>(null);
  const [wrongId, setWrongId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      stopSpeaking();
    };
  }, []);

  function buildQuestion(allCards: WordCard[], target: WordCard, m: Mode): Question {
    const keyOf = (c: WordCard) =>
      m === "listen" ? c.german.toLowerCase() : c.english.toLowerCase();
    const dummies = shuffle(
      allCards.filter((c) => c.id !== target.id && keyOf(c) !== keyOf(target)),
    ).slice(0, 3);
    return { target, options: shuffle([target, ...dummies]) };
  }

  async function start(m: Mode, cat: CategoryId | "all") {
    setLoading(true);
    setError(null);
    try {
      const all = await loadVocabulary();
      const source =
        cat === "all" ? all : all.filter((c) => c.category === cat);
      if (source.length < 4) {
        throw new Error("Need at least 4 terms in this category to play.");
      }
      const qs: Question[] = shuffle(source)
        .slice(0, ROUNDS)
        .map((target) => buildQuestion(all, target, m));
      setMode(m);
      setQuestions(qs);
      setRound(0);
      setFirstTryHits(0);
      setHadMiss(false);
      setCorrectId(null);
      setWrongId(null);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load vocabulary.json");
    } finally {
      setLoading(false);
    }
  }

  // In listen mode the word is spoken when a round starts.
  useEffect(() => {
    if (phase !== "playing" || mode !== "listen") return;
    const q = questions[round];
    if (q && soundOn) speak(q.target.german);
  }, [phase, mode, round, questions, soundOn]);

  const question: Question | undefined = questions[round];

  const answer = useCallback(
    (option: WordCard) => {
      if (!question || locked || correctId) return;
      if (option.id === question.target.id) {
        setCorrectId(option.id);
        setLocked(true);
        if (soundOn) speak(`Richtig! ${question.target.german}.`);
        if (!hadMiss) setFirstTryHits((h) => h + 1);
        timerRef.current = setTimeout(() => {
          setCorrectId(null);
          setWrongId(null);
          setLocked(false);
          if (round + 1 >= questions.length) {
            setPhase("done");
          } else {
            setRound((r) => r + 1);
            setHadMiss(false);
          }
        }, 1400);
      } else {
        setHadMiss(true);
        setWrongId(option.id);
        if (soundOn) speak(question.target.german);
        timerRef.current = setTimeout(() => setWrongId(null), 450);
      }
    },
    [question, locked, correctId, hadMiss, round, questions.length, soundOn],
  );

  const hearAgain = () => {
    if (question && soundOn) speak(question.target.german);
  };

  if (phase === "ready") {
    return (
      <div className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.12)]">
          <div className="border-b border-edge bg-surface px-5 py-3 font-mono text-xs text-fog">
            ~/quiz
          </div>
          <div className="p-6 text-center sm:p-8">
            <div className="text-6xl" aria-hidden>
              🎧
            </div>
            <h1 className="mt-3 font-mono text-3xl font-bold text-ice">
              Quiz
            </h1>
            <p className="mt-2 text-base text-fog">
              Pick a mode, choose a category, then train.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <ModeButton
                active={mode === "listen"}
                onClick={() => setMode("listen")}
                icon="🎧"
                label="Listen"
                hint="Hear it, pick the word"
              />
              <ModeButton
                active={mode === "read"}
                onClick={() => setMode("read")}
                icon="📖"
                label="Read"
                hint="Read the term, pick the meaning"
              />
            </div>

            <div className="mt-5">
              <CategoryBar
                categories={CATEGORIES}
                active={category}
                onSelect={setCategory}
              />
            </div>

            <button
              type="button"
              onClick={() => start(mode, category)}
              disabled={loading}
              className="mt-6 w-full rounded-lg border border-neon/70 bg-surface px-6 py-4 text-xl font-bold text-neon transition hover:bg-void/50 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Getting ready…" : "Start"}
            </button>

            {error && <p className="mt-6 font-mono font-bold text-danger">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const pct = firstTryHits / questions.length;
    return (
      <div className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.12)]">
          <div className="border-b border-edge bg-surface px-5 py-3 font-mono text-xs text-fog">
            ~/quiz/results
          </div>
          <div className="p-6 text-center sm:p-8">
            <div className="text-6xl" aria-hidden>
              {pct >= 0.8 ? "🌟" : "🎉"}
            </div>
            <h1 className="mt-3 font-mono text-3xl font-bold text-ice">
              Done!
            </h1>
            <p className="mt-2 text-xl font-bold text-neon">
              {firstTryHits} / {questions.length} on the first try
            </p>
            <div
              role="progressbar"
              aria-valuenow={firstTryHits}
              aria-valuemin={0}
              aria-valuemax={questions.length}
              className="mx-auto mt-5 h-3 w-full overflow-hidden rounded-full border border-edge bg-void"
            >
              <div
                className="h-full bg-gradient-to-r from-mint to-neon"
                style={{ width: `${Math.max(4, pct * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => setPhase("ready")}
              className="mt-6 w-full rounded-lg border border-edge bg-surface px-6 py-4 text-xl font-bold text-ice transition hover:border-neon/70 active:scale-[0.98]"
            >
              Play again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-sm text-fog">
          round {round + 1} / {questions.length} · {mode}
        </p>
        <button
          type="button"
          onClick={hearAgain}
          aria-label="Hear the word again"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-panel text-lg transition hover:border-neon/60 active:scale-95"
        >
          <span aria-hidden>🔊</span>
        </button>
      </div>

      {question && (
        <>
          <div className="rounded-2xl border border-edge bg-panel p-6 text-center">
            {mode === "listen" ? (
              <>
                <p className="text-sm font-bold uppercase tracking-widest text-fog">
                  Which word did you hear?
                </p>
                <button
                  type="button"
                  onClick={hearAgain}
                  aria-label="Play the word again"
                  className="mt-4 flex h-16 w-16 items-center justify-center rounded-full border border-neon/60 bg-surface text-2xl transition hover:bg-void/40 active:scale-95"
                >
                  <span aria-hidden>🔊</span>
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-bold uppercase tracking-widest text-fog">
                  What does this mean?
                </p>
                <p
                  lang="de"
                  className="mt-3 break-words font-mono text-4xl font-bold text-ice"
                >
                  {question.target.german}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {question.options.map((option) => {
              const isCorrect = correctId === option.id;
              const isWrong = wrongId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => answer(option)}
                  disabled={locked || correctId !== null}
                  className={`w-full rounded-xl border px-4 py-5 text-center font-mono text-lg transition ${
                    isCorrect
                      ? "border-mint/80 bg-surface text-mint animate-pop shadow-[0_0_22px_rgba(52,211,153,0.3)]"
                      : isWrong
                        ? "border-danger/80 bg-surface text-danger animate-shake"
                        : "border-edge bg-panel text-ice hover:border-neon/60 active:scale-[0.98]"
                  }`}
                >
                  {mode === "listen" ? (
                    <span lang="de">{option.german}</span>
                  ) : (
                    <span>{option.english}</span>
                  )}
                  {isCorrect && (
                    <span aria-hidden className="mt-1 block text-xl">
                      ✅
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 rounded-lg border p-4 transition ${
        active
          ? "border-neon/80 bg-surface text-neon shadow-[0_0_14px_rgba(34,211,238,0.25)]"
          : "border-edge bg-panel text-fog hover:text-ice"
      }`}
    >
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <span className="font-mono text-sm font-bold">{label}</span>
      <span className="text-[11px] text-fog">{hint}</span>
    </button>
  );
}
