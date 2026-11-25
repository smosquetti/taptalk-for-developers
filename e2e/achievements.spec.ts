import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, installTaptalk, type Page, type TaptalkHandle } from "./fixtures";
import { categoryWords, PRIVACY } from "./vocab";

// The spec asserts against the real definitions, so a point or target
// change here is caught where it matters (score, order, progress text).
const achievements = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "public/achievements.json"), "utf8"),
) as { id: string; name: string; points: number; event: string; target: number }[];
const TOTAL = achievements.length;

const privacyWords = categoryWords(PRIVACY);
const byGerman = new Map(privacyWords.map((w) => [w.german, w]));
const privacyGermanSet = new Set(privacyWords.map((w) => w.german));

type StoredProgress = {
  counters: Record<string, number>;
  unlocked: Record<string, number>;
} | null;

const readProgress = (page: Page) =>
  page.evaluate(
    () => JSON.parse(window.localStorage.getItem("taptalk-achievements") ?? "null"),
  ) as Promise<StoredProgress>;

// The round-start TTS speaks the full phrase, even in hidden-article
// rounds where the display masks the article; membership in the privacy
// set identifies it (feedback lines start with "Richtig!").
async function waitPhrase(t: TaptalkHandle) {
  await expect
    .poll(async () => privacyGermanSet.has((await t.lastUtterance()) ?? ""), {
      timeout: 10_000,
    })
    .toBe(true);
  return (await t.lastUtterance())!;
}

