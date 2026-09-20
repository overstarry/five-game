import { test, expect } from "@playwright/test";
import { t } from "../../src/locale";

test("missing key is explicit and board cannot start", async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: t.start, exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(t.setup)).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("grid")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("human and AI alternate; undo, retry and restore preserve the game", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  let fail = false;
  let calls = 0;
  await page.route("**/api/move", async (route) => {
    calls++;
    await route.fulfill(
      fail
        ? { status: 502, json: { error: "AI_UNAVAILABLE" } }
        : { json: { move: { row: 7, col: 8 }, model: "test" } },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: t.start, exact: true }).click();
  await page.getByRole("button", { name: "H8", exact: true }).click();
  await expect(page.locator(".stone")).toHaveCount(2);
  await page.getByRole("button", { name: t.undo, exact: true }).click();
  await expect(page.locator(".stone")).toHaveCount(0);
  fail = true;
  await page.getByRole("button", { name: "H8", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".stone")).toHaveCount(1);
  fail = false;
  await page.getByRole("button", { name: t.retry, exact: true }).click();
  await expect(page.locator(".stone")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".stone")).toHaveCount(2);
  expect(calls).toBe(3);
  await page.screenshot({ path: "test-results/playing.png", fullPage: true });
});

test("AI can open as black and stale responses cannot overwrite restart", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/move", async (route) => {
    requested = true;
    await pending;
    await route.fulfill({ json: { move: { row: 7, col: 7 } } }).catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(t.white) }).click();
  await page.getByRole("button", { name: t.start, exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByRole("grid")).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: t.newGame, exact: true }).click();
  await page
    .getByRole("alert")
    .getByRole("button", { name: t.newGame, exact: true })
    .click();
  release();
  await expect(
    page.getByRole("button", { name: t.start, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stone")).toHaveCount(0);
});
