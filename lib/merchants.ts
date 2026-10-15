import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config";
import { open, randomSecret, seal } from "./crypto";

/** Tokens pasted from email arrive with line-wrap whitespace and "smart" dashes. Header values cannot contain them. */
export function cleanToken(raw: string): string {
  return raw.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]/g, "");
}
import { Merchant, MerchantSummary } from "./types";

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!client) client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  return client;
}

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

function toMerchant(r: any): Merchant {
  return {
    id: r.id, name: r.name, status: r.status,
    accounting: r.accounting === "quickbooks" ? "quickbooks" : "freshbooks",
    acctAccountId: r.fb_account_id,
    pcBaseUrl: r.pc_base_url, pcSiteId: r.pc_site_id,
    pcAccessToken: r.pc_access_token_enc ? open(r.pc_access_token_enc) : null,
    pcWebhookSecret: r.pc_webhook_secret,
    notifyMode: r.notify_mode, recordOn: r.record_on, reversals: r.reversals,
    bookFees: !!r.book_fees,
    qbTrigger: r.qb_trigger === "sent" ? "sent" : "open",
    qbEnv: r.qb_env === "sandbox" ? "sandbox" : "production",
    qbDepositAccountId: r.qb_deposit_account_id ?? null,
    qbFeeItemId: r.qb_fee_item_id ?? null,
    connectToken: r.connect_token, connectExpiresAt: r.connect_expires_at ? new Date(r.connect_expires_at).getTime() : null,
    createdAt: r.created_at,
  };
}

export interface MerchantInput {
  name: string;
  pcBaseUrl: string;
  pcSiteId: string;
  pcAccessToken?: string | null;
  accounting?: Merchant["accounting"];
  acctAccountId?: string | null;
  notifyMode: "link" | "customer";
  recordOn: "settled" | "captured";
  reversals: "review" | "auto";
  bookFees?: boolean;
  qbTrigger?: Merchant["qbTrigger"];
  qbEnv?: Merchant["qbEnv"];
  qbDepositAccountId?: string | null;
  qbFeeItemId?: string | null;
  status?: Merchant["status"];
}

export async function listMerchants(): Promise<MerchantSummary[]> {
  const rows: any[] = ok(await db().from("merchants").select("*").order("created_at")) ?? [];
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [tokens, callbacks, attention, invoices] = await Promise.all([
    ok(await db().from("fb_tokens").select("merchant_id, access_token").in("merchant_id", ids)) as any[],
    ok(await db().from("fb_callbacks").select("merchant_id").in("merchant_id", ids).eq("verified", true)) as any[],
    ok(await db().from("payment_ledger").select("merchant_id").in("merchant_id", ids).in("state", ["review", "uncertain"])) as any[],
    ok(await db().from("invoice_map").select("merchant_id").in("merchant_id", ids)) as any[],
  ]);
  const count = (list: any[], id: string) => list.filter((x) => x.merchant_id === id).length;
  // A token row only counts if it decrypts; rows from before encryption are ignored.
  const usable = (tokens ?? []).filter((t) => { try { open(t.access_token); return true; } catch { return false; } });
  return rows.map((r) => ({
    ...toMerchant(r),
    acctConnected: count(usable, r.id) > 0,
    webhooksRegistered: count(callbacks ?? [], r.id),
    attention: count(attention ?? [], r.id),
    invoices: count(invoices ?? [], r.id),
  }));
}

export async function getMerchant(id: string): Promise<Merchant | null> {
  const r = ok(await db().from("merchants").select("*").eq("id", id).maybeSingle());
  return r ? toMerchant(r) : null;
}

/** The merchant connected to a FreshBooks account id or a QuickBooks realm id. */
export async function merchantByAcctAccount(kind: Merchant["accounting"], accountId: string): Promise<Merchant | null> {
  if (!accountId) return null;
  const r = ok(await db().from("merchants").select("*").eq("accounting", kind).eq("fb_account_id", accountId).maybeSingle());
  return r ? toMerchant(r) : null;
}

