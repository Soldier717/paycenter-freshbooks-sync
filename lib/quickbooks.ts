import { createHmac, timingSafeEqual } from "node:crypto";
import { toCents, toDecimal } from "./money";
import { AccountingApi, AcctInvoice, OAuthTokens, ProviderError, Store } from "./types";

/**
 * QuickBooks Online (Intuit) adapter.
 *
 * One Intuit app, owned by PBS, has two key sets: Development (sandbox companies) and Production
 * (real companies). A merchant row says which one it uses. Webhooks are configured once per key set in
 * the Intuit developer portal, pointed at /api/quickbooks/webhook; Intuit signs each delivery with the
 * verifier token shown there.
 */
export type QbEnv = "production" | "sandbox";

export const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const SCOPES = "com.intuit.quickbooks.accounting";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR_VERSION = "75";

export interface QbApp { env: QbEnv; clientId: string; clientSecret: string; redirectUri: string; webhookVerifier: string | null }

const API_BASE: Record<QbEnv, string> = {
  production: "https://quickbooks.api.intuit.com",
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
};

/** The QuickBooks keys for an environment, from QUICKBOOKS_* (production) or QUICKBOOKS_SANDBOX_* env vars. */
export function qbApp(env: QbEnv, redirectUri: string): QbApp {
  const prefix = env === "sandbox" ? "QUICKBOOKS_SANDBOX_" : "QUICKBOOKS_";
  const clientId = process.env[`${prefix}CLIENT_ID`];
  const clientSecret = process.env[`${prefix}CLIENT_SECRET`];
  if (!clientId || !clientSecret) throw new Error(`Missing configuration: ${prefix}CLIENT_ID / ${prefix}CLIENT_SECRET`);
  return { env, clientId, clientSecret, redirectUri, webhookVerifier: process.env[`${prefix}WEBHOOK_VERIFIER`] ?? null };
}

export function qbConfigured(env: QbEnv): boolean {
  const prefix = env === "sandbox" ? "QUICKBOOKS_SANDBOX_" : "QUICKBOOKS_";
  return !!process.env[`${prefix}CLIENT_ID`] && !!process.env[`${prefix}CLIENT_SECRET`];
}

interface QbFault { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[]; type?: string } }

async function raw(method: string, url: string, headers: Record<string, string>, body?: string): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new ProviderError("QuickBooks did not respond", false);
  }
  const text = await res.text();
  // Intuit's request id. Their support asks for it when troubleshooting, so every error carries it.
  const tid = res.headers.get("intuit_tid");
  let json: any = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (!res.ok) {
    const fault = (json as QbFault)?.Fault?.Error?.[0];
    const msg = fault ? `${fault.Message ?? "error"}${fault.Detail ? `: ${fault.Detail}` : ""} (code ${fault.code ?? res.status})` : `HTTP ${res.status}`;
    const err = new ProviderError(`QuickBooks ${msg}${tid ? ` [intuit_tid ${tid}]` : ""}`, res.status >= 400 && res.status < 500, res.status);
    (err as any).qbCode = fault?.code;
    (err as any).intuitTid = tid;
    throw err;
  }
  if (json === null) throw new ProviderError("QuickBooks returned an unreadable response", false);
  return { status: res.status, json };
}

export async function requestTokens(app: QbApp, grant: Record<string, string>): Promise<OAuthTokens> {
  const auth = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
  const form = new URLSearchParams(grant);
  if (grant.grant_type === "authorization_code") form.set("redirect_uri", app.redirectUri);
  const { json: r } = await raw("POST", TOKEN_URL, {
    Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
  }, form.toString());
  if (!r.access_token || !r.refresh_token) throw new ProviderError("OAuth response missing tokens", true);
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + (Number(r.expires_in ?? 3600) - 60) * 1000,
    refreshExpiresAt: Date.now() + Number(r.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
  };
}

