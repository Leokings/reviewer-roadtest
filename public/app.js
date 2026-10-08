const REPORT_URL = "/reports/roadtest.json";
const $ = (selector) => document.querySelector(selector);
let publishedReport;
let activeFilter = "all";
let latestPublishedRun;

function text(el, value) {
  el.textContent = String(value ?? "");
  return el;
}

function short(value, lead = 10, tail = 6) {
  const string = String(value ?? "");
  return string.length > lead + tail + 3 ? string.slice(0, lead) + "…" + string.slice(-tail) : string;
}

function safeEvidenceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function renderClaims(report) {
  const list = $("#claim-list");
  list.replaceChildren();
  text($("#claim-count"), report.claims.length + " SCOPED CLAIMS");
  for (const claim of report.claims) {
    const item = document.createElement("div");
    item.className = "claim";
    item.dataset.status = claim.status;
    item.append(text(Object.assign(document.createElement("span"), { className: "claim-icon" }), claim.status === "PASS" ? "✓" : claim.status === "FAIL" ? "×" : "?"));
    const copy = document.createElement("div");
    copy.className = "claim-copy";
    copy.append(text(document.createElement("strong"), claim.text));
    copy.append(text(document.createElement("small"), "Backed by: " + claim.check_ids.join(" + ")));
    item.append(copy, text(Object.assign(document.createElement("span"), { className: "claim-status" }), claim.status));
    list.append(item);
  }
}

function renderChecks(report) {
  const list = $("#check-list");
  list.replaceChildren();
  for (const check of report.checks.filter((item) => activeFilter === "all" || item.kind === activeFilter)) {
    const row = document.createElement("article");
    row.className = "check";
    row.dataset.status = check.result;
    row.append(text(Object.assign(document.createElement("span"), { className: "check-mark" }), check.result === "PASS" ? "✓" : check.result === "FAIL" ? "×" : "?"));
    const copy = document.createElement("div");
    copy.className = "check-copy";
    copy.append(text(document.createElement("strong"), check.title + " · " + check.result));
    copy.append(text(document.createElement("small"), check.observation));
    row.append(copy);
    const evidence = safeEvidenceUrl(check.evidence_url);
    if (evidence) {
      const link = text(document.createElement("a"), "Open evidence ↗");
      link.href = evidence;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.className = "check-link";
      row.append(link);
    }
    list.append(row);
  }
}

function renderReport(report) {
  if (report.protocol !== "ROADTEST_REPORT_V1" || !Array.isArray(report.checks) || !Array.isArray(report.claims) ||
      !Array.isArray(report.not_tested) || !report.project?.name || !safeEvidenceUrl(report.project.site)) {
    throw new Error("Published report has an unsupported format.");
  }
  publishedReport = report;
  text($("#report-project"), report.project.name);
  text($("#report-scope"), report.scope);
  text($("#report-time"), "Run " + new Date(report.completed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  text($("#report-target"), new URL(report.project.site).hostname);
  text($("#report-overall"), report.overall);
  $(".report-verdict").dataset.status = report.overall;
  const screenshot = $("#screenshot-link");
  screenshot.hidden = typeof report.screenshot !== "string" || !/^evidence\/[a-z0-9-]+\.png$/.test(report.screenshot);
  if (!screenshot.hidden) screenshot.href = "/" + report.screenshot;
  text($("#agent-code"), JSON.stringify({ overall: report.overall,
    claims: report.claims.slice(0, 1).map((claim) => ({ id: claim.id, status: claim.status, check_ids: claim.check_ids })),
    not_tested: ["See full report"] }, null, 2));
  renderClaims(report);
  renderChecks(report);
  $("#not-tested").replaceChildren(...report.not_tested.map((item) => text(document.createElement("li"), item)));
  $("#loading").hidden = true;
  $("#report-content").hidden = false;
}

function renderAssessment(assessment) {
  if (assessment.protocol !== "ROADTEST_ONBOARDING_V1" || !["CLEAR", "PARTIAL", "UNCLEAR"].includes(assessment.verdict) ||
      assessment.landing_url !== publishedReport?.project.site || assessment.transaction_status !== "FINALIZED" ||
      assessment.execution_result !== "SUCCESS" || !["AGREE", "MAJORITY_AGREE"].includes(assessment.consensus_result) ||
      !/^0x[0-9a-fA-F]{40}$/.test(assessment.contract_address) || !/^0x[0-9a-fA-F]{64}$/.test(assessment.transaction_hash)) {
    throw new Error("Unsupported on-chain assessment record.");
  }
  const txUrl = safeEvidenceUrl(assessment.explorer_url);
  const sourceUrl = safeEvidenceUrl(assessment.source_url);
  if (!txUrl || !sourceUrl) throw new Error("Assessment links must be HTTPS.");
  text($("#consensus-verdict"), assessment.verdict);
  text($("#consensus-scope"), assessment.scope);
  text($("#consensus-contract"), "Contract " + short(assessment.contract_address, 12, 8));
  text($("#consensus-date"), "Assessed " + new Date(assessment.assessed_epoch * 1000).toLocaleDateString(undefined, { dateStyle: "medium" }));
  $("#consensus-tx").href = txUrl;
  $("#consensus-source").href = sourceUrl;
  $("#consensus-card").dataset.status = assessment.verdict;
  $("#consensus-card").hidden = false;
}

async function readJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("active", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    });
    if (publishedReport) renderChecks(publishedReport);
  });
});

$("#copy-report").addEventListener("click", async () => {
  const button = $("#copy-report");
  try {
    await navigator.clipboard.writeText(new URL(REPORT_URL, location.origin).href);
    text(button, "Link copied ✓");
  } catch { text(button, "Copy unavailable — open the JSON link"); }
  setTimeout(() => text(button, "Copy report link"), 3000);
});

