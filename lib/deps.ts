import { appUrl, env } from "./config";
import { freshBooks, OAuthApp } from "./freshbooks";
import { payCenter } from "./paycenter";
import { merchantStore } from "./store";
import { Deps, Merchant, Store, SyncSettings } from "./types";

/** PBS owns one FreshBooks developer app; every merchant approves it on their own account. */
export function oauthApp(): OAuthApp {
  return {
    clientId: env("FRESHBOOKS_CLIENT_ID"),
    clientSecret: env("FRESHBOOKS_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/freshbooks/oauth/callback`,
  };
}

export function storeFor(m: Merchant): Store {
  return merchantStore(m.id);
}

export function settingsFor(m: Merchant): SyncSettings {
  return {
    notifyMode: m.notifyMode,
    recordOn: m.recordOn,
    reversals: m.reversals,
    webhookUrl: `${appUrl()}/api/paycenter/webhook/${m.pcWebhookSecret}`,
  };
}

export class MerchantNotReady extends Error {}

export function depsFor(m: Merchant): Deps {
  if (!m.fbAccountId) throw new MerchantNotReady(`${m.name}: FreshBooks is not connected yet`);
  if (!m.pcAccessToken) throw new MerchantNotReady(`${m.name}: Pay Center token is missing`);
  const s = storeFor(m);
  return {
    store: s,
    fb: freshBooks(s, oauthApp(), m.fbAccountId),
    pc: payCenter(m.pcBaseUrl, m.pcSiteId, m.pcAccessToken),
    settings: settingsFor(m),
  };
}
