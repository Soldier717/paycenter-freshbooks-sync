import { ProviderError } from "./types";

/**
 * MX Merchant Checkout API (Priority). One consumer key/secret per environment (sandbox or
 * production) covers every merchant the key can see; each payment names its `merchantId`.
 *
 * Card data never passes through this server: the browser gets a one-time limited-use token
 * and posts the card straight to MX. This module only ever handles payment ids, amounts and
 * statuses.
 *
 * Docs: https://developer.mxmerchant.com (Checkout API v3).
 */

export interface MxConfig { baseUrl: string; consumerKey: string; consumerSecret: string }

export function mxConfig(): MxConfig | null {
  const baseUrl = process.env.MX_BASE_URL, consumerKey = process.env.MX_CONSUMER_KEY, consumerSecret = process.env.MX_CONSUMER_SECRET;
  if (!baseUrl || !consumerKey || !consumerSecret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), consumerKey, consumerSecret };
}

export const mxEnvName = (cfg: MxConfig) => (/sandbox/i.test(cfg.baseUrl) ? "sandbox" : "production");

/** MX payment statuses as the API reports them. */
export type MxStatus = "Approved" | "Declined" | "Settled" | "Voided" | "Chargedback" | "TicketOnly" | "AuthOnly" | "InProgress" | string;

export interface MxPayment {
  id: number | string;
  merchantId?: number | string;
  status: MxStatus;
  amount: number | string;
  /** Customer fee MX added (MX Advantage), in dollars. */
  surchargeAmount?: number | string;
  surchargeRate?: number | string;
  surchargeLabel?: string;
  tenderType?: string;
  paymentType?: string;
  authCode?: string;
  reference?: string;
  clientReference?: string;
  invoice?: string;
  created?: string;
  settled?: string | null;
  batch?: string | number;
  cardAccount?: { cardType?: string; last4?: string; isDebit?: boolean; token?: string };
  bankAccount?: { last4?: string; type?: string };
  [k: string]: unknown;
}

export interface MxMerchant { id: number | string; name?: string; dba?: string; merchantId?: string; status?: string; [k: string]: unknown }

function raw(cfg: MxConfig) {
  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString("base64");
  return async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T; text: string }> {
    const url = `${cfg.baseUrl}/checkout/v3${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
    } catch (err: any) {
      const cause = err?.cause?.code ?? err?.cause?.message ?? err?.name ?? String(err);
      throw new ProviderError(`MX did not respond (${cause}) at ${url}`, false);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
    if (!res.ok) {
      const detail = json?.message ?? json?.errorMessage ?? json?.details ?? text.slice(0, 300);
      throw new ProviderError(`MX HTTP ${res.status}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`, res.status >= 400 && res.status < 500, res.status);
    }
    if (json === null) throw new ProviderError("MX returned an unreadable response", false);
    return { status: res.status, json, text };
  };
}

export interface SurchargeQuote { total: number; surchargeAmount: number; surchargeRate: number; surchargeLabel: string }

export interface MxClient {
  env: "sandbox" | "production";
  /** Merchants the consumer key can act for. The first call to make on a new key. */
  listMerchants(): Promise<MxMerchant[]>;
  getMerchant(merchantId: string | number): Promise<MxMerchant>;
  /** One-time token (24h) the browser uses to post card data to MX directly. */
  limitedUseToken(merchantId: string | number): Promise<{ token: string; raw: unknown }>;
  getPayment(id: string | number): Promise<MxPayment>;
  listPayments(merchantId: string | number, opts?: { limit?: number; offset?: number; startDate?: string; endDate?: string }): Promise<{ records: MxPayment[]; recordCount?: number }>;
  /** Full or partial return of a settled payment. Amount in dollars. */
  refund(merchantId: string | number, originalPaymentId: string | number, amountDollars: number): Promise<MxPayment>;
  void(paymentId: string | number): Promise<void>;
  listBatches(merchantId: string | number, opts?: { limit?: number }): Promise<{ records: unknown[]; raw: unknown }>;
}

export function mx(cfg: MxConfig): MxClient {
  const call = raw(cfg);
  const q = (o: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") s.set(k, String(v));
    const str = s.toString();
    return str ? `?${str}` : "";
  };
  return {
    env: mxEnvName(cfg),
    async listMerchants() {
      const r = await call("GET", `/merchant${q({ limit: 100 })}`);
      const j: any = r.json;
      return (Array.isArray(j) ? j : j?.records ?? j?.merchants ?? (j?.id ? [j] : [])) as MxMerchant[];
    },
    async getMerchant(id) {
      return (await call<MxMerchant>("GET", `/merchant/${encodeURIComponent(String(id))}`)).json;
    },
    async limitedUseToken(merchantId) {
      const r = await call("POST", `/auth/token/${encodeURIComponent(String(merchantId))}`);
      const j: any = r.json;
      const token = j?.token ?? j?.access_token ?? j?.accessToken ?? (typeof j === "string" ? j : null);
      if (!token) throw new ProviderError("MX returned no token", false);
      return { token: String(token), raw: j };
    },
    async getPayment(id) {
      return (await call<MxPayment>("GET", `/payment/${encodeURIComponent(String(id))}`)).json;
    },
    async listPayments(merchantId, opts = {}) {
      const r = await call("GET", `/payment${q({ merchantId, limit: opts.limit ?? 100, offset: opts.offset, startDate: opts.startDate, endDate: opts.endDate })}`);
      const j: any = r.json;
      return { records: (Array.isArray(j) ? j : j?.records ?? []) as MxPayment[], recordCount: j?.recordCount };
    },
    async refund(merchantId, originalPaymentId, amountDollars) {
      // A Return against the original payment. MX also accepts a negative-amount Sale; this is the documented form.
      const r = await call<MxPayment>("POST", `/payment${q({ echo: "true" })}`, {
        merchantId, paymentType: "Return", amount: amountDollars, originalPaymentId: String(originalPaymentId), source: "API",
      });
      return r.json;
    },
    async void(paymentId) {
      await call("DELETE", `/payment/${encodeURIComponent(String(paymentId))}${q({ force: "true" })}`);
    },
    async listBatches(merchantId, opts = {}) {
      const r = await call("GET", `/batch${q({ merchantId, limit: opts.limit ?? 50 })}`);
      const j: any = r.json;
      return { records: Array.isArray(j) ? j : j?.records ?? [], raw: j };
    },
  };
}

/** Dollars (number or string from MX) -> cents, exactly. */
export function mxCents(v: number | string | undefined | null): number {
  if (v === undefined || v === null || v === "") return 0;
  const s = typeof v === "number" ? v.toFixed(2) : String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`MX amount is not a plain money value: ${s}`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -cents : cents;
}
