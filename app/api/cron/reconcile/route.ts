import { env } from "@/lib/config";
import { deps } from "@/lib/deps";
import { safeEqual } from "@/lib/freshbooks";
import { reconcile } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily safety net: Pay Center stops retrying a webhook after about three hours.
export async function GET(req: Request) {
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env("CRON_SECRET")}`))
    return Response.json({ error: "Not authorized" }, { status: 401 });
  return Response.json(await reconcile(deps()));
}