export async function merchantByWebhookSecret(secret: string): Promise<Merchant | null> {
  if (!secret) return null;
  const r = ok(await db().from("merchants").select("*").eq("pc_webhook_secret", secret).maybeSingle());
  return r ? toMerchant(r) : null;
}

export async function merchantByConnectToken(token: string): Promise<Merchant | null> {
  if (!token) return null;
  const r = ok(await db().from("merchants").select("*").eq("connect_token", token).maybeSingle());
  if (!r) return null;
  const m = toMerchant(r);
  if (!m.connectExpiresAt || m.connectExpiresAt < Date.now()) return null;
  return m;
}

/** The merchant that owns a FreshBooks webhook callback id (used for the verification handshake). */
export async function merchantByCallbackId(callbackId: string): Promise<Merchant | null> {
  const cb: any = ok(await db().from("fb_callbacks").select("merchant_id").eq("callback_id", callbackId).maybeSingle());
  return cb ? getMerchant(cb.merchant_id) : null;
}

export async function activeMerchants(): Promise<Merchant[]> {
  const rows: any[] = ok(await db().from("merchants").select("*").eq("status", "active")) ?? [];
  return rows.map(toMerchant);
}

export async function createMerchant(input: MerchantInput): Promise<Merchant> {
  const r = ok(await db().from("merchants").insert({
    name: input.name.trim(),
    status: input.status ?? "setup",
    accounting: input.accounting ?? "freshbooks",
    fb_account_id: input.acctAccountId?.trim() || null,
    pc_base_url: input.pcBaseUrl.trim().replace(/\/+$/, ""),
    pc_site_id: input.pcSiteId.trim(),
    pc_access_token_enc: input.pcAccessToken ? seal(cleanToken(input.pcAccessToken)) : null,
    pc_webhook_secret: randomSecret(),
    notify_mode: input.notifyMode, record_on: input.recordOn, reversals: input.reversals,
    book_fees: input.bookFees ?? false,
    qb_trigger: input.qbTrigger ?? "open",
    qb_env: input.qbEnv ?? "production",
    qb_deposit_account_id: input.qbDepositAccountId ?? null,
    qb_fee_item_id: input.qbFeeItemId ?? null,
  }).select("*").single());
  return toMerchant(r);
}

export async function updateMerchant(id: string, patch: Partial<MerchantInput>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.accounting !== undefined) row.accounting = patch.accounting;
  if (patch.acctAccountId !== undefined) row.fb_account_id = patch.acctAccountId?.trim() || null;
  if (patch.pcBaseUrl !== undefined) row.pc_base_url = patch.pcBaseUrl.trim().replace(/\/+$/, "");
  if (patch.pcSiteId !== undefined) row.pc_site_id = patch.pcSiteId.trim();
  if (patch.pcAccessToken) row.pc_access_token_enc = seal(cleanToken(patch.pcAccessToken));
  if (patch.notifyMode !== undefined) row.notify_mode = patch.notifyMode;
  if (patch.recordOn !== undefined) row.record_on = patch.recordOn;
  if (patch.reversals !== undefined) row.reversals = patch.reversals;
  if (patch.bookFees !== undefined) row.book_fees = patch.bookFees;
  if (patch.qbTrigger !== undefined) row.qb_trigger = patch.qbTrigger;
  if (patch.qbEnv !== undefined) row.qb_env = patch.qbEnv;
  if (patch.qbDepositAccountId !== undefined) row.qb_deposit_account_id = patch.qbDepositAccountId || null;
  if (patch.qbFeeItemId !== undefined) row.qb_fee_item_id = patch.qbFeeItemId || null;
  ok(await db().from("merchants").update(row).eq("id", id));
}

/** A link the merchant opens to approve accounting access. Valid for 7 days. */
export async function issueConnectToken(id: string): Promise<string> {
  const token = randomSecret(24);
  ok(await db().from("merchants").update({
    connect_token: token, connect_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  }).eq("id", id));
  return token;
}
