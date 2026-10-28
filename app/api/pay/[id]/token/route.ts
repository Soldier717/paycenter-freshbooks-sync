import { getMerchant } from "@/lib/merchants";
import { browserToken, getRequest, prices } from "@/lib/pbspay";

export const dynamic = "force-dynamic";

/** A one-time MX token for the customer's browser, plus the exact amounts it may charge. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const req = await getRequest(id);
  if (!req || req.status !== "open") return Response.json({ error: "This payment request is not open" }, { status: 404 });
  const m = await getMerchant(req.merchantId);
  if (!m || m.payments !== "pbspay" || m.status !== "active") return Response.json({ error: "Payments are not available for this request" }, { status: 404 });
  try {
    const t = await browserToken(m);
    const px = prices(req, m);
    return Response.json({ token: t.token, apiBase: t.apiBase, merchantId: t.mxMerchantId, cardAmount: px.cardCents, cashAmount: px.cashCents, invoice: req.invoiceNumber, achEnabled: m.achEnabled });
  } catch (err) {
    return Response.json({ error: `Could not start the payment: ${(err as Error).message}` }, { status: 502 });
  }
}
