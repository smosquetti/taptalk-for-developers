# TapTalk — German for Developers

A German vocabulary learning app for software developers. Tap a card to see
and hear a German dev term — article, example sentence, English
translation — then drill it in a quiz.

Dark, high-tech terminal aesthetic: neon-on-void palette, monospace type,
terminal window chrome, blinking cursor.

Built with **Next.js (App Router) + React + TypeScript + Tailwind CSS**.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Production build & serve:

```bash
npm run build
npm start
```

## UI tests (Playwright)

The web app runs inside the APK's WebView, so the tests exercise it
exactly as the APK serves it: a test server
(`scripts/webapp-test-server.mjs`) serves the statically exported web
app with its root-absolute URLs rewritten to relative ones — the same
rewrites `android/build-apk.sh` applies — under `/webapp/`, and every
page is a full document load, just like in the WebView. The browser
runs with a Pixel 5 viewport (393 px, touch), and gestures use
`tap()`.

The specs also install faithful fakes of the native bridges before the
first page load:

- a `speechSynthesis` whose utterances keep `speaking` true for a
  configurable time and **never fire onDone** — exactly what the APK's
  `TextToSpeech` bridge does, and what the app relies on (it polls
  `speaking` and caps the wait at 15 s).
- `window.taptalkRecognizer` delivering results through
  `window.taptalkOnRecognitionResult` as JSON strings with monotonic
  sessions, as `SpeechRecognitionBridge.kt` does.

```bash
npm install
npx playwright install chromium   # first time only
npm run test:e2e                  # builds the web app once if stale, then runs all specs
```

Specs live in `e2e/`:

- `board.spec.ts` — board boot, card detail overlay (close via
  button / Escape / backdrop), hide & restore, sound toggle
  persistence, vocabulary load errors
- `quiz.spec.ts` — listen & read rounds, wrong-answer replay and
  un-hide in localStorage, vocabulary load errors
- `speak-quiz.spec.ts` — full-phrase recognition, hidden-article
  reveal styling, permission / 15 s timeout errors, 3-strike
  un-hide, and the 15 s TTS cap when the bridge never reports
  end-of-speech
- `webview.spec.ts` — every page boots from a full-document load,
  nav links hard-navigate, no request ever leaves the asset origin,
  no horizontal overflow at phone width

## How it works

### Word board (`/`)

- A board of **20 random cards**, reshuffled on every app launch.
  Tapping a card speaks the German term immediately and opens a
  terminal-style detail window: the word with its article highlighted,
  the English meaning, and a German example sentence with its
  translation — plus "Word" / "Example" buttons to replay the audio.
- **Hiding cards:** the detail window offers "never / 1 day /
  1 week / 1 month" hides. A hidden card leaves the board
  immediately — another card takes its place — and temporary hides
  expire on their own. The board lists the currently hidden cards,
  where each can be restored. Card state is stored in
  `localStorage` (in the APK that is the app's private storage —
  same durability as native SharedPreferences, so no bridge needed).
- The sound toggle in the header turns audio off/on (text stays
  available either way). The preference is saved in the browser.

### Quiz (`/quiz`)

- **Listen mode:** the app speaks a German term; pick it out of four
  German words. A big play button (and a HUD button) repeats the audio.
- **Read mode:** the German term is shown large; pick its English
  meaning out of four.
- Choose a category to focus a topic, or "all" for a mixed drill.
- Correct answers glow green and are confirmed in German
  ("Richtig! …") — the app waits for that audio to finish before
  moving to the next word, so it is never cut off. Wrong answers shake
  gently and replay the correct term — no penalty, just feedback.
- After 8 rounds a results screen shows how many you got on the first
  try.
- **Hidden cards:** words hidden on the board still appear in the quiz.
  A wrong answer un-hides the involved words (the target and the picked
  dummy), so they come back to the board for more practice.

### Speak quiz (`/speak-quiz`)

