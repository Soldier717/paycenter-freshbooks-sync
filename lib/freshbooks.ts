import { createHmac, timingSafeEqual } from "node:crypto";
import { FbClientInfo, FbInvoice, FbTokens, FreshBooksApi, ProviderError, Store } from "./types";

const API = "https://api.freshbooks.com";
export const AUTHORIZE_URL = "https://auth.freshbooks.com/oauth/authorize";
export const SCOPES = "user:profile:read user:invoices:read user:clients:read user:payments:read user:payments:write";
export const WEBHOOK_EVENTS = ["invoice.create", "invoice.update", "invoice.sendByEmail", "invoice.delete"];

export interface OAuthApp { clientId: string; clientSecret: string; redirectUri: string }

async function raw(method: string, url: string, token: string | null, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ProviderError("FreshBooks did not respond", false);
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, res.status >= 400 && res.status < 500, res.status);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError("FreshBooks returned an unreadable response", false);
  }
}

export async function requestTokens(app: OAuthApp, grant: Record<string, string>): Promise<FbTokens> {
  const r = await raw("POST", `${API}/auth/oauth/token`, null, {
    ...grant, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri,
  });
  if (!r.access_token || !r.refresh_token) throw new ProviderError("OAuth response missing tokens", true);
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + (Number(r.expires_in ?? 300) - 60) * 1000,
  };
}

/** FreshBooks refresh tokens are single use, so the new pair is saved before it is used. */
export async function accessToken(store: Store, app: OAuthApp): Promise<string> {
  const t = await store.getTokens();
  if (!t) throw new Error("FreshBooks is not connected yet. Run the OAuth setup step.");
  if (t.expiresAt > Date.now()) return t.accessToken;
  const fresh = await requestTokens(app, { grant_type: "refresh_token", refresh_token: t.refreshToken });
  await store.saveTokens(fresh);
  return fresh.accessToken;
}

/** Account ids the signed-in FreshBooks user can reach. */
export async function listAccountIds(token: string): Promise<string[]> {
  const me = await raw("GET", `${API}/auth/api/v1/users/me`, token);
  const memberships: any[] = me?.response?.business_memberships ?? [];
  return memberships.map((m) => String(m?.business?.account_id)).filter((id) => id && id !== "undefined");
}

export function freshBooks(store: Store, app: OAuthApp, accountId: string): FreshBooksApi {
  const base = `${API}/accounting/account/${encodeURIComponent(accountId)}`;
  const call = async (method: string, path: string, body?: unknown) =>
    (await raw(method, base + path, await accessToken(store, app), body))?.response?.result ?? {};

  return {
    accountId,
    async getInvoice(id) {
      const inv = (await call("GET", `/invoices/invoices/${encodeURIComponent(id)}`)).invoice as FbInvoice;
      if (!inv) throw new ProviderError("FreshBooks returned no invoice", false);
      return { ...inv, invoiceid: inv.invoiceid ?? inv.id! };
    },
    async getClient(id) {
      return ((await call("GET", `/users/clients/${encodeURIComponent(id)}`)).client ?? {}) as FbClientInfo;
    },
    async createPayment(body) {
      const p = (await call("POST", "/payments/payments", { payment: body })).payment;
      const id = p?.id ?? p?.logid;
      if (!id) throw new ProviderError("FreshBooks returned no payment id", false);
      return { id: String(id) };
    },
    async updatePaymentAmount(id, amount) {
      await call("PUT", `/payments/payments/${encodeURIComponent(id)}`, { payment: { amount } });
    },
    async deletePayment(id) {
      await call("PUT", `/payments/payments/${encodeURIComponent(id)}`, { payment: { vis_state: 1 } });
    },
  };
}

export async function registerCallback(store: Store, app: OAuthApp, accountId: string, event: string, uri: string) {
  const token = await accessToken(store, app);
  const r = await raw("POST", `${API}/events/account/${encodeURIComponent(accountId)}/events/callbacks`, token, {
    callback: { event, uri },
  });
  const id = r?.response?.result?.callback?.callbackid;
  if (!id) throw new ProviderError("FreshBooks returned no callback id", false);
  await store.saveCallback(String(id), event);
  return String(id);
}

export async function confirmCallback(store: Store, app: OAuthApp, accountId: string, callbackId: string, verifier: string) {
  const token = await accessToken(store, app);
  await raw("PUT", `${API}/events/account/${encodeURIComponent(accountId)}/events/callbacks/${encodeURIComponent(callbackId)}`, token, {
    callback: { verifier },
  });
}

/**
 * FreshBooks signs the form fields as a Python-style JSON string
 * ({"key": "value", "key2": "value"}), HMAC-SHA256 with the callback's verifier, base64.
 */
export function webhookSignature(params: [string, string][], verifier: string): string {
  const ascii = (s: string) => JSON.stringify(s).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const message = "{" + params.map(([k, v]) => `${ascii(k)}: ${ascii(v)}`).join(", ") + "}";
  return createHmac("sha256", verifier).update(message, "utf8").digest("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
