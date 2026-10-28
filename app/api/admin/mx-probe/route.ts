import { denied, isAdmin } from "@/lib/guard";
import { db } from "@/lib/merchants";
import { mx, mxConfig } from "@/lib/mx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read-only check of the MX Merchant credentials: which environment, which merchants the key
 * can act for, and (with ?merchant=<id>) that merchant's recent payments and batches.
 * Results are also written to the activity log so they can be read without the response.
 * Writes nothing to MX.
 */
export async function GET(req: Request) {
  // Preview deployments sit behind Vercel's own login, so the admin secret is only required in production.
  if (process.env.VERCEL_ENV !== "preview" && !(await isAdmin(req))) return denied();
  const cfg = mxConfig();
  if (!cfg) return Response.json({ error: "MX_BASE_URL / MX_CONSUMER_KEY / MX_CONSUMER_SECRET are not set" }, { status: 503 });
  const client = mx(cfg);
  const merchantId = new URL(req.url).searchParams.get("merchant");
  const out: Record<string, unknown> = { env: client.env, baseUrl: cfg.baseUrl };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (err) { out[name] = { error: String((err as Error).message ?? err) }; }
  };
  await step("merchants", async () => (await client.listMerchants()).map((m) => ({ id: m.id, name: m.name ?? m.dba, merchantId: m.merchantId, status: m.status, keys: Object.keys(m).slice(0, 40) })));
  if (merchantId) {
    await step("merchant", () => client.getMerchant(merchantId));
    await step("payments", async () => {
      const r = await client.listPayments(merchantId, { limit: 5 });
      return { recordCount: r.recordCount, sample: r.records.slice(0, 3) };
    });
    await step("batches", async () => (await client.listBatches(merchantId, { limit: 3 })).raw);
    await step("limitedUseToken", async () => { const t = await client.limitedUseToken(merchantId); return { tokenLength: t.token.length, shape: Object.keys((t.raw as object) ?? {}) }; });
  }
  await db().from("sync_log").insert({ merchant_id: null, level: "info", message: `MX probe (${client.env})`, detail: out });
  return Response.json(out);
}
