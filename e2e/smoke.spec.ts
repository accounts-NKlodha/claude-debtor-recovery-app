import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke + accessibility gate (PRD §9 WCAG 2.1 AA, acceptance scenario 18).
 * Routes are added by the UI slice; keep this list in sync as screens land.
 */
const routes = ["/today", "/cases", "/communications", "/intake", "/payments", "/client"];

for (const route of routes) {
  test(`${route} renders and has no serious a11y violations`, async ({ page }) => {
    const res = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(res?.status(), `${route} should not 404/500`).toBeLessThan(400);
    await expect(page.locator("main, [role=main]").first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
    expect(serious, JSON.stringify(serious.map((v) => v.id), null, 2)).toEqual([]);
  });
}

test("case detail always shows automation state (scenario 18)", async ({ page }) => {
  await page.goto("/cases");
  const firstRow = page.getByRole("link", { name: /case|CASE-|view/i }).first();
  if (await firstRow.count()) {
    await firstRow.click();
    await expect(page.getByText(/waiting on/i)).toBeVisible();
    await expect(page.getByText(/next (scheduled )?action/i)).toBeVisible();
  }
});
