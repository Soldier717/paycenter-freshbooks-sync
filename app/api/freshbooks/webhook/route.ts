import { depsFor, MerchantNotReady, oauthApp, storeFor } from "@/lib/deps";
import { confirmCallback, safeEqual, webhookSignature } from "@/lib/freshbooks";
import { merchantByCallbackId, merchantByFbAccount } from "@/lib/merchants";
import { syncInvoice } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const params = [...new URLSearchParams(await req.text()).entries()];
  const get = (k: string) => params.find(([key]) => key === k)?.[1] ?? "";

  // First call after registration: FreshBooks sends a verifier we must echo back.
  if (get("verifier")) {
    const m = await merchantByCallbackId(get("object_id"));
    if (!m) return Response.json({ error: "Unknown callback" }, { status: 403 });
    const s = storeFor(m);
    if (!(await s.setVerifier(get("object_id"), get("verifier")))) return Response.json({ error: "Already verified" }, { status: 403 });
    await confirmCallback(s, oauthApp(), m.fbAccountId!, get("object_id"), get("verifier"));
    return Response.json({ status: "verified" });
  }

  const m = await merchantByFbAccount(get("account_id"));
  if (!m) return Response.json({ status: "ignored", reason: "No merchant for this account" });
  const s = storeFor(m);
  const signature = req.headers.get("x-freshbooks-hmac-sha256") ?? "";
  const verifiers = await s.verifiersFor(get("name"));
  if (!verifiers.some((v) => safeEqual(webhookSignature(params, v), signature)))
    return Response.json({ error: "Bad signature" }, { status: 401 });
  if (m.status !== "active") return Response.json({ status: "ignored", reason: `Merchant is ${m.status}` });

  // A failure returns 500 so FreshBooks retries. Every step is safe to repeat.
  try {
    return Response.json(await syncInvoice(depsFor(m), get("object_id")));
  } catch (err) {
    if (err instanceof MerchantNotReady) return Response.json({ status: "ignored", reason: err.message });
    await s.log("error", "Could not process FreshBooks invoice event", { fbInvoiceId: get("object_id"), event: get("name"), error: String(err) });
    throw err;
  }
}
