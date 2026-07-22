import { expect, test } from "@playwright/test";

/**
 * These run against `next start` in mock mode (no Supabase env configured —
 * see playwright.config.ts's webServer), so they exercise the read-only
 * demo path (issue #16 rule 6), not the live Supabase CRUD flows. Live
 * flows are covered by tests/integration/operations.test.ts against a real
 * local Supabase instance in CI's `database` job.
 */

test.describe("CRM module (mock mode)", () => {
  test("shows a read-only demo notice and BOSSA's fictional leads", async ({ page }) => {
    await page.goto("/bossa/crm");
    await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
    await expect(page.getByText("Demo Guest — Maria F.")).toBeVisible();
  });

  test("keeps BOSSA and Papai leads isolated", async ({ page }) => {
    await page.goto("/papai/crm");
    await expect(page.getByText("Demo Guest — Ronnie S.")).toBeVisible();
    await expect(page.getByText("Demo Guest — Maria F.")).toHaveCount(0);
  });

  test("never shows lead-conversion actions in the read-only mock demo", async ({ page }) => {
    await page.goto("/bossa/crm");
    await expect(page.getByRole("button", { name: "Convert to reservation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Convert to order" })).toHaveCount(0);
  });
});

test.describe("Reservations module (mock mode)", () => {
  test("shows a read-only demo notice and BOSSA's fictional reservations", async ({ page }) => {
    await page.goto("/bossa/reservations");
    await expect(page.getByRole("heading", { name: "Reservations" })).toBeVisible();
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
    await expect(page.getByText("Demo Guest — Sofia W.")).toBeVisible();
  });
});

test.describe("Orders module (mock mode)", () => {
  test("shows a read-only demo notice and BOSSA's fictional orders", async ({ page }) => {
    await page.goto("/bossa/orders");
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
    await expect(page.getByText("BOSSA-DEMO-1001")).toBeVisible();
  });

  test("order numbers are plain text, not links, in mock mode", async ({ page }) => {
    await page.goto("/bossa/orders");
    await expect(page.getByRole("link", { name: "BOSSA-DEMO-1001" })).toHaveCount(0);
  });
});
