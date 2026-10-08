import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { put } from "@vercel/blob";
import { sha256, validateConfig } from "../lib/checks.mjs";
import { assertPublicTarget, sandboxPolicy } from "../lib/public-target.mjs";

const runnerSource = new URL("../scripts/sandbox-runner.mjs", import.meta.url);
const checksSource = new URL("../lib/checks.mjs", import.meta.url);

export async function POST(request) {
  let config;
  try {
    if (Number(request.headers.get("content-length")) > 20000) return Response.json({ error: "Plan is too large" }, { status: 413 });
    config = validateConfig(await request.json());
    if (JSON.stringify(config).length > 20000 || config.browser_checks.length > 5 || config.http_checks.length > 5) {
      throw new Error("Hosted runs allow at most 5 browser checks and 5 public reads");
    }
    if (request.headers.get("origin") && new URL(request.headers.get("origin")).host !== request.headers.get("host")) {
      throw new Error("Open the Roadtest site to start a hosted run");
    }
  } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }

  if (!process.env.ROADTEST_SANDBOX_SNAPSHOT_ID || !process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "Hosted runs are not configured yet" }, { status: 503 });
  }
  let sandbox;
  try {
    const hostname = await assertPublicTarget(config.site);
    sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId: process.env.ROADTEST_SANDBOX_SNAPSHOT_ID },
      timeout: 120000, resources: { vcpus: 1 }, persistent: false,
      networkPolicy: sandboxPolicy(hostname),
      env: { PLAYWRIGHT_BROWSERS_PATH: "/vercel/ms-playwright" }
    });
    await sandbox.writeFiles([
      { path: "plan.json", content: Buffer.from(JSON.stringify(config)) },
      { path: "runner.mjs", content: await readFile(runnerSource) },
      { path: "checks.mjs", content: await readFile(checksSource) }
    ]);
    const command = await sandbox.runCommand({ cmd: "node", args: ["/vercel/runner.mjs"], cwd: "/vercel" });
    if (command.exitCode !== 0) throw new Error((await command.stderr()).slice(-500));
    const reportBytes = await sandbox.readFileToBuffer({ path: "result.json" });
    if (!reportBytes || reportBytes.length > 200000) throw new Error("Sandbox did not produce a valid report");
    const report = JSON.parse(reportBytes.toString("utf8"));
    const imageBytes = await sandbox.readFileToBuffer({ path: "evidence.jpg" });
    const nonce = randomBytes(8).toString("hex");
    if (imageBytes && imageBytes.length <= 750000 && sha256(imageBytes) === report.screenshot_sha256) {
      const image = await put(`evidence/${report.report_id}-${nonce}.jpg`, imageBytes, {
        access: "public", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: false
      });
      report.screenshot = image.url;
    }
    const publishedBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
    const reportHash = sha256(publishedBytes);
    const published = await put(`reports/${report.report_id}-${nonce}.json`, publishedBytes, {
      access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false
    });
    return Response.json({ report_url: published.url, report_sha256: reportHash, report }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("hosted run failed", error);
    const invalidTarget = /Target must/.test(error.message);
    return Response.json({ error: invalidTarget ? error.message : "Hosted run failed; please retry or use the local runner" }, { status: invalidTarget ? 400 : 502 });
  } finally { await sandbox?.stop().catch(() => {}); }
}
