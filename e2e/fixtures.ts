import { test, expect, type Page } from "@playwright/test";

export { test, expect, type Page };

export interface TaptalkOpts {
  /**
   * How long (ms) a fake TTS utterance keeps `speechSynthesis.speaking`
   * true. Default 150 — the app waits for `speaking` to clear before
   * advancing, so small values keep tests fast.
   */
  ttsMs?: number;
  /**
   * Install the fake `window.taptalkRecognizer` bridge (what the APK
   * provides). Default true. Set false to test the webkit fallback path
   * instead.
   */
  recognizer?: boolean;
  /**
   * Seed localStorage `taptalk-card-state` for a fresh context. Only
   * applied when the key is absent, so reloads in the same test see what
   * the app itself saved.
   */
  seedCardState?: Record<string, { until: number; ms: number }>;
  /** Seed localStorage `taptalk-sound` ("on" | "off") for a fresh context. */
  seedSound?: "on" | "off";
  /**
   * Seed localStorage `taptalk-achievements` for a fresh context:
   * per-event counters plus already-unlocked achievement ids (with
   * timestamps). Only applied when the key is absent.
   */
  seedAchievements?: {
    counters: Record<string, number>;
    unlocked: Record<string, number>;
  };
}

type TaptalkState = {
  utterances: string[];
  speakingNow: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  recStarts: number;
  recStops: number;
  session: number;
};

type TaptalkTestWindow = {
  state: TaptalkState;
  deliver: (payload: {
    status: "result" | "error";
    results?: string[];
    code?: number;
    session?: number;
  }) => void;
};

declare global {
  interface Window {
    __taptalkTest: TaptalkTestWindow;
  }
}

export interface TaptalkHandle {
  /** Every utterance the fake speech synthesis has spoken, in order. */
  utterances(): Promise<string[]>;
  /** The most recent utterance, or undefined. */
  lastUtterance(): Promise<string | undefined>;
  /** Forget previously recorded utterances. */
  clearUtterances(): Promise<void>;
  /** Call counts of the fake recognizer's startListening/stopListening. */
  recognizerCalls(): Promise<{ starts: number; stops: number }>;
  /** Deliver a recognition result, exactly as the APK bridge would. */
  deliverResult(text: string): Promise<void>;
  /** Deliver a recognizer error code, exactly as the APK bridge would. */
  deliverError(code: number, session?: number): Promise<void>;
}

/**
 * Install the WebView test fakes on a page. Must be called before the
 * first navigation (it uses `page.addInitScript`, which runs on every
 * document load of the context).
 *
 * The fakes mirror the APK bridges, not a desktop browser:
 *  - `speechSynthesis`: the bridge never fires onDone, so the app polls
 *    `speaking` — the fake keeps the flag true for `ttsMs` and records
 *    every utterance text for assertions.
 *  - `window.taptalkRecognizer`: results are delivered through
 *    `window.taptalkOnRecognitionResult` as a JSON string with a
 *    monotonically increasing `session`, passing the app's
 *    stale-session guard.
 */
export function installTaptalk(page: Page, opts: TaptalkOpts = {}): TaptalkHandle {
  page.addInitScript((init) => {
    const state: TaptalkState = {
      utterances: [],
      speakingNow: false,
      timer: undefined,
      recStarts: 0,
      recStops: 0,
      session: 0,
    };

    const seed = (key: string, value: string) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, value);
      }
    };
    if (init.seedCardState) {
      seed("taptalk-card-state", JSON.stringify(init.seedCardState));
    }
    if (init.seedSound) {
      seed("taptalk-sound", init.seedSound);
    }
    if (init.seedAchievements) {
      seed("taptalk-achievements", JSON.stringify(init.seedAchievements));
    }

    window.SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      constructor(text = "") {
        this.text = String(text);
      }
    } as unknown as typeof SpeechSynthesisUtterance;
    // This Chromium exposes window.speechSynthesis as its own getter-only
    // accessor, so a plain assignment in this (sloppy-mode) init script is a
    // silent no-op — the app then calls the native SpeechSynthesis with the
    // fake utterance and throws a WebIDL TypeError. The accessor is
    // configurable, so re-define it as a data property instead.
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        get speaking() {
          return state.speakingNow;
        },
        get pending() {
          return state.speakingNow;
        },
        speak: (u: SpeechSynthesisUtterance) => {
          clearTimeout(state.timer);
          state.utterances.push(u.text);
          state.speakingNow = true;
          state.timer = setTimeout(() => {
            state.speakingNow = false;
          }, init.ttsMs ?? 150);
        },
        cancel: () => {
          clearTimeout(state.timer);
          state.speakingNow = false;
        },
        getVoices: () => [
          {
            name: "de-DE (test)",
            lang: "de-DE",
            localService: true,
            default: false,
          },
        ],
      } as SpeechSynthesis,
      writable: true,
      configurable: true,
    });

    if (init.recognizer !== false) {
      window.taptalkRecognizer = {
        startListening: () => {
          state.recStarts += 1;
        },
        stopListening: () => {
          state.recStops += 1;
        },
      };
    }

    window.__taptalkTest = {
      state,
      deliver: (payload) => {
        state.session += 1;
        const out = { ...payload, session: payload.session ?? state.session };
        window.taptalkOnRecognitionResult!(JSON.stringify(out));
      },
    };
  }, opts);

  return {
    utterances: () => page.evaluate(() => window.__taptalkTest.state.utterances.slice()),
    lastUtterance: () =>
      page.evaluate(() => {
        const u = window.__taptalkTest.state.utterances;
        return u.length > 0 ? u[u.length - 1] : undefined;
      }),
    clearUtterances: () => page.evaluate(() => {
      window.__taptalkTest.state.utterances.length = 0;
    }),
    recognizerCalls: () =>
      page.evaluate(() => ({
        starts: window.__taptalkTest.state.recStarts,
        stops: window.__taptalkTest.state.recStops,
      })),
    deliverResult: (text: string) =>
      page.evaluate(
        (t) => window.__taptalkTest.deliver({ status: "result", results: [t] }),
        text
      ),
    deliverError: (code: number, session?: number) =>
      page.evaluate(
        (a) => window.__taptalkTest.deliver({ status: "error", code: a.code, session: a.session }),
        { code, session }
      ),
  };
}
