import { deps } from "@/lib/deps";
import { denied, isAdmin } from "@/lib/guard";
import { reconcile, syncInvoice, syncPayment } from "@/lib/sync";

export const dynamic = "force-dynamic";

// Manual trigger for testing: { "invoice": "123" } or { "payment": "<pay center payment id>" }
export async function POST(req: Request) {
  if (!isAdmin(req)) return denied();
  const body = await req.json().catch(() => ({}));
  if (body.invoice) return Response.json(await syncInvoice(deps(), String(body.invoice)));
  if (body.payment) return Response.json(await syncPayment(deps(), String(body.payment)));
  return Response.json({ error: "Send an invoice or payment id" }, { status: 400 });
}

// Browser link: /api/admin/sync?key=ADMIN_SECRET re-checks every Pay Center payment from the last few days.
export async function GET(req: Request) {
  if (!isAdmin(req)) return denied();
  return Response.json(await reconcile(deps()));
}