A speaking drill: the app speaks the **full phrase — article and word**
(„der Computer"), and the device's speech recognizer checks what you
actually said.

- **Full-phrase recognition:** you must get the *article* and the *word*
  right (word order included). After each attempt the phrase is colored
  per token: green = spoken correctly, red = wrong or missing — so you
  see exactly which part failed (e.g. article red + word green).
- **Hidden articles:** in about a third of the rounds the article is
  hidden in the text (a „···" placeholder). The TTS still speaks it, and
  you still have to say it — the review reveals the article in its own
  red/green color.
- **3 tries per phrase**, 8 rounds. A phrase you fail is spoken as a
  model phrase and comes back to the board (hidden cards included).
- In the APK the recognition uses `android.speech.SpeechRecognizer`
  (de-DE) through a `window.taptalkRecognizer` bridge
  (`SpeechRecognitionBridge.kt`); in a plain browser it falls back to
  `webkitSpeechRecognition`. The app requests **microphone access** on
  first use.

### Audio

Audio is the browser's built-in Web Speech API (`speechSynthesis`) —
no API keys, no network calls, works offline in any modern browser.
The app speaks in **German (`de-DE`)** and prefers a `localService`
voice when one is available. Voice quality depends on the device
(e.g. Chrome/Edge on Windows ship good German voices; Linux may need
installed voices).

## Android APK (100% offline, on-device)

The repo also builds a native APK: a Kotlin/Android shell (`android/`)
wraps the statically exported web app in a WebView. The web app is
bundled into the APK under `assets/webapp/` and served over a private
`https://appassets.taptalk.local` origin with
`androidx.webkit.WebViewAssetLoader`, so the page — including its
`fetch()` of `vocabulary.json` — behaves like a normal web page while
every request is answered locally from the APK (Chromium's `fetch()`
refuses `file://` URLs, so plain asset loading does not work).
`window.speechSynthesis` is bridged to the device's native
`TextToSpeech`, so the German audio uses the phone's German voice.

- **One permission: `RECORD_AUDIO`** — needed by the Speak quiz
  (`android.speech.SpeechRecognizer`), requested at runtime on first
  use. There is no INTERNET permission, and every navigation off the
  asset host is blocked, so the app itself can never touch the network.
  (Caveat: the system speech-recognition engine may use the network or
  on-device language data depending on the device/OS — that runs
  outside the app, and some devices have no recognizer at all; the
  Speak quiz then shows a notice and stays disabled.)
- Everything (web app, fonts, vocabulary) is bundled inside the APK —
  nothing is ever downloaded.
- The home/back buttons, sound toggle (persisted via DOM storage)
  and audio all behave like a native app.

### Build

```bash
npm run build:apk            # = bash android/build-apk.sh
```

Five steps: `next build` (static export) → copy `out/` into
`app/src/main/assets/webapp/` → rewrite the static export's
root-absolute URLs to relative ones (they must resolve under the
`/webapp/` origin path) → `./gradlew assembleDebug`. The APK lands in
`android/app/build/outputs/apk/debug/app-debug.apk`.

Prerequisites:

- JDK 17+
- Android SDK with **platform android-37** and **build-tools
  36.0.0** installed. `sdk.dir` is written to
  `android/local.properties` automatically (or set `ANDROID_HOME`).
- Network access on the build machine (Gradle downloads its
  distribution and the Android/Kotlin dependencies on first run).

### Install

With a phone connected and USB debugging enabled:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

(or copy the APK to the phone and open it). A release build can be
produced with `cd android && ./gradlew assembleRelease` (unsigned —
sign it before distributing).

## Vocabulary data (how to add words)

All vocabulary lives in **`public/vocabulary.json`** — a JSON array of
600 objects:

```json
[
  {
    "id": "hardware-01",
    "category": "hardware",
    "german": "der Computer",
    "english": "computer",
    "exampleDe": "Mein neuer Computer ist extrem schnell.",
    "exampleEn": "My new computer is extremely fast."
  }
]
```

- `id` must be unique — use `<category>-<number>` (e.g. `oop-61`).
- `german` should include the article so the app can highlight it
  (e.g. "die Schnittstelle").
- `category` must be one of the 17 ids defined in
  `src/lib/vocabulary.ts`: `hardware`, `fundamentals`, `control-flow`,
  `development`, `oop`, `web`, `security-ops`, `workplace`, `devops`,
  `qa`, `architecture`, `advanced`, `networking`, `data`, `privacy`,
  `ai`, `product`.

To add a new word:

1. Add an entry to `public/vocabulary.json`.
2. Done — the JSON is fetched at runtime, so no rebuild is needed.

For a whole new category, also add it to `CATEGORIES` and `CategoryId`
in `src/lib/vocabulary.ts`.

## Project structure

```
android/
  build-apk.sh             # static export → assets/webapp → debug APK
  app/                     # Kotlin WebView shell (TTS + speech
                           # recognition bridges, offline)
e2e/
  fixtures.ts              # WebView test fakes (TTS + recognizer
                           # bridges) for the Playwright specs
  board.spec.ts            # board UI tests
  quiz.spec.ts             # quiz UI tests
  speak-quiz.spec.ts       # speak-quiz UI tests
  webview.spec.ts          # WebView-constraint tests (origin, overflow)
public/
  vocabulary.json          # the 600-word list (de/en + examples)
src/
  app/
    layout.tsx             # shell: header, sound provider, footer
    page.tsx               # word board
    quiz/page.tsx          # quiz (listen + read modes)
    speak-quiz/page.tsx    # speak quiz (full-phrase recognition)
    globals.css            # high-tech theme + animations
  components/
    Card.tsx               # tappable term card
    CategoryBar.tsx        # category filter chips
    DetailOverlay.tsx      # terminal-style detail window
    Header.tsx             # nav + sound toggle
    SoundContext.tsx       # sound on/off, persisted
  lib/
    speech.ts              # Web Speech API helpers (de-DE)
    recognition.ts         # recognition plumbing (APK bridge +
                           # webkitSpeechRecognition fallback)
    speakMatch.ts          # token-level phrase matching for the review
    vocabulary.ts          # types, 17 categories, JSON loader
```

## Design notes

- Big touch targets, high-contrast neon-on-dark palette.
- Audio only plays on tap (never on load), and can be switched off.
- Animations respect `prefers-reduced-motion`.
- Keyboard accessible: cards are buttons, Escape closes the detail
  window, quiz options are buttons with `aria-pressed` where relevant.
# taptalk-for-developers
