import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicTarget, publicAddress, sandboxPolicy } from "../lib/public-target.mjs";

test("public target check rejects private, metadata, and mixed DNS answers", async () => {
  for (const address of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "fd00::1"]) {
    assert.equal(publicAddress(address), false, address);
  }
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(await assertPublicTarget("https://example.org/", async () => [{ address: "1.1.1.1" }]), "example.org");
  await assert.rejects(assertPublicTarget("https://example.org/", async () => [{ address: "1.1.1.1" }, { address: "10.0.0.1" }]), /public internet/);
  assert.deepEqual(sandboxPolicy("example.org").allow, ["example.org"]);
});
