# TapTalk — German for Developers

A German vocabulary learning app for software developers. Tap a card to see
and hear a German dev term — article, example sentence, English
translation — then drill it in a quiz. Built around the 200-word list from
`material/200_german_words_software_engineering.pdf`.

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
  ("Richtig! …"); wrong answers shake gently and replay the correct
  term — no penalty, just feedback.
- After 8 rounds a results screen shows how many you got on the first
  try.
- **Hidden cards:** words hidden on the board still appear in the quiz.
  A wrong answer un-hides the involved words (the target and the picked
  dummy), so they come back to the board for more practice.

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

- **No permissions at all** — the manifest declares none. There is no
  INTERNET permission, and every navigation off the asset host is
  blocked, so the app can never touch the network.
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
200 objects:

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
  app/                     # Kotlin WebView shell (TTS bridge, offline)
public/
  vocabulary.json          # the 200-word list (de/en + examples)
material/
  200_german_words_software_engineering.pdf   # source list
src/
  app/
    layout.tsx             # shell: header, sound provider, footer
    page.tsx               # word board
    quiz/page.tsx          # quiz (listen + read modes)
    globals.css            # high-tech theme + animations
  components/
    Card.tsx               # tappable term card
    CategoryBar.tsx        # category filter chips
    DetailOverlay.tsx      # terminal-style detail window
    Header.tsx             # nav + sound toggle
    SoundContext.tsx       # sound on/off, persisted
  lib/
    speech.ts              # Web Speech API helpers (de-DE)
    vocabulary.ts          # types, 17 categories, JSON loader
```

## Design notes

- Big touch targets, high-contrast neon-on-dark palette.
- Audio only plays on tap (never on load), and can be switched off.
- Animations respect `prefers-reduced-motion`.
- Keyboard accessible: cards are buttons, Escape closes the detail
  window, quiz options are buttons with `aria-pressed` where relevant.
# taptalk-for-developers
