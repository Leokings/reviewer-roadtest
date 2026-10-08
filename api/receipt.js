import { verifyReceipt } from "../lib/receipt.mjs";
import { readJsonBody, RequestTooLargeError } from "../lib/request.mjs";

export async function POST(request) {
  try {
    const result = await verifyReceipt(await readJsonBody(request, 2000));
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestTooLargeError) return Response.json({ error: error.message }, { status: 413 });
    const badInput = error instanceof SyntaxError || /Enter |Choose |Request body is required/.test(error.message);
    if (!badInput) console.error("receipt verification failed", error);
    return Response.json({ error: badInput ? error.message : "Receipt verification is temporarily unavailable" }, { status: badInput ? 400 : 502 });
  }
}
