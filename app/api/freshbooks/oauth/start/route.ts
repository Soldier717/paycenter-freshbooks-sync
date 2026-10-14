import { hasAdminCookie, isAdminSecret } from "@/lib/guard";
import { getMerchant, merchantByConnectToken } from "@/lib/merchants";
import { authorizeUrl } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// Admin:    /api/freshbooks/oauth/start?merchant=<id>          (admin cookie or ?key=)
// Merchant: /api/freshbooks/oauth/start?connect=<connect token>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const connect = url.searchParams.get("connect");
  if (connect) {
    const m = await merchantByConnectToken(connect);
    if (!m) return Response.json({ error: "This connect link has expired. Ask for a new one." }, { status: 404 });
    return Response.redirect(authorizeUrl(m, "merchant"), 302);
  }
  if (!(await hasAdminCookie()) && !isAdminSecret(url.searchParams.get("key"))) return Response.json({ error: "Not authorized" }, { status: 401 });
  const m = await getMerchant(url.searchParams.get("merchant") ?? "");
  if (!m) return Response.json({ error: "Unknown merchant" }, { status: 404 });
  return Response.redirect(authorizeUrl(m, "admin"), 302);
}
