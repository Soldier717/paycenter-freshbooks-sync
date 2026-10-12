import { env } from "@/lib/config";
import { deps, oauthApp } from "@/lib/deps";
import { confirmCallback, safeEqual, webhookSignature } from "@/lib/freshbooks";
import { syncInvoice } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const params = [...new URLSearchParams(await req.text()).entries()];
  const get = (k: string) => params.find(([key]) => key === k)?.[1] ?? "";
  const d = deps();

  // First call after registration: FreshBooks sends a verifier we must echo back.
  if (get("verifier")) {
    const accepted = await d.store.setVerifier(get("object_id"), get("verifier"));
    if (!accepted) return Response.json({ error: "Unknown callback" }, { status: 403 });
    await confirmCallback(d.store, oauthApp(), env("FRESHBOOKS_ACCOUNT_ID"), get("object_id"), get("verifier"));
    return Response.json({ status: "verified" });
  }

  const signature = req.headers.get("x-freshbooks-hmac-sha256") ?? "";
  const verifiers = await d.store.verifiersFor(get("name"));
  if (!verifiers.some((v) => safeEqual(webhookSignature(params, v), signature)))
    return Response.json({ error: "Bad signature" }, { status: 401 });
  if (get("account_id") !== env("FRESHBOOKS_ACCOUNT_ID")) return Response.json({ status: "ignored" });

  // A failure returns 500 so FreshBooks retries. Every step is safe to repeat.
  const result = await syncInvoice(d, get("object_id"));
  return Response.json(result);
}
