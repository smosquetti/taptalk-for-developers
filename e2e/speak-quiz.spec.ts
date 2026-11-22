import { test, expect, installTaptalk, type Page, type TaptalkHandle } from "./fixtures";
import { categoryWords, PRIVACY } from "./vocab";

const privacyWords = categoryWords(PRIVACY);
const privacyGermanSet = new Set(privacyWords.map((w) => w.german));
const byGerman = new Map(privacyWords.map((w) => [w.german, w]));

const mic = (page: Page) => page.getByRole("button", { name: "Tap to say the phrase" });
const listening = (page: Page) => page.getByRole("button", { name: "Listening…" });
const correct = (page: Page) => page.getByText("Richtig! 🎉");

async function startSpeakQuiz(page: Page) {
  await page.goto("/webapp/speak-quiz.html");
  // The category chips are static, so privacy can be picked even though the
  // vocabulary only loads on Start.
  await page.getByRole("navigation", { name: "Categories" }).getByRole("button", { name: "Privacy" }).tap();
  await page.getByRole("button", { name: "Start" }).tap();
}

// Wait for the round-start TTS: the utterance lands right after the round
// indicator renders, and feedback utterances start with "Richtig!" so a
// membership test against the privacy terms identifies the target phrase.
async function waitPhrase(t: TaptalkHandle) {
  await expect
    .poll(async () => privacyGermanSet.has((await t.lastUtterance()) ?? ""), {
      timeout: 10_000,
    })
    .toBe(true);
  return (await t.lastUtterance())!;
}

