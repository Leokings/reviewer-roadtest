import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { validateConfig } from "../lib/checks.mjs";

const base = process.argv[2] ?? process.env.ROADTEST_BASE_URL ?? "http://localhost:4173";
const report = JSON.parse(await readFile(new URL("../public/reports/roadtest.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ headless: true });
try {
  await mkdir("test-results", { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("heading", { name: "This site, first hand.", exact: true }).waitFor();
  assert.match(await page.locator("#agents").innerText(), /wallet signs that on-chain write/);
  await page.locator("#report-content").waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await page.locator("#report-project").innerText(), "Reviewer Roadtest");
  assert.equal(await page.locator("#report-overall").innerText(), report.overall);
  assert.equal(await page.locator("#screenshot-link").isVisible(), Boolean(report.screenshot));
  assert.equal(await page.locator(".check").count(), report.checks.length);
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  assert.equal(await page.locator(".check").count(), report.checks.filter((check) => check.kind === "browser-runner").length);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("link", { name: "See a sample roadtest", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#report");

  await page.getByLabel("Project name").fill("Sample Review");
  await page.getByLabel("Public site URL").fill("https://example.org/");
  await page.getByLabel("Homepage headline").fill("Welcome to Sample Review");
  await page.getByLabel("Public example link").fill("See an example");
  await page.getByLabel("Example page heading").fill("Example result");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download my plan JSON/ }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "sample-review.json");
  const generated = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(validateConfig(generated), generated);
  assert.equal(generated.site, "https://example.org/");
  assert.equal(generated.browser_checks[1].after.name, "Example result");
  await page.getByLabel("Public site URL").fill("http://localhost/");
  await page.getByRole("button", { name: /Download my plan JSON/ }).click();
  assert.match(await page.locator("#plan-status").innerText(), /public HTTPS/);
  await page.screenshot({ path: "test-results/roadtest-desktop.png", fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);

  const missingScreenshot = await browser.newPage();
  await missingScreenshot.route("**/reports/roadtest.json", (route) => route.fulfill({ json: { ...report, screenshot: null } }));
  await missingScreenshot.goto(base, { waitUntil: "networkidle", timeout: 45000 });
  await missingScreenshot.locator("#report-content").waitFor({ state: "visible" });
  assert.equal(await missingScreenshot.locator("#screenshot-link").isVisible(), false);
  await missingScreenshot.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(base, { waitUntil: "networkidle", timeout: 45000 });
  await mobile.locator("#report-content").waitFor({ state: "visible" });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, "Mobile page must not overflow horizontally; overflow=" + overflow);
  await mobile.screenshot({ path: "test-results/roadtest-mobile.png", fullPage: true, animations: "disabled" });
  console.log("Roadtest site passed report, plan download, filtering, and mobile checks.");
} finally { await browser.close(); }
