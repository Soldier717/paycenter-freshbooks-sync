import { appUrl } from "./config";
import { sign } from "./crypto";
import { oauthApp, quickBooksApp, storeFor } from "./deps";
import { AUTHORIZE_URL as FB_AUTHORIZE_URL, registerCallback, SCOPES as FB_SCOPES, WEBHOOK_EVENTS } from "./freshbooks";
import { AUTHORIZE_URL as QB_AUTHORIZE_URL, SCOPES as QB_SCOPES } from "./quickbooks";
import { Merchant } from "./types";

/** Registers the four invoice webhooks for a FreshBooks merchant. FreshBooks verifies each one by calling us back. */
export async function registerWebhooks(m: Merchant): Promise<Record<string, string>> {
  if (m.accounting !== "freshbooks") throw new Error("QuickBooks webhooks are set once for the whole app in the Intuit developer portal");
  if (!m.acctAccountId) throw new Error("FreshBooks is not connected yet");
  const s = storeFor(m);
  const uri = `${appUrl()}/api/freshbooks/webhook`;
  const out: Record<string, string> = {};
  for (const event of WEBHOOK_EVENTS) out[event] = await registerCallback(s, oauthApp(), m.acctAccountId, event, uri);
  await s.log("info", "Registered FreshBooks webhooks", out);
  return out;
}

/** The accounting system's approval URL. `who` decides where the person lands afterwards. */
export function authorizeUrl(m: Merchant, who: "admin" | "merchant"): string {
  const state = sign({ m: m.id, who }, 10 * 60 * 1000);
  if (m.accounting === "quickbooks") {
    const app = quickBooksApp(m.qbEnv);
    const q = new URLSearchParams({ client_id: app.clientId, response_type: "code", scope: QB_SCOPES, redirect_uri: app.redirectUri, state });
    return `${QB_AUTHORIZE_URL}?${q}`;
  }
  const app = oauthApp();
  const q = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: app.redirectUri, scope: FB_SCOPES, state });
  return `${FB_AUTHORIZE_URL}?${q}`;
}

export const connectUrl = (token: string) => `${appUrl()}/connect/${token}`;
