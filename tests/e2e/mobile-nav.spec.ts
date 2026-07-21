import { expect, test } from "@playwright/test";

test.describe("mobile sidebar behavior", () => {
  test("opens via the hamburger menu, navigates, and closes itself", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "mobile navigation sheet only applies below the lg breakpoint");

    await page.goto("/bossa/dashboard");

    const openMenuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(openMenuButton).toBeVisible();
    await expect(page.getByRole("link", { name: "Orders" })).not.toBeVisible();

    await openMenuButton.click();
    const ordersLink = page.getByRole("link", { name: "Orders" });
    await expect(ordersLink).toBeVisible();

    await ordersLink.click();

    await expect(page).toHaveURL("/bossa/orders");
    await expect(page.getByRole("link", { name: "Orders" })).not.toBeVisible();
  });
});
