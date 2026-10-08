import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody, RequestTooLargeError } from "../lib/request.mjs";

test("JSON API bounds streamed bodies even without Content-Length", async () => {
  const valid = new Request("https://example.org/api/run", { method: "POST", body: JSON.stringify({ ok: true }) });
  assert.deepEqual(await readJsonBody(valid, 20), { ok: true });
  const oversized = new Request("https://example.org/api/run", { method: "POST", body: "x".repeat(100) });
  await assert.rejects(readJsonBody(oversized, 20), RequestTooLargeError);
});
