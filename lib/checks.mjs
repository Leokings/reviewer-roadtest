import { createHash } from "node:crypto";

export const REPORT_PROTOCOL = "ROADTEST_REPORT_V1";
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const ROLES = new Set(["heading", "link", "button"]);

function requiredText(value, label, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}

export function publicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Target must be a public HTTPS origin"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.port ||
      !/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.includes("..") ||
      host.endsWith(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") ||
      host.endsWith(".localhost") || /^\d+(?:\.\d+){3}$/.test(host)) {
    throw new Error("Target must be a public HTTPS origin");
  }
  return url.origin;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || !ID.test(config.id ?? "")) throw new Error("Invalid project id");
  requiredText(config.name, "project name", 120);
  // Canonicalize once so agent-supplied origins without a trailing slash still
  // produce reports that the on-chain reviewer can verify byte-for-byte.
  const site = publicOrigin(config.site) + "/";
  requiredText(config.scope, "scope", 1000);
  if (config.source !== undefined) {
    const source = new URL(config.source);
    if (source.protocol !== "https:" || source.username || source.password) throw new Error("Source must be HTTPS");
  }
  if (!Array.isArray(config.browser_checks) || config.browser_checks.length < 1 || config.browser_checks.length > 12) {
    throw new Error("Configure 1-12 browser checks");
  }
  if (!Array.isArray(config.http_checks) || config.http_checks.length > 20) throw new Error("Configure at most 20 HTTP checks");
  const ids = new Set();
  for (const check of config.browser_checks) {
    if (!ID.test(check.id ?? "") || ids.has(check.id)) throw new Error("Invalid or duplicate check id");
    ids.add(check.id);
    requiredText(check.title, "check title");
    if (!["visible", "click", "no-page-errors"].includes(check.type)) throw new Error("Unsupported browser check");
    if (check.type !== "no-page-errors") {
      if (!ROLES.has(check.role)) throw new Error("Unsupported browser role");
      requiredText(check.name, "browser locator");
    }
    if (check.type === "click") {
      if (!check.after || !ROLES.has(check.after.role)) throw new Error("Click check needs an expected result");
      requiredText(check.after.name, "click result locator");
    }
  }
  for (const check of config.http_checks) {
    if (!ID.test(check.id ?? "") || ids.has(check.id)) throw new Error("Invalid or duplicate check id");
    ids.add(check.id);
    requiredText(check.title, "check title");
    if (typeof check.path !== "string" || !/^\/[a-zA-Z0-9/_.-]*$/.test(check.path) || check.path.includes("..") || check.path.startsWith("//")) {
      throw new Error("HTTP check must use a same-origin path");
    }
    if (!["json", "text"].includes(check.format) || !Array.isArray(check.assertions) || !check.assertions.length || check.assertions.length > 8) {
      throw new Error("Invalid HTTP check format or assertions");
    }
    for (const assertion of check.assertions) {
      if (check.format === "json") {
        if (typeof assertion.field !== "string" || !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(assertion.field) ||
            !Object.hasOwn(assertion, "equals") || !["string", "number", "boolean"].includes(typeof assertion.equals)) {
          throw new Error("Invalid JSON assertion");
        }
      } else if (typeof assertion.includes !== "string" || !assertion.includes || assertion.includes.length > 200) {
        throw new Error("Invalid text assertion");
      }
    }
  }
  if (!Array.isArray(config.claims) || !config.claims.length || config.claims.length > 10) throw new Error("Configure 1-10 scoped claims");
  const claimIds = new Set();
  const referenced = new Set();
  for (const claim of config.claims) {
    if (!ID.test(claim.id ?? "") || claimIds.has(claim.id)) throw new Error("Invalid or duplicate claim id");
    claimIds.add(claim.id);
    requiredText(claim.text, "claim text", 500);
    if (!Array.isArray(claim.checks) || !claim.checks.length) throw new Error("Claim needs checks");
    for (const id of claim.checks) {
      if (!ids.has(id)) throw new Error(`Claim references unknown check: ${id}`);
      referenced.add(id);
    }
  }
  if ([...ids].some((id) => !referenced.has(id))) throw new Error("Every check must support a claim");
  if (!Array.isArray(config.not_tested) || !config.not_tested.length || config.not_tested.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("List the important untested paths");
  }
  return { ...config, site };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fetchDocument(url, fetchImpl = fetch, options = {}) {
  const timeoutMs = options.timeoutMs ?? 25000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json, text/plain" }, signal: controller.signal, redirect: "manual", cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const size = Number(response.headers?.get("content-length"));
    if (size > maxBytes) throw new Error("Response exceeds 1 MB");
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) {
        await response.body.cancel().catch(() => {});
        throw new Error("Response exceeds 1 MB");
      }
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    return { body: bytes.toString("utf8"), sha256: sha256(bytes), bytes: total };
  } finally {
    clearTimeout(timer);
  }
}

