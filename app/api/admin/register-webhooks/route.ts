import { appUrl, env } from "@/lib/config";
import { oauthApp, store } from "@/lib/deps";
import { registerCallback, WEBHOOK_EVENTS } from "@/lib/freshbooks";
import { denied, isAdmin } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Run once after connecting FreshBooks. FreshBooks then calls our webhook to verify each one.
export async function POST(req: Request) {
  if (!isAdmin(req)) return denied();
  const s = store();
  const uri = `${appUrl()}/api/freshbooks/webhook`;
  const registered: Record<string, string> = {};
  for (const event of WEBHOOK_EVENTS)
    registered[event] = await registerCallback(s, oauthApp(), env("FRESHBOOKS_ACCOUNT_ID"), event, uri);
  return Response.json({ status: "registered", uri, registered });
}