function planFromForm(form) {
  const values = Object.fromEntries(new FormData(form));
    const url = new URL(values.site);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.port ||
        !/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.includes("..") ||
        host.endsWith(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".localhost") ||
        /^\d+(?:\.\d+){3}$/.test(host)) throw new Error("Use a public HTTPS homepage URL.");
    let id = values.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");
    if (id.length < 2) id = "my-project";
    return {
      id, name: values.name.trim(), site: url.href,
      scope: "A clean browser can identify the product and open one public example. Only the named path is tested.",
      browser_checks: [
        { id: "first-heading", title: "Purpose is visible", type: "visible", role: "heading", name: values.headline.trim() },
        { id: "example-path", title: "Public example opens", type: "click", role: "link", name: values.exampleLink.trim(), after: { role: "heading", name: values.exampleHeading.trim() } },
        { id: "browser-errors", title: "No uncaught page errors", type: "no-page-errors" }
      ],
      http_checks: [],
      claims: [{ id: "first-visit", text: "A new visitor can find the product and a public example.", checks: ["first-heading", "example-path", "browser-errors"] }],
      not_tested: ["Wallet writes", "Private evidence", "Security outside these checks"]
    };
}

$("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const output = $("#plan-status");
  try {
    const config = planFromForm(event.currentTarget);
    const id = config.id;
    const blob = new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    text(output, `Downloaded ${id}.json. Run it from the repository.`);
  } catch (error) {
    text(output, error.message);
  }
});

$("#run-online").addEventListener("click", async () => {
  const form = $("#plan-form");
  const output = $("#plan-status");
  const button = $("#run-online");
  if (!form.reportValidity()) return;
  if (!$("#publish-consent").checked) { text(output, "Confirm that this public run may publish a report and screenshot."); return; }
  try {
    const config = planFromForm(form);
    button.disabled = true;
    text(output, "Running a clean browser now. This can take about a minute…");
    const response = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Run failed (HTTP ${response.status})`);
    const { report } = payload;
    text($("#online-result-title"), `${report.project.name}: ${report.overall}`);
    text($("#online-result-summary"), `${report.checks.filter((check) => check.result === "PASS").length} of ${report.checks.length} checks passed. Read the limits before relying on this result.`);
    const reportUrl = safeEvidenceUrl(payload.report_url);
    if (!reportUrl) throw new Error("Published report URL is invalid");
    if (!/^[0-9a-f]{64}$/.test(payload.report_sha256 ?? "")) throw new Error("Published report hash is invalid");
    latestPublishedRun = { reportUrl, reportHash: payload.report_sha256 };
    $("#online-report-link").href = reportUrl;
    const screenshotUrl = safeEvidenceUrl(report.screenshot);
    $("#online-screenshot-link").hidden = !screenshotUrl;
    if (screenshotUrl) $("#online-screenshot-link").href = screenshotUrl;
    text($("#online-report-hash"), `Report SHA-256: ${payload.report_sha256}`);
    $("#online-check-list").replaceChildren(...report.checks.map((check) => text(document.createElement("li"), `${check.result} · ${check.title}`)));
    $("#online-result").hidden = false;
    text(output, "Run complete. The report is public and downloadable.");
  } catch (error) { text(output, error.message); }
  finally { button.disabled = false; }
});

$("#review-online").addEventListener("click", async () => {
  const output = $("#review-online-status");
  const button = $("#review-online");
  if (!latestPublishedRun) { text(output, "Run a public Roadtest first."); return; }
  try {
    button.disabled = true;
    text(output, "Waiting for your wallet to sign on Studionet…");
    const { requestReportReview } = await import("/chain.js");
    const random = Array.from(crypto.getRandomValues(new Uint8Array(5)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const reviewId = `review_${Date.now().toString(36)}_${random}`;
    const result = await requestReportReview({
      reviewId, reportUrl: latestPublishedRun.reportUrl, reportHash: latestPublishedRun.reportHash,
      onTransaction: (hash) => {
        const link = $("#review-online-tx");
        link.href = `https://explorer-studio.genlayer.com/tx/${hash}`;
        link.hidden = false;
        text(output, "Transaction sent. Waiting for finality and stored review…");
      }
    });
    text(output, `GenLayer verdict: ${result.review.verdict}. ${result.review.http_rechecked} public responses re-checked; browser clicks remain runner-only evidence. Review ID: ${reviewId}`);
  } catch (error) { text(output, error.message ?? "On-chain review did not complete."); }
  finally { button.disabled = false; }
});

$("#receipt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const output = $("#receipt-result");
  const button = form.querySelector("button");
  try {
    button.disabled = true;
    text(output, "Checking network receipt…");
    const response = await fetch("/api/receipt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Receipt check failed (HTTP ${response.status})`);
    output.replaceChildren();
    output.dataset.status = result.result;
    output.append(text(document.createElement("strong"), result.result + " · " + result.lifecycle));
    output.append(text(document.createElement("span"), `Execution ${result.execution_status ?? "unknown"}; contract ${short(result.actual_contract ?? "none", 12, 8)}.`));
    const link = text(document.createElement("a"), "Open transaction ↗");
    link.href = result.explorer_url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    output.append(link);
  } catch (error) { text(output, error.message); output.dataset.status = "INCONCLUSIVE"; }
  finally { button.disabled = false; }
});

try {
  renderReport(await readJson(REPORT_URL));
  try { renderAssessment(await readJson("/assessments/roadtest.json")); } catch { /* The separate assessment is optional. */ }
} catch (error) {
  text($("#loading"), "The published example is not available yet: " + error.message);
}
