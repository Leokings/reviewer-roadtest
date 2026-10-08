const REPORT_URL = "/reports/roadtest.json";
const $ = (selector) => document.querySelector(selector);
let publishedReport;
let activeFilter = "all";

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

$("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const output = $("#plan-status");
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const url = new URL(values.site);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.port ||
        !/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.includes("..") ||
        host.endsWith(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".localhost") ||
        /^\d+(?:\.\d+){3}$/.test(host)) throw new Error("Use a public HTTPS homepage URL.");
    let id = values.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");
    if (id.length < 2) id = "my-project";
    const config = {
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

try {
  renderReport(await readJson(REPORT_URL));
  try { renderAssessment(await readJson("/assessments/roadtest.json")); } catch { /* The separate assessment is optional. */ }
} catch (error) {
  text($("#loading"), "The published example is not available yet: " + error.message);
}
