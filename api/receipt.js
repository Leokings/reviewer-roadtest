import { verifyReceipt } from "../lib/receipt.mjs";

export async function POST(request) {
  try {
    if (Number(request.headers.get("content-length")) > 2000) return Response.json({ error: "Request too large" }, { status: 413 });
    const result = await verifyReceipt(await request.json());
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const badInput = /Enter |Choose /.test(error.message);
    if (!badInput) console.error("receipt verification failed", error);
    return Response.json({ error: badInput ? error.message : "Receipt verification is temporarily unavailable" }, { status: badInput ? 400 : 502 });
  }
}
