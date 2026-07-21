import { chromium } from "playwright";

const targets = [
  { url: "http://localhost:3000/bossa/dashboard", out: "docs/screenshots/bossa-dashboard.png" },
  { url: "http://localhost:3000/papai/dashboard", out: "docs/screenshots/papai-dashboard.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });

for (const target of targets) {
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.screenshot({ path: target.out });
  console.log(`saved ${target.out}`);
}

await browser.close();
