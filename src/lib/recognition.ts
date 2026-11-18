// Recognition plumbing for the Speak quiz: one entry point over two
// backends —
//   1. the APK's native bridge (window.taptalkRecognizer, backed by
//      android.speech.SpeechRecognizer, de-DE), and
//   2. the browser's webkitSpeechRecognition fallback (dev mode).
//
// Outcomes arrive at the sink registered via setOutcomeSink(). Both
// backends are guarded by a monotonically increasing session so a result
// from a superseded listening session is never delivered.

export type RecognitionOutcome =
  | { status: "result"; results: string[] }
  | { status: "error"; code: number };

type OutcomeSink = (outcome: RecognitionOutcome) => void;

// Stable error codes, shared with SpeechRecognitionBridge.kt (the browser
// fallback maps webkitSpeechRecognition errors onto the same set):
//   -1  permission not granted
//    1  no recognizer on device
//    2  recognizer busy
//    3  no usable match
//    4  audio failure
//    5  other engine/network error
// Code 9 is reserved for the client-side timeout (no backend sends it).

declare global {
  interface Window {
    taptalkRecognizer?: {
      startListening: () => void;
      stopListening: () => void;
    };
    taptalkOnRecognitionResult?: (json: string) => void;
  }
}

type SpeechRecognitionEventLike = {
  results: Array<Array<{ transcript: string }>>;
};
type SpeechErrorEventLike = { error?: string };

type SpeechRecognitionLike = {
  lang: string;
  maxAlternatives: number;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

let sink: OutcomeSink | null = null;
let active = false;
// Native payloads echo the bridge's session; webkit uses its own counter.
let lastNativeSession = 0;
let webkitSession = 0;
let webkitRecognizer: SpeechRecognitionLike | null = null;

// Native → JS: called by the APK bridge on the WebView's main thread.
// Registered at module scope so it survives client-side page loads.
if (typeof window !== "undefined") {
  window.taptalkOnRecognitionResult = (json: string) => {
    try {
      const parsed = JSON.parse(json) as {
        status?: string;
        session?: number;
        results?: string[];
        code?: number;
      };
      if (
        typeof parsed.session === "number" &&
        parsed.session <= lastNativeSession
      ) {
        return; // stale result from a superseded session
      }
      lastNativeSession = parsed.session ?? 0;
      if (parsed.status === "result") {
        sink?.({ status: "result", results: parsed.results ?? [] });
      } else if (parsed.status === "error") {
        sink?.({ status: "error", code: parsed.code ?? 5 });
      }
    } catch {
      // Malformed payload — ignore.
    }
  };
}

/** True when some recognition backend is present on this page. */
export function recognitionAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return (
    Boolean(window.taptalkRecognizer) ||
    "webkitSpeechRecognition" in window ||
    "SpeechRecognition" in window
  );
}

/**
 * Registers the sink that receives outcomes. Returns a cleanup function
 * that unregisters the sink and stops any in-flight recognition.
 */
export function setOutcomeSink(cb: OutcomeSink): () => void {
  sink = cb;
  return () => {
    if (sink === cb) sink = null;
    stopRecognition();
  };
}

function mapWebkitError(error: string): number {
  switch (error) {
    case "not-allowed":
      return -1;
    case "aborted":
      return 2;
    case "no-speech":
      return 3;
    case "audio-capture":
      return 4;
    case "network":
      return 5;
    default:
      return 5;
  }
}

/** Starts a recognition session; ignored when one is already active. */
export function startRecognition(): void {
  if (typeof window === "undefined" || active) return;
  active = true;

  const native = window.taptalkRecognizer;
  if (native) {
    native.startListening();
    return;
  }

  // Typed structurally: lib.dom doesn't declare both globals as
  // constructible, so read them through an explicit cast.
  const win = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = win.webkitSpeechRecognition ?? win.SpeechRecognition;
  if (!Ctor) {
    active = false;
    sink?.({ status: "error", code: 1 });
    return;
  }

  try {
    const rec = new Ctor();
    webkitSession += 1;
    const session = webkitSession;
    webkitRecognizer = rec;
    rec.lang = "de-DE";
    rec.maxAlternatives = 3;
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event: SpeechRecognitionEventLike) => {
      if (!active || session !== webkitSession) return;
      const results: string[] = [];
      for (const alt of event.results) {
        for (const item of alt) {
          results.push(String(item.transcript));
        }
      }
      if (!active || session !== webkitSession) return;
      active = false;
      webkitRecognizer = null;
      sink?.({ status: "result", results });
    };
    rec.onerror = (event: SpeechErrorEventLike) => {
      if (!active || session !== webkitSession) return;
      active = false;
      webkitRecognizer = null;
      sink?.({ status: "error", code: mapWebkitError(String(event.error)) });
    };
    rec.onend = () => {
      if (!active || session !== webkitSession) return;
      active = false;
      webkitRecognizer = null;
    };
    rec.start();
  } catch {
    active = false;
    webkitRecognizer = null;
    sink?.({ status: "error", code: 5 });
  }
}

/** Stops the in-flight session; stale callbacks are dropped by session. */
export function stopRecognition(): void {
  if (!active) return;
  active = false;
  const native = typeof window !== "undefined" ? window.taptalkRecognizer : null;
  if (native) {
    native.stopListening();
  } else {
    webkitSession += 1; // invalidate the pending callbacks
    try {
      webkitRecognizer?.abort();
    } catch {
      // non-fatal
    }
    webkitRecognizer = null;
  }
}