test.describe("achievements", () => {
  test("board shows the score section and links to the achievements page", async ({ page }) => {
    installTaptalk(page);
    await page.goto("/webapp/");

    await expect(page.getByText("0 pts", { exact: true })).toBeVisible();
    await expect(page.getByText(`0/${TOTAL} achievements unlocked`, { exact: true })).toBeVisible();

    // The APK/test-server URL rewrites turn the root-absolute href into a
    // relative one under the /webapp/ origin.
    const link = page.getByRole("link", { name: "View all achievements" });
    await expect(link).toHaveAttribute("href", "achievements.html");
    await link.tap();
    await expect(page.url()).toContain("achievements.html");

    await expect(page.getByText("0 pts", { exact: true })).toBeVisible();
    await expect(page.getByText(`0/${TOTAL} unlocked`, { exact: true })).toBeVisible();
    await expect(page.locator("ul li")).toHaveCount(TOTAL);
  });

  test("tapping a board card records boardPick and unlocks First Steps", async ({ page }) => {
    installTaptalk(page);
    await page.goto("/webapp/");

    await page.getByRole("button", { name: / — / }).first().tap();
    await expect(page.getByRole("dialog")).toBeVisible();

    await expect
      .poll(async () => (await readProgress(page))?.counters.boardPick ?? 0)
      .toBeGreaterThanOrEqual(1);
    const progress = (await readProgress(page))!;
    expect(progress.unlocked["first-pick"]).toBeDefined();

    await expect(page.getByText("10 pts", { exact: true })).toBeVisible();
    await expect(page.getByText(`1/${TOTAL} achievements unlocked`, { exact: true })).toBeVisible();
  });

  test("lists completed, in-progress and locked in that order with live progress", async ({ page }) => {
    installTaptalk(page, {
      seedAchievements: {
        counters: { boardPick: 25, quizCompleted: 2, speakFirstTry: 3 },
        unlocked: { "first-pick": 1, "curious-mind": 2, "quiz-debut": 3 },
      },
    });
    await page.goto("/webapp/achievements.html");

    // 10 (First Steps) + 40 (Curious Mind) + 20 (Quiz Debut).
    await expect(page.getByText("70 pts", { exact: true })).toBeVisible();
    await expect(page.getByText(`3/${TOTAL} unlocked`, { exact: true })).toBeVisible();
    await expect(page.getByText("✓ unlocked")).toHaveCount(3);

    const texts = await page
      .locator("ul li")
      .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    const idx = (name: string) => {
      const i = texts.findIndex((t) => t.includes(name));
      expect(i, `row for ${name}`).toBeGreaterThanOrEqual(0);
      return i;
    };

    // Completed group, highest points first (40 > 20 > 10)…
    expect(idx("Curious Mind")).toBeLessThan(idx("Quiz Debut"));
    expect(idx("Quiz Debut")).toBeLessThan(idx("First Steps"));
    // …then in progress (Vocabulary Veteran 100 > First Try Club 80 > Regular 50)…
    expect(idx("First Steps")).toBeLessThan(idx("Vocabulary Veteran"));
    expect(idx("Vocabulary Veteran")).toBeLessThan(idx("First Try Club"));
    expect(idx("First Try Club")).toBeLessThan(idx("Regular"));
    // …then locked (Word Hoarder, 200 pts, tops its group).
    expect(idx("Regular")).toBeLessThan(idx("Word Hoarder"));

    // Per-achievement progress, capped at the target.
    await expect(page.getByText("25/100", { exact: true })).toBeVisible();
    await expect(page.getByText("3/25", { exact: true })).toBeVisible();
    await expect(page.getByText("2/7", { exact: true })).toBeVisible();
  });

  test("a perfect read quiz unlocks Quiz Debut and Perfekt!", async ({ page }) => {
    installTaptalk(page);
    await page.goto("/webapp/quiz.html");
    await page
      .getByRole("navigation", { name: "Categories" })
      .getByRole("button", { name: "Privacy" })
      .tap();
    await page.getByRole("button", { name: "Read" }).tap();
    await page.getByRole("button", { name: "Start" }).tap();

    for (let round = 1; round <= 8; round++) {
      await expect(page.getByText(`round ${round} / 8 · read`)).toBeVisible();
      const german = (await page.locator('p[lang="de"]').allInnerTexts())[0];
      await page.getByRole("button", { name: byGerman.get(german)!.english, exact: true }).tap();
    }

    await expect(page.getByText("8 / 8 on the first try")).toBeVisible();
    await expect(page.getByText("Achievement unlocked: Quiz Debut", { exact: true })).toBeVisible();
    await expect(page.getByText("Achievement unlocked: Perfekt!", { exact: true })).toBeVisible();

    const progress = (await readProgress(page))!;
    expect(progress.unlocked["quiz-debut"]).toBeDefined();
    expect(progress.unlocked["perfect-quiz"]).toBeDefined();
    expect(progress.counters.quizCompleted).toBe(1);
  });

  test("a perfect speak quiz unlocks Say Hallo and Zungengabe, and 8 first-try hits", async ({
    page,
  }) => {
    const t = installTaptalk(page);
    await page.goto("/webapp/speak-quiz.html");
    await page
      .getByRole("navigation", { name: "Categories" })
      .getByRole("button", { name: "Privacy" })
      .tap();
    await page.getByRole("button", { name: "Start" }).tap();

    for (let round = 1; round <= 8; round++) {
      await expect(page.getByText(`round ${round} / 8`)).toBeVisible();
      const phrase = await waitPhrase(t);
      await page.getByRole("button", { name: "Tap to say the phrase" }).tap();
      await expect(page.getByRole("button", { name: "Listening…" })).toBeVisible();
      await t.deliverResult(phrase);
      await expect(page.getByText("Richtig! 🎉")).toBeVisible();
    }

    await expect(page.getByText("8 / 8 on the first try")).toBeVisible();
    await expect(page.getByText("Achievement unlocked: Say Hallo", { exact: true })).toBeVisible();
    await expect(page.getByText("Achievement unlocked: Zungengabe", { exact: true })).toBeVisible();
    // First Try Club needs 25 first-try hits, so 8 must not unlock it.
    await expect(page.getByText("Achievement unlocked: First Try Club", { exact: true })).toHaveCount(
      0,
    );

    const progress = (await readProgress(page))!;
    expect(progress.unlocked["speak-hello"]).toBeDefined();
    expect(progress.unlocked["perfect-speak"]).toBeDefined();
    expect(progress.counters.speakFirstTry).toBe(8);
  });
});
