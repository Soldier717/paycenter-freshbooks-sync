import { appUrl } from "@/lib/config";
import { storeFor } from "@/lib/deps";
import { db, merchantByAcctAccount } from "@/lib/merchants";

export const dynamic = "force-dynamic";

/**
 * Intuit sends the customer here (with ?realmId=) when they disconnect the app from their side.
 * Their tokens are already revoked by Intuit; this drops our copy and pauses the merchant so the
 * admin page shows "not connected" rather than failing on the next invoice.
 */
export async function GET(req: Request) {
  const realmId = new URL(req.url).searchParams.get("realmId") ?? "";
  const m = realmId ? await merchantByAcctAccount("quickbooks", realmId) : null;
  if (m) {
    await db().from("fb_tokens").delete().eq("merchant_id", m.id);
    if (m.status === "active") await db().from("merchants").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", m.id);
    await storeFor(m).log("info", "QuickBooks disconnected by the customer from Intuit; merchant paused", { realmId });
  }
  return Response.redirect(`${appUrl()}/quickbooks?disconnected=1`, 302);
}
