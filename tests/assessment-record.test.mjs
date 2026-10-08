import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { overallStatus, summarizeClaims } from "../lib/checks.mjs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("configs/roadtest.json", root), "utf8"));

test("published report follows its checks and scoped claims", async () => {
  const report = JSON.parse(await readFile(new URL("public/reports/roadtest.json", root), "utf8"));
  const derived = summarizeClaims(config, report.checks);
  const ids = new Set(config.claims.flatMap((claim) => claim.checks));
  assert.equal(report.project.id, config.id);
  assert.equal(report.project.site, config.site);
  assert.ok(report.checks.every((check) => ids.has(check.id)), "Every check must support a claim");
  assert.deepEqual(report.claims.map((claim) => [claim.id, claim.status]), derived.map((claim) => [claim.id, claim.status]));
  assert.equal(report.overall, overallStatus(derived));
  assert.match(report.report_id, /^roadtest-\d{8}t\d{9}z$/);
});

test("on-chain record, when published, identifies source bytes and successful receipt", async (t) => {
  let assessment;
  try { assessment = JSON.parse(await readFile(new URL("public/assessments/roadtest.json", root), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return t.skip("Self-assessment is not published yet"); throw error; }
  const source = await readFile(new URL("contracts/OnboardingRoadtest.py", root));
  assert.equal(createHash("sha256").update(source).digest("hex"), assessment.source_sha256);
  assert.equal(assessment.landing_url, config.site);
  assert.equal(assessment.transaction_status, "FINALIZED");
  assert.equal(assessment.execution_result, "SUCCESS");
  assert.ok(["AGREE", "MAJORITY_AGREE"].includes(assessment.consensus_result));
  assert.ok(assessment.explorer_url.endsWith(assessment.transaction_hash));
  assert.match(assessment.source_url, /\/blob\/[0-9a-f]{40}\/contracts\/OnboardingRoadtest\.py$/);
});
