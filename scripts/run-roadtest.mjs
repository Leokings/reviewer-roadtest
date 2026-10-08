import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { REPORT_PROTOCOL, runHttpChecks, summarizeClaims, overallStatus, validateConfig } from "../lib/checks.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const configPath = resolve(process.argv[2] ?? join(projectRoot, "configs/roadtest.json"));
const config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));

function browserRecord(spec, result, observation, evidenceUrl = config.site) {
  return { id: spec.id, title: spec.title, kind: "browser-runner", result, observation, evidence_url: evidenceUrl };
}

async function runBrowserChecks() {
  const checks = [];
  const pageErrors = [];
  let screenshotProduced = false;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 850 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(config.site, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (new URL(page.url()).origin !== new URL(config.site).origin) throw new Error("Target redirected to a different origin");
    for (const spec of config.browser_checks.filter((item) => item.type !== "no-page-errors")) {
      try {
        const locator = page.getByRole(spec.role, { name: spec.name, exact: true });
        await locator.waitFor({ state: "visible", timeout: 12000 });
        if (spec.type === "click") {
          await locator.click({ timeout: 12000 });
          if (new URL(page.url()).origin !== new URL(config.site).origin) {
            checks.push(browserRecord(spec, "FAIL", "The first-visit path left the target origin.", page.url()));
            continue;
          }
          await page.getByRole(spec.after.role, { name: spec.after.name, exact: true }).waitFor({ state: "visible", timeout: 12000 });
          checks.push(browserRecord(spec, "PASS", `Clicked ${spec.role} ${JSON.stringify(spec.name)} and found ${spec.after.role} ${JSON.stringify(spec.after.name)}.`, page.url()));
        } else {
          checks.push(browserRecord(spec, "PASS", `Visible ${spec.role} ${JSON.stringify(spec.name)} in a clean browser.`, page.url()));
        }
      } catch (error) {
        checks.push(browserRecord(spec, "FAIL", `Expected first-visit step did not complete: ${error.message.slice(0, 250)}`, page.url()));
      }
    }
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    for (const spec of config.browser_checks.filter((item) => item.type === "no-page-errors")) {
      checks.push(browserRecord(spec, pageErrors.length ? "FAIL" : "PASS",
        pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "No uncaught page errors in the tested path.", page.url()));
    }
    const relative = `evidence/${config.id}-first-visit.png`;
    await mkdir(join(projectRoot, "public/evidence"), { recursive: true });
    await page.screenshot({ path: join(projectRoot, "public", relative), fullPage: true, animations: "disabled" });
    screenshotProduced = true;
    await context.close();
  } catch (error) {
    for (const spec of config.browser_checks.filter((item) => !checks.some((check) => check.id === item.id))) {
      checks.push(browserRecord(spec, "INCONCLUSIVE", `Browser run did not complete: ${error.message.slice(0, 250)}`));
    }
  } finally {
    await browser?.close();
  }
  return { checks, screenshotProduced };
}

const started = new Date().toISOString();
const httpChecks = await runHttpChecks(config);
const { checks: browserChecks, screenshotProduced } = await runBrowserChecks();
const checks = [...httpChecks, ...browserChecks];
const claims = summarizeClaims(config, checks);
const report = {
  protocol: REPORT_PROTOCOL,
  report_id: `${config.id}-${started.replace(/[-:.]/g, "").replace("T", "t").replace("Z", "z")}`,
  created_at: started,
  completed_at: new Date().toISOString(),
  project: { id: config.id, name: config.name, site: config.site, ...(config.source ? { source: config.source } : {}) },
  scope: config.scope,
  evidence_model: {
    http: "The runner fetched same-origin public responses and recorded byte hashes. The target operates these endpoints; their contents are not independent proof.",
    browser: "The screenshot and clicks, when present, are CI-runner observations, not trustless proof of human use.",
    onchain: "Any displayed GenLayer assessment is separate from this deterministic CI report and covers only its named question."
  },
  checks,
  claims,
  overall: overallStatus(claims),
  screenshot: screenshotProduced ? `evidence/${config.id}-first-visit.png` : null,
  not_tested: config.not_tested
};
const reportPath = join(projectRoot, "public/reports", `${config.id}.json`);
await mkdir(join(projectRoot, "public/reports"), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ report: reportPath, overall: report.overall, checks: checks.map((check) => `${check.id}:${check.result}`), claims: claims.map((claim) => `${claim.id}:${claim.status}`) }, null, 2));
if (report.overall !== "PASS" || checks.some((check) => check.result !== "PASS")) process.exitCode = 1;