/** Intuit may rotate the refresh token on every refresh, so the new pair is saved before it is used. */
export async function accessToken(store: Store, app: QbApp, force = false): Promise<string> {
  const t = await store.getTokens();
  if (!t) throw new Error("QuickBooks is not connected yet. Run the connect step.");
  if (!force && t.expiresAt > Date.now()) return t.accessToken;
  if (t.refreshExpiresAt && t.refreshExpiresAt < Date.now())
    throw new ProviderError("QuickBooks access has expired (refresh token older than 100 days); the merchant must connect again", true, 401);
  const fresh = await requestTokens(app, { grant_type: "refresh_token", refresh_token: t.refreshToken });
  await store.saveTokens(fresh);
  return fresh.accessToken;
}

export interface QbClient {
  get(path: string, query?: Record<string, string>): Promise<any>;
  post(path: string, body: unknown, query?: Record<string, string>): Promise<any>;
  query(sql: string): Promise<any>;
}

export function qbClient(store: Store, app: QbApp, realmId: string): QbClient {
  const base = `${API_BASE[app.env]}/v3/company/${encodeURIComponent(realmId)}`;

  async function call(method: string, path: string, query: Record<string, string>, body?: unknown): Promise<any> {
    const q = new URLSearchParams({ ...query, minorversion: MINOR_VERSION });
    const url = `${base}${path}?${q}`;
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    });
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    try {
      return (await raw(method, url, headers(await accessToken(store, app)), payload)).json;
    } catch (err) {
      // A token can be rejected before its clock-based expiry; refresh once and retry.
      if (err instanceof ProviderError && err.status === 401) {
        return (await raw(method, url, headers(await accessToken(store, app, true)), payload)).json;
      }
      throw err;
    }
  }

  return {
    get: (path, query = {}) => call("GET", path, query),
    post: (path, body, query = {}) => call("POST", path, query, body),
    query: (sql) => call("GET", "/query", { query: sql }),
  };
}

export interface QbOptions {
  /** Which invoices get a payment request: any open invoice, or only ones emailed from QuickBooks. */
  trigger: "open" | "sent";
  depositAccountId: string | null;
  /** Service item whose income account receives the customer fee. Enables createFee. */
  feeItemId: string | null;
}

interface QbInvoice {
  Id: string; SyncToken: string; DocNumber?: string; DueDate?: string; TxnDate?: string;
  TotalAmt: number; Balance: number; CurrencyRef?: { value: string }; CustomerRef?: { value: string; name?: string };
  EmailStatus?: string; PrivateNote?: string; BillEmail?: { Address?: string };
}

const isNotFound = (err: unknown) => err instanceof ProviderError && (err as any).qbCode === "610";
const money = (n: unknown) => toCents(Number(n ?? 0).toFixed(2));

