import { denied, isAdmin } from "@/lib/guard";
import { db, getMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

/**
 * Forgets the link between an accounting invoice and its payment request, so the invoice can be
 * pushed again (for example to a different payment platform). Refuses if any payment was recorded
 * against the old request. The old request itself is left alone on its platform.
 * GET ?merchant=<id>&invoice=<accounting invoice id>
 */
export async function GET(req: Request) {
  if (process.env.VERCEL_ENV !== "preview" && !(await isAdmin(req))) return denied();
  const u = new URL(req.url);
  const m = await getMerchant(u.searchParams.get("merchant") ?? "");
  const invoice = u.searchParams.get("invoice") ?? "";
  if (!m || !invoice) return Response.json({ error: "merchant and invoice are required" }, { status: 400 });
  const link: any = (await db().from("invoice_map").select("*").eq("merchant_id", m.id).eq("fb_invoice_id", invoice).maybeSingle()).data;
  if (!link) return Response.json({ status: "no_link" });
  const paid = await db().from("payment_ledger").select("pc_payment_id", { count: "exact", head: true }).eq("merchant_id", m.id).eq("pc_invoice_id", link.pc_invoice_id);
  if ((paid.count ?? 0) > 0) return Response.json({ status: "refused", reason: "payments were recorded against this link" }, { status: 409 });
  const del = await db().from("invoice_map").delete().eq("merchant_id", m.id).eq("fb_invoice_id", invoice);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  await db().from("sync_log").insert({ merchant_id: m.id, level: "info", message: "Invoice link cleared by admin so it can be pushed again", detail: { invoiceId: invoice, previous: link.pc_invoice_id, previousLink: link.pay_link } });
  return Response.json({ status: "unlinked", previous: link.pc_invoice_id, previousLink: link.pay_link });
}
