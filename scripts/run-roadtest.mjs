import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { REPORT_PROTOCOL, runApiChecks, summarizeClaims, overallStatus, validateConfig } from "../lib/checks.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const configPath = resolve(process.argv[2] ?? join(projectRoot, "configs/deliveryos.json"));
const config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));

function browserCheck(id, title, result, observation, evidenceUrl = config.site) {
  return { id, title, kind: "browser-runner", result, observation, evidence_url: evidenceUrl };
}

async function runBrowserChecks() {
  const checks = [];
  let screenshotProduced = false;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 850 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(config.site, { waitUntil: "domcontentloaded", timeout: 45000 });
    const heading = page.getByRole("heading", { level: 1 });
    const hero = await heading.innerText({ timeout: 15000 });
    const firstTimeButton = page.getByRole("button", { name: /Explore a completed example · no wallet needed/i });
    const walletButton = page.getByRole("button", { name: "Connect wallet" });
    const firstTimeVisible = await firstTimeButton.isVisible() && await walletButton.isVisible();
    checks.push(browserCheck("first-visit-browser", "Fresh visitor sees a wallet-free path", firstTimeVisible ? "PASS" : "FAIL",
      `Heading: ${hero.replace(/\s+/g, " ")}; example CTA=${firstTimeVisible}; no wallet was injected.`));

    if (firstTimeVisible) {
      await firstTimeButton.click();
      const jobHeading = page.getByRole("heading", { name: config.example_job_id });
      await jobHeading.waitFor({ timeout: 45000 });
      const detail = await page.locator(".job-detail").innerText();
      const accepted = detail.includes("ACCEPTED") && detail.includes("CONSENSUS");
      const screenshotRelative = `evidence/${config.id}-first-visit.png`;
      const screenshotPath = join(projectRoot, "public", screenshotRelative);
      await mkdir(join(projectRoot, "public/evidence"), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
      screenshotProduced = true;
      checks.push(browserCheck("example-browser", "Example opens in a fresh browser", accepted ? "PASS" : "FAIL",
        `Job heading=${config.example_job_id}; accepted label=${detail.includes("ACCEPTED")}; decision source=${detail.includes("CONSENSUS")}. Screenshot is runner evidence, not cryptographic proof.`, page.url()));
    } else {
      checks.push(browserCheck("example-browser", "Example opens in a fresh browser", "INCONCLUSIVE", "Example CTA was unavailable; the path was not exercised."));
    }

    checks.push(browserCheck("browser-javascript", "No uncaught page error in tested path", pageErrors.length === 0 ? "PASS" : "FAIL",
      pageErrors.length === 0 ? "No uncaught page errors during the tested path." : pageErrors.slice(0, 3).join(" | ")));
    await context.close();
  } catch (error) {
    const missing = ["first-visit-browser", "example-browser"].filter((id) => !checks.some((check) => check.id === id));
    for (const id of missing) checks.push(browserCheck(id, id === "first-visit-browser" ? "Fresh visitor sees a wallet-free path" : "Example opens in a fresh browser", "INCONCLUSIVE", `Browser run did not complete: ${error.message}`));
    if (!checks.some((check) => check.id === "browser-javascript")) checks.push(browserCheck("browser-javascript", "No uncaught page error in tested path", "INCONCLUSIVE", "Browser run did not complete."));
  } finally {
    await browser?.close();
  }
  return { checks, screenshotProduced };
}

const started = new Date().toISOString();
const apiChecks = await runApiChecks(config);
const { checks: browserChecks, screenshotProduced } = await runBrowserChecks();
const checks = [...apiChecks, ...browserChecks];
const claims = summarizeClaims(config, checks);
const report = {
  protocol: REPORT_PROTOCOL,
  report_id: `${config.id}-${started.replace(/[-:.]/g, "").replace("T", "t").replace("Z", "z")}`,
  created_at: started,
  completed_at: new Date().toISOString(),
  project: { id: config.id, name: config.name, site: config.site, source: config.source, source_commit: config.source_commit,
    network: config.network, chain_id: config.chain_id, contract: config.contract },
  scope: "Read-only first-visit path, public v4 API, prior transactions and chain-backed state. No new wallet write or full bilateral lifecycle was performed in this run.",
  evidence_model: {
    live_api: "The runner fetched public API responses and recorded byte hashes. The API is operated by DeliveryOS; this alone is not independent chain verification.",
    transaction: "Transaction status and execution are reported by the DeliveryOS API, which reads GenLayer Studionet.",
    browser: "When present, the screenshot and clicks are CI-runner observations, not trustless on-chain proof.",
    source: "The source commit is a disclosed reference, not an assertion that production deployed those exact bytes."
  },
  checks,
  claims,
  overall: overallStatus(claims),
  screenshot: screenshotProduced ? `evidence/${config.id}-first-visit.png` : null,
  not_tested: ["A new signed wallet transaction", "Provider acceptance and submission from a fresh wallet", "GenLayer validator review on a newly created job", "Other wallets, browsers, and mobile devices", "Security properties beyond the scoped assertions"]
};
const reportPath = join(projectRoot, "public/reports", `${config.id}.json`);
await mkdir(join(projectRoot, "public/reports"), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ report: reportPath, overall: report.overall, checks: checks.map((check) => `${check.id}:${check.result}`), claims: claims.map((claim) => `${claim.id}:${claim.status}`) }, null, 2));
if (report.overall !== "PASS" || checks.some((check) => check.result !== "PASS")) process.exitCode = 1;
