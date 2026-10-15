import { appUrl, env } from "./config";
import { freshBooks, OAuthApp } from "./freshbooks";
import { payCenter } from "./paycenter";
import { agencyTokenFor } from "./paycenter-agency";
import { qbApp, qbClient, QbApp, quickBooks } from "./quickbooks";
import { merchantStore } from "./store";
import { AccountingApi, Deps, Merchant, Store, SyncSettings } from "./types";

/** PBS owns one FreshBooks developer app; every merchant approves it on their own account. */
export function oauthApp(): OAuthApp {
  return {
    clientId: env("FRESHBOOKS_CLIENT_ID"),
    clientSecret: env("FRESHBOOKS_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/freshbooks/oauth/callback`,
  };
}

/** PBS owns one Intuit app; its production or sandbox keys depending on the merchant. */
export function quickBooksApp(envName: Merchant["qbEnv"]): QbApp {
  return qbApp(envName, `${appUrl()}/api/quickbooks/oauth/callback`);
}

export function storeFor(m: Merchant): Store {
  return merchantStore(m.id);
}

export function settingsFor(m: Merchant): SyncSettings {
  return {
    notifyMode: m.notifyMode,
    recordOn: m.recordOn,
    reversals: m.reversals,
    bookFees: m.bookFees,
    webhookUrl: `${appUrl()}/api/paycenter/webhook/${m.pcWebhookSecret}`,
  };
}

export const systemName = (m: Pick<Merchant, "accounting">) => (m.accounting === "quickbooks" ? "QuickBooks" : "FreshBooks");

export class MerchantNotReady extends Error {}

/** A merchant's own site token wins; otherwise the agency token covers any site under the PBS agency. */
export function pcTokenFor(m: Merchant): string | null {
  return m.pcAccessToken ?? agencyTokenFor(m.pcBaseUrl);
}

export function accountingFor(m: Merchant): AccountingApi {
  if (!m.acctAccountId) throw new MerchantNotReady(`${m.name}: ${systemName(m)} is not connected yet`);
  const s = storeFor(m);
  if (m.accounting === "quickbooks")
    return quickBooks(s, quickBooksApp(m.qbEnv), m.acctAccountId, {
      trigger: m.qbTrigger, depositAccountId: m.qbDepositAccountId, feeItemId: m.bookFees ? m.qbFeeItemId : null,
    });
  return freshBooks(s, oauthApp(), m.acctAccountId);
}

/** Raw QuickBooks client for setup pages (account lists, fee item creation). */
export function quickBooksClientFor(m: Merchant) {
  if (!m.acctAccountId) throw new MerchantNotReady(`${m.name}: QuickBooks is not connected yet`);
  return qbClient(storeFor(m), quickBooksApp(m.qbEnv), m.acctAccountId);
}

export function depsFor(m: Merchant): Deps {
  const acct = accountingFor(m);
  const token = pcTokenFor(m);
  if (!token) throw new MerchantNotReady(`${m.name}: Pay Center token is missing`);
  return {
    store: storeFor(m),
    acct,
    pc: payCenter(m.pcBaseUrl, m.pcSiteId, token),
    settings: settingsFor(m),
  };
}
