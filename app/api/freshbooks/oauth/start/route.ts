import { randomBytes } from "node:crypto";
import { oauthApp, store } from "@/lib/deps";
import { AUTHORIZE_URL, SCOPES } from "@/lib/freshbooks";
import { denied, isAdmin } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Open in a browser: /api/freshbooks/oauth/start?key=ADMIN_SECRET
export async function GET(req: Request) {
  if (!isAdmin(req)) return denied();
  const app = oauthApp();
  const state = randomBytes(24).toString("base64url");
  await store().setKv("oauth_state", JSON.stringify({ state, expires: Date.now() + 10 * 60 * 1000 }));
  const q = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: app.redirectUri, scope: SCOPES, state });
  return Response.redirect(`${AUTHORIZE_URL}?${q}`, 302);
}
