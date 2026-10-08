import { createHash } from "node:crypto";

export const REPORT_PROTOCOL = "ROADTEST_REPORT_V1";

export function isFullHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || !/^[a-z0-9-]{2,48}$/.test(config.id ?? "")) {
    throw new Error("Invalid project id");
  }
  const site = new URL(config.site);
  if (site.protocol !== "https:" || site.username || site.password || site.search || site.hash || site.pathname !== "/") {
    throw new Error("The target must be an HTTPS site origin");
  }
  if (!isAddress(config.contract) || !isFullHash(config.review_tx) || !isFullHash(config.browser_write_tx)) {
    throw new Error("Invalid contract address or transaction hash");
  }
  if (!/^[a-z0-9_]{4,64}$/.test(config.example_job_id) || !/^[a-z0-9_]{4,64}$/.test(config.browser_write_job_id)) {
    throw new Error("Invalid job id");
  }
  if (!Number.isInteger(config.chain_id) || config.chain_id <= 0) throw new Error("Invalid chain id");
  if (!Array.isArray(config.claims) || config.claims.length === 0) throw new Error("Missing scoped claims");
  const ids = new Set();
  for (const claim of config.claims) {
    if (!/^[a-z0-9-]{2,48}$/.test(claim.id ?? "") || ids.has(claim.id)) throw new Error("Invalid or duplicate claim id");
    if (typeof claim.text !== "string" || !claim.text.trim() || !Array.isArray(claim.checks) || !claim.checks.length) throw new Error("Invalid claim");
    ids.add(claim.id);
  }
  return config;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fetchJson(url, fetchImpl = fetch, options = {}) {
  const timeoutMs = options.timeoutMs ?? 25000;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 1_000_000) throw new Error("Response exceeds 1 MB");
      return { value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes), bytes: bytes.length };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function record(id, title, url, condition, observation, bodySha) {
  return {
    id,
    title,
    kind: "live-api",
    result: condition ? "PASS" : "FAIL",
    observation,
    evidence_url: url,
    ...(bodySha ? { response_sha256: bodySha } : {})
  };
}

function errorRecord(id, title, url, error) {
  return { id, title, kind: "live-api", result: "INCONCLUSIVE", observation: `Could not read evidence: ${error.message}`, evidence_url: url };
}

export async function runApiChecks(config, fetchImpl = fetch) {
  validateConfig(config);
  const base = config.site.replace(/\/$/, "");
  const specs = [
    {
      id: "api-health", title: "Contract-backed API is reachable", path: "/api/v4/health",
      evaluate: (v) => ({ ok: v.status === "ok" && v.protocol === "DELIVERYOS_PACKAGES_V4" && v.chain_id === config.chain_id && String(v.contract_address).toLowerCase() === config.contract.toLowerCase(),
        observation: `status=${v.status ?? "?"}; protocol=${v.protocol ?? "?"}; chain=${v.chain_id ?? "?"}; contract=${v.contract_address ?? "?"}` })
    },
    {
      id: "example-job", title: "Accepted example matches the stated contract", path: `/api/v4/jobs/${config.example_job_id}`,
      evaluate: (v) => ({ ok: v.job_id === config.example_job_id && v.status === "ACCEPTED" && v.decision_source === "CONSENSUS" && v.contract?.toLowerCase() === config.contract.toLowerCase() && v.chain_id === config.chain_id && Array.isArray(v.latest_statuses) && v.latest_statuses.every((s) => s === "MET") && v.latest_statuses.length > 0,
        observation: `job=${v.job_id ?? "?"}; status=${v.status ?? "?"}; decision=${v.decision_source ?? "?"}; criteria=${JSON.stringify(v.latest_statuses ?? [])}` })
    },
    {
      id: "review-transaction", title: "Review transaction finalized and executed", path: `/api/transactions/${config.review_tx}`,
      evaluate: (v) => ({ ok: v.transaction_hash?.toLowerCase() === config.review_tx.toLowerCase() && v.status === "FINALIZED" && ["AGREE", "MAJORITY_AGREE"].includes(v.consensus_result) && ["SUCCESS", "FINISHED_WITH_RETURN"].includes(v.execution_result) && v.finalized_success === true,
        observation: `status=${v.status ?? "?"}; consensus=${v.consensus_result ?? "?"}; execution=${v.execution_result ?? "?"}` })
    },
    {
      id: "browser-write-transaction", title: "Earlier create-job write has a successful receipt", path: `/api/transactions/${config.browser_write_tx}`,
      evaluate: (v) => ({ ok: v.transaction_hash?.toLowerCase() === config.browser_write_tx.toLowerCase() && v.status === "FINALIZED" && ["AGREE", "MAJORITY_AGREE"].includes(v.consensus_result) && ["SUCCESS", "FINISHED_WITH_RETURN"].includes(v.execution_result) && v.finalized_success === true,
        observation: `status=${v.status ?? "?"}; consensus=${v.consensus_result ?? "?"}; execution=${v.execution_result ?? "?"}` })
    },
    {
      id: "browser-write-state", title: "Earlier created job remains readable", path: `/api/v4/jobs/${config.browser_write_job_id}`,
      evaluate: (v) => ({ ok: v.job_id === config.browser_write_job_id && v.protocol === "DELIVERYOS_PACKAGES_V4" && v.contract?.toLowerCase() === config.contract.toLowerCase() && v.chain_id === config.chain_id,
        observation: `job=${v.job_id ?? "?"}; status=${v.status ?? "?"}; chain=${v.chain_id ?? "?"}` })
    }
  ];
  const checks = [];
  for (const spec of specs) {
    const url = base + spec.path;
    try {
      const response = await fetchJson(url, fetchImpl);
      const result = spec.evaluate(response.value);
      checks.push(record(spec.id, spec.title, url, result.ok, result.observation, response.sha256));
    } catch (error) {
      checks.push(errorRecord(spec.id, spec.title, url, error));
    }
  }
  return checks;
}

export function summarizeClaims(config, checks) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  return config.claims.map((claim) => {
    const related = claim.checks.map((id) => byId.get(id));
    const status = related.some((check) => check?.result === "FAIL")
      ? "FAIL"
      : related.some((check) => !check || check.result === "INCONCLUSIVE") ? "INCONCLUSIVE" : "PASS";
    return { id: claim.id, text: claim.text, check_ids: claim.checks, status };
  });
}

export function overallStatus(claims) {
  if (claims.some((claim) => claim.status === "FAIL")) return "FAIL";
  if (claims.some((claim) => claim.status === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASS";
}
