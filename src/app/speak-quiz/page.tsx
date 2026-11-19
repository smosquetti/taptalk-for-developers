"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryId, WordCard } from "@/lib/vocabulary";
import { CATEGORIES, loadVocabulary, shuffle } from "@/lib/vocabulary";
import { loadCardState, saveCardState, type CardState } from "@/lib/cardState";
import { speak, speaking, stopSpeaking } from "@/lib/speech";
import {
  isArticle,
  matchPhrase,
  type MatchResult,
} from "@/lib/speakMatch";
import {
  recognitionAvailable,
  setOutcomeSink,
  startRecognition,
  stopRecognition,
  type RecognitionOutcome,
} from "@/lib/recognition";
import CategoryBar from "@/components/CategoryBar";
import { useSound } from "@/components/SoundContext";

type Phase = "ready" | "playing" | "done";

type Question = {
  target: WordCard;
  /**
   * The article is hidden in the UI ("···") but still has to be said —
   * the TTS always speaks the full phrase, article included.
   */
  hideArticle: boolean;
};

type Feedback =
  | { kind: "correct" }
  | { kind: "heard"; match: MatchResult; heard: string[]; left: number }
  | { kind: "error"; message: string; left: number };

const ROUNDS = 8;
const MAX_ATTEMPTS = 3;
const HIDE_ARTICLE_CHANCE = 0.35;
const CORRECT_FEEDBACK_MS = 1400; // minimum wait before advancing
const MAX_TTS_WAIT_MS = 15000; // cap, in case the speaking flag gets stuck
const FAIL_ADVANCE_MS = 2200; // wait for the model phrase before advancing
const RECOGNITION_TIMEOUT_MS = 15000; // no outcome → error code 9

// Matches the stable codes in recognition.ts / SpeechRecognitionBridge.kt.
const ERROR_MESSAGES: Record<number, string> = {
  [-1]: "Microphone access not allowed. Allow the microphone, then tap again.",
  1: "No speech recognition available on this device.",
  2: "Recognition is busy — try again.",
  3: "I didn't catch that. Try again.",
  4: "Microphone error. Try again.",
  5: "Something went wrong with recognition. Try again.",
  9: "I didn't catch that. Try again.",
};

