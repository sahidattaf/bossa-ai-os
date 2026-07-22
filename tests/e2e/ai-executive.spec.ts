import { expect, test } from "@playwright/test";

/**
 * These run against `next start` in mock mode (no Supabase env configured —
 * see playwright.config.ts's webServer), so they exercise the read-only
 * demo path (issue #18 decision #11), not the live evaluate/approve/execute
 * flows. Live flows are covered by tests/integration/ai-executive.test.ts
 * against a real local Supabase instance in CI's `database` job.
 */

test.describe("AI Executive workspace (mock mode)", () => {
  test("shows a deterministic-mode banner, a demo notice, and BOSSA's fictional signals and recommendations", async ({ page }) => {
    await page.goto("/bossa/ai-executive");
    await expect(page.getByRole("heading", { name: "AI Executive" })).toBeVisible();
    await expect(page.getByText(/Deterministic mode/)).toBeVisible();
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
    await expect(page.getByText("1 unanswered lead")).toBeVisible();
    await expect(page.getByText("Follow up with Demo Guest — Maria F.")).toBeVisible();
    await expect(page.getByText("Revenue is trailing target today")).toBeVisible();
  });

  test("keeps BOSSA and Papai signals and recommendations isolated", async ({ page }) => {
    await page.goto("/papai/ai-executive");
    await expect(page.getByText("Follow up with Demo Guest — Ronnie S.")).toBeVisible();
    await expect(page.getByText("Follow up with Demo Guest — Maria F.")).toHaveCount(0);
    await expect(page.getByText("Revenue is trailing target today")).toHaveCount(0);
  });

  test("never links recommendation cards to a detail page in mock mode", async ({ page }) => {
    await page.goto("/bossa/ai-executive");
    await expect(page.getByRole("link", { name: /Follow up with Demo Guest — Maria F\./ })).toHaveCount(0);
  });

  test("does not show an approval-queue link in mock mode", async ({ page }) => {
    await page.goto("/bossa/ai-executive");
    await expect(page.getByRole("link", { name: "Approval queue" })).toHaveCount(0);
  });

  test("recommendation detail routes 404 in mock mode", async ({ page }) => {
    const response = await page.goto("/bossa/ai-executive/recommendations/mock-rec-bossa-1");
    expect(response?.status()).toBe(404);
  });
});

test.describe("AI Executive approval queue (mock mode)", () => {
  test("shows a read-only demo notice and BOSSA's fictional pending approval", async ({ page }) => {
    await page.goto("/bossa/ai-executive/approvals");
    await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
    await expect(page.getByText(/Demo mode — read-only/)).toBeVisible();
    await expect(page.getByText("Follow up with Demo Guest — Maria F.")).toBeVisible();
  });

  test("keeps BOSSA and Papai approvals isolated", async ({ page }) => {
    await page.goto("/papai/ai-executive/approvals");
    await expect(page.getByText("Follow up with Demo Guest — Ronnie S.")).toBeVisible();
    await expect(page.getByText("Follow up with Demo Guest — Maria F.")).toHaveCount(0);
  });

  test("never shows approve or reject controls in the read-only mock demo", async ({ page }) => {
    await page.goto("/bossa/ai-executive/approvals");
    await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test("never links pending approvals to a recommendation detail page in mock mode", async ({ page }) => {
    await page.goto("/bossa/ai-executive/approvals");
    await expect(page.getByRole("link", { name: /Follow up with Demo Guest — Maria F\./ })).toHaveCount(0);
  });
});
