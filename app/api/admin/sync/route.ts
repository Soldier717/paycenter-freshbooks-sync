import { depsFor } from "@/lib/deps";
import { denied, isAdmin } from "@/lib/guard";
import { getMerchant } from "@/lib/merchants";
import { reconcile, syncInvoice, syncPayment } from "@/lib/sync";
import { refreshStatuses } from "@/lib/pbspay";

export const dynamic = "force-dynamic";

async function merchantFrom(req: Request, body?: any) {
  const id = body?.merchant ?? new URL(req.url).searchParams.get("merchant") ?? "";
  return getMerchant(id);
}

// POST { merchant, invoice } or { merchant, payment } runs one step by hand.
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return denied();
  const body = await req.json().catch(() => ({}));
  const m = await merchantFrom(req, body);
  if (!m) return Response.json({ error: "Unknown merchant" }, { status: 404 });
  if (body.invoice) return Response.json(await syncInvoice(depsFor(m), String(body.invoice)));
  if (body.payment) return Response.json(await syncPayment(depsFor(m), String(body.payment)));
  return Response.json({ error: "Send an invoice or payment id" }, { status: 400 });
}

// GET ?merchant=<id> re-checks every Pay Center payment from the last week.
export async function GET(req: Request) {
  if (!(await isAdmin(req))) return denied();
  const m = await merchantFrom(req);
  if (!m) return Response.json({ error: "Unknown merchant" }, { status: 404 });
  const refreshed = m.payments === "pbspay" ? await refreshStatuses(m) : [];
  return Response.json({ ...(await reconcile(depsFor(m), { full: true })), refreshed });
}