export default function SpeakQuizPage() {
  const { on: soundOn } = useSound();
  const [phase, setPhase] = useState<Phase>("ready");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [round, setRound] = useState(0);
  const [firstTryHits, setFirstTryHits] = useState(0);
  const [attempts, setAttempts] = useState(0); // 0..MAX_ATTEMPTS-1 used
  const [listening, setListening] = useState(false);
  const [locked, setLocked] = useState(false);
  // Once the article was revealed (first wrong answer), it stays visible
  // for the rest of the round — no re-hiding on retries.
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [available] = useState(() => recognitionAvailable());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef = useRef(false);
  // True while a listening session is paused for a "hear again" TTS:
  // the UI keeps showing "listening", only the recognizer is suspended
  // (and it resumes automatically when the TTS ends).
  const recPausedRef = useRef(false);
  // Board card state at quiz start: hidden cards still appear in the quiz,
  // and a failed phrase un-hides its card.
  const hiddenRef = useRef<CardState>({});
  // The sink is registered once; it always calls the latest handler
  // (kept in the ref, updated by an effect below) so handleOutcome
  // reads the current state (round, attempts, …).
  const outcomeHandlerRef = useRef<(o: RecognitionOutcome) => void>(() => {});

  useEffect(() => {
    return setOutcomeSink((o) => outcomeHandlerRef.current(o));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (recTimeoutRef.current) clearTimeout(recTimeoutRef.current);
      stopSpeaking();
    };
  }, []);

  // TTS always speaks the full phrase (article included) — that is what
  // the user has to say, even on hidden-article rounds.
  useEffect(() => {
    if (phase !== "playing") return;
    const q = questions[round];
    if (q && soundOn) speak(q.target.german);
  }, [phase, round, questions, soundOn]);

  const question: Question | undefined = questions[round];

  function buildQuestions(source: WordCard[]): Question[] {
    const withArticle = (target: WordCard) =>
      isArticle(target.german.split(/\s+/)[0] ?? "");
    const qs: Question[] = shuffle(source)
      .slice(0, ROUNDS)
      .map((target) => ({
        target,
        hideArticle: withArticle(target) && Math.random() < HIDE_ARTICLE_CHANCE,
      }));
    // At least one hidden article per game, when any target has one.
    if (qs.some((q) => withArticle(q.target)) && !qs.some((q) => q.hideArticle)) {
      const i = qs.findIndex((q) => withArticle(q.target));
      qs[i] = { ...qs[i], hideArticle: true };
    }
    return qs;
  }

  async function start(cat: CategoryId | "all") {
    setLoading(true);
    setError(null);
    try {
      const all = await loadVocabulary();
      hiddenRef.current = loadCardState();
      const source = cat === "all" ? all : all.filter((c) => c.category === cat);
      if (source.length < ROUNDS) {
        throw new Error(`Need at least ${ROUNDS} terms in this category to play.`);
      }
      setQuestions(buildQuestions(source));
      setRound(0);
      setFirstTryHits(0);
      setAttempts(0);
      setListening(false);
      setLocked(false);
      setRevealed(false);
      setFeedback(null);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load vocabulary.json");
    } finally {
      setLoading(false);
    }
  }

  /** No backend outcome within the window → treat as "didn't catch that". */
  function armRecTimeout() {
    recTimeoutRef.current = setTimeout(() => {
      if (listeningRef.current) {
        console.warn(
          "[speak-quiz] no outcome within",
          RECOGNITION_TIMEOUT_MS,
          "ms — timeout, code 9",
        );
        handleOutcome({ status: "error", code: 9 });
      }
    }, RECOGNITION_TIMEOUT_MS);
  }

  /**
   * Starts one listening session (also the retry path — a tap clears the
   * current feedback and begins a fresh attempt; `revealed` persists).
   */
  function startListeningNow() {
    if (!question || locked || listening) return;
    console.log(
      "[speak-quiz] tap — starting recognition for:",
      question.target.german,
    );
    stopSpeaking(); // TTS and ASR fight over the audio stack
    stopRecognition(); // drop any in-flight session (stale results are ignored)
    setFeedback(null);
    setListening(true);
    listeningRef.current = true;
    startRecognition();
    armRecTimeout();
  }

  function handleOutcome(o: RecognitionOutcome) {
    if (!listeningRef.current) {
      console.log("[speak-quiz] handleOutcome ignored — not listening");
      return;
    }
    console.log(
      "[speak-quiz] outcome:",
      o.status === "error" ? `error code ${o.code}` : JSON.stringify(o.results),
    );
    listeningRef.current = false;
    setListening(false);
    if (recTimeoutRef.current) {
      clearTimeout(recTimeoutRef.current);
      recTimeoutRef.current = null;
    }
    const q = question;
    if (!q) return;

    if (o.status === "error") {
      const message = ERROR_MESSAGES[o.code] ?? ERROR_MESSAGES[5];
      console.log("[speak-quiz] error feedback:", message);
      const used = attempts + 1;
      setAttempts(used);
      setFeedback({ kind: "error", message, left: Math.max(0, MAX_ATTEMPTS - used) });
      if (used >= MAX_ATTEMPTS) failRound(q);
      return;
    }

    const match = matchPhrase(q.target.german, o.results);
    console.log(
      `[speak-quiz] matchPhrase vs "${q.target.german}" -> ok=${match.ok}`,
    );
    if (match.ok) {
      if (attempts === 0) setFirstTryHits((h) => h + 1);
      setLocked(true);
      setFeedback({ kind: "correct" });
      if (soundOn) speak(`Richtig! ${q.target.german}.`);
      waitThen(advance, CORRECT_FEEDBACK_MS);
    } else {
      // Show which part was wrong: per-token mint/danger, and a hidden
      // article is revealed here in its own color.
      setRevealed(true);
      const used = attempts + 1;
      setAttempts(used);
      setFeedback({ kind: "heard", match, heard: o.results, left: Math.max(0, MAX_ATTEMPTS - used) });
      if (used >= MAX_ATTEMPTS) failRound(q);
    }
  }

  // Keep the ref on the latest handler (after every render, outside of
  // render, so the once-registered sink never goes stale).
  useEffect(() => {
    outcomeHandlerRef.current = handleOutcome;
  });

  /**
   * The phrase was not got after all attempts: say it as a model phrase,
   * and if its card was hidden on the board, bring it back.
   */
  function failRound(q: Question) {
    setLocked(true);
    if (soundOn) speak(q.target.german);
    if (q.target.id in hiddenRef.current) {
      const next = { ...hiddenRef.current };
      delete next[q.target.id];
      hiddenRef.current = next;
      saveCardState(next);
    }
    waitThen(advance, FAIL_ADVANCE_MS);
  }

  /**
   * Wait at least `minMs`, and also until the TTS is done speaking (the
   * app-wide end-of-speech signal; the APK's TTS bridge never delivers
   * onDone), then run `fn`.
   */
  function waitThen(fn: () => void, minMs: number) {
    const started = Date.now();
    const step = () => {
      const elapsed = Date.now() - started;
      if (elapsed >= minMs && (elapsed >= MAX_TTS_WAIT_MS || !speaking())) {
        fn();
      } else {
        timerRef.current = setTimeout(step, 150);
      }
    };
    step();
  }

  function advance() {
    setLocked(false);
    setAttempts(0);
    setRevealed(false);
    setFeedback(null);
    if (round + 1 >= questions.length) {
      setPhase("done");
    } else {
      setRound((r) => r + 1);
    }
  }

  /**
   * Re-arms a session that hearAgain paused: the UI-level listening state
   * never changed, so only the backend and the outcome timeout come back
   * (fresh session number, so results from the paused session are
   * dropped as stale).
   */
  function resumeListening() {
    if (!recPausedRef.current) return;
    recPausedRef.current = false;
    listeningRef.current = true;
    startRecognition();
    armRecTimeout();
  }

  /**
   * "Hear again." While a listening session is in progress, the
   * recognizer is paused for the duration of the TTS — an open mic would
   * pick up the speaker output and the phrase would pass as if the user
   * said it. It resumes automatically when the TTS ends, so the user
   * just keeps speaking; hearing the phrase doesn't consume an attempt.
   */
  const hearAgain = () => {
    if (!question || !soundOn) return;
    if (listeningRef.current) {
      // Suspend the session: the timeout is dropped and any payload
      // arriving while the mic is closed is ignored ("not listening").
      listeningRef.current = false;
      recPausedRef.current = true;
      stopRecognition();
      if (recTimeoutRef.current) {
        clearTimeout(recTimeoutRef.current);
        recTimeoutRef.current = null;
      }
    }
    speak(question.target.german);
    if (recPausedRef.current) {
      // Floor so the browser's speaking flag has time to turn on (the
      // APK's TTS bridge sets it synchronously, so this is a no-op there)
      // — without it the resume could race the TTS start.
      waitThen(resumeListening, 300);
    }
  };

  if (phase === "ready") {
    return (
      <div className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_0_40px_rgba(34,211,238,0.12)]">
          <div className="border-b border-edge bg-surface px-5 py-3 font-mono text-xs text-fog">
            ~/speak-quiz
          </div>
          <div className="p-6 text-center sm:p-8">
            <div className="text-6xl" aria-hidden>
              🎤
            </div>
            <h1 className="mt-3 font-mono text-3xl font-bold text-ice">
              Speak
            </h1>
            <p className="mt-2 text-base text-fog">
              Say the full phrase — article and word. The article is
              sometimes hidden; say it anyway. You get 3 tries per phrase.
            </p>
            <p className="mt-3 font-mono text-xs text-fog">
              <span className="text-mint">{"//"}</span> a phrase you fail
              comes back to the board.
            </p>
            <p className="mt-2 font-mono text-xs text-fog">
              First use asks for microphone access — the recognizer needs
              it.
            </p>

            <div className="mt-5">
              <CategoryBar
                categories={CATEGORIES}
                active={category}
                onSelect={setCategory}
              />
            </div>

            <button
              type="button"
              onClick={() => start(category)}
              disabled={loading || !available}
              className="mt-6 w-full rounded-lg border border-neon/70 bg-surface px-6 py-4 text-xl font-bold text-neon transition hover:bg-void/50 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Getting ready…" : "Start"}
            </button>

            {!available && (
              <p className="mt-4 font-mono text-sm text-danger">
                {`Speech recognition isn't available on this device.`}
              </p>
            )}

            {error && (
              <p className="mt-6 font-mono font-bold text-danger">{error}</p>
            )}
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
            ~/speak-quiz/results
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
        <div className="flex items-center gap-3">
          <p className="font-mono text-sm text-fog">
            round {round + 1} / {questions.length}
          </p>
          {/* Attempt dots: dim = used up. */}
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-full ${
                  i < attempts ? "bg-fog/30" : "bg-mint/80"
                }`}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={hearAgain}
          aria-label="Hear the phrase again"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-panel text-lg transition hover:border-neon/60 active:scale-95"
        >
          <span aria-hidden>🔊</span>
        </button>
      </div>

      {question && (
        <div className="rounded-2xl border border-edge bg-panel p-6 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-fog">
            Say the full phrase
          </p>
          <PhraseDisplay
            question={question}
            revealed={revealed}
            feedback={feedback}
          />
          <p className="mt-3 text-sm text-fog">{question.target.english}</p>

          <button
            type="button"
            onClick={startListeningNow}
            disabled={locked}
            aria-label={
              listening ? "Listening…" : "Tap to say the phrase"
            }
            className={`mx-auto mt-6 flex h-20 w-20 items-center justify-center rounded-full border-2 bg-surface text-4xl transition active:scale-95 sm:h-24 sm:w-24 ${
              listening
                ? "animate-listening border-neon"
                : "border-edge hover:border-neon/70"
            } disabled:opacity-50`}
          >
            <span aria-hidden>🎤</span>
          </button>

          {/* Feedback: reserved height so the card doesn't jump. */}
          <div className="mt-5 flex min-h-[4rem] flex-col items-center justify-start gap-1 font-mono text-sm">
            {feedback?.kind === "correct" && (
              <p className="text-lg font-bold text-mint">Richtig! 🎉</p>
            )}
            {feedback?.kind === "heard" && (
              <>
                {feedback.heard[0] ? (
                  <p className="text-fog">
                    Heard:{" "}
                    <span lang="de" className="text-ice">
                      “{feedback.heard[0]}”
                    </span>
                  </p>
                ) : null}
                {feedback.left > 0 ? (
                  <p className="text-amber">{feedback.left} tries left — try again</p>
                ) : (
                  <>
                    <p className="text-danger">No more tries — listen.</p>
                    <p className="text-xs text-fog">
                      This phrase goes back to the board.
                    </p>
                  </>
                )}
              </>
            )}
            {feedback?.kind === "error" && (
              <>
                <p className="text-ice">{feedback.message}</p>
                {feedback.left > 0 ? (
                  <p className="text-amber">{feedback.left} tries left — try again</p>
                ) : (
                  <p className="text-danger">No more tries — listen.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PhraseDisplay({
  question,
  revealed,
  feedback,
}: {
  question: Question;
  revealed: boolean;
  feedback: Feedback | null;
}) {
  const tokens = question.target.german.split(/\s+/).filter(Boolean);
  const heard = feedback?.kind === "heard" ? feedback.match : null;
  const correctAll = feedback?.kind === "correct";
  // Long German compound words (e.g. "Machbarkeitsstudie") overflow a fixed
  // size — size the font to the longest word so it fits the card, capped at
  // text-4xl (2.25rem) so short phrases keep their large size.
  const longest = tokens.reduce((m, t) => Math.max(m, t.length), 1);
  const fontSize = `min(2.25rem, calc((100vw - 80px) / (0.62 * ${longest})))`;

  return (
    <p
      lang="de"
      className={`mt-4 flex flex-wrap justify-center gap-x-2 gap-y-1 font-mono font-bold ${
        correctAll ? "animate-pop" : ""
      }`}
      style={{ fontSize }}
    >
      {tokens.map((token, i) => {
        const isArticleToken = i === 0 && isArticle(token);
        const hidden =
          question.hideArticle && isArticleToken && !revealed && !heard;
        let cls = "text-ice";
        let text = token;
        if (heard) {
          cls = heard.tokens[i]?.correct ? "text-mint" : "text-danger";
        } else if (correctAll) {
          cls = "text-mint";
        } else if (hidden) {
          text = "···";
          cls = "text-fog";
        }
        // min-w-0 + break-words let an overly long word break inside its
        // span as a fallback, so it can never spill past the card edges.
        return (
          <span key={i} className={`min-w-0 break-words ${cls}`}>
            {text}
          </span>
        );
      })}
    </p>
  );
}
