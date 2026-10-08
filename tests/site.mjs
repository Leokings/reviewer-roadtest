import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.ROADTEST_BASE_URL ?? "http://localhost:4173";
const report = JSON.parse(await readFile(new URL("../public/reports/deliveryos.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ headless: true });
try {
  await mkdir("test-results", { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("heading", { name: "DeliveryOS", exact: true }).waitFor();
  assert.equal(await page.locator("#report-overall").innerText(), report.overall);
  assert.match(await page.locator("#claim-count").innerText(), /4 SCOPED CLAIMS/);
  assert.equal(await page.locator(".check").count(), report.checks.length);
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  assert.equal(await page.locator(".check").count(), report.checks.filter((check) => check.kind === "browser-runner").length);
  await page.getByRole("button", { name: "All", exact: true }).click();
  assert.equal(await page.locator(".check").count(), report.checks.length);
  await page.getByRole("button", { name: /Refresh live reads/ }).click();
  await page.locator("#recheck-result").getByText(/live reads match|inconclusive/i).waitFor({ timeout: 60000 });
  await page.screenshot({ path: "test-results/roadtest-desktop.png", fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(base, { waitUntil: "networkidle", timeout: 45000 });
  await mobile.getByRole("heading", { name: "DeliveryOS", exact: true }).waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, "Mobile page must not overflow horizontally; overflow=" + overflow);
  await mobile.screenshot({ path: "test-results/roadtest-mobile.png", fullPage: true, animations: "disabled" });
  console.log("Roadtest site passed desktop interactions, live recheck, and mobile layout.");
} finally {
  await browser.close();
}