test.describe("speak-quiz", () => {
  test("start is enabled when the native recognizer bridge is present", async ({ page }) => {
    // The fake must be installed before the first navigation: the app reads
    // the recognizer availability once, when the page mounts.
    installTaptalk(page);
    await page.goto("/webapp/speak-quiz.html");
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  test("full game: a hidden article is revealed after a miss, then the exact phrase passes", async ({ page }) => {
    const t = installTaptalk(page);
    await startSpeakQuiz(page);

    let misses = 0;
    let sawHidden = false;

    for (let round = 1; round <= 8; round++) {
      await expect(page.getByText(`round ${round} / 8`)).toBeVisible();
      const phrase = await waitPhrase(t);

      if (await page.getByText("···").isVisible()) {
        // buildQuestions forces at least one hidden-article round, and every
        // hidden privacy phrase starts with a real article.
        sawHidden = true;
        misses++;
        const [article, ...rest] = phrase.split(" ");
        // Any article different from the target's breaks the match; the
        // fallback must never equal the original (a "das" target would
        // then "mispronounce" its own correct phrase).
        const wrongArticle = article === "der" ? "die" : "der";
        const wrong = `${wrongArticle} ${rest.join(" ")}`;

        await mic(page).tap();
        await expect(listening(page)).toBeVisible();
        await t.deliverResult(wrong);

        // Feedback: heard text, one consumed attempt dot, and the article
        // revealed as a danger token while the rest of the phrase turns mint.
        await expect(page.getByText(`Heard: “${wrong}”`)).toBeVisible();
        await expect(page.getByText("2 tries left — try again")).toBeVisible();
        await expect(page.locator('[class~="bg-fog/30"]')).toHaveCount(1);
        await expect(page.locator('[class~="bg-mint/80"]')).toHaveCount(2);
        const tokens = page.locator('p[lang="de"] span');
        await expect(tokens.nth(0)).toHaveClass(/text-danger/);
        await expect(tokens.nth(1)).toHaveClass(/text-mint/);

        await mic(page).tap();
        await expect(listening(page)).toBeVisible();
        await t.deliverResult(phrase);
      } else {
        await mic(page).tap();
        await expect(listening(page)).toBeVisible();
        await t.deliverResult(phrase);
      }

      await expect(correct(page)).toBeVisible();
    }

    // The forced guarantee means at least one hidden round happened.
    expect(sawHidden).toBeTruthy();
    await expect(page.getByText(`${8 - misses} / 8 on the first try`)).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(8 - misses));
  });

  test("a permission error consumes a try, then the exact phrase passes", async ({ page }) => {
    const t = installTaptalk(page);
    await startSpeakQuiz(page);

    await expect(page.getByText("round 1 / 8")).toBeVisible();
    const phrase = await waitPhrase(t);

    await mic(page).tap();
    await expect(listening(page)).toBeVisible();

    // The bridge emits permission errors at session 0 (before any start).
    await t.deliverError(-1, 0);

    await expect(
      page.getByText("Microphone access not allowed. Allow the microphone, then tap again."),
    ).toBeVisible();
    await expect(page.getByText("2 tries left — try again")).toBeVisible();

    await mic(page).tap();
    await expect(listening(page)).toBeVisible();
    await t.deliverResult(phrase);
    await expect(correct(page)).toBeVisible();
  });

  test("a silent microphone times out after 15 seconds", async ({ page }) => {
    const t = installTaptalk(page);
    await startSpeakQuiz(page);

    await expect(page.getByText("round 1 / 8")).toBeVisible();
    await waitPhrase(t);

    await mic(page).tap();
    await expect(listening(page)).toBeVisible();

    // Nothing is delivered — the app's 15s recognition timeout must fire.
    await expect(page.getByText("I didn't catch that. Try again.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("2 tries left — try again")).toBeVisible();
  });

  test("three failures end the round and unhide the card in localStorage", async ({ page }) => {
    const t = installTaptalk(page, {
      seedCardState: Object.fromEntries(privacyWords.map((w) => [w.id, { until: 0, ms: 0 }])),
    });
    await startSpeakQuiz(page);

    await expect(page.getByText("round 1 / 8")).toBeVisible();
    const phrase = await waitPhrase(t);
    const word = byGerman.get(phrase);
    expect(word).toBeDefined();

    await mic(page).tap();
    await t.deliverResult("falsch");
    await expect(page.getByText("Heard: “falsch”")).toBeVisible();
    await expect(page.getByText("2 tries left — try again")).toBeVisible();

    await mic(page).tap();
    await t.deliverResult("quer quer");
    await expect(page.getByText("1 tries left — try again")).toBeVisible();

    await mic(page).tap();
    await t.deliverResult("nie nie");
    await expect(page.getByText("No more tries — listen.")).toBeVisible();
    await expect(page.getByText("This phrase goes back to the board.")).toBeVisible();

    // The fail feedback speaks the target phrase…
    await expect
      .poll(async () => privacyGermanSet.has((await t.lastUtterance()) ?? ""))
      .toBe(true);
    await expect(t.lastUtterance()).resolves.toBe(phrase);
    // …and the app removes the card from the hidden set.
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem("taptalk-card-state"));
        return raw === null || !(word!.id in JSON.parse(raw));
      })
      .toBeTruthy();

    // The remaining rounds can still be won.
    for (let round = 2; round <= 8; round++) {
      await expect(page.getByText(`round ${round} / 8`)).toBeVisible();
      const p = await waitPhrase(t);
      await mic(page).tap();
      await expect(listening(page)).toBeVisible();
      await t.deliverResult(p);
      await expect(correct(page)).toBeVisible();
    }

    await expect(page.getByText("7 / 8 on the first try")).toBeVisible();
  });

  test("advances at the 15s cap when the TTS bridge never reports end-of-speech", async ({ page }) => {
    // The real APK bridge never fires onDone, so the app relies on a 15s
    // cap. Simulate a stuck bridge: utterances keep `speaking` true for 20s.
    const t = installTaptalk(page, { ttsMs: 20_000 });
    await startSpeakQuiz(page);

    await expect(page.getByText("round 1 / 8")).toBeVisible();
    const phrase = await waitPhrase(t);

    await mic(page).tap();
    await expect(listening(page)).toBeVisible();
    await t.deliverResult(phrase);

    await expect(correct(page)).toBeVisible();
    const t0 = Date.now();
    await expect(page.getByText("round 2 / 8")).toBeVisible({ timeout: 20_000 });
    const elapsed = Date.now() - t0;

    // waitThen caps at MAX_TTS_WAIT_MS = 15s: the round advances a little
    // after 15s, not after the 20s fake utterance.
    expect(elapsed).toBeGreaterThanOrEqual(14_500);
    expect(elapsed).toBeLessThan(17_000);
  });
});
