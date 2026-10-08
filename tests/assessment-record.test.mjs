import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { overallStatus, summarizeClaims } from "../lib/checks.mjs";

const root = new URL("../", import.meta.url);
const assessment = JSON.parse(await readFile(new URL("public/assessments/deliveryos.json", root), "utf8"));
const report = JSON.parse(await readFile(new URL("public/reports/deliveryos.json", root), "utf8"));
const config = JSON.parse(await readFile(new URL("configs/deliveryos.json", root), "utf8"));
const source = await readFile(new URL("contracts/OnboardingRoadtest.py", root));

test("on-chain assessment record names exact source bytes and receipt", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), assessment.source_sha256);
  assert.equal(assessment.contract_address.length, 42);
  assert.match(assessment.transaction_hash, /^0x[0-9a-f]{64}$/);
  assert.ok(assessment.explorer_url.endsWith(assessment.transaction_hash));
  assert.equal(assessment.landing_url, config.site);
  assert.equal(assessment.transaction_status, "FINALIZED");
  assert.equal(assessment.execution_result, "SUCCESS");
  assert.equal(assessment.consensus_result, "MAJORITY_AGREE");
});

test("published report status follows its checks and scoped claims", () => {
  const derivedClaims = summarizeClaims(config, report.checks);
  assert.deepEqual(
    report.claims.map((claim) => [claim.id, claim.status]),
    derivedClaims.map((claim) => [claim.id, claim.status])
  );
  assert.equal(report.overall, overallStatus(derivedClaims));
});
