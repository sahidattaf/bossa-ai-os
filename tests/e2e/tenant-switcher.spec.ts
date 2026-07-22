import { expect, test } from "@playwright/test";

test.describe("tenant switcher navigation", () => {
  test("switches from BOSSA to Papai while preserving the current route", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop sidebar switcher; mobile switcher is covered separately");

    await page.goto("/bossa/orders");
    await page.getByRole("button", { name: "Switch organization" }).click();
    await page.getByRole("menuitem", { name: /Papai Since 1933/ }).click();

    await expect(page).toHaveURL("/papai/orders");
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
  });

  test("switches from Papai back to BOSSA on the dashboard route", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop sidebar switcher; mobile switcher is covered separately");

    await page.goto("/papai/dashboard");
    await page.getByRole("button", { name: "Switch organization" }).click();
    await page.getByRole("menuitem", { name: /BOSSA Asado i Mar/ }).click();

    await expect(page).toHaveURL("/bossa/dashboard");
    await expect(page.getByText("Good evening, BOSSA team")).toBeVisible();
  });
});
