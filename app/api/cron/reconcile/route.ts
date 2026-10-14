import { env } from "@/lib/config";
import { depsFor, storeFor } from "@/lib/deps";
import { safeEqual } from "@/lib/freshbooks";
import { activeMerchants } from "@/lib/merchants";
import { reconcile } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily safety net: Pay Center stops retrying a webhook after about three hours.
export async function GET(req: Request) {
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env("CRON_SECRET")}`))
    return Response.json({ error: "Not authorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  for (const m of await activeMerchants()) {
    try {
      out[m.name] = await reconcile(depsFor(m));
    } catch (err) {
      out[m.name] = { status: "error", error: String(err) };
      await storeFor(m).log("error", "Daily reconcile failed", { error: String(err) });
    }
  }
  return Response.json(out);
}
