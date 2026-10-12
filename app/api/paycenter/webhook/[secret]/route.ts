import { env } from "@/lib/config";
import { deps } from "@/lib/deps";
import { safeEqual } from "@/lib/freshbooks";
import { syncPayment } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!safeEqual(secret, env("PAYCENTER_WEBHOOK_SECRET"))) return Response.json({ error: "Not authorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body?.data?._id;
  if (body?.action !== "payment" || typeof id !== "string") return Response.json({ status: "ignored" });

  // Only the id is taken from the webhook. The payment itself is re-read from Pay Center,
  // so a forged or stale notification cannot change what gets posted.
  // A failure returns 500 so Pay Center retries; the ledger makes repeats harmless.
  return Response.json(await syncPayment(deps(), id));
}
