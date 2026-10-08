import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { REPORT_PROTOCOL, runHttpChecks, summarizeClaims, overallStatus, validateConfig, sha256 } from "./checks.mjs";

const config = validateConfig(JSON.parse(await readFile("/vercel/plan.json", "utf8")));
const origin = new URL(config.site).origin;
const started = new Date().toISOString();
const browserChecks = [];
const pageErrors = [];
let screenshotHash = null;
let browser;

function record(spec, result, observation, evidenceUrl = config.site) {
  browserChecks.push({ id: spec.id, title: spec.title, kind: "browser-runner", result, observation, evidence_url: evidenceUrl });
}

try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, serviceWorkers: "block", acceptDownloads: false });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    try { return new URL(route.request().url()).origin === origin ? route.continue() : route.abort(); }
    catch { return route.abort(); }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 180)));
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(config.site, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (new URL(page.url()).origin !== origin) throw new Error("Target redirected off origin");
  for (const spec of config.browser_checks.filter((item) => item.type !== "no-page-errors")) {
    try {
      const locator = page.getByRole(spec.role, { name: spec.name, exact: true });
      await locator.waitFor({ state: "visible", timeout: 8000 });
      if (spec.type === "click") {
        await locator.click({ timeout: 8000 });
        if (new URL(page.url()).origin !== origin) throw new Error("Click left the target origin");
        await page.getByRole(spec.after.role, { name: spec.after.name, exact: true }).waitFor({ state: "visible", timeout: 8000 });
        record(spec, "PASS", `Clicked ${spec.role} ${JSON.stringify(spec.name)} and found ${spec.after.role} ${JSON.stringify(spec.after.name)}.`, page.url());
      } else record(spec, "PASS", `Visible ${spec.role} ${JSON.stringify(spec.name)} in a clean browser.`, page.url());
    } catch (error) { record(spec, "FAIL", `Expected first-visit step did not complete: ${error.message.slice(0, 180)}`, page.url()); }
  }
  for (const spec of config.browser_checks.filter((item) => item.type === "no-page-errors")) {
    record(spec, pageErrors.length ? "FAIL" : "PASS", pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "No uncaught page errors in the tested path.", page.url());
  }
  const image = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false, animations: "disabled", timeout: 10000 });
  if (image.length < 750000) {
    screenshotHash = sha256(image);
    await writeFile("/vercel/evidence.jpg", image);
  }
  await context.close();
} catch (error) {
  for (const spec of config.browser_checks.filter((item) => !browserChecks.some((check) => check.id === item.id))) {
    record(spec, "INCONCLUSIVE", `Browser run did not complete: ${error.message.slice(0, 180)}`);
  }
} finally { await browser?.close(); }

const httpChecks = await runHttpChecks(config);
const checks = [...httpChecks, ...browserChecks];
const claims = summarizeClaims(config, checks);
const report = {
  protocol: REPORT_PROTOCOL,
  report_id: `${config.id}-${started.replace(/[-:.]/g, "").replace("T", "t").replace("Z", "z")}`,
  created_at: started, completed_at: new Date().toISOString(),
  project: { id: config.id, name: config.name, site: config.site, ...(config.source ? { source: config.source } : {}) },
  scope: config.scope,
  plan: config,
  evidence_model: {
    http: "A sandbox fetched public same-origin responses and recorded byte hashes. Target-operated content is not independent proof.",
    browser: "Clicks and screenshot are isolated-runner observations, not trustless proof of human use.",
    onchain: "A later chain assessment may verify the report's public bytes and evidence coverage, but cannot independently replay browser clicks."
  },
  checks, claims, overall: overallStatus(claims), screenshot: null,
  screenshot_sha256: screenshotHash, not_tested: config.not_tested
};
await writeFile("/vercel/result.json", JSON.stringify(report), "utf8");
