import { denied, isAdmin } from "@/lib/guard";
import { db, updateMerchant } from "@/lib/merchants";

export const dynamic = "force-dynamic";

// One-time: copy the Pay Center token from the old PAYCENTER_ACCESS_TOKEN setting onto the
// merchant with the matching site id. Afterwards the setting can be removed.
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return denied();
  const token = process.env.PAYCENTER_ACCESS_TOKEN;
  const siteId = process.env.PAYCENTER_SITE_ID;
  if (!token || !siteId) return Response.json({ error: "PAYCENTER_ACCESS_TOKEN or PAYCENTER_SITE_ID is not set" }, { status: 400 });
  const { data, error } = await db().from("merchants").select("id, name").eq("pc_site_id", siteId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  for (const m of data ?? []) await updateMerchant(m.id, { pcAccessToken: token });
  return Response.json({ status: "imported", merchants: (data ?? []).map((m) => m.name) });
}
