import { test, expect, installTaptalk, type Page } from "./fixtures";
import { loadVocabulary, categoryWords, PRIVACY } from "./vocab";

const vocabulary = loadVocabulary();
const privacyWords = categoryWords(PRIVACY);
const privacyGermanSet = new Set(privacyWords.map((w) => w.german));
const byGerman = new Map(privacyWords.map((w) => [w.german, w]));
const englishSet = new Set(vocabulary.map((w) => w.english));

const categoriesNav = (page: Page) => page.getByRole("navigation", { name: "Categories" });

// The quiz page loads the vocabulary only when Start is pressed, so the
// category chips render immediately. The privacy category has 24 terms
// (>= 8), exactly one no-article word, and no English duplicates, which
// keeps every round deterministic.
async function startQuiz(page: Page, mode: "listen" | "read") {
  await page.goto("/webapp/quiz.html");
  if (mode === "read") {
    // The button's accessible name is "Read" plus its hint span
    // ("Read the term, pick the meaning"), so match by substring — the
    // only other mode button is "Listen".
    await page.getByRole("button", { name: "Read" }).tap();
  }
  await categoriesNav(page).getByRole("button", { name: "Privacy" }).tap();
  await page.getByRole("button", { name: "Start" }).tap();
}

const waitRound = (page: Page, round: number, mode?: string) =>
  page.getByText(mode ? `round ${round} / 8 · ${mode}` : `round ${round} / 8`);

// The four option buttons are the only buttons whose text is a vocabulary
// English; find any of them that isn't the target (read mode).
async function pickWrongOption(page: Page, target: string) {
  const names = (
    await page.getByRole("button").evaluateAll((els) => els.map((el) => el.textContent ?? ""))
  )
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const wrongName = names.find((n) => englishSet.has(n) && n !== target);
  expect(wrongName).toBeDefined();
  return page.getByRole("button", { name: wrongName!, exact: true }).first();
}

test.describe("quiz", () => {
  test("read mode: 8 correct answers in a row finish with 8 / 8", async ({ page }) => {
    installTaptalk(page);
    await startQuiz(page, "read");

    for (let round = 1; round <= 8; round++) {
      await expect(waitRound(page, round, "read")).toBeVisible();
      // Exactly one p[lang="de"] on screen: the German target term.
      const german = (await page.locator('p[lang="de"]').allInnerTexts())[0];
      const word = byGerman.get(german);
      expect(word).toBeDefined();

      // The target's English appears on exactly one of the four options.
      const option = page.getByRole("button", { name: word!.english, exact: true });
      await expect(option).toHaveCount(1);
      await option.tap();
    }

    await expect(page.getByText("8 / 8 on the first try")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
  });

  test("a wrong option plays the target, the correct one finishes the game", async ({ page }) => {
    const t = installTaptalk(page);
    await startQuiz(page, "read");

    // Round 1: answer wrong, then right.
    await expect(waitRound(page, 1, "read")).toBeVisible();
    const german = (await page.locator('p[lang="de"]').allInnerTexts())[0];
    const word = byGerman.get(german)!;

    await (await pickWrongOption(page, word.english)).tap();
    // The wrong answer replays the target German.
    await expect(t.lastUtterance()).resolves.toBe(word.german);

    const option = page.getByRole("button", { name: word.english, exact: true });
    await expect(option).toBeEnabled();
    await option.tap();

    // Finish the remaining rounds correctly.
    for (let round = 2; round <= 8; round++) {
      await expect(waitRound(page, round, "read")).toBeVisible();
      const g = (await page.locator('p[lang="de"]').allInnerTexts())[0];
      const w = byGerman.get(g)!;
      await page.getByRole("button", { name: w.english, exact: true }).tap();
    }

    await expect(page.getByText("7 / 8 on the first try")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "7");
  });

  test("listen mode speaks every round and 8 correct answers leave 16 utterances", async ({ page }) => {
    const t = installTaptalk(page);
    await startQuiz(page, "listen"); // the default mode

    for (let round = 1; round <= 8; round++) {
      await expect(waitRound(page, round, "listen")).toBeVisible();
      // The round-start utterance lands right after the indicator renders;
      // poll until the latest utterance is a privacy German term (feedback
      // utterances start with "Richtig!" and never match).
      await expect
        .poll(async () => privacyGermanSet.has((await t.lastUtterance()) ?? ""))
        .toBe(true);
      const german = (await t.lastUtterance())!;

      // In listen mode the options are the German terms.
      const option = page.getByRole("button", { name: german, exact: true });
      await expect(option).toHaveCount(1);
      await option.tap();
    }

    await expect(page.getByText("8 / 8 on the first try")).toBeVisible();
    // 8 round-start phrases + 8 "Richtig! …" feedback lines.
    await expect((await t.utterances()).length).toBe(16);
  });

  test("a wrong answer unhides the target card in localStorage", async ({ page }) => {
    installTaptalk(page, {
      seedCardState: Object.fromEntries(privacyWords.map((w) => [w.id, { until: 0, ms: 0 }])),
    });
    await startQuiz(page, "read");

    await expect(waitRound(page, 1, "read")).toBeVisible();
    const german = (await page.locator('p[lang="de"]').allInnerTexts())[0];
    const word = byGerman.get(german)!;

    await (await pickWrongOption(page, word.english)).tap();

    // The app removes the target from the hidden set after a miss…
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem("taptalk-card-state"));
        return raw === null || !(word.id in JSON.parse(raw));
      })
      .toBeTruthy();
    // …while the rest of the seeded set stays hidden.
    const state = JSON.parse(
      (await page.evaluate(() => window.localStorage.getItem("taptalk-card-state"))) ?? "{}",
    );
    for (const w of privacyWords) if (w.id !== word.id) expect(state[w.id]).toBeDefined();

    // Correct the round, then finish the game.
    await page.getByRole("button", { name: word.english, exact: true }).tap();
    for (let round = 2; round <= 8; round++) {
      await expect(waitRound(page, round, "read")).toBeVisible();
      const g = (await page.locator('p[lang="de"]').allInnerTexts())[0];
      await page.getByRole("button", { name: byGerman.get(g)!.english, exact: true }).tap();
    }

    await expect(page.getByText("7 / 8 on the first try")).toBeVisible();
  });

  test("shows the vocabulary error when the JSON fetch fails", async ({ page }) => {
    installTaptalk(page);
    await page.route("**/vocabulary.json", (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto("/webapp/quiz.html");
    await categoriesNav(page).getByRole("button", { name: "Privacy" }).tap();
    await page.getByRole("button", { name: "Start" }).tap();

    // The quiz page renders the raw error text (no "[error]" prefix).
    await expect(page.getByText("Could not load vocabulary.json (HTTP 500)")).toBeVisible();
  });
});
