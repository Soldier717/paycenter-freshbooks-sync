import { createHmac, timingSafeEqual } from "node:crypto";
import { toCents, toDecimal } from "./money";
import { AccountingApi, AcctInvoice, OAuthTokens, ProviderError, Store } from "./types";

/** FreshBooks' own invoice shape (the fields this service reads). */
interface FbInvoice {
  id?: number;
  invoiceid: number;
  invoice_number: string;
  v3_status: string;
  vis_state: number;
  amount: { amount: string; code: string };
  outstanding: { amount: string; code: string };
  due_date: string;
  customerid?: number;
}
interface FbClientInfo { fname?: string; lname?: string; email?: string; mob_phone?: string }

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

export async function requestTokens(app: OAuthApp, grant: Record<string, string>): Promise<OAuthTokens> {
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

/** Accounts the signed-in FreshBooks user can reach. */
export async function listAccounts(token: string): Promise<{ accountId: string; name: string }[]> {
  const me = await raw("GET", `${API}/auth/api/v1/users/me`, token);
  const memberships: any[] = me?.response?.business_memberships ?? [];
  return memberships
    .map((m) => ({ accountId: String(m?.business?.account_id ?? ""), name: String(m?.business?.name ?? "") }))
    .filter((a) => a.accountId);
}

export function freshBooks(store: Store, app: OAuthApp, accountId: string): AccountingApi {
  const base = `${API}/accounting/account/${encodeURIComponent(accountId)}`;
  const call = async (method: string, path: string, body?: unknown) =>
    (await raw(method, base + path, await accessToken(store, app), body))?.response?.result ?? {};

  const toAcct = (inv: FbInvoice): AcctInvoice => ({
    id: String(inv.invoiceid),
    number: String(inv.invoice_number),
    currency: inv.amount.code,
    totalCents: toCents(inv.amount.amount),
    balanceCents: toCents(inv.outstanding.amount),
    dueDate: String(inv.due_date).slice(0, 10),
    customerId: inv.customerid ? String(inv.customerid) : null,
    deleted: inv.vis_state !== 0,
    sendable: ["sent", "viewed", "overdue"].includes(inv.v3_status),
    status: inv.v3_status,
  });

  return {
    kind: "freshbooks",
    accountId,
    async getInvoice(id) {
      const inv = (await call("GET", `/invoices/invoices/${encodeURIComponent(id)}`)).invoice as FbInvoice;
      if (!inv) throw new ProviderError("FreshBooks returned no invoice", false);
      return toAcct({ ...inv, invoiceid: inv.invoiceid ?? inv.id! });
    },
    async getCustomer(id) {
      const c = ((await call("GET", `/users/clients/${encodeURIComponent(id)}`)).client ?? {}) as FbClientInfo;
      return { firstName: c.fname, lastName: c.lname, email: c.email, mobilePhone: c.mob_phone };
    },
    async createPayment(input) {
      const p = (await call("POST", "/payments/payments", {
        payment: {
          invoiceid: Number(input.invoiceId),
          amount: { amount: toDecimal(input.cents), code: "USD" },
          date: input.date,
          type: "Other",
          note: input.note,
          send_client_notification: false,
        },
      })).payment;
      const id = p?.id ?? p?.logid;
      if (!id) throw new ProviderError("FreshBooks returned no payment id", false);
      return { id: String(id) };
    },
    async updatePaymentAmount(id, cents) {
      await call("PUT", `/payments/payments/${encodeURIComponent(id)}`, { payment: { amount: { amount: toDecimal(cents), code: "USD" } } });
    },
    async deletePayment(id) {
      await call("PUT", `/payments/payments/${encodeURIComponent(id)}`, { payment: { vis_state: 1 } });
    },
    // Fee booking is not offered for FreshBooks yet (it would be an Other Income entry).
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
