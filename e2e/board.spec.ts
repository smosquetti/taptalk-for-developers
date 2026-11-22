import { test, expect, installTaptalk, type Page } from "./fixtures";
import { loadVocabulary } from "./vocab";

const vocabulary = loadVocabulary();
const cardByPair = new Map(vocabulary.map((w) => [`${w.german} — ${w.english}`, w]));

const cardButtons = (page: Page) => page.getByRole("button", { name: / — / });

test.describe("board", () => {
  test("boots with 20 cards and the board nav pill active", async ({ page }) => {
    // The APK injects a speechSynthesis shim before every page load, so
    // install the fake before the first navigation in every test.
    installTaptalk(page);
    await page.goto("/webapp/");

    const cards = cardButtons(page);
    await expect(cards).toHaveCount(20);

    // Every card button is named "<german> — <english>" from the vocabulary.
    for (const label of await cards.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))) {
      expect(cardByPair.has(label ?? "")).toBeTruthy();
    }

    // The board is the active page in the main nav.
    const mainNav = page.getByRole("navigation", { name: "Main" });
    await expect(mainNav.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");

    // Sound is on by default.
    await expect(page.getByRole("button", { name: "Turn sound off" })).toBeVisible();
  });

  test("tapping a card opens the detail overlay and speaks the word", async ({ page }) => {
    const t = installTaptalk(page, { ttsMs: 800 });
    await page.goto("/webapp/");

    const label = await cardButtons(page).first().getAttribute("aria-label");
    const word = cardByPair.get(label ?? "");
    expect(word).toBeDefined();

    await cardButtons(page).first().tap();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", word!.german);
    await expect(t.lastUtterance()).resolves.toBe(word!.german);

    // The card tap spoke before the overlay mounted, so the Word button
    // starts highlighted, then the highlight follows the 800ms fake TTS.
    const wordBtn = page.getByRole("button", { name: "Word" });
    const exampleBtn = page.getByRole("button", { name: "Example" });
    await expect(wordBtn).toHaveAttribute("aria-pressed", "true");
    await expect(wordBtn).toHaveAttribute("aria-pressed", "false");

    // Re-speak: highlight on, utterance recorded, highlight off when done.
    await wordBtn.tap();
    await expect(wordBtn).toHaveAttribute("aria-pressed", "true");
    await expect(t.lastUtterance()).resolves.toBe(word!.german);
    await expect(wordBtn).toHaveAttribute("aria-pressed", "false");

    // Example speaks the German example sentence.
    await exampleBtn.tap();
    await expect(exampleBtn).toHaveAttribute("aria-pressed", "true");
    await expect(t.lastUtterance()).resolves.toBe(word!.exampleDe);
    await expect(exampleBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("the detail overlay closes via button, Escape, or backdrop", async ({ page }) => {
    installTaptalk(page);
    await page.goto("/webapp/");

    const close = page.getByRole("button", { name: "Close" });

    // Close button.
    await cardButtons(page).first().tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await close.tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Escape key.
    await cardButtons(page).nth(1).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Backdrop: the dialog's outer 16px padding ring is not part of the
    // inner panel, so a tap at (8, 8) lands on the backdrop itself.
    await cardButtons(page).nth(2).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("hiding a card removes it from the board, persists, and can be restored", async ({ page }) => {
    installTaptalk(page);
    await page.goto("/webapp/");

    const label = await cardButtons(page).first().getAttribute("aria-label");
    const word = cardByPair.get(label ?? "");
    expect(word).toBeDefined();

    await cardButtons(page).first().tap();
    await page
      .getByRole("button", { name: `Hide ${word!.german} from the board never` })
      .tap();

    // Dialog is gone, the board is still full, and the hidden card left it.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const cards = cardButtons(page);
    await expect(cards).toHaveCount(20);
    for (const label of await cards.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))) {
      expect(label).not.toBe(`${word!.german} — ${word!.english}`);
    }

    // The hidden row appears with one entry.
    const hiddenToggle = page.getByRole("button", { name: "hidden · 1" });
    await expect(hiddenToggle).toBeVisible();
    await expect(hiddenToggle).toHaveAttribute("aria-expanded", "false");

    // It survived a reload (WebView keeps localStorage).
    await page.reload();
    await expect(page.getByRole("button", { name: "hidden · 1" })).toBeVisible();

    // Open the row and restore the card.
    await page.getByRole("button", { name: "hidden · 1" }).tap();
    await expect(page.getByRole("button", { name: "hidden · 1" })).toHaveAttribute("aria-expanded", "true");
    await page
      .getByRole("button", { name: `Show ${word!.german} on the board again` })
      .tap();

    // No hidden cards left: the row disappears and state is empty.
    await expect(page.getByRole("button", { name: "hidden · 1" })).toHaveCount(0);
    await expect(
      page.evaluate(() => window.localStorage.getItem("taptalk-card-state")),
    ).resolves.toEqual("{}");
  });

  test("turning sound off stops all speech and persists across reloads", async ({ page }) => {
    const t = installTaptalk(page, { ttsMs: 800 });
    await page.goto("/webapp/");

    // Tapping a card speaks while sound is on.
    await cardButtons(page).first().tap();
    await expect(t.utterances()).resolves.toHaveLength(1);
    await page.getByRole("button", { name: "Close" }).tap();

    // Turn sound off.
    await page.getByRole("button", { name: "Turn sound off" }).tap();
    await expect(page.getByRole("button", { name: "Turn sound on" })).toBeVisible();
    await expect(page.evaluate(() => window.localStorage.getItem("taptalk-sound"))).resolves.toBe(
      "off",
    );

    // No speech while sound is off.
    await t.clearUtterances();
    await cardButtons(page).first().tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(await t.utterances()).toHaveLength(0);
    await page.getByRole("button", { name: "Close" }).tap();

    // Persists across a reload (WebView keeps localStorage).
    await page.reload();
    await expect(page.getByRole("button", { name: "Turn sound on" })).toBeVisible();
    await t.clearUtterances();
    await cardButtons(page).first().tap();
    await expect(await t.utterances()).toHaveLength(0);
    await page.getByRole("button", { name: "Close" }).tap();

    // Back on: speech works again.
    await page.getByRole("button", { name: "Turn sound on" }).tap();
    await t.clearUtterances();
    await cardButtons(page).first().tap();
    await expect(await t.utterances()).toHaveLength(1);
  });

  test("shows the vocabulary error box when the JSON fetch fails", async ({ page }) => {
    installTaptalk(page);
    await page.route("**/vocabulary.json", (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto("/webapp/");

    await expect(page.getByText("[error] Could not load vocabulary.json (HTTP 500)")).toBeVisible();
    await expect(page.getByText("loading vocabulary…")).toHaveCount(0);
  });
});
