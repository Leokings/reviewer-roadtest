const REPORT_URL = "/reports/deliveryos.json";
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
  } catch {
    return null;
  }
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
      link.rel = "noreferrer";
      link.className = "check-link";
      row.append(link);
    }
    list.append(row);
  }
}

function renderReport(report) {
  if (report.protocol !== "ROADTEST_REPORT_V1" || !Array.isArray(report.checks) || !Array.isArray(report.claims) || !Array.isArray(report.not_tested)) {
    throw new Error("Published report has an unsupported format.");
  }
  publishedReport = report;
  text($("#report-project"), report.project.name);
  text($("#report-scope"), report.scope);
  text($("#report-time"), "Run " + new Date(report.completed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  text($("#report-chain"), report.project.network + " · " + report.project.chain_id);
  text($("#report-contract"), "Contract " + short(report.project.contract));
  text($("#report-overall"), report.overall);
  $(".report-verdict").dataset.status = report.overall;
  text($("#agent-code"), JSON.stringify({ overall: report.overall, claims: report.claims.slice(0, 1).map((claim) => ({ id: claim.id, status: claim.status, check_ids: claim.check_ids })), not_tested: ["See full report"] }, null, 2));
  renderClaims(report);
  renderChecks(report);
  const gaps = $("#not-tested");
  gaps.replaceChildren(...report.not_tested.map((item) => text(document.createElement("li"), item)));
  $("#loading").hidden = true;
  $("#report-content").hidden = false;
}

async function readJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function quickRecheck() {
  if (!publishedReport) return;
  const button = $("#recheck");
  const output = $("#recheck-result");
  button.disabled = true;
  output.classList.remove("error");
  text(output, "Reading the current public endpoints…");
  try {
    const checks = publishedReport.checks;
    const healthUrl = checks.find((check) => check.id === "api-health")?.evidence_url;
    const jobUrl = checks.find((check) => check.id === "example-job")?.evidence_url;
    const txUrl = checks.find((check) => check.id === "review-transaction")?.evidence_url;
    const expectedOrigin = new URL(publishedReport.project.site).origin;
    if (![healthUrl, jobUrl, txUrl].every((url) => safeEvidenceUrl(url) && new URL(url).origin === expectedOrigin)) {
      throw new Error("The published evidence URLs failed origin validation.");
    }
    const [health, job, tx] = await Promise.all([readJson(healthUrl), readJson(jobUrl), readJson(txUrl)]);
    const healthOk = health.status === "ok" && health.chain_id === publishedReport.project.chain_id && health.contract_address?.toLowerCase() === publishedReport.project.contract.toLowerCase();
    const jobOk = job.status === "ACCEPTED" && job.decision_source === "CONSENSUS" && job.contract?.toLowerCase() === publishedReport.project.contract.toLowerCase();
    const txOk = tx.status === "FINALIZED" && tx.finalized_success === true && ["SUCCESS", "FINISHED_WITH_RETURN"].includes(tx.execution_result);
    const passed = [healthOk, jobOk, txOk].filter(Boolean).length;
    text(output, passed + "/3 live reads match the published expectations. " + (passed === 3 ? "The historical example is still available." : "Inspect the API links; at least one assertion changed."));
    output.classList.toggle("error", passed !== 3);
  } catch (error) {
    text(output, "Live recheck is inconclusive: " + error.message + ". The dated CI report remains available.");
    output.classList.add("error");
  } finally {
    button.disabled = false;
  }
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
$("#recheck").addEventListener("click", quickRecheck);
$("#copy-report").addEventListener("click", async () => {
  const button = $("#copy-report");
  try {
    await navigator.clipboard.writeText(new URL(REPORT_URL, location.origin).href);
    text(button, "Link copied ✓");
  } catch {
    text(button, "Copy unavailable — open the JSON link");
  }
  setTimeout(() => text(button, "Copy report link"), 3000);
});

try {
  renderReport(await readJson(REPORT_URL));
} catch (error) {
  text($("#loading"), "The published report could not be loaded: " + error.message);
}