export function quickBooks(store: Store, app: QbApp, realmId: string, opts: QbOptions): AccountingApi {
  const qb = qbClient(store, app, realmId);

  const toAcct = (inv: QbInvoice): AcctInvoice => {
    const total = money(inv.TotalAmt);
    const voided = total === 0 && /voided/i.test(inv.PrivateNote ?? "");
    return {
      id: String(inv.Id),
      number: String(inv.DocNumber ?? inv.Id),
      currency: inv.CurrencyRef?.value ?? "USD",
      totalCents: total,
      balanceCents: money(inv.Balance),
      dueDate: String(inv.DueDate ?? inv.TxnDate ?? "").slice(0, 10),
      customerId: inv.CustomerRef?.value ? String(inv.CustomerRef.value) : null,
      deleted: voided,
      sendable: opts.trigger === "open" ? true : inv.EmailStatus === "EmailSent",
      status: voided ? "voided" : inv.EmailStatus === "EmailSent" ? "sent" : money(inv.Balance) === 0 ? "paid" : "not yet emailed",
    };
  };

  const deposit = () => (opts.depositAccountId ? { DepositToAccountRef: { value: opts.depositAccountId } } : {});

  async function getPaymentRaw(id: string) {
    const p = (await qb.get(`/payment/${encodeURIComponent(id)}`)).Payment;
    if (!p) throw new ProviderError("QuickBooks returned no payment", false);
    return p;
  }

  const api: AccountingApi = {
    kind: "quickbooks",
    accountId: realmId,
    async getInvoice(id) {
      try {
        const inv = (await qb.get(`/invoice/${encodeURIComponent(id)}`)).Invoice as QbInvoice;
        if (!inv) throw new ProviderError("QuickBooks returned no invoice", false);
        return toAcct(inv);
      } catch (err) {
        if (!isNotFound(err)) throw err;
        return { id: String(id), number: String(id), currency: "USD", totalCents: 0, balanceCents: 0, dueDate: "", customerId: null, deleted: true, sendable: false, status: "deleted" };
      }
    },
    async getCustomer(id) {
      const c = (await qb.get(`/customer/${encodeURIComponent(id)}`)).Customer ?? {};
      const [first, ...rest] = String(c.DisplayName ?? "").split(" ");
      return {
        firstName: c.GivenName || first || "",
        lastName: c.FamilyName || rest.join(" ") || "",
        email: c.PrimaryEmailAddr?.Address || undefined,
        mobilePhone: c.Mobile?.FreeFormNumber || undefined,
      };
    },
    async createPayment(input) {
      const amount = Number(toDecimal(input.cents));
      const body: Record<string, unknown> = {
        TotalAmt: amount,
        TxnDate: input.date,
        PrivateNote: input.note,
        Line: [{ Amount: amount, LinkedTxn: [{ TxnId: input.invoiceId, TxnType: "Invoice" }] }],
        ...deposit(),
      };
      if (input.customerId) body.CustomerRef = { value: input.customerId };
      const p = (await qb.post("/payment", body)).Payment;
      if (!p?.Id) throw new ProviderError("QuickBooks returned no payment id", false);
      return { id: String(p.Id) };
    },
    async updatePaymentAmount(id, cents) {
      const cur = await getPaymentRaw(id);
      const amount = Number(toDecimal(cents));
      const lines = (cur.Line ?? []).map((l: any) => ({ Amount: amount, LinkedTxn: l.LinkedTxn }));
      await qb.post("/payment", { Id: cur.Id, SyncToken: cur.SyncToken, sparse: true, TotalAmt: amount, Line: lines.length ? lines : undefined });
    },
    async deletePayment(id) {
      const cur = await getPaymentRaw(id);
      await qb.post("/payment", { Id: cur.Id, SyncToken: cur.SyncToken }, { operation: "delete" });
    },
  };

  if (opts.feeItemId) {
    // The fee is a sales receipt on the fee item, deposited to the same account as the payment, so the
    // bookkeeper's bank deposit screen shows both next to each other.
    api.createFee = async (input) => {
      const amount = Number(toDecimal(input.cents));
      const body: Record<string, unknown> = {
        TxnDate: input.date,
        PrivateNote: input.note,
        DocNumber: `FEE-${input.invoiceNumber}`.slice(0, 21),
        Line: [{
          DetailType: "SalesItemLineDetail", Amount: amount, Description: input.note,
          SalesItemLineDetail: { ItemRef: { value: opts.feeItemId }, Qty: 1, UnitPrice: amount },
        }],
        ...deposit(),
      };
      if (input.customerId) body.CustomerRef = { value: input.customerId };
      const r = (await qb.post("/salesreceipt", body)).SalesReceipt;
      if (!r?.Id) throw new ProviderError("QuickBooks returned no sales receipt id", false);
      return { id: String(r.Id) };
    };
    api.deleteFee = async (id) => {
      const cur = (await qb.get(`/salesreceipt/${encodeURIComponent(id)}`)).SalesReceipt;
      if (!cur) return;
      await qb.post("/salesreceipt", { Id: cur.Id, SyncToken: cur.SyncToken }, { operation: "delete" });
    };
  }
  return api;
}

// ---- Setup helpers (admin pages) ----

export interface QbAccount { id: string; name: string; type: string; subType: string }
export interface QbItem { id: string; name: string; incomeAccount: string | null }

export async function companyName(qb: QbClient, realmId: string): Promise<string> {
  const c = (await qb.get(`/companyinfo/${encodeURIComponent(realmId)}`)).CompanyInfo;
  return String(c?.CompanyName ?? "");
}

