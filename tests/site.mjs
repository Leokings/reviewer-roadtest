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
  assert.match(await page.locator("#agents").innerText(), /signed by its requester/);
  await page.locator("#report-content").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#consensus-card").waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await page.locator("#consensus-verdict").innerText(), "CLEAR");
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
  assert.deepEqual(validateConfig(generated), generated);
  assert.equal(generated.site, "https://example.org/");
  assert.equal(generated.browser_checks[1].after.name, "Example result");
  await page.getByLabel("Public site URL").fill("http://localhost/");
  await page.getByRole("button", { name: /Download my plan JSON/ }).click();
  assert.match(await page.locator("#plan-status").innerText(), /public HTTPS/);
  await page.getByLabel("Public site URL").fill("https://example.org/");
  await page.getByLabel("Project name").fill("A".repeat(47) + " more words");
  const longNameDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download my plan JSON/ }).click();
  assert.equal(validateConfig(JSON.parse(await readFile(await (await longNameDownload).path(), "utf8"))).id.length, 47);
  await page.getByLabel("Project name").fill("Sample Review");
  await page.getByLabel("Public site URL").fill("https://example.org/");
  await page.getByLabel("I understand the run, report, and screenshot will be public.").check();
  await page.route("**/api/run", (route) => route.fulfill({ json: {
    report_url: "https://s2k2fceowpooyxy0.public.blob.vercel-storage.com/reports/test.json",
    report_sha256: "a".repeat(64),
    report: { ...report, project: { ...report.project, name: "Sample Review" } }
  } }));
  await page.getByRole("button", { name: /Run online/ }).click();
  await page.locator("#online-result").waitFor({ state: "visible" });
  assert.match(await page.locator("#online-result-title").innerText(), /Sample Review/);
  await page.getByRole("button", { name: /Request on-chain review/ }).click();
  await page.locator("#review-online-status").getByText(/EIP-1193 wallet/).waitFor();
  await page.route("**/api/receipt", (route) => route.fulfill({ json: {
    result: "PASS", lifecycle: "FINALIZED", execution_status: "0x1",
    actual_contract: "0x3AC40f631e8fAFcF6A7D2cc3179ed7320ff7744A",
    explorer_url: "https://explorer-studio.genlayer.com/tx/" + "b".repeat(64)
  } }));
  await page.getByLabel("Transaction hash").fill("0x" + "b".repeat(64));
  await page.getByLabel("Expected contract").fill("0x3AC40f631e8fAFcF6A7D2cc3179ed7320ff7744A");
  await page.getByRole("button", { name: /Verify receipt/ }).click();
  await page.locator("#receipt-result").getByText(/PASS · FINALIZED/).waitFor();
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
