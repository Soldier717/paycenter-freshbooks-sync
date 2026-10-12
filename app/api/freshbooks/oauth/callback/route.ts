import { env } from "@/lib/config";
import { oauthApp, store } from "@/lib/deps";
import { listAccountIds, requestTokens, safeEqual } from "@/lib/freshbooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const given = url.searchParams.get("state") ?? "";
  const s = store();
  const saved = JSON.parse((await s.getKv("oauth_state")) ?? "null");
  if (!code || !saved || saved.expires < Date.now() || !safeEqual(given, saved.state))
    return Response.json({ error: "Sign-in link expired or invalid. Start again." }, { status: 400 });
  await s.setKv("oauth_state", "null");

  const tokens = await requestTokens(oauthApp(), { grant_type: "authorization_code", code });
  // Refuse to connect to any FreshBooks account other than the one configured.
  const accounts = await listAccountIds(tokens.accessToken);
  if (!accounts.includes(env("FRESHBOOKS_ACCOUNT_ID")))
    return Response.json({ error: "That login does not have the configured FreshBooks account.", accountsOnThisLogin: accounts }, { status: 403 });

  await s.saveTokens(tokens);
  await s.log("info", "FreshBooks connected");
  return Response.json({ status: "connected", next: "POST /api/admin/register-webhooks" });
}
