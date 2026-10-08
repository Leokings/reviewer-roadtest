import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertReportMatchesPlan, evaluateAssertions, fetchDocument, overallStatus, publicOrigin, runHttpChecks, sha256, summarizeClaims, validateConfig } from "../lib/checks.mjs";

const config = JSON.parse(await readFile(new URL("../configs/roadtest.json", import.meta.url), "utf8"));

test("a reusable plan validates checks and claim coverage", () => {
  assert.deepEqual(validateConfig(config), config);
  assert.equal(validateConfig({ ...config, site: "https://reviewer-roadtest.vercel.app" }).site, config.site);
  assert.equal(publicOrigin(config.site), "https://reviewer-roadtest.vercel.app");
  assert.throws(() => validateConfig({ ...config, site: "http://localhost/" }), /HTTPS/);
  assert.throws(() => validateConfig({ ...config, site: "https://127.0.0.1/" }), /HTTPS/);
  assert.throws(() => validateConfig({ ...config, http_checks: [{ ...config.http_checks[0], path: "//private/" }] }), /same-origin/);
  assert.throws(() => validateConfig({ ...config, claims: [{ id: "bad", text: "Bad claim", checks: ["unknown"] }] }), /unknown check/);
  assert.throws(() => validateConfig({ ...config, claims: Array.from({ length: 11 }, (_, i) => ({ id: `claim-${i}`, text: "A narrow claim", checks: [config.browser_checks[0].id] })) }), /1-10/);
});

test("response hashes use exact bytes", () => {
  assert.equal(sha256(Buffer.from("hello")), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("HTTP assertions require exact expected values, not only a 200", async () => {
  const fakeFetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/openapi.json") return new Response(JSON.stringify({ openapi: "3.1.0", info: { title: "Wrong title" } }), { status: 200 });
    if (path === "/llms.txt") return new Response("Reviewer Roadtest with no API key", { status: 200 });
    return new Response(JSON.stringify({ id: "my-project" }), { status: 200 });
  };
  const checks = await runHttpChecks(config, fakeFetch);
  assert.equal(checks.find((check) => check.id === "openapi")?.result, "FAIL");
  assert.equal(checks.find((check) => check.id === "agent-guide")?.result, "PASS");
  assert.equal(summarizeClaims(config, checks).find((claim) => claim.id === "agent-resources")?.status, "FAIL");
});

test("malformed JSON and redirects are inconclusive, never a pass", async () => {
  const malformed = await runHttpChecks(config, async () => new Response("not json", { status: 200 }));
  assert.equal(malformed.find((check) => check.id === "openapi")?.result, "INCONCLUSIVE");
  const redirected = await fetchDocument(config.site + "openapi.json", async () => new Response(null, { status: 302, headers: { location: "https://other.example/" } })).catch((error) => error);
  assert.match(redirected.message, /HTTP 302/);
});

test("oversized responses are rejected before becoming evidence", async () => {
  const result = await fetchDocument("https://example.org/large", async () => new Response("x".repeat(100), { status: 200 }), { maxBytes: 40 }).catch((error) => error);
  assert.match(result.message, /exceeds/);
});

test("missing evidence cannot create a passing claim", () => {
  const claims = summarizeClaims(config, []);
  assert.equal(overallStatus(claims), "INCONCLUSIVE");
});

test("a definite failure is not hidden by a missing check", () => {
  const claims = summarizeClaims(config, [{ id: "openapi", result: "FAIL" }]);
  assert.equal(claims.find((claim) => claim.id === "agent-resources")?.status, "FAIL");
  assert.equal(overallStatus(claims), "FAIL");
});

test("text and JSON comparisons are explicit", () => {
  assert.equal(evaluateAssertions({ format: "text", assertions: [{ includes: "hello" }] }, "hello world").ok, true);
  assert.equal(evaluateAssertions({ format: "json", assertions: [{ field: "nested.ok", equals: true }] }, '{"nested":{"ok":false}}').ok, false);
});

test("untrusted sandbox output cannot replace check results or plan identity", () => {
  const checks = [
    ...config.http_checks.map((spec) => ({ id: spec.id, title: spec.title, kind: "live-api", result: "PASS", observation: "Matched", evidence_url: new URL(spec.path, config.site).href, response_sha256: "a".repeat(64) })),
    ...config.browser_checks.map((spec) => ({ id: spec.id, title: spec.title, kind: "browser-runner", result: "PASS", observation: "Visible", evidence_url: config.site }))
  ];
  const claims = summarizeClaims(config, checks);
  const report = { protocol: "ROADTEST_REPORT_V1", report_id: `${config.id}-20261008t123456z`, plan: config,
    project: { id: config.id, name: config.name, site: config.site }, scope: config.scope,
    checks, claims, overall: overallStatus(claims), not_tested: config.not_tested,
    screenshot: null, screenshot_sha256: null };
  assert.equal(assertReportMatchesPlan(report, config), report);
  assert.throws(() => assertReportMatchesPlan({ ...report, overall: "FAIL" }, config), /does not match/);
  assert.throws(() => assertReportMatchesPlan({ ...report, report_id: "../wrong" }, config), /does not match/);
  assert.throws(() => assertReportMatchesPlan({ ...report, checks: checks.map((check, index) => index ? check : { ...check, id: "different" }) }, config), /does not match/);
});