/** Accounts a payment can be deposited to: bank accounts and Undeposited Funds. */
export async function depositAccounts(qb: QbClient): Promise<QbAccount[]> {
  const r = await qb.query("select Id, Name, AccountType, AccountSubType from Account where Active = true maxresults 1000");
  return ((r.QueryResponse?.Account ?? []) as any[])
    .filter((a) => a.AccountType === "Bank" || a.AccountSubType === "UndepositedFunds")
    .map((a) => ({ id: String(a.Id), name: String(a.Name), type: String(a.AccountType), subType: String(a.AccountSubType ?? "") }))
    .sort((a, b) => (a.subType === "UndepositedFunds" ? -1 : b.subType === "UndepositedFunds" ? 1 : a.name.localeCompare(b.name)));
}

export async function incomeAccounts(qb: QbClient): Promise<QbAccount[]> {
  const r = await qb.query("select Id, Name, AccountType, AccountSubType from Account where AccountType = 'Income' and Active = true maxresults 1000");
  return ((r.QueryResponse?.Account ?? []) as any[])
    .map((a) => ({ id: String(a.Id), name: String(a.Name), type: String(a.AccountType), subType: String(a.AccountSubType ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Service items; the fee item is one of these. */
export async function serviceItems(qb: QbClient): Promise<QbItem[]> {
  const r = await qb.query("select Id, Name, Type, IncomeAccountRef from Item where Type = 'Service' and Active = true maxresults 1000");
  return ((r.QueryResponse?.Item ?? []) as any[])
    .map((i) => ({ id: String(i.Id), name: String(i.Name), incomeAccount: i.IncomeAccountRef?.name ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Creates the fee item, and the income account it posts to when none is given. Idempotent by name:
 * an existing item or account with the same name is reused.
 */
export async function ensureFeeItem(qb: QbClient, itemName = "Card Processing Fee", accountName = "Card Processing Fee Income", incomeAccountId?: string): Promise<{ itemId: string; accountId: string; created: string[] }> {
  const created: string[] = [];
  const esc = (s: string) => s.replace(/'/g, "\\'");
  const existingItem = (await qb.query(`select Id, IncomeAccountRef from Item where Name = '${esc(itemName)}'`)).QueryResponse?.Item?.[0];
  if (existingItem) return { itemId: String(existingItem.Id), accountId: String(existingItem.IncomeAccountRef?.value ?? ""), created };

  let accountId = incomeAccountId;
  if (!accountId) {
    const existing = (await qb.query(`select Id from Account where Name = '${esc(accountName)}'`)).QueryResponse?.Account?.[0];
    if (existing) accountId = String(existing.Id);
    else {
      const a = (await qb.post("/account", { Name: accountName, AccountType: "Income", AccountSubType: "ServiceFeeIncome" })).Account;
      if (!a?.Id) throw new ProviderError("QuickBooks returned no account id", false);
      accountId = String(a.Id);
      created.push(`income account "${accountName}"`);
    }
  }
  const item = (await qb.post("/item", { Name: itemName, Type: "Service", IncomeAccountRef: { value: accountId }, Taxable: false })).Item;
  if (!item?.Id) throw new ProviderError("QuickBooks returned no item id", false);
  created.push(`service item "${itemName}"`);
  return { itemId: String(item.Id), accountId: accountId!, created };
}

// ---- Webhooks ----

export interface QbEvent { realmId: string; entity: string; id: string; operation: string }

/** Intuit signs the raw body: base64(HMAC-SHA256(verifier, body)) in the intuit-signature header. */
export function verifyWebhook(rawBody: string, signature: string | null, verifier: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", verifier).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseEvents(body: any): QbEvent[] {
  const out: QbEvent[] = [];
  for (const n of body?.eventNotifications ?? []) {
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      if (n?.realmId && e?.name && e?.id) out.push({ realmId: String(n.realmId), entity: String(e.name), id: String(e.id), operation: String(e.operation ?? "") });
    }
  }
  return out;
}
