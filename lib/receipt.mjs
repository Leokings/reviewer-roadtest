const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const NETWORKS = Object.freeze({
  studionet: { rpc: "https://studio.genlayer.com/api", chainId: "0xf22f", explorer: "https://explorer-studio.genlayer.com/tx/" },
  bradbury: { rpc: "https://rpc-bradbury.genlayer.com", chainId: "0x107d", explorer: "https://explorer-bradbury.genlayer.com/tx/" }
});

export function validateReceiptRequest(input) {
  if (!input || typeof input !== "object" || !Object.hasOwn(NETWORKS, input.network)) throw new Error("Choose a supported GenLayer network");
  if (typeof input.tx_hash !== "string" || !HASH.test(input.tx_hash)) throw new Error("Enter a 32-byte transaction hash");
  if (typeof input.expected_contract !== "string" || !ADDRESS.test(input.expected_contract)) throw new Error("Enter the expected contract address");
  return { network: input.network, tx_hash: input.tx_hash.toLowerCase(), expected_contract: input.expected_contract.toLowerCase() };
}

async function rpc(url, method, params, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, {
      method: "POST", redirect: "manual", cache: "no-store", signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > 250000) throw new Error("RPC response too large");
    const raw = await response.text();
    if (raw.length > 250000) throw new Error("RPC response too large");
    const data = JSON.parse(raw);
    if (data.error) throw new Error(`RPC ${method}: ${String(data.error.message).slice(0, 100)}`);
    return data.result;
  } finally { clearTimeout(timer); }
}

export async function verifyReceipt(input, fetchImpl = fetch) {
  const request = validateReceiptRequest(input);
  const network = NETWORKS[request.network];
  const [chainId, receipt, lifecycle] = await Promise.all([
    rpc(network.rpc, "eth_chainId", [], fetchImpl),
    rpc(network.rpc, "eth_getTransactionReceipt", [request.tx_hash], fetchImpl),
    rpc(network.rpc, "gen_getTransactionStatus", [request.tx_hash], fetchImpl)
  ]);
  if (String(chainId).toLowerCase() !== network.chainId) throw new Error("RPC chain ID does not match the selected network");
  const actualContract = String(receipt?.to ?? receipt?.contractAddress ?? "").toLowerCase();
  const sameHash = String(receipt?.transactionHash ?? "").toLowerCase() === request.tx_hash;
  const recipientMatches = actualContract === request.expected_contract;
  const executionSucceeded = receipt?.status === "0x1";
  const finalized = lifecycle === "FINALIZED";
  const status = !receipt || !sameHash || !finalized ? "INCONCLUSIVE" : !recipientMatches || !executionSucceeded ? "FAIL" : "PASS";
  return {
    protocol: "ROADTEST_RECEIPT_V1", network: request.network, tx_hash: request.tx_hash,
    expected_contract: request.expected_contract, actual_contract: actualContract || null,
    sender: typeof receipt?.from === "string" ? receipt.from : null,
    lifecycle: typeof lifecycle === "string" ? lifecycle : null,
    execution_status: typeof receipt?.status === "string" ? receipt.status : null,
    block_number: typeof receipt?.blockNumber === "string" ? receipt.blockNumber : null,
    result: status, explorer_url: network.explorer + request.tx_hash,
    scope: "Independent RPC check of transaction identity, destination, finality and execution status; not proof that a website's full flow worked."
  };
}
