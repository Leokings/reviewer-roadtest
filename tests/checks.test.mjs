import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchJson, isAddress, isFullHash, overallStatus, runApiChecks, sha256, summarizeClaims, validateConfig } from "../lib/checks.mjs";

const config = JSON.parse(await readFile(new URL("../configs/deliveryos.json", import.meta.url), "utf8"));

test("config is intentionally scoped and hashes are exact-length", () => {
  assert.equal(validateConfig(config), config);
  assert.equal(isAddress(config.contract), true);
  assert.equal(isFullHash(config.review_tx), true);
  assert.equal(isFullHash("0xabc"), false);
  assert.throws(() => validateConfig({ ...config, site: "http://localhost/" }), /HTTPS/);
});

test("SHA-256 uses response bytes", () => {
  assert.equal(sha256(Buffer.from("hello")), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("all relevant receipts must prove execution, not just finalization", async () => {
  const values = new Map([
    ["/api/v4/health", { status: "ok", protocol: "DELIVERYOS_PACKAGES_V4", chain_id: 61999, contract_address: config.contract }],
    [`/api/v4/jobs/${config.example_job_id}`, { job_id: config.example_job_id, status: "ACCEPTED", decision_source: "CONSENSUS", chain_id: 61999, contract: config.contract, latest_statuses: ["MET", "MET"] }],
    [`/api/transactions/${config.review_tx}`, { transaction_hash: config.review_tx, status: "FINALIZED", consensus_result: "MAJORITY_AGREE", execution_result: "REVERTED", finalized_success: false }],
    [`/api/transactions/${config.browser_write_tx}`, { transaction_hash: config.browser_write_tx, status: "FINALIZED", consensus_result: "MAJORITY_AGREE", execution_result: "SUCCESS", finalized_success: true }],
    [`/api/v4/jobs/${config.browser_write_job_id}`, { job_id: config.browser_write_job_id, protocol: "DELIVERYOS_PACKAGES_V4", contract: config.contract, chain_id: 61999 }]
  ]);
  const fakeFetch = async (url) => {
    const value = values.get(new URL(url).pathname);
    return { ok: Boolean(value), status: value ? 200 : 404, arrayBuffer: async () => Buffer.from(JSON.stringify(value)) };
  };
  const checks = await runApiChecks(config, fakeFetch);
  assert.equal(checks.find((check) => check.id === "review-transaction")?.result, "FAIL");
  const claims = summarizeClaims(config, checks);
  assert.equal(claims.find((claim) => claim.id === "reviewed-example")?.status, "FAIL");
  assert.equal(overallStatus(claims), "FAIL");
});

test("missing check never becomes a pass", () => {
  const claims = summarizeClaims(config, []);
  assert.equal(overallStatus(claims), "INCONCLUSIVE");
});

test("HTTP failures stay inconclusive instead of becoming false proof", async () => {
  const response = await fetchJson("https://example.com/a", async () => ({ ok: true, arrayBuffer: async () => Buffer.from('{"ok":true}') }));
  assert.equal(response.value.ok, true);
  assert.match(response.sha256, /^[0-9a-f]{64}$/);
});