export function evaluateAssertions(check, body) {
  let value = body;
  if (check.format === "json") value = JSON.parse(body);
  const observations = [];
  let ok = true;
  for (const assertion of check.assertions) {
    if (check.format === "text") {
      const found = value.includes(assertion.includes);
      observations.push(`Contains ${JSON.stringify(assertion.includes)}: ${found}`);
      ok &&= found;
    } else {
      let actual = value;
      for (const segment of assertion.field.split(".")) actual = actual && Object.hasOwn(actual, segment) ? actual[segment] : undefined;
      const matched = actual === assertion.equals;
      const observed = JSON.stringify(actual ?? null);
      observations.push(`${assertion.field}=${observed.length > 180 ? observed.slice(0, 180) + "…" : observed}; expected=${JSON.stringify(assertion.equals)}`);
      ok &&= matched;
    }
  }
  return { ok, observation: observations.join(" | ") };
}

export async function runHttpChecks(config, fetchImpl = fetch) {
  validateConfig(config);
  const checks = [];
  for (const spec of config.http_checks) {
    const url = new URL(spec.path, config.site).href;
    try {
      const response = await fetchDocument(url, fetchImpl);
      const evaluated = evaluateAssertions(spec, response.body);
      checks.push({ id: spec.id, title: spec.title, kind: "live-api", result: evaluated.ok ? "PASS" : "FAIL",
        observation: evaluated.observation, evidence_url: url, response_sha256: response.sha256 });
    } catch (error) {
      checks.push({ id: spec.id, title: spec.title, kind: "live-api", result: "INCONCLUSIVE",
        observation: `Could not read evidence: ${error.message}`, evidence_url: url });
    }
  }
  return checks;
}

export function summarizeClaims(config, checks) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  return config.claims.map((claim) => {
    const related = claim.checks.map((id) => byId.get(id));
    const status = related.some((check) => check?.result === "FAIL") ? "FAIL" :
      related.some((check) => !check || check.result === "INCONCLUSIVE") ? "INCONCLUSIVE" : "PASS";
    return { id: claim.id, text: claim.text, check_ids: claim.checks, status };
  });
}

export function overallStatus(claims) {
  if (claims.some((claim) => claim.status === "FAIL")) return "FAIL";
  if (claims.some((claim) => claim.status === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASS";
}

export function assertReportMatchesPlan(report, config) {
  const fail = () => { throw new Error("Sandbox report does not match the requested plan"); };
  if (!report || report.protocol !== REPORT_PROTOCOL ||
      typeof report.report_id !== "string" || !/^[a-z0-9-]{4,80}$/.test(report.report_id) ||
      !report.report_id.startsWith(config.id + "-") ||
      JSON.stringify(report.plan) !== JSON.stringify(config) ||
      report.project?.id !== config.id || report.project?.name !== config.name ||
      report.project?.site !== config.site || report.scope !== config.scope ||
      !Array.isArray(report.checks) || report.checks.length !== config.http_checks.length + config.browser_checks.length ||
      !Array.isArray(report.claims) || !Array.isArray(report.not_tested) ||
      JSON.stringify(report.not_tested) !== JSON.stringify(config.not_tested) ||
      ![null, undefined].includes(report.screenshot) ||
      !(report.screenshot_sha256 === null || /^[0-9a-f]{64}$/.test(report.screenshot_sha256))) fail();
  const specs = new Map([
    ...config.http_checks.map((spec) => [spec.id, { spec, kind: "live-api" }]),
    ...config.browser_checks.map((spec) => [spec.id, { spec, kind: "browser-runner" }])
  ]);
  const seen = new Set();
  for (const item of report.checks) {
    const expected = specs.get(item?.id);
    if (!expected || seen.has(item.id) || item.title !== expected.spec.title || item.kind !== expected.kind ||
        !["PASS", "FAIL", "INCONCLUSIVE"].includes(item.result) || typeof item.observation !== "string" ||
        typeof item.evidence_url !== "string") fail();
    seen.add(item.id);
    if (item.kind === "live-api") {
      if (item.evidence_url !== new URL(expected.spec.path, config.site).href ||
          (item.response_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(item.response_sha256))) fail();
    } else {
      let origin;
      try { origin = new URL(item.evidence_url).origin; } catch { fail(); }
      if (origin !== new URL(config.site).origin) fail();
    }
  }
  if (seen.size !== specs.size) fail();
  const claims = summarizeClaims(config, report.checks);
  if (JSON.stringify(report.claims) !== JSON.stringify(claims) || report.overall !== overallStatus(claims)) fail();
  return report;
}
