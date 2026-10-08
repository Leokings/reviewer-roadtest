import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";

export const REPORT_REVIEW_CONTRACT = "0x3AC40f631e8fAFcF6A7D2cc3179ed7320ff7744A";

export async function requestReportReview({ reviewId, reportUrl, reportHash, onTransaction }) {
  const provider = window.ethereum ?? window.okxwallet;
  if (!provider?.request) throw new Error("Open this page in a wallet browser or install an EIP-1193 wallet to request a review.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = accounts?.[0];
  if (!/^0x[0-9a-fA-F]{40}$/.test(account ?? "")) throw new Error("The wallet did not provide an address.");
  const client = createClient({ chain: studionet, account, provider });
  await client.connect("studionet");
  const hash = await client.writeContract({
    address: REPORT_REVIEW_CONTRACT,
    functionName: "review",
    args: [reviewId, reportUrl, reportHash],
    value: 0n
  });
  onTransaction?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 3000, retries: 120 });
  const succeeded = receipt?.statusName === TransactionStatus.FINALIZED &&
    receipt?.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN &&
    ["AGREE", "MAJORITY_AGREE"].includes(receipt?.resultName);
  if (!succeeded) throw new Error(`Transaction ${hash} finalized without confirmed successful execution. Inspect the explorer before relying on it.`);
  const review = await client.readContract({ address: REPORT_REVIEW_CONTRACT, functionName: "get_review", args: [reviewId] });
  if (review?.report_sha256 !== reportHash || review?.report_url !== reportUrl) {
    throw new Error("The stored review does not match the submitted report.");
  }
  return { hash, review };
}
