import { after } from "next/server";
import { depsFor, MerchantNotReady, storeFor } from "@/lib/deps";
import { merchantByAcctAccount } from "@/lib/merchants";
import { parseEvents, verifyWebhook } from "@/lib/quickbooks";
import { syncInvoice } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One webhook address for the whole Intuit app, set in the developer portal for each key set
 * (production and sandbox). Intuit batches events, sends only ids, and expects a quick 200;
 * the invoices are re-read and synced after the response goes out. Every step is safe to repeat,
 * and the daily reconcile covers a delivery that is lost.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("intuit-signature");
  const verifiers = [process.env.QUICKBOOKS_WEBHOOK_VERIFIER, process.env.QUICKBOOKS_SANDBOX_WEBHOOK_VERIFIER].filter(Boolean) as string[];
  if (verifiers.length === 0) return Response.json({ error: "Webhook verifier is not configured" }, { status: 503 });
  if (!verifiers.some((v) => verifyWebhook(raw, signature, v))) return Response.json({ error: "Bad signature" }, { status: 401 });

  let body: any;
  try { body = JSON.parse(raw); } catch { return Response.json({ status: "ignored", reason: "Not JSON" }); }
  const events = parseEvents(body).filter((e) => e.entity === "Invoice");
  if (events.length === 0) return Response.json({ status: "ignored", reason: "No invoice events" });

  after(async () => {
    for (const e of events) {
      const m = await merchantByAcctAccount("quickbooks", e.realmId);
      if (!m) continue;
      const s = storeFor(m);
      if (m.status !== "active") { await s.log("info", `QuickBooks invoice ${e.operation} ignored (merchant is ${m.status})`, { invoiceId: e.id }); continue; }
      try {
        const r = await syncInvoice(depsFor(m), e.id);
        if (r.status !== "already_linked") await s.log("info", `QuickBooks invoice ${e.operation}: ${r.status}`, { invoiceId: e.id, ...r });
      } catch (err) {
        if (err instanceof MerchantNotReady) { await s.log("error", err.message, { invoiceId: e.id }); continue; }
        await s.log("error", "Could not process QuickBooks invoice event", { invoiceId: e.id, operation: e.operation, error: String(err) });
      }
    }
  });
  return Response.json({ status: "accepted", events: events.length });
}
