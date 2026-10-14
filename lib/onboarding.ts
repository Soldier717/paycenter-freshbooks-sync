import { appUrl } from "./config";
import { sign } from "./crypto";
import { oauthApp, storeFor } from "./deps";
import { AUTHORIZE_URL, registerCallback, SCOPES, WEBHOOK_EVENTS } from "./freshbooks";
import { Merchant } from "./types";

/** Registers the four invoice webhooks for a merchant. FreshBooks verifies each one by calling us back. */
export async function registerWebhooks(m: Merchant): Promise<Record<string, string>> {
  if (!m.fbAccountId) throw new Error("FreshBooks is not connected yet");
  const s = storeFor(m);
  const uri = `${appUrl()}/api/freshbooks/webhook`;
  const out: Record<string, string> = {};
  for (const event of WEBHOOK_EVENTS) out[event] = await registerCallback(s, oauthApp(), m.fbAccountId, event, uri);
  await s.log("info", "Registered FreshBooks webhooks", out);
  return out;
}

/** The FreshBooks approval URL. `who` decides where the person lands afterwards. */
export function authorizeUrl(m: Merchant, who: "admin" | "merchant"): string {
  const app = oauthApp();
  const state = sign({ m: m.id, who }, 10 * 60 * 1000);
  const q = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: app.redirectUri, scope: SCOPES, state });
  return `${AUTHORIZE_URL}?${q}`;
}

export const connectUrl = (token: string) => `${appUrl()}/connect/${token}`;
