import { test, expect, installTaptalk, type Page } from "./fixtures";

const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

// The APK's WebView is locked to the asset host: no internet permission,
// and shouldOverrideUrlLoading blocks any navigation off
// appassets.taptalk.local. These tests mirror that guarantee against the
// test server, which serves the same APK asset layout under /webapp/.
test.describe("android webview", () => {
  test("every page boots from a direct full-document load", async ({ page }) => {
    installTaptalk(page);

    await page.goto("/webapp/");
    await expect(page.getByRole("button", { name: / — / })).toHaveCount(20);
    await expect(mainNav(page).getByRole("link", { name: "Board", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.goto("/webapp/quiz.html");
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await expect(mainNav(page).getByRole("link", { name: "Quiz", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.goto("/webapp/speak-quiz.html");
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await expect(
      mainNav(page).getByRole("link", { name: "Speak", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("nav links load the target page as a full document", async ({ page }) => {
    installTaptalk(page);
    await page.goto("/webapp/");
    await expect(page.getByRole("button", { name: / — / })).toHaveCount(20);

    // The static export serves text/html for page URLs, so the router's RSC
    // fetch falls back to a hard browser navigation — exactly what happens
    // inside the WebView too. Assert on the outcome: the final URL and the
    // active pill.
    await mainNav(page).getByRole("link", { name: "Quiz", exact: true }).tap();
    await page.waitForURL(/\/webapp\/quiz\.html/);
    await expect(mainNav(page).getByRole("link", { name: "Quiz", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await mainNav(page).getByRole("link", { name: "Speak", exact: true }).tap();
    await page.waitForURL(/\/webapp\/speak-quiz\.html/);
    await expect(
      mainNav(page).getByRole("link", { name: "Speak", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    // The logo link is a plain relative href — also a full document load.
    // The "Board" nav pill carries the same href too, so scope to the logo
    // (the first such anchor in DOM order, inside the banner).
    await page.locator('a[href="index.html"]').first().tap();
    await page.waitForURL("http://127.0.0.1:8473/webapp/index.html");
    await expect(mainNav(page).getByRole("link", { name: "Board", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: / — / })).toHaveCount(20);
  });

  test("no request ever leaves the asset origin", async ({ page }) => {
    installTaptalk(page);
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));

    await page.goto("/webapp/");
    await expect(page.getByRole("button", { name: / — / })).toHaveCount(20);

    // Cross the pages the way the app navigates them; the request listener
    // on the page object persists across the full-document loads.
    await mainNav(page).getByRole("link", { name: "Quiz", exact: true }).tap();
    await page.waitForURL(/\/webapp\/quiz\.html/);
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await mainNav(page).getByRole("link", { name: "Speak", exact: true }).tap();
    await page.waitForURL(/\/webapp\/speak-quiz\.html/);
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();

    for (const url of requests) {
      expect(url.startsWith("http://127.0.0.1:8473/")).toBeTruthy();
    }
  });

  test("no horizontal overflow on a phone-width viewport", async ({ page }) => {
    installTaptalk(page);

    await page.goto("/webapp/");
    await expect(page.getByRole("button", { name: / — / })).toHaveCount(20);
    await assertNoHorizontalOverflow(page);

    await page.goto("/webapp/quiz.html");
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await assertNoHorizontalOverflow(page);

    await page.goto("/webapp/speak-quiz.html");
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await assertNoHorizontalOverflow(page);
  });
});

async function assertNoHorizontalOverflow(page: Page) {
  // The category bar scrolls internally; the document itself must not
  // overflow a 393px viewport.
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    )
    .toBeTruthy();
}
