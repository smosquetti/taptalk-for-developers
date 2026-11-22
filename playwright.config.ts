import { defineConfig, devices } from "@playwright/test";

// The app ships in an Android WebView: phone viewport, touch input, and the
// APK asset layout served under /webapp/ (scripts/webapp-test-server.mjs
// replicates android/build-apk.sh so tests exercise exactly what the APK
// loads — never the raw static export at a server root).
export default defineConfig({
  testDir: "./e2e",
  // Full quiz/speak-quiz games plus the 15 s recognition-timeout and
  // stuck-TTS tests comfortably fit in 60 s.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  webServer: {
    command: "node scripts/webapp-test-server.mjs",
    url: "http://127.0.0.1:8473/webapp/",
    timeout: 240_000, // includes a static-export build when out/ is stale
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://127.0.0.1:8473",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "android-webview",
      use: {
        ...devices["Pixel 5"], // 393x852, touch — closest to the WebView
      },
    },
  ],
});
