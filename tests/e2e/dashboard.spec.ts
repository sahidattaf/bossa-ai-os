import { expect, test } from "@playwright/test";

test.describe("BOSSA dashboard route", () => {
  test("loads with BOSSA-specific content", async ({ page }) => {
    await page.goto("/bossa/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Good evening, BOSSA team")).toBeVisible();
    await expect(page.getByText("Fire Boxes Sold")).toBeVisible();
    await expect(page.getByText("PapaiLegacyGPT")).toHaveCount(0);
  });
});

test.describe("Papai dashboard route", () => {
  test("loads with Papai-specific content", async ({ page }) => {
    await page.goto("/papai/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Good evening, Papai team")).toBeVisible();
    await expect(page.getByText("Heritage Platters Served")).toBeVisible();
    await expect(page.getByText("BossVisionGPT")).toHaveCount(0);
  });
});

test.describe("unknown tenant", () => {
  test("shows the tenant not-found state instead of a generic 404", async ({ page }) => {
    const response = await page.goto("/nonexistent-org/dashboard");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("We couldn't find that organization")).toBeVisible();
    await expect(page.getByRole("link", { name: "BOSSA Asado i Mar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Papai Since 1933" })).toBeVisible();
  });
});

test.describe("module routes", () => {
  test("renders the live Orders module as a read-only demo in mock mode", async ({ page }) => {
    await page.goto("/bossa/orders");
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
  });
});
