import test from "node:test";
import assert from "node:assert/strict";
import { verifyReceipt, validateReceiptRequest } from "../lib/receipt.mjs";

const tx = "0x" + "a".repeat(64);
const contract = "0x" + "b".repeat(40);
const request = { network: "studionet", tx_hash: tx, expected_contract: contract };

function mockedRpc({ status = "0x1", lifecycle = "FINALIZED", to = contract, hash = tx } = {}) {
  return async (_url, options) => {
    const { method } = JSON.parse(options.body);
    const result = method === "eth_chainId" ? "0xf22f" : method === "gen_getTransactionStatus" ? lifecycle :
      { transactionHash: hash, to, from: "0x" + "c".repeat(40), status, blockNumber: "0x12" };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("receipt requires a supported chain, valid hash, and expected contract", () => {
  assert.throws(() => validateReceiptRequest({ ...request, network: "mainnet" }), /supported/);
  assert.throws(() => validateReceiptRequest({ ...request, tx_hash: "0x123" }), /32-byte/);
  assert.throws(() => validateReceiptRequest({ ...request, expected_contract: "0x123" }), /contract/);
});

test("finalized successful transaction to the expected contract passes", async () => {
  const result = await verifyReceipt(request, mockedRpc());
  assert.equal(result.result, "PASS");
  assert.equal(result.lifecycle, "FINALIZED");
  assert.equal(result.execution_status, "0x1");
});

test("receipt accepts the structured GenLayer lifecycle shape without confusing status and execution", async () => {
  const result = await verifyReceipt(request, mockedRpc({ lifecycle: { status: "Finalized", statusCode: 7 }, status: "0x01" }));
  assert.equal(result.result, "PASS");
  assert.equal(result.lifecycle, "FINALIZED");
});

test("wrong recipient and reverted execution cannot pass", async () => {
  assert.equal((await verifyReceipt(request, mockedRpc({ to: "0x" + "d".repeat(40) }))).result, "FAIL");
  assert.equal((await verifyReceipt(request, mockedRpc({ status: "0x0" }))).result, "FAIL");
});

test("pending or mismatched-hash transaction remains inconclusive", async () => {
  assert.equal((await verifyReceipt(request, mockedRpc({ lifecycle: "ACCEPTED" }))).result, "INCONCLUSIVE");
  assert.equal((await verifyReceipt(request, mockedRpc({ hash: "0x" + "d".repeat(64) }))).result, "INCONCLUSIVE");
});
