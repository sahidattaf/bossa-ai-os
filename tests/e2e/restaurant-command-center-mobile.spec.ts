import { expect, test, type Page } from "@playwright/test";

const DEMO_BANNER = "DEMO DATA — NOT LIVE";
const PILOT_ROOT = "/caribbean-ember";

async function expectNoGlobalHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function expectDemoBanner(page: Page) {
  await expect(page.getByText(DEMO_BANNER, { exact: false }).first()).toBeVisible();
}

test.describe("Caribbean Ember mobile pilot QA", () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(!isMobile, "Caribbean Ember mobile QA runs only in the mobile-chromium project");
  });

  test("dashboard shell labels demo data and mobile navigation opens, navigates, and closes", async ({
    page,
  }) => {
    await page.goto(`${PILOT_ROOT}/dashboard`);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expectDemoBanner(page);
    await expectNoGlobalHorizontalOverflow(page);

    await expect(page.locator("aside")).not.toBeVisible();

    const openMenuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(openMenuButton).toBeVisible();

    await openMenuButton.click();

    const navigationSheet = page.getByRole("dialog");
    await expect(navigationSheet).toBeVisible();
    await expect(
      navigationSheet.getByRole("heading", { name: "Caribbean Ember Grill — Demo Restaurant" }),
    ).toBeVisible();

    const crmLink = navigationSheet.getByRole("link", { name: "CRM" });
    await expect(crmLink).toBeVisible();
    await crmLink.click();

    await expect(page).toHaveURL(`${PILOT_ROOT}/crm`);
    await expect(navigationSheet).not.toBeVisible();
    await expectDemoBanner(page);
    await expectNoGlobalHorizontalOverflow(page);
  });

  test("CRM and reservations contain their wide tables without page-level overflow", async ({
    page,
  }) => {
    for (const route of ["crm", "reservations"] as const) {
      await page.goto(`${PILOT_ROOT}/${route}`);
      await expectDemoBanner(page);

      const title = route === "crm" ? "CRM" : "Reservations";
      await expect(page.getByRole("heading", { name: title })).toBeVisible();

      await expect(
        page.getByText("Demo mode — read-only", { exact: false }).first(),
      ).toBeVisible();

      const table = page.locator("table").first();
      await expect(table).toBeVisible();

      const scrollContainer = table.locator("xpath=..");
      await expect(scrollContainer).toHaveClass(/overflow-x-auto/);

      const sizes = await scrollContainer.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));

      expect(sizes.clientWidth).toBeGreaterThan(0);
      expect(sizes.scrollWidth).toBeGreaterThanOrEqual(sizes.clientWidth);
      await expectNoGlobalHorizontalOverflow(page);
    }
  });

  test("dashboard, AI Executive, Reviews, and Tasks fit the mobile viewport and preserve demo labeling", async ({
    page,
  }) => {
    const routes = [
      { path: "dashboard", heading: "Dashboard" },
      { path: "ai-executive", heading: "AI Executive" },
      { path: "reviews", heading: "Reviews" },
      { path: "tasks", heading: "Tasks & SOPs" },
    ] as const;

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    for (const route of routes) {
      await page.goto(`${PILOT_ROOT}/${route.path}`);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await expectDemoBanner(page);
      await expectNoGlobalHorizontalOverflow(page);

      const visibleButtons = page.getByRole("button").filter({ visible: true });
      const count = await visibleButtons.count();
      for (let index = 0; index < count; index += 1) {
        const box = await visibleButtons.nth(index).boundingBox();
        if (!box) continue;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        const viewportWidth = await page.evaluate(() => window.innerWidth);
        expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
      }
    }

    expect(pageErrors).toEqual([]);
  });

  test("planned Reviews and Tasks modules render intentional placeholders rather than broken pages", async ({
    page,
  }) => {
    await page.goto(`${PILOT_ROOT}/reviews`);
    await expect(page.getByText("Reviews coming in Phase 3", { exact: false })).toBeVisible();
    await expectDemoBanner(page);

    await page.goto(`${PILOT_ROOT}/tasks`);
    await expect(page.getByText("Tasks & SOPs coming in Phase 3", { exact: false })).toBeVisible();
    await expectDemoBanner(page);
  });
});
