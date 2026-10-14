import { depsFor, MerchantNotReady, storeFor } from "@/lib/deps";
import { merchantByWebhookSecret } from "@/lib/merchants";
import { syncPayment } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  const m = await merchantByWebhookSecret(secret);
  if (!m) return Response.json({ error: "Not authorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body?.data?._id;
  if (body?.action === "notification") {
    // Delivery state of the text/email Pay Center sent, or the customer opening the link.
    const d = body.data ?? {};
    await storeFor(m).log(d.status === "failed" ? "error" : "info", `Pay Center ${d.type ?? "notification"}: ${d.status ?? d.event ?? "update"}`, d);
    return Response.json({ status: "logged" });
  }
  if (body?.action !== "payment" || typeof id !== "string") return Response.json({ status: "ignored" });

  // Only the id is taken from the webhook. The payment itself is re-read from Pay Center,
  // so a forged or stale notification cannot change what gets posted.
  // A failure returns 500 so Pay Center retries; the ledger makes repeats harmless.
  const s = storeFor(m);
  try {
    const result = await syncPayment(depsFor(m), id);
    await s.log("info", `Pay Center payment notification: ${result.status}`, { pcPaymentId: id, notified: body?.data?.status, result });
    return Response.json(result);
  } catch (err) {
    if (err instanceof MerchantNotReady) {
      await s.log("error", "Payment notification received but merchant is not ready", { pcPaymentId: id, error: err.message });
      return Response.json({ status: "ignored", reason: err.message });
    }
    throw err;
  }
}
