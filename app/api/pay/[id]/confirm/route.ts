import { depsFor, MerchantNotReady, storeFor } from "@/lib/deps";
import { getMerchant } from "@/lib/merchants";
import { getRequest, recordMxPayment } from "@/lib/pbspay";
import { syncPayment } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The browser reports the MX payment id it got back. We re-read the payment from MX, record it,
 * and run the same sync step a Pay Center webhook would. Safe to repeat.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const mxPaymentId = String(body?.mxPaymentId ?? "").trim();
  if (!/^[0-9A-Za-z-]{1,40}$/.test(mxPaymentId)) return Response.json({ error: "Missing payment id" }, { status: 400 });
  const pr = await getRequest(id);
  if (!pr) return Response.json({ error: "Unknown payment request" }, { status: 404 });
  const m = await getMerchant(pr.merchantId);
  if (!m || m.payments !== "pbspay") return Response.json({ error: "Unknown merchant" }, { status: 404 });
  const s = storeFor(m);
  const rec = await recordMxPayment(m, pr, mxPaymentId);
  if (rec.status !== "recorded") {
    await s.log("review", `PBS Pay: a payment reported by the browser was not recorded (${rec.reason})`, { requestId: id, mxPaymentId });
    return Response.json({ status: "rejected", reason: rec.reason }, { status: 409 });
  }
  let sync: unknown = null;
  try {
    sync = await syncPayment(depsFor(m), rec.paymentId!);
    await s.log("info", `PBS Pay payment ${rec.mxStatus}: ${(sync as any)?.status}`, { paymentId: rec.paymentId, mxPaymentId, requestId: id, result: sync });
  } catch (err) {
    if (!(err instanceof MerchantNotReady)) await s.log("error", "PBS Pay: payment recorded but the accounting sync failed", { paymentId: rec.paymentId, error: String(err) });
    else await s.log("error", err.message, { paymentId: rec.paymentId });
  }
  return Response.json({ status: "ok", mxStatus: rec.mxStatus, sync });
}
